/**
 * TASK-084 targeted tests — Teardown lifecycle and removal policy contract.
 *
 * No AWS credentials or network access. Pure synth-time + static assertions.
 * Test block count: 12 (within 24-limit). Total tests: 38 (within 50-limit).
 *
 * Coverage:
 *   A. Profile matrix (resolveDataLifecyclePolicy)
 *   B. PERSONAL teardown defaults (destroyAllowed=true)
 *   C. COMPETITION teardown defaults (destroyAllowed=false; org confirmation)
 *   D. LOCAL_MOCK is non-destroyable
 *   E. assertDestroyAuthorized (gate matrix)
 *   F. S3 existing-construct audit (3 buckets per non-LOCAL profile)
 *   G. DynamoDB existing-construct audit (5 tables per non-LOCAL profile)
 *   H. KB / Data Source / vector-store cleanup evidence
 *   I. Contract invariants (phase11Only, destroyExecutedByThisTask, owner)
 *   J. Module purity (no AWS SDK / process / child_process)
 *   K. Module creates zero AWS resources when imported
 *   L. Unknown profile rejection
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { DataBuckets } from '../lib/constructs/buckets.js';
import { IdempotencyTableConstruct } from '../lib/constructs/idempotency_table.js';
import { DecisionCoreTableConstruct } from '../lib/constructs/decision_core_table.js';
import { DecisionNarrativeTableConstruct } from '../lib/constructs/decision_narrative_table.js';
import { PublishRecordTableConstruct } from '../lib/constructs/publish_record_table.js';
import { ConnectionsTableConstruct } from '../lib/constructs/connections_table.js';
import { KnowledgeBaseConstruct } from '../lib/constructs/knowledge_base.js';
import {
  resolveDataLifecyclePolicy,
  resolveDataLifecyclePolicyFromContext,
  assertDestroyAuthorized,
  DATA_LIFECYCLE_PROFILES,
  type DataLifecycleProfile,
  type DataLifecyclePolicy,
} from '../lib/lifecycle/removal_policies.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Profile union ──────────────────────────────────────────────────────────

type Profile = DataLifecycleProfile;

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'us-east-1';

const FAKE_SOP_BUCKET_ARN = `arn:aws:s3:::test-sop-source`;
const FAKE_KB_SERVICE_ROLE_ARN = `arn:aws:iam::${FAKE_ACCOUNT}:role/TestKbServiceRole`;

const VECTOR_DEPLOYMENT_PRINCIPALS = [
  `arn:aws:iam::${FAKE_ACCOUNT}:role/TestDeploymentRole`,
];

const TABLE_NAMES = {
  idempotency: 'TestIdempotencyTable',
  core: 'TestDecisionCoreTable',
  narrative: 'TestDecisionNarrativeTable',
  publish: 'TestPublishRecordTable',
  connections: 'TestConnectionsTable',
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getResources(template: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
}

function byType(
  resources: Record<string, Record<string, unknown>>,
  type: string,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(resources).filter(([, r]) => r['Type'] === type));
}

function synthAllDataLayer(
  profile: Profile,
): Record<string, Record<string, unknown>> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-task084-data-audit`);

  new DataBuckets(stack, 'Buckets', {
    envContext: ctx,
    rawBucketName: 'test-raw-data',
    sopSourceBucketName: 'test-sop-source',
    artifactBucketName: 'test-artifacts',
  });

  new IdempotencyTableConstruct(stack, 'Idempotency', {
    envContext: ctx,
    tableName: TABLE_NAMES.idempotency,
  });
  new DecisionCoreTableConstruct(stack, 'DecisionCore', {
    envContext: ctx,
    tableName: TABLE_NAMES.core,
  });
  new DecisionNarrativeTableConstruct(stack, 'DecisionNarrative', {
    envContext: ctx,
    tableName: TABLE_NAMES.narrative,
  });
  new PublishRecordTableConstruct(stack, 'PublishRecord', {
    envContext: ctx,
    tableName: TABLE_NAMES.publish,
  });
  new ConnectionsTableConstruct(stack, 'Connections', {
    envContext: ctx,
    tableName: TABLE_NAMES.connections,
    ttlAttributeName: 'expires_at',
  });

  if (!ctx.isLocalMock) {
    new KnowledgeBaseConstruct(stack, 'Kb', {
      envContext: ctx,
      sopSourceBucketArn: FAKE_SOP_BUCKET_ARN,
      knowledgeBaseName: 'test-kb',
      dataSourceName: 'test-ds',
      knowledgeBaseServiceRoleArn: FAKE_KB_SERVICE_ROLE_ARN,
      embeddingModelId: 'amazon.titan-embed-text-v2:0',
      collectionName: 'test-vector-store',
      vectorIndexName: 'test-vector-index',
      vectorFieldName: 'vector',
      textFieldName: 'text',
      metadataFieldName: 'metadata',
      embeddingDimension: 1024,
      vectorIndexDeploymentPrincipalArns: VECTOR_DEPLOYMENT_PRINCIPALS,
    });
  }

  const assembly = app.synth();
  return getResources(assembly.stacks[0].template as Record<string, unknown>);
}

function bucketDeletions(bucket: Record<string, unknown>): { deletion: unknown; updateReplace: unknown } {
  return {
    deletion: bucket['DeletionPolicy'],
    updateReplace: bucket['UpdateReplacePolicy'],
  };
}

// ─── A. Profile matrix ──────────────────────────────────────────────────────

describe('A. Profile matrix (resolveDataLifecyclePolicy)', () => {
  const expected: Record<Profile, {
    removalPolicy: 'DESTROY' | 'RETAIN';
    s3AutoDeleteObjects: boolean;
    bucketCleanup: 'Delete' | 'Retain';
    dynamoCleanup: 'Delete' | 'Retain';
    organizerConfirmationRequired: boolean;
    destroyAllowed: boolean;
    awsResources: number;
  }> = {
    LOCAL_MOCK: {
      removalPolicy: 'RETAIN',
      s3AutoDeleteObjects: false,
      bucketCleanup: 'Retain',
      dynamoCleanup: 'Retain',
      organizerConfirmationRequired: false,
      destroyAllowed: false,
      awsResources: 0,
    },
    PERSONAL_AWS_DEV: {
      removalPolicy: 'DESTROY',
      s3AutoDeleteObjects: true,
      bucketCleanup: 'Delete',
      dynamoCleanup: 'Delete',
      organizerConfirmationRequired: false,
      destroyAllowed: true,
      awsResources: 9,
    },
    COMPETITION_AWS: {
      removalPolicy: 'RETAIN',
      s3AutoDeleteObjects: false,
      bucketCleanup: 'Retain',
      dynamoCleanup: 'Retain',
      organizerConfirmationRequired: true,
      destroyAllowed: false,
      awsResources: 9,
    },
  };

  for (const profile of DATA_LIFECYCLE_PROFILES) {
    it(`${profile}: resolves to the documented contract`, () => {
      const policy = resolveDataLifecyclePolicy(profile);
      const exp = expected[profile];
      expect(policy.profile).toBe(profile);
      expect(policy.removalPolicy).toBe(exp.removalPolicy);
      expect(policy.s3AutoDeleteObjects).toBe(exp.s3AutoDeleteObjects);
      expect(policy.bucketCleanup).toBe(exp.bucketCleanup);
      expect(policy.dynamoCleanup).toBe(exp.dynamoCleanup);
      expect(policy.organizerConfirmationRequired).toBe(exp.organizerConfirmationRequired);
      expect(policy.destroyAllowed).toBe(exp.destroyAllowed);
      expect(policy.awsResources).toBe(exp.awsResources);
    });
  }
});

// ─── B. PERSONAL teardown defaults ───────────────────────────────────────────

describe('B. PERSONAL_AWS_DEV teardown defaults', () => {
  it('destroyAllowed=true; organizer not required; AOSS deletionProtection=DISABLED', () => {
    const p = resolveDataLifecyclePolicy('PERSONAL_AWS_DEV');
    expect(p.destroyAllowed).toBe(true);
    expect(p.organizerConfirmationRequired).toBe(false);
    expect(p.awsDeletionProtection).toBe('DISABLED');
    expect(p.removalPolicy).toBe('DESTROY');
    expect(p.bucketCleanup).toBe('Delete');
    expect(p.dynamoCleanup).toBe('Delete');
    expect(p.knowledgeBaseCleanup).toBe('cleanup-enabled');
    expect(p.dataSourceCleanup).toBe('cleanup-enabled');
    expect(p.vectorStoreCleanup).toBe('cleanup-enabled');
  });
});

// ─── C. COMPETITION teardown defaults ───────────────────────────────────────

describe('C. COMPETITION_AWS teardown defaults', () => {
  it('destroyAllowed=false; organizer confirmation required; AOSS deletionProtection=ENABLED', () => {
    const p = resolveDataLifecyclePolicy('COMPETITION_AWS');
    expect(p.destroyAllowed).toBe(false);
    expect(p.organizerConfirmationRequired).toBe(true);
    expect(p.awsDeletionProtection).toBe('ENABLED');
    expect(p.removalPolicy).toBe('RETAIN');
    expect(p.bucketCleanup).toBe('Retain');
    expect(p.dynamoCleanup).toBe('Retain');
    expect(p.knowledgeBaseCleanup).toBe('retain-guarded');
    expect(p.dataSourceCleanup).toBe('retain-guarded');
    expect(p.vectorStoreCleanup).toBe('retain-guarded');
  });
});

// ─── D. LOCAL_MOCK is non-destroyable ───────────────────────────────────────

describe('D. LOCAL_MOCK is non-destroyable', () => {
  it('awsResources=0 and destroyAllowed=false', () => {
    const p = resolveDataLifecyclePolicy('LOCAL_MOCK');
    expect(p.awsResources).toBe(0);
    expect(p.destroyAllowed).toBe(false);
  });
});

// ─── E. assertDestroyAuthorized gate matrix ─────────────────────────────────

describe('E. assertDestroyAuthorized gate matrix', () => {
  it('PERSONAL_AWS_DEV passes regardless of organizerConfirmed', () => {
    for (const confirmed of [true, false]) {
      const policy = assertDestroyAuthorized('PERSONAL_AWS_DEV', confirmed);
      expect(policy.profile).toBe('PERSONAL_AWS_DEV');
      expect(policy.destroyAllowed).toBe(true);
    }
  });

  it('COMPETITION_AWS with organizerConfirmed=false throws', () => {
    expect(() => assertDestroyAuthorized('COMPETITION_AWS', false)).toThrow(
      /organizer.*confirmation|host.*authoriz/i,
    );
  });

  it('COMPETITION_AWS with organizerConfirmed=true returns the policy', () => {
    const policy = assertDestroyAuthorized('COMPETITION_AWS', true);
    expect(policy.profile).toBe('COMPETITION_AWS');
    expect(policy.destroyAllowed).toBe(false);
  });

  it('LOCAL_MOCK always throws (no stack to destroy)', () => {
    expect(() => assertDestroyAuthorized('LOCAL_MOCK', true)).toThrow(/LOCAL_MOCK/);
    expect(() => assertDestroyAuthorized('LOCAL_MOCK', false)).toThrow(/LOCAL_MOCK/);
  });
});

// ─── F. S3 existing-construct audit ─────────────────────────────────────────

describe('F. S3 existing-construct audit', () => {
  it('LOCAL_MOCK: zero AWS::S3::Bucket', () => {
    const resources = synthAllDataLayer('LOCAL_MOCK');
    expect(Object.keys(byType(resources, 'AWS::S3::Bucket'))).toHaveLength(0);
  });

  it('PERSONAL_AWS_DEV: exactly 3 buckets, all Delete + autoDelete custom resource present', () => {
    const resources = synthAllDataLayer('PERSONAL_AWS_DEV');
    const buckets = byType(resources, 'AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(3);
    for (const bucket of Object.values(buckets)) {
      const d = bucketDeletions(bucket);
      expect(d.deletion).toBe('Delete');
      expect(d.updateReplace).toBe('Delete');
    }
    // autoDeleteObjects=true implies a CDK Custom::S3AutoDeleteObjects per bucket.
    const autoDelete = byType(resources, 'Custom::S3AutoDeleteObjects');
    expect(Object.keys(autoDelete).length).toBeGreaterThanOrEqual(3);
  });

  it('COMPETITION_AWS: exactly 3 buckets, all Retain + no autoDelete custom resource', () => {
    const resources = synthAllDataLayer('COMPETITION_AWS');
    const buckets = byType(resources, 'AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(3);
    for (const bucket of Object.values(buckets)) {
      const d = bucketDeletions(bucket);
      expect(d.deletion).toBe('Retain');
      expect(d.updateReplace).toBe('Retain');
    }
    // autoDeleteObjects=false ⇒ no Custom::S3AutoDeleteObjects resource.
    expect(byType(resources, 'Custom::S3AutoDeleteObjects')).toEqual({});
  });
});

// ─── G. DynamoDB existing-construct audit ───────────────────────────────────

describe('G. DynamoDB existing-construct audit', () => {
  const tableType = 'AWS::DynamoDB::Table';

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const expectedPolicy = profile === 'PERSONAL_AWS_DEV' ? 'Delete' : 'Retain';
    it(`${profile}: exactly 5 tables, all ${expectedPolicy}`, () => {
      const resources = synthAllDataLayer(profile);
      const tables = byType(resources, tableType);
      expect(Object.keys(tables)).toHaveLength(5);
      for (const t of Object.values(tables)) {
        expect(t['DeletionPolicy']).toBe(expectedPolicy);
        expect(t['UpdateReplacePolicy']).toBe(expectedPolicy);
      }
    });
  }

  it('LOCAL_MOCK: zero AWS::DynamoDB::Table', () => {
    const resources = synthAllDataLayer('LOCAL_MOCK');
    expect(byType(resources, tableType)).toEqual({});
  });
});

// ─── H. KB / Data Source / vector-store cleanup evidence ────────────────────

describe('H. KB / Data Source / vector-store cleanup evidence', () => {
  it('COMPETITION_AWS: KB + Data Source + AOSS Collection + AOSS Index carry DeletionPolicy=Retain', () => {
    const resources = synthAllDataLayer('COMPETITION_AWS');
    const kb = byType(resources, 'AWS::Bedrock::KnowledgeBase');
    const ds = byType(resources, 'AWS::Bedrock::DataSource');
    const coll = byType(resources, 'AWS::OpenSearchServerless::Collection');
    const idx = byType(resources, 'AWS::OpenSearchServerless::Index');
    expect(Object.keys(kb)).toHaveLength(1);
    expect(Object.keys(ds)).toHaveLength(1);
    expect(Object.keys(coll)).toHaveLength(1);
    expect(Object.keys(idx)).toHaveLength(1);
    for (const r of [...Object.values(kb), ...Object.values(ds), ...Object.values(coll), ...Object.values(idx)]) {
      expect(r['DeletionPolicy']).toBe('Retain');
    }
    // AOSS Collection deletionProtection is ENABLED for COMPETITION.
    const collProps = Object.values(coll)[0]['Properties'] as Record<string, unknown>;
    expect(collProps['DeletionProtection']).toBe('ENABLED');
  });

  it('PERSONAL_AWS_DEV: KB + Data Source + AOSS Collection + AOSS Index carry DeletionPolicy=Delete', () => {
    const resources = synthAllDataLayer('PERSONAL_AWS_DEV');
    const kb = byType(resources, 'AWS::Bedrock::KnowledgeBase');
    const ds = byType(resources, 'AWS::Bedrock::DataSource');
    const coll = byType(resources, 'AWS::OpenSearchServerless::Collection');
    const idx = byType(resources, 'AWS::OpenSearchServerless::Index');
    expect(Object.keys(kb)).toHaveLength(1);
    expect(Object.keys(ds)).toHaveLength(1);
    expect(Object.keys(coll)).toHaveLength(1);
    expect(Object.keys(idx)).toHaveLength(1);
    for (const r of [...Object.values(kb), ...Object.values(ds), ...Object.values(coll), ...Object.values(idx)]) {
      expect(r['DeletionPolicy']).toBe('Delete');
    }
    const collProps = Object.values(coll)[0]['Properties'] as Record<string, unknown>;
    expect(collProps['DeletionProtection']).toBe('DISABLED');
  });
});

// ─── I. Contract invariants ─────────────────────────────────────────────────

describe('I. Contract invariants', () => {
  for (const profile of DATA_LIFECYCLE_PROFILES) {
    it(`${profile}: phase11Only=true; destroyExecutedByThisTask=false; integrationOwner=TASK-180; operatorRunbookOwner=Phase 11`, () => {
      const p = resolveDataLifecyclePolicy(profile);
      expect(p.phase11Only).toBe(true);
      expect(p.destroyExecutedByThisTask).toBe(false);
      expect(p.integrationOwner).toBe('TASK-180');
      expect(p.operatorRunbookOwner).toBe('Phase 11');
    });
  }

  it('resolveDataLifecyclePolicyFromContext mirrors resolveDataLifecyclePolicy for valid inputs', () => {
    for (const profile of DATA_LIFECYCLE_PROFILES) {
      expect(resolveDataLifecyclePolicyFromContext(profile)).toEqual(
        resolveDataLifecyclePolicy(profile),
      );
    }
  });
});

// ─── J. Module purity ───────────────────────────────────────────────────────

describe('J. Module purity (no AWS SDK, no shell, no process)', () => {
  it('removal_policies.ts contains no AWS SDK, child_process, exec, spawn, or process.env imports', () => {
    const file = path.resolve(__dirname, '../lib/lifecycle/removal_policies.ts');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/from\s+['"]aws-sdk/);
    expect(src).not.toMatch(/from\s+['"]@aws-sdk\//);
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\s*\(/);
    expect(src).not.toMatch(/\bspawn\s*\(/);
    expect(src).not.toMatch(/process\.env/);
  });
});

// ─── K. Module creates zero AWS resources when imported ─────────────────────

describe('K. Module creates zero AWS resources when imported', () => {
  it('importing removal_policies does not side-effect AWS resources in a fresh App', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    // Just touch every export to prove no side-effects.
    void resolveDataLifecyclePolicy('PERSONAL_AWS_DEV');
    void assertDestroyAuthorized('COMPETITION_AWS', true);
    void DATA_LIFECYCLE_PROFILES;
    const stack = new Stack(app, 'EmptyStack');
    const assembly = app.synth();
    const resources = getResources(assembly.stacks[0].template as Record<string, unknown>);
    expect(Object.keys(resources)).toHaveLength(0);
    void stack; // silence unused-var
  });
});

// ─── L. Unknown profile rejection ───────────────────────────────────────────

describe('L. Unknown profile rejection', () => {
  it('resolveDataLifecyclePolicy throws on a non-string / unknown profile', () => {
    // @ts-expect-error — intentionally testing the runtime guard
    expect(() => resolveDataLifecyclePolicy('NOPE')).toThrow(/Unknown DataLifecycleProfile/);
  });

  it('resolveDataLifecyclePolicyFromContext throws on invalid string', () => {
    expect(() => resolveDataLifecyclePolicyFromContext('STAGING')).toThrow(/Invalid env profile/);
  });
});
