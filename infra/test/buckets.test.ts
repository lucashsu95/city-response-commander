/**
 * TASK-060 targeted tests — DataBuckets construct
 *
 * Runs without AWS credentials or network access.
 * Uses inline CDK App + Stack construction (no file I/O).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { DataBuckets } from '../lib/constructs/buckets.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function synthStack(
  profile: 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS',
  bucketNames: { raw: string; sop: string; artifact: string },
): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-data-buckets-test`);
  new DataBuckets(stack, 'Buckets', {
    envContext: ctx,
    rawBucketName: bucketNames.raw,
    sopSourceBucketName: bucketNames.sop,
    artifactBucketName: bucketNames.artifact,
  });
  const assembly = app.synth();
  return assembly.stacks[0].template as Record<string, unknown>;
}

function getResources(template: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
}

function getS3Buckets(resources: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::S3::Bucket'),
  );
}

function getBucketPolicies(resources: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::S3::BucketPolicy'),
  );
}

function getAutoDeleteCustomResources(resources: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'Custom::S3AutoDeleteObjects'),
  );
}

function countNonCdkResources(resources: Record<string, Record<string, unknown>>): number {
  return Object.values(resources).filter((r) => {
    const t = r['Type'] as string;
    return t && !t.startsWith('AWS::CDK::');
  }).length;
}

function countCdkAutoResources(resources: Record<string, Record<string, unknown>>): number {
  // Count CDK auto-generated cleanup resources: Lambda + IAM for auto-delete
  return Object.values(resources).filter((r) => {
    const t = r['Type'] as string;
    return t === 'Custom::S3AutoDeleteObjects' || t === 'AWS::Lambda::Function' || t === 'AWS::IAM::Role';
  }).length;
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

const VALID_NAMES = {
  personal: { raw: 'personal-dev-raw-data', sop: 'personal-dev-sop-source', artifact: 'personal-dev-artifacts' },
  competition: { raw: 'competition-raw-data', sop: 'competition-sop-source', artifact: 'competition-artifacts' },
  local: { raw: 'local-raw-data', sop: 'local-sop-source', artifact: 'local-artifacts' },
};

// ─── A. Bucket count and naming ──────────────────────────────────────────────

describe('A. Bucket count and naming', () => {
  it('PERSONAL_AWS_DEV: exactly 3 AWS::S3::Bucket', () => {
    const template = synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal);
    const s3Buckets = getS3Buckets(getResources(template));
    expect(Object.keys(s3Buckets)).toHaveLength(3);
  });

  it('COMPETITION_AWS: exactly 3 AWS::S3::Bucket', () => {
    const template = synthStack('COMPETITION_AWS', VALID_NAMES.competition);
    const s3Buckets = getS3Buckets(getResources(template));
    expect(Object.keys(s3Buckets)).toHaveLength(3);
  });

  it('LOCAL_MOCK: 0 AWS::S3::Bucket', () => {
    const template = synthStack('LOCAL_MOCK', VALID_NAMES.local);
    const s3Buckets = getS3Buckets(getResources(template));
    expect(Object.keys(s3Buckets)).toHaveLength(0);
  });

  it('bucket names come entirely from props', () => {
    const template = synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal);
    const s3Buckets = getS3Buckets(getResources(template));
    const bucketNames = Object.values(s3Buckets).map(
      (b) => (b['Properties'] as Record<string, unknown>)['BucketName'] as string,
    );
    const expected = [VALID_NAMES.personal.raw, VALID_NAMES.personal.sop, VALID_NAMES.personal.artifact];
    for (const name of expected) {
      expect(bucketNames).toContain(name);
    }
  });

  it('changing props names changes bucket names without modifying construct', () => {
    const t1 = synthStack('PERSONAL_AWS_DEV', { raw: 'my-raw', sop: 'my-sop', artifact: 'my-art' });
    const t2 = synthStack('PERSONAL_AWS_DEV', { raw: 'other-raw', sop: 'other-sop', artifact: 'other-art' });

    const names1 = Object.values(getS3Buckets(getResources(t1))).map(
      (b) => (b['Properties'] as Record<string, unknown>)['BucketName'] as string,
    );
    const names2 = Object.values(getS3Buckets(getResources(t2))).map(
      (b) => (b['Properties'] as Record<string, unknown>)['BucketName'] as string,
    );

    expect(names1).not.toEqual(names2);
    expect(names1).toContain('my-raw');
    expect(names2).toContain('other-raw');
  });

  it('duplicate bucket names throw', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');

    expect(
      () =>
        new DataBuckets(stack, 'B1', {
          envContext: ctx,
          rawBucketName: 'dup-raw',
          sopSourceBucketName: 'dup-raw',
          artifactBucketName: 'unique-art',
        }),
    ).toThrow(/must be unique/i);

    expect(
      () =>
        new DataBuckets(stack, 'B2', {
          envContext: ctx,
          rawBucketName: 'raw-abc',
          sopSourceBucketName: 'sop-def',
          artifactBucketName: 'raw-abc',
        }),
    ).toThrow(/must be unique/i);
  });

  it('invalid bucket names throw', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');

    expect(
      () =>
        new DataBuckets(stack, 'B1', {
          envContext: ctx,
          rawBucketName: 'Invalid-Name',
          sopSourceBucketName: 'valid-sop',
          artifactBucketName: 'valid-art',
        }),
    ).toThrow(/valid S3 bucket name/i);

    expect(
      () =>
        new DataBuckets(stack, 'B2', {
          envContext: ctx,
          rawBucketName: '',
          sopSourceBucketName: 'valid-sop',
          artifactBucketName: 'valid-art',
        }),
    ).toThrow(/non-empty string/i);

    expect(
      () =>
        new DataBuckets(stack, 'B3', {
          envContext: ctx,
          rawBucketName: 'ab',
          sopSourceBucketName: 'valid-sop',
          artifactBucketName: 'valid-art',
        }),
    ).toThrow(/valid S3 bucket name/i);

    expect(
      () =>
        new DataBuckets(stack, 'B4', {
          envContext: ctx,
          rawBucketName: '-starts-with-hyphen',
          sopSourceBucketName: 'valid-sop',
          artifactBucketName: 'valid-art',
        }),
    ).toThrow(/valid S3 bucket name/i);
  });
});

// ─── B. Public access blocking ───────────────────────────────────────────────

describe('B. Public access blocking', () => {
  const profiles = ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as const;

  for (const profile of profiles) {
    describe(`${profile}`, () => {
      const names = profile === 'PERSONAL_AWS_DEV' ? VALID_NAMES.personal : VALID_NAMES.competition;
      let s3Buckets: Record<string, Record<string, unknown>>;

      beforeEach(() => {
        s3Buckets = getS3Buckets(getResources(synthStack(profile, names)));
      });

      it('BlockPublicAcls = true for all 3 buckets', () => {
        for (const [id, bucket] of Object.entries(s3Buckets)) {
          const block = (bucket['Properties'] as Record<string, unknown>)['PublicAccessBlockConfiguration'] as Record<string, unknown>;
          expect(block?.['BlockPublicAcls'], `${id} BlockPublicAcls`).toBe(true);
        }
      });

      it('IgnorePublicAcls = true for all 3 buckets', () => {
        for (const [id, bucket] of Object.entries(s3Buckets)) {
          const block = (bucket['Properties'] as Record<string, unknown>)['PublicAccessBlockConfiguration'] as Record<string, unknown>;
          expect(block?.['IgnorePublicAcls'], `${id} IgnorePublicAcls`).toBe(true);
        }
      });

      it('BlockPublicPolicy = true for all 3 buckets', () => {
        for (const [id, bucket] of Object.entries(s3Buckets)) {
          const block = (bucket['Properties'] as Record<string, unknown>)['PublicAccessBlockConfiguration'] as Record<string, unknown>;
          expect(block?.['BlockPublicPolicy'], `${id} BlockPublicPolicy`).toBe(true);
        }
      });

      it('RestrictPublicBuckets = true for all 3 buckets', () => {
        for (const [id, bucket] of Object.entries(s3Buckets)) {
          const block = (bucket['Properties'] as Record<string, unknown>)['PublicAccessBlockConfiguration'] as Record<string, unknown>;
          expect(block?.['RestrictPublicBuckets'], `${id} RestrictPublicBuckets`).toBe(true);
        }
      });

      // CDK L2 omits PublicReadAccess when implied by BlockPublicAccess
      it('no PublicReadAccess property present for all 3 buckets (implied false by BlockPublicAccess)', () => {
        for (const bucket of Object.values(s3Buckets)) {
          expect((bucket['Properties'] as Record<string, unknown>)['PublicReadAccess']).toBeUndefined();
        }
      });

      // CDK L2 never sets AccessControl
      it('no AccessControl: PublicRead for all 3 buckets', () => {
        for (const bucket of Object.values(s3Buckets)) {
          expect((bucket['Properties'] as Record<string, unknown>)['AccessControl']).toBeUndefined();
        }
      });
    });
  }
});

// ─── C. Encryption and SSL ──────────────────────────────────────────────────

describe('C. Encryption and SSL', () => {
  const profiles = ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as const;

  for (const profile of profiles) {
    describe(`${profile}`, () => {
      const names = profile === 'PERSONAL_AWS_DEV' ? VALID_NAMES.personal : VALID_NAMES.competition;
      let resources: Record<string, Record<string, unknown>>;
      let s3Buckets: Record<string, Record<string, unknown>>;
      let bucketPolicies: Record<string, Record<string, unknown>>;

      beforeEach(() => {
        resources = getResources(synthStack(profile, names));
        s3Buckets = getS3Buckets(resources);
        bucketPolicies = getBucketPolicies(resources);
      });

      it('SSE-S3 (AES256) encryption for all 3 buckets', () => {
        for (const [id, bucket] of Object.entries(s3Buckets)) {
          const enc = (bucket['Properties'] as Record<string, unknown>)['BucketEncryption'] as Record<string, unknown>;
          const rules = enc?.['ServerSideEncryptionConfiguration'] as Record<string, unknown>[];
          const byDefault = (rules?.[0] as Record<string, unknown>)?.['ServerSideEncryptionByDefault'] as Record<string, unknown>;
          expect(byDefault?.['SSEAlgorithm'], `${id} SSEAlgorithm`).toMatch(/^AES256$/);
        }
      });

      it('VersioningConfiguration = Enabled for all 3 buckets', () => {
        for (const [id, bucket] of Object.entries(s3Buckets)) {
          const vc = (bucket['Properties'] as Record<string, unknown>)['VersioningConfiguration'] as Record<string, unknown>;
          expect(vc?.['Status'], `${id} VersioningConfiguration.Status`).toBe('Enabled');
        }
      });

      // CDK creates BucketPolicy as a separate resource when enforceSSL=true
      it('exactly 3 AWS::S3::BucketPolicy resources exist (one per bucket)', () => {
        expect(Object.keys(bucketPolicies)).toHaveLength(3);
      });

      it('enforceSSL policy denies non-HTTPS (aws:SecureTransport=false string) for all 3 buckets', () => {
        for (const [id, policy] of Object.entries(bucketPolicies)) {
          expect(policy['Properties'], `${id} Properties`).toBeDefined();
          const props = policy['Properties'] as Record<string, unknown>;
          expect(props['Bucket'], `${id} Bucket ref`).toBeDefined();
          const doc = (props['PolicyDocument'] as Record<string, unknown>) as Record<string, unknown>;
          const statements = (doc?.['Statement'] as Record<string, unknown>[]) ?? [];
          // The Deny statement for insecure transport
          const sslDeny = statements.find(
            (s) =>
              s['Effect'] === 'Deny' &&
              (((s['Condition'] as Record<string, unknown>)?.['Bool'] as Record<string, unknown>)?.['aws:SecureTransport'] as unknown) === 'false',
          );
          expect(sslDeny, `${id} must have aws:SecureTransport=false Deny`).toBeDefined();
        }
      });
    });
  }
});

// ─── D. Removal lifecycle ───────────────────────────────────────────────────

describe('D. Removal lifecycle', () => {
  it('PERSONAL_AWS_DEV: DeletionPolicy = Delete for all 3 buckets', () => {
    const template = synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal);
    const s3Buckets = getS3Buckets(getResources(template));
    for (const [id, bucket] of Object.entries(s3Buckets)) {
      expect(bucket['DeletionPolicy'], `${id} DeletionPolicy`).toBe('Delete');
    }
  });

  it('PERSONAL_AWS_DEV: UpdateReplacePolicy = Delete for all 3 buckets', () => {
    const template = synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal);
    const s3Buckets = getS3Buckets(getResources(template));
    for (const [id, bucket] of Object.entries(s3Buckets)) {
      expect(bucket['UpdateReplacePolicy'], `${id} UpdateReplacePolicy`).toBe('Delete');
    }
  });

  it('PERSONAL_AWS_DEV: 3 Custom::S3AutoDeleteObjects (CDK auto-cleanup, not runtime)', () => {
    const template = synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal);
    const autoDelete = getAutoDeleteCustomResources(getResources(template));
    expect(Object.keys(autoDelete)).toHaveLength(3);
  });

  it('COMPETITION_AWS: DeletionPolicy = Retain for all 3 buckets', () => {
    const template = synthStack('COMPETITION_AWS', VALID_NAMES.competition);
    const s3Buckets = getS3Buckets(getResources(template));
    for (const [id, bucket] of Object.entries(s3Buckets)) {
      expect(bucket['DeletionPolicy'], `${id} DeletionPolicy`).toBe('Retain');
    }
  });

  it('COMPETITION_AWS: UpdateReplacePolicy = Retain for all 3 buckets', () => {
    const template = synthStack('COMPETITION_AWS', VALID_NAMES.competition);
    const s3Buckets = getS3Buckets(getResources(template));
    for (const [id, bucket] of Object.entries(s3Buckets)) {
      expect(bucket['UpdateReplacePolicy'], `${id} UpdateReplacePolicy`).toBe('Retain');
    }
  });

  it('COMPETITION_AWS: 0 Custom::S3AutoDeleteObjects', () => {
    const template = synthStack('COMPETITION_AWS', VALID_NAMES.competition);
    const autoDelete = getAutoDeleteCustomResources(getResources(template));
    expect(Object.keys(autoDelete)).toHaveLength(0);
  });

  it('LOCAL_MOCK: 0 AWS::S3::Bucket', () => {
    const template = synthStack('LOCAL_MOCK', VALID_NAMES.local);
    const s3Buckets = getS3Buckets(getResources(template));
    expect(Object.keys(s3Buckets)).toHaveLength(0);
  });

  it('LOCAL_MOCK: 0 Custom::S3AutoDeleteObjects', () => {
    const template = synthStack('LOCAL_MOCK', VALID_NAMES.local);
    const autoDelete = getAutoDeleteCustomResources(getResources(template));
    expect(Object.keys(autoDelete)).toHaveLength(0);
  });

  it('LOCAL_MOCK: 0 non-CDK AWS resources', () => {
    const template = synthStack('LOCAL_MOCK', VALID_NAMES.local);
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });
});

// ─── E. Compatibility ─────────────────────────────────────────────────────

describe('E. Compatibility', () => {
  it('bucket names contain no 12-digit account literal', () => {
    for (const names of [VALID_NAMES.personal, VALID_NAMES.competition]) {
      for (const name of Object.values(names)) {
        expect(name).not.toMatch(/\d{12}/);
      }
    }
  });

  it('bucket names contain no hard-coded region', () => {
    for (const names of [VALID_NAMES.personal, VALID_NAMES.competition]) {
      for (const name of Object.values(names)) {
        expect(name).not.toMatch(/ap-northeast-1|us-east-1|us-west-1|us-west-2/);
      }
    }
  });

  it('PERSONAL_AWS_DEV and COMPETITION_AWS share the same construct but differ in removal policy', () => {
    const t1 = synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal);
    const t2 = synthStack('COMPETITION_AWS', VALID_NAMES.competition);

    const buckets1 = getS3Buckets(getResources(t1));
    const buckets2 = getS3Buckets(getResources(t2));

    expect(Object.keys(buckets1)).toHaveLength(3);
    expect(Object.keys(buckets2)).toHaveLength(3);

    for (const b of [...Object.values(buckets1), ...Object.values(buckets2)]) {
      expect(b['Type']).toBe('AWS::S3::Bucket');
    }

    const policies1 = Object.values(buckets1).map((b) => b['DeletionPolicy']);
    const policies2 = Object.values(buckets2).map((b) => b['DeletionPolicy']);
    expect(policies1).toEqual(['Delete', 'Delete', 'Delete']);
    expect(policies2).toEqual(['Retain', 'Retain', 'Retain']);
  });

  it('synth succeeds without AWS credentials', () => {
    expect(() => synthStack('PERSONAL_AWS_DEV', VALID_NAMES.personal)).not.toThrow();
    expect(() => synthStack('COMPETITION_AWS', VALID_NAMES.competition)).not.toThrow();
    expect(() => synthStack('LOCAL_MOCK', VALID_NAMES.local)).not.toThrow();
  });
});
