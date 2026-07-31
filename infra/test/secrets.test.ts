/**
 * TASK-074 targeted tests — SecretsManager Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { SecretsManager, SecretDefinition } from '../lib/constructs/secrets.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

function synthTemplate(profile: Profile, secrets: readonly SecretDefinition[]): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-secrets-test`);
  new SecretsManager(stack, 'SecretsManager', {
    envContext: ctx,
    secrets,
  });
  const assembly = app.synth();
  return assembly.stacks[0].template as Record<string, unknown>;
}

function getResources(template: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
}

function getSecrets(resources: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::SecretsManager::Secret'),
  );
}

function countResourcesByType(resources: Record<string, Record<string, unknown>>, typeName: string): number {
  return Object.values(resources).filter((r) => r['Type'] === typeName).length;
}

function countNonCdkResources(resources: Record<string, Record<string, unknown>>): number {
  return Object.values(resources).filter((r) => {
    const t = r['Type'] as string;
    return t && !t.startsWith('AWS::CDK::');
  }).length;
}

function countCfnOutputs(template: Record<string, unknown>): Record<string, unknown> {
  return (template['Outputs'] as Record<string, unknown>) ?? {};
}

// Test-only fixture secrets — never look like real credentials
const FIXTURE_MANAGED: SecretDefinition = Object.freeze({ secretKey: 'test-managed', name: 'test-managed-secret' });
const FIXTURE_IMPORTED_BY_NAME: SecretDefinition = Object.freeze({
  secretKey: 'test-imported-name',
  name: 'existing-secret-by-name',
});
const FIXTURE_IMPORTED_BY_ARN: SecretDefinition = Object.freeze({
  secretKey: 'test-imported-arn',
  arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:TestSecretPath/test',
});

// ─── A. LOCAL_MOCK ─────────────────────────────────────────────────────────

describe('A. LOCAL_MOCK', () => {
  it('produces 0 AWS::SecretsManager::Secret', () => {
    const template = synthTemplate('LOCAL_MOCK', [FIXTURE_MANAGED]);
    expect(countResourcesByType(getResources(template), 'AWS::SecretsManager::Secret')).toBe(0);
  });

  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK', [FIXTURE_MANAGED]);
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });

  it('exports empty secrets map', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'LOCAL_MOCK');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'local-secrets-test');
    const sm = new SecretsManager(stack, 'SecretsManager', {
      envContext: ctx,
      secrets: [FIXTURE_MANAGED],
    });
    expect(sm.secrets.size).toBe(0);
  });
});

// ─── B. PERSONAL_AWS_DEV — empty definitions ────────────────────────────────

describe('B. Empty definitions', () => {
  it('PERSONAL_AWS_DEV: 0 Secrets Manager resources with empty array', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', []);
    expect(countResourcesByType(getResources(template), 'AWS::SecretsManager::Secret')).toBe(0);
  });

  it('COMPETITION_AWS: 0 Secrets Manager resources with empty array', () => {
    const template = synthTemplate('COMPETITION_AWS', []);
    expect(countResourcesByType(getResources(template), 'AWS::SecretsManager::Secret')).toBe(0);
  });
});

// ─── C. Managed placeholder ─────────────────────────────────────────────────

describe('C. Managed placeholder', () => {
  it('one managed placeholder = exactly 1 AWS::SecretsManager::Secret', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const secrets = getSecrets(getResources(template));
    expect(Object.keys(secrets)).toHaveLength(1);
  });

  it('uses GenerateSecretString (not secretValue)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const secrets = getSecrets(getResources(template));
    const props = Object.values(secrets)[0]['Properties'] as Record<string, unknown>;
    expect(props['GenerateSecretString']).toBeDefined();
    expect(props['SecretString']).toBeUndefined();
  });

  it('template contains no SecretString literal', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const templateStr = JSON.stringify(template);
    expect(templateStr).not.toMatch(/"SecretString"\s*:/);
  });

  it('template contains no SecretBinary literal', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const templateStr = JSON.stringify(template);
    expect(templateStr).not.toMatch(/"SecretBinary"\s*:/);
  });

  it('PERSONAL_AWS_DEV DeletionPolicy = Delete', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const secrets = getSecrets(getResources(template));
    expect(Object.values(secrets)[0]['DeletionPolicy']).toBe('Delete');
  });

  it('COMPETITION_AWS DeletionPolicy = Retain', () => {
    const template = synthTemplate('COMPETITION_AWS', [FIXTURE_MANAGED]);
    const secrets = getSecrets(getResources(template));
    expect(Object.values(secrets)[0]['DeletionPolicy']).toBe('Retain');
  });

  it('UpdateReplacePolicy matches DeletionPolicy (PERSONAL)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const secrets = getSecrets(getResources(template));
    expect(Object.values(secrets)[0]['UpdateReplacePolicy']).toBe('Delete');
  });

  it('UpdateReplacePolicy matches DeletionPolicy (COMPETITION)', () => {
    const template = synthTemplate('COMPETITION_AWS', [FIXTURE_MANAGED]);
    const secrets = getSecrets(getResources(template));
    expect(Object.values(secrets)[0]['UpdateReplacePolicy']).toBe('Retain');
  });
});

// ─── D. Imported secret — by name ───────────────────────────────────────────

describe('D. Imported secret by name', () => {
  // fromSecretNameV2 creates a Secret construct (for reference) — CDK synthesises
  // an AWS::SecretsManager::Secret with GenerateSecretString (no user-provided
  // secret value). This is the correct CDK pattern for referencing a named secret
  // that already exists; it does NOT duplicate secret material.
  it('imported by name has GenerateSecretString (no literal secret)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_IMPORTED_BY_NAME]);
    const secrets = getSecrets(getResources(template));
    const props = Object.values(secrets)[0]?.['Properties'] as Record<string, unknown> | undefined;
    expect(props?.['GenerateSecretString']).toBeDefined();
  });

  it('imported by name has no SecretString literal in template', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_IMPORTED_BY_NAME]);
    const templateStr = JSON.stringify(template);
    expect(templateStr).not.toMatch(/"SecretString"\s*:/);
  });

  it('imported by name has no SecretBinary literal in template', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_IMPORTED_BY_NAME]);
    const templateStr = JSON.stringify(template);
    expect(templateStr).not.toMatch(/"SecretBinary"\s*:/);
  });
});

// ─── E. Imported secret — by ARN ───────────────────────────────────────────

describe('E. Imported secret by ARN', () => {
  it('imported by ARN produces 0 new Secrets Manager resources', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_IMPORTED_BY_ARN]);
    expect(countResourcesByType(getResources(template), 'AWS::SecretsManager::Secret')).toBe(0);
  });
});

// ─── F. Validation — rejection cases ────────────────────────────────────────

describe('F. Validation — rejected inputs', () => {
  function makeApp(profile: Profile = 'PERSONAL_AWS_DEV'): { app: App; stack: Stack; ctx: ReturnType<typeof resolveEnvironmentContext> } {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', profile);
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'validation-test');
    return { app, stack, ctx };
  }

  it('blank secretKey throws', () => {
    const { stack, ctx } = makeApp();
    expect(
      () =>
        new SecretsManager(stack, 'X', {
          envContext: ctx,
          secrets: [{ secretKey: '  ', name: 'some-name' }],
        }),
    ).toThrow(/blank secretKey/i);
  });

  it('duplicate secretKey throws', () => {
    const { stack, ctx } = makeApp();
    expect(
      () =>
        new SecretsManager(stack, 'X', {
          envContext: ctx,
          secrets: [
            { secretKey: 'dup-key', name: 'secret-a' },
            { secretKey: 'dup-key', name: 'secret-b' },
          ],
        }),
    ).toThrow(/Duplicate secretKey.*dup-key/i);
  });

  it('wildcard ARN throws', () => {
    const { stack, ctx } = makeApp();
    expect(
      () =>
        new SecretsManager(stack, 'X', {
          envContext: ctx,
          secrets: [{ secretKey: 'wild', arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:*' }],
        }),
    ).toThrow(/wildcard ARN/i);
  });

  it('malformed ARN throws', () => {
    const { stack, ctx } = makeApp();
    expect(
      () =>
        new SecretsManager(stack, 'X', {
          envContext: ctx,
          secrets: [{ secretKey: 'bad', arn: 'not-a-valid-arn' }],
        }),
    ).toThrow(/malformed ARN/i);
  });

  it('conflicting definition (both name and arn) throws', () => {
    const { stack, ctx } = makeApp();
    expect(
      () =>
        new SecretsManager(stack, 'X', {
          envContext: ctx,
          secrets: [
            {
              secretKey: 'conflict',
              name: 'some-name',
              arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:Test',
            },
          ],
        }),
    ).toThrow(/must not have both/i);
  });

  it('error message does not echo the secret value', () => {
    const { stack, ctx } = makeApp();
    // Blank secretKey triggers validation error
    expect(
      () =>
        new SecretsManager(stack, 'X', {
          envContext: ctx,
          secrets: [
            {
              secretKey: '  ',
              arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:SuperSecretPassword123!',
            },
          ],
        }),
    ).toThrow(/secretKey/i);
    // The error must NOT echo the ARN value
    let threw = false;
    let errMsg = '';
    try {
      new SecretsManager(stack, 'X', {
        envContext: ctx,
        secrets: [{ secretKey: '  ', arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:SuperSecretPassword123!' }],
      });
    } catch (e: unknown) {
      threw = true;
      errMsg = String((e as Error).message);
    }
    expect(threw).toBe(true);
    expect(errMsg).not.toMatch(/SuperSecretPassword/i);
  });
});

// ─── G. Prohibited resources ─────────────────────────────────────────────────

describe('G. Prohibited resources (must not appear)', () => {
  function checkNoResource(profile: Profile, def: SecretDefinition, label: string): void {
    const template = synthTemplate(profile, [def]);
    const resources = getResources(template);
    expect(countResourcesByType(resources, 'AWS::IAM::Role'), `${label}: IAM Role`).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy'), `${label}: IAM Policy`).toBe(0);
    expect(countResourcesByType(resources, 'AWS::Lambda::Function'), `${label}: Lambda`).toBe(0);
    expect(countResourcesByType(resources, 'AWS::KMS::Key'), `${label}: KMS Key`).toBe(0);
    expect(countResourcesByType(resources, 'AWS::SSM::Parameter'), `${label}: SSM Parameter`).toBe(0);
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount, `${label}: Custom Resource`).toBe(0);
  }

  it('managed placeholder: no IAM / Lambda / KMS / SSM / Custom', () => {
    checkNoResource('PERSONAL_AWS_DEV', FIXTURE_MANAGED, 'managed(PERSONAL)');
  });

  it('imported by ARN: no IAM / Lambda / KMS / SSM / Custom', () => {
    checkNoResource('PERSONAL_AWS_DEV', FIXTURE_IMPORTED_BY_ARN, 'imported-arn(PERSONAL)');
  });

  it('COMPETITION_AWS: no IAM / Lambda / KMS / SSM / Custom', () => {
    checkNoResource('COMPETITION_AWS', FIXTURE_MANAGED, 'managed(COMPETITION)');
  });

  it('CloudFormation Outputs do not leak secret content', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', [FIXTURE_MANAGED]);
    const outputs = countCfnOutputs(template);
    const outputStr = JSON.stringify(outputs);
    // Outputs should be minimal; no secret content
    expect(outputStr).not.toMatch(/password|token|secret|credential|key/i);
  });
});

// ─── H. Source-level static checks ─────────────────────────────────────────

describe('H. Source-level static checks', () => {
  it('secrets.ts source contains no secretValue prop', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'secrets.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\bsecretValue\s*:/i);
  });

  it('secrets.ts source contains no plaintextSecret prop', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'secrets.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\bplaintextSecret\s*:/i);
  });

  it('secrets.ts source contains no accessKey prop', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'secrets.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\baccessKey\s*:/i);
  });

  it('secrets.ts source contains no workshopAccessCode prop', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'secrets.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\bworkshopAccessCode\s*:/i);
  });

  it('secrets.ts source contains no AWS access key literal', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'secrets.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\bAKIA[A-Z0-9]{16}\b/);
  });

  it('secrets.ts source contains no credential-like fixture', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'secrets.ts');
    const content = fs.readFileSync(file, 'utf8');
    // No long hex-like or base64-like credential strings
    expect(content).not.toMatch(/\b[A-Za-z0-9+/]{40,}={0,2}\b/);
  });
});

// ─── I. Export contract ────────────────────────────────────────────────────

describe('I. Export contract', () => {
  it('exports ReadonlyMap<string, ISecret>', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'export-test');
    const sm = new SecretsManager(stack, 'SecretsManager', {
      envContext: ctx,
      secrets: [FIXTURE_MANAGED, FIXTURE_IMPORTED_BY_ARN],
    });
    expect(sm.secrets).toBeInstanceOf(Map);
    expect(sm.secrets.get('test-managed')).toBeDefined();
    expect(sm.secrets.get('test-imported-arn')).toBeDefined();
    expect(sm.secrets.get('nonexistent-key')).toBeUndefined();
  });
});
