/**
 * TASK-061 targeted tests — IdempotencyTable Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { IdempotencyTableConstruct, IDEMPOTENCY_TABLE_PARTITION_KEY, IDEMPOTENCY_TABLE_TTL_ATTRIBUTE } from '../lib/constructs/idempotency_table.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

function synthTemplate(profile: Profile, tableName: string): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-idempotency-test`);
  new IdempotencyTableConstruct(stack, 'IdempotencyTable', {
    envContext: ctx,
    tableName,
  });
  const assembly = app.synth();
  return assembly.stacks[0].template as Record<string, unknown>;
}

function getResources(template: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
}

function getDynamoTables(resources: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::DynamoDB::Table'),
  );
}

function getTableProperties(table: Record<string, unknown>): Record<string, unknown> {
  return (table['Properties'] as Record<string, unknown>) ?? {};
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

const TEST_TABLE_NAME = 'personal-dev-idempotency';
const TEST_TABLE_NAME_COMPETITION = 'competition-idempotency';

// ─── A. PERSONAL_AWS_DEV ───────────────────────────────────────────────────

describe('A. PERSONAL_AWS_DEV', () => {
  let template: Record<string, unknown>;
  let table: Record<string, unknown>;
  let props: Record<string, unknown>;

  // Re-init table/props after each synthesis
  beforeEach(() => {
    template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const tables = getDynamoTables(getResources(template));
    expect(Object.keys(tables)).toHaveLength(1);
    table = Object.values(tables)[0];
    props = getTableProperties(table);
  });

  it('exactly 1 AWS::DynamoDB::Table', () => {
    expect(Object.keys(getDynamoTables(getResources(template)))).toHaveLength(1);
  });

  it('TableName equals props input', () => {
    expect(props['TableName']).toBe(TEST_TABLE_NAME);
  });

  it('KeySchema has only idempotency_key (HASH, STRING)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(1);
    expect(keySchema[0]['AttributeName']).toBe(IDEMPOTENCY_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('AttributeDefinitions has only idempotency_key (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(IDEMPOTENCY_TABLE_PARTITION_KEY);
    expect(attrs[0]['AttributeType']).toBe('S');
  });

  it('BillingMode = PAY_PER_REQUEST', () => {
    expect(props['BillingMode']).toBe('PAY_PER_REQUEST');
  });

  it('TTL: AttributeName = expires_at, Enabled = true', () => {
    const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
    expect(ttl).toBeDefined();
    expect(ttl['AttributeName']).toBe(IDEMPOTENCY_TABLE_TTL_ATTRIBUTE);
    expect(ttl['Enabled']).toBe(true);
  });

  it('DeletionPolicy = Delete', () => {
    expect(table['DeletionPolicy']).toBe('Delete');
  });

  it('UpdateReplacePolicy = Delete', () => {
    expect(table['UpdateReplacePolicy']).toBe('Delete');
  });
});

// ─── B. COMPETITION_AWS ────────────────────────────────────────────────────

describe('B. COMPETITION_AWS', () => {
  let template: Record<string, unknown>;
  let table: Record<string, unknown>;
  let props: Record<string, unknown>;

  beforeEach(() => {
    template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION);
    const tables = getDynamoTables(getResources(template));
    expect(Object.keys(tables)).toHaveLength(1);
    table = Object.values(tables)[0];
    props = getTableProperties(table);
  });

  it('exactly 1 AWS::DynamoDB::Table', () => {
    expect(Object.keys(getDynamoTables(getResources(template)))).toHaveLength(1);
  });

  it('uses same construct class', () => {
    // Both profiles produce a Table of identical shape
    const t2 = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const competitionTable = Object.values(getDynamoTables(getResources(template)))[0];
    const personalTable = Object.values(getDynamoTables(getResources(t2)))[0];
    expect(competitionTable['Type']).toBe(personalTable['Type']);
    const cProps = competitionTable['Properties'] as Record<string, unknown>;
    const pProps = personalTable['Properties'] as Record<string, unknown>;
    expect(cProps['KeySchema']).toEqual(pProps['KeySchema']);
    expect(cProps['AttributeDefinitions']).toEqual(pProps['AttributeDefinitions']);
    expect(cProps['BillingMode']).toEqual(pProps['BillingMode']);
    expect(cProps['TimeToLiveSpecification']).toEqual(pProps['TimeToLiveSpecification']);
  });

  it('KeySchema has only idempotency_key (HASH, STRING)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(1);
    expect(keySchema[0]['AttributeName']).toBe(IDEMPOTENCY_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('AttributeDefinitions has only idempotency_key (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(IDEMPOTENCY_TABLE_PARTITION_KEY);
    expect(attrs[0]['AttributeType']).toBe('S');
  });

  it('BillingMode = PAY_PER_REQUEST', () => {
    expect(props['BillingMode']).toBe('PAY_PER_REQUEST');
  });

  it('TTL: AttributeName = expires_at, Enabled = true', () => {
    const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
    expect(ttl).toBeDefined();
    expect(ttl['AttributeName']).toBe(IDEMPOTENCY_TABLE_TTL_ATTRIBUTE);
    expect(ttl['Enabled']).toBe(true);
  });

  it('DeletionPolicy = Retain', () => {
    expect(table['DeletionPolicy']).toBe('Retain');
  });

  it('UpdateReplacePolicy = Retain', () => {
    expect(table['UpdateReplacePolicy']).toBe('Retain');
  });
});

// ─── C. LOCAL_MOCK ─────────────────────────────────────────────────────────

describe('C. LOCAL_MOCK', () => {
  it('produces 0 AWS::DynamoDB::Table', () => {
    const template = synthTemplate('LOCAL_MOCK', 'local-idempotency');
    expect(countResourcesByType(getResources(template), 'AWS::DynamoDB::Table')).toBe(0);
  });

  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK', 'local-idempotency');
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });
});

// ─── D. Prohibited resources ───────────────────────────────────────────────

describe('D. Prohibited resources (must not appear)', () => {
  it('PERSONAL_AWS_DEV: no GSI, no LSI, no Stream, no ProvisionedThroughput', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    expect(props['GlobalSecondaryIndexes']).toBeUndefined();
    expect(props['LocalSecondaryIndexes']).toBeUndefined();
    expect(props['StreamSpecification']).toBeUndefined();
    expect(props['ProvisionedThroughput']).toBeUndefined();
    // No sort key: KeySchema has exactly 1 element
    expect((props['KeySchema'] as unknown[]).length).toBe(1);
  });

  it('COMPETITION_AWS: no GSI, no LSI, no Stream, no ProvisionedThroughput', () => {
    const template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    expect(props['GlobalSecondaryIndexes']).toBeUndefined();
    expect(props['LocalSecondaryIndexes']).toBeUndefined();
    expect(props['StreamSpecification']).toBeUndefined();
    expect(props['ProvisionedThroughput']).toBeUndefined();
  });

  it('PERSONAL_AWS_DEV: no IAM Role / Policy / Lambda / KMS / Custom resource', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const resources = getResources(template);
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::KMS::Key')).toBe(0);
    // Custom resource via CFN: Custom::<Service>
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });

  it('COMPETITION_AWS: no IAM Role / Policy / Lambda / KMS / Custom resource', () => {
    const template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION);
    const resources = getResources(template);
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::KMS::Key')).toBe(0);
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });

  it('does not pre-declare backend runtime attributes as AttributeDefinitions', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    const names = attrs.map((a) => a['AttributeName']);
    // Only idempotency_key. The TTL attribute `expires_at` is NOT a key schema attribute.
    expect(names).toEqual([IDEMPOTENCY_TABLE_PARTITION_KEY]);
    expect(names).not.toContain(IDEMPOTENCY_TABLE_TTL_ATTRIBUTE);
    expect(names).not.toContain('status');
    expect(names).not.toContain('attempt_count');
    expect(names).not.toContain('lease_expires_at');
    expect(names).not.toContain('workflow_execution_arn');
    expect(names).not.toContain('recovery_mode');
    expect(names).not.toContain('recovery_stage');
    expect(names).not.toContain('decision_id');
    expect(names).not.toContain('last_error');
    expect(names).not.toContain('core_committed');
  });
});

// ─── E. Parameterization and validation ────────────────────────────────────

describe('E. Parameterization and validation', () => {
  it('changing tableName changes only TableName (no code changes)', () => {
    const t1 = synthTemplate('PERSONAL_AWS_DEV', 'name-one');
    const t2 = synthTemplate('PERSONAL_AWS_DEV', 'name-two');
    const table1 = Object.values(getDynamoTables(getResources(t1)))[0];
    const table2 = Object.values(getDynamoTables(getResources(t2)))[0];
    const p1 = getTableProperties(table1);
    const p2 = getTableProperties(table2);
    expect(p1['TableName']).toBe('name-one');
    expect(p2['TableName']).toBe('name-two');
    // Same key schema, billing, TTL
    expect(p1['KeySchema']).toEqual(p2['KeySchema']);
    expect(p1['BillingMode']).toEqual(p2['BillingMode']);
    expect(p1['TimeToLiveSpecification']).toEqual(p2['TimeToLiveSpecification']);
  });

  it('empty tableName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: '',
        }),
    ).toThrow(/non-empty string/i);
  });

  it('whitespace-only tableName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: '   ',
        }),
    ).toThrow(/non-empty string|invalid length/i);
  });

  it('too-short tableName (1-2 chars) throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: 'ab',
        }),
    ).toThrow(/invalid length|3-255|valid DynamoDB table name/i);
  });

  it('too-long tableName (256+ chars) throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    const long = 'a'.repeat(256);
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: long,
        }),
    ).toThrow(/invalid length|3-255/i);
  });

  it('illegal character (slash) throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: 'has/slash',
        }),
    ).toThrow(/not a valid DynamoDB table name/i);
  });

  it('illegal character (colon) throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: 'has:colon',
        }),
    ).toThrow(/not a valid DynamoDB table name/i);
  });

  it('illegal character (space) throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new IdempotencyTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: 'has space',
        }),
    ).toThrow(/not a valid DynamoDB table name/i);
  });

  it.each([
    ['All.Upper_With-Mixed.Digit0'],
    ['CapitalTable-1'],
    ['lowercase_table-2.0'],
    ['has_underscore-only'],
  ])('valid table name %s is accepted', (name) => {
    const template = synthTemplate('PERSONAL_AWS_DEV', name);
    const tables = getDynamoTables(getResources(template));
    expect(Object.keys(tables)).toHaveLength(1);
    const props = getTableProperties(Object.values(tables)[0]);
    expect(props['TableName']).toBe(name);
  });

  it('does not lowercase tableName', () => {
    const t = synthTemplate('PERSONAL_AWS_DEV', 'Mixed-Case-Table');
    const table = Object.values(getDynamoTables(getResources(t)))[0];
    const props = getTableProperties(table);
    expect(props['TableName']).toBe('Mixed-Case-Table');
  });
});

// ─── F. Source-level static checks (cross-file) ──────────────────────────

describe('F. Source-level static checks', () => {
  it('idempotency_table.ts source contains no 12-digit AWS account literal', () => {
    // Vitest runs in Node; we can fs.readFileSync the source
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'idempotency_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\b\d{12}\b/);
  });

  it('idempotency_table.ts source contains no hard-coded region', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'idempotency_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Match any AWS region string
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('idempotency_table.ts source does NOT contain a hard-coded competition table name', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'idempotency_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Ensure no quoted string literal that looks like a finalized hostname-ish table name.
    // We don't know future names; simply assert no `tableName:` literal default value.
    expect(content).not.toMatch(/tableName\s*:\s*['"]/);
  });
});
