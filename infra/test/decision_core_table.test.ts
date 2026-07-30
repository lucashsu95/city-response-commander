/**
 * TASK-062 targeted tests — DecisionCoreTable Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  DecisionCoreTableConstruct,
  DECISION_CORE_TABLE_PARTITION_KEY,
} from '../lib/constructs/decision_core_table.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

function synthTemplate(profile: Profile, tableName: string): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-decision-core-test`);
  new DecisionCoreTableConstruct(stack, 'DecisionCoreTable', {
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

const TEST_TABLE_NAME = 'personal-dev-decision-core';
const TEST_TABLE_NAME_COMPETITION = 'competition-decision-core';

// ─── A. PERSONAL_AWS_DEV ───────────────────────────────────────────────────

describe('A. PERSONAL_AWS_DEV', () => {
  let template: Record<string, unknown>;
  let table: Record<string, unknown>;
  let props: Record<string, unknown>;

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

  it('KeySchema has only decision_id (HASH, STRING)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(1);
    expect(keySchema[0]['AttributeName']).toBe(DECISION_CORE_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('AttributeDefinitions has only decision_id (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(DECISION_CORE_TABLE_PARTITION_KEY);
    expect(attrs[0]['AttributeType']).toBe('S');
  });

  it('BillingMode = PAY_PER_REQUEST', () => {
    expect(props['BillingMode']).toBe('PAY_PER_REQUEST');
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

  it('uses same construct class — key schema and billing mode identical to PERSONAL_AWS_DEV', () => {
    const t2 = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const competitionTable = Object.values(getDynamoTables(getResources(template)))[0];
    const personalTable = Object.values(getDynamoTables(getResources(t2)))[0];
    expect(competitionTable['Type']).toBe(personalTable['Type']);
    const cProps = competitionTable['Properties'] as Record<string, unknown>;
    const pProps = personalTable['Properties'] as Record<string, unknown>;
    expect(cProps['KeySchema']).toEqual(pProps['KeySchema']);
    expect(cProps['AttributeDefinitions']).toEqual(pProps['AttributeDefinitions']);
    expect(cProps['BillingMode']).toEqual(pProps['BillingMode']);
  });

  it('KeySchema has only decision_id (HASH, STRING)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(1);
    expect(keySchema[0]['AttributeName']).toBe(DECISION_CORE_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('AttributeDefinitions has only decision_id (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(DECISION_CORE_TABLE_PARTITION_KEY);
    expect(attrs[0]['AttributeType']).toBe('S');
  });

  it('BillingMode = PAY_PER_REQUEST', () => {
    expect(props['BillingMode']).toBe('PAY_PER_REQUEST');
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
    const template = synthTemplate('LOCAL_MOCK', 'local-decision-core');
    expect(countResourcesByType(getResources(template), 'AWS::DynamoDB::Table')).toBe(0);
  });

  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK', 'local-decision-core');
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });
});

// ─── D. Immutability boundary and prohibited resources ─────────────────────

describe('D. Immutability boundary and prohibited resources', () => {
  const FORBIDDEN_PROPS = [
    'TimeToLiveSpecification',
    'GlobalSecondaryIndexes',
    'LocalSecondaryIndexes',
    'StreamSpecification',
    'ProvisionedThroughput',
  ];

  it('PERSONAL_AWS_DEV: no TTL, GSI, LSI, Stream, ProvisionedThroughput', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    for (const p of FORBIDDEN_PROPS) {
      expect(props[p]).toBeUndefined();
    }
    // No sort key: KeySchema has exactly 1 element
    expect((props['KeySchema'] as unknown[]).length).toBe(1);
  });

  it('COMPETITION_AWS: no TTL, GSI, LSI, Stream, ProvisionedThroughput', () => {
    const template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    for (const p of FORBIDDEN_PROPS) {
      expect(props[p]).toBeUndefined();
    }
  });

  it('PERSONAL_AWS_DEV: no IAM / Lambda / KMS / Custom resource', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
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

  it('COMPETITION_AWS: no IAM / Lambda / KMS / Custom resource', () => {
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
    expect(names).toEqual([DECISION_CORE_TABLE_PARTITION_KEY]);

    // §10.11a DecisionCore attributes must NOT be in AttributeDefinitions
    const forbiddenAttrs = [
      'immutable_after_commit',
      'core_hash',
      'event_id',
      'triggered_articles',
      'invoked_procedures',
      'applied_formula_articles',
      'primary_evacuation',
      'secondary_evacuation',
      'ete',
      'evidence',
      'policy',
      'source_manifest_hash',
      'created_at',
      'version',
    ];
    for (const a of forbiddenAttrs) {
      expect(names).not.toContain(a);
    }
  });

  it('source documents immutable_after_commit boundary (conditional Put + TASK-077 sole writer)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_core_table.ts');
    const content = fs.readFileSync(file, 'utf8');

    // Boundary is documented
    expect(content).toMatch(/immutable_after_commit/i);
    expect(content).toMatch(/conditional\s*Put/i);
    expect(content).toMatch(/TASK-077/);

    // The Construct explicitly states DynamoDB cannot enforce item immutability
    expect(content).toMatch(/CANNOT enforce item-level immutability/i);

    // publish_state not written back to this table
    expect(content).toMatch(/publish_state[\s\S]{0,200}never[\s\S]{0,40}written back/i);
  });

  it('source contains no IAM grant calls (grantRead / grantWrite / grantReadWriteData)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_core_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\.grantRead\b/);
    expect(content).not.toMatch(/\.grantWrite\b/);
    expect(content).not.toMatch(/\.grantReadWriteData\b/);
  });

  it('source contains no IAM policy creation', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_core_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/PolicyStatement/);
    expect(content).not.toMatch(/new\s+Policy\b/);
    expect(content).not.toMatch(/new\s+Role\b/);
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
    // Same key schema and billing
    expect(p1['KeySchema']).toEqual(p2['KeySchema']);
    expect(p1['AttributeDefinitions']).toEqual(p2['AttributeDefinitions']);
    expect(p1['BillingMode']).toEqual(p2['BillingMode']);
  });

  it('empty tableName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new DecisionCoreTableConstruct(stack, 'X', {
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
        new DecisionCoreTableConstruct(stack, 'X', {
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
        new DecisionCoreTableConstruct(stack, 'X', {
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
        new DecisionCoreTableConstruct(stack, 'X', {
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
        new DecisionCoreTableConstruct(stack, 'X', {
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
        new DecisionCoreTableConstruct(stack, 'X', {
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
        new DecisionCoreTableConstruct(stack, 'X', {
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
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_core_table.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('decision_core_table.ts source contains no 12-digit AWS account literal', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b\d{12}\b/);
  });

  it('decision_core_table.ts source contains no hard-coded region', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('decision_core_table.ts source does NOT contain a hard-coded competition table name', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/tableName\s*:\s*['"]/);
  });
});
