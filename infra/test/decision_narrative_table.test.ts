/**
 * TASK-063 targeted tests — DecisionNarrativeTable Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  DecisionNarrativeTableConstruct,
  DECISION_NARRATIVE_TABLE_PARTITION_KEY,
  DECISION_NARRATIVE_TABLE_SORT_KEY,
  NARRATIVE_TYPES,
} from '../lib/constructs/decision_narrative_table.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

function synthTemplate(profile: Profile, tableName: string): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-decision-narrative-test`);
  new DecisionNarrativeTableConstruct(stack, 'DecisionNarrativeTable', {
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

const TEST_TABLE_NAME = 'personal-dev-decision-narrative';
const TEST_TABLE_NAME_COMPETITION = 'competition-decision-narrative';

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

  it('KeySchema has decision_id (HASH) and narrative_type (RANGE)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(2);
    const hash = keySchema.find((k) => k['KeyType'] === 'HASH');
    const range = keySchema.find((k) => k['KeyType'] === 'RANGE');
    expect(hash).toBeDefined();
    expect(range).toBeDefined();
    expect(hash!['AttributeName']).toBe(DECISION_NARRATIVE_TABLE_PARTITION_KEY);
    expect(range!['AttributeName']).toBe(DECISION_NARRATIVE_TABLE_SORT_KEY);
  });

  it('AttributeDefinitions has decision_id (S) and narrative_type (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(2);
    const pk = attrs.find((a) => a['AttributeName'] === DECISION_NARRATIVE_TABLE_PARTITION_KEY);
    const sk = attrs.find((a) => a['AttributeName'] === DECISION_NARRATIVE_TABLE_SORT_KEY);
    expect(pk).toBeDefined();
    expect(sk).toBeDefined();
    expect(pk!['AttributeType']).toBe('S');
    expect(sk!['AttributeType']).toBe('S');
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

  it('KeySchema has decision_id (HASH) and narrative_type (RANGE)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(2);
    const hash = keySchema.find((k) => k['KeyType'] === 'HASH');
    const range = keySchema.find((k) => k['KeyType'] === 'RANGE');
    expect(hash!['AttributeName']).toBe(DECISION_NARRATIVE_TABLE_PARTITION_KEY);
    expect(range!['AttributeName']).toBe(DECISION_NARRATIVE_TABLE_SORT_KEY);
  });

  it('AttributeDefinitions has decision_id (S) and narrative_type (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(2);
    const pk = attrs.find((a) => a['AttributeName'] === DECISION_NARRATIVE_TABLE_PARTITION_KEY);
    const sk = attrs.find((a) => a['AttributeName'] === DECISION_NARRATIVE_TABLE_SORT_KEY);
    expect(pk!['AttributeType']).toBe('S');
    expect(sk!['AttributeType']).toBe('S');
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
    const template = synthTemplate('LOCAL_MOCK', 'local-decision-narrative');
    expect(countResourcesByType(getResources(template), 'AWS::DynamoDB::Table')).toBe(0);
  });

  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK', 'local-decision-narrative');
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });
});

// ─── D. Prohibited resources and properties ────────────────────────────────

describe('D. Prohibited resources and properties', () => {
  const FORBIDDEN_PROPS = [
    'TimeToLiveSpecification',
    'GlobalSecondaryIndexes',
    'LocalSecondaryIndexes',
    'StreamSpecification',
    'ProvisionedThroughput',
    'PointInTimeRecoverySpecification',
  ];

  it('PERSONAL_AWS_DEV: no TTL, GSI, LSI, Stream, ProvisionedThroughput, PITR', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    for (const p of FORBIDDEN_PROPS) {
      expect(props[p]).toBeUndefined();
    }
  });

  it('COMPETITION_AWS: no TTL, GSI, LSI, Stream, ProvisionedThroughput, PITR', () => {
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

  it('does not pre-declare backend narrative attributes as AttributeDefinitions', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    const names = attrs.map((a) => a['AttributeName']);

    // Exactly the two key attrs
    expect(names).toHaveLength(2);
    expect(names).toContain(DECISION_NARRATIVE_TABLE_PARTITION_KEY);
    expect(names).toContain(DECISION_NARRATIVE_TABLE_SORT_KEY);

    // §10.11b narrative attributes must NOT be in AttributeDefinitions
    const forbiddenAttrs = [
      'payload',
      'content',
      'language',
      'citations',
      'citation_article_set',
      'status',
      'created_at',
      'updated_at',
      'trace_id',
      'schema_version',
      'rendered_by',
      'fallback_used',
    ];
    for (const a of forbiddenAttrs) {
      expect(names).not.toContain(a);
    }
  });

  it('source documents three-item isolation, base-table recovery, and conditional-Put boundary', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');

    // Three-item isolation
    expect(content).toMatch(/REPORT/);
    expect(content).toMatch(/PUBLIC_ALERT/);
    expect(content).toMatch(/EXPLANATION/);

    // Conditional Put boundary — the Construct references TASK-116 but does not implement it
    expect(content).toMatch(/TASK-116/);
    expect(content).toMatch(/attribute_not_exists/);

    // Base-table recovery invariant
    expect(content).toMatch(/BASE TABLE/i);
    expect(content).toMatch(/eventually-consistent GSI/i);
    expect(content).toMatch(/ConsistentRead/i);

    // Construct explicitly does NOT claim strong consistency at table level
    // (phrase spans multiple lines and may contain em-dashes)
    expect(content).toMatch(/Construct[\s\S]*?does not[\s\S]*?cannot[\s\S]*?guarantee strong consistency/i);
  });

  it('source contains no IAM grant calls', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\.grantRead\b/);
    expect(content).not.toMatch(/\.grantWrite\b/);
    expect(content).not.toMatch(/\.grantReadWriteData\b/);
  });

  it('source contains no IAM policy / role / Lambda creation', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/PolicyStatement/);
    expect(content).not.toMatch(/new\s+Policy\b/);
    expect(content).not.toMatch(/new\s+Role\b/);
    expect(content).not.toMatch(/new\s+(Function|NodejsFunction)\b/);
  });

  it('source contains no application/repository code (renderer / writer / reader / recovery)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/class\s+\w*Repository\b/);
    expect(content).not.toMatch(/class\s+\w*Writer\b/);
    expect(content).not.toMatch(/class\s+\w*Reader\b/);
    expect(content).not.toMatch(/class\s+\w*Recovery\b/);
    // No application-level Composer / Renderer classes
    expect(content).not.toMatch(/class\s+\w*Composer\b/);
    expect(content).not.toMatch(/class\s+\w*Renderer\b/);
  });

  it('source does not introduce environment-specific duplicate Construct', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Only one Construct class declared
    const classMatches = content.match(/export\s+class\s+\w+Construct\b/g) ?? [];
    expect(classMatches).toHaveLength(1);
    expect(classMatches[0]).toBe('export class DecisionNarrativeTableConstruct');
  });
});

// ─── E. Composite-key anti-regression ───────────────────────────────────────

describe('E. Composite-key anti-regression', () => {
  it('PERSONAL_AWS_DEV: exactly 1 HASH and 1 RANGE key', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const hashKeys = keySchema.filter((k) => k['KeyType'] === 'HASH');
    const rangeKeys = keySchema.filter((k) => k['KeyType'] === 'RANGE');
    expect(hashKeys).toHaveLength(1);
    expect(rangeKeys).toHaveLength(1);
  });

  it('HASH key must be decision_id', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const hashKeys = keySchema.filter((k) => k['KeyType'] === 'HASH');
    expect(hashKeys[0]['AttributeName']).toBe(DECISION_NARRATIVE_TABLE_PARTITION_KEY);
  });

  it('RANGE key must be narrative_type', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const rangeKeys = keySchema.filter((k) => k['KeyType'] === 'RANGE');
    expect(rangeKeys[0]['AttributeName']).toBe(DECISION_NARRATIVE_TABLE_SORT_KEY);
  });

  it('narrative_type must NOT be the HASH key', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const hashKeys = keySchema.filter((k) => k['KeyType'] === 'HASH');
    for (const hk of hashKeys) {
      expect(hk['AttributeName']).not.toBe(DECISION_NARRATIVE_TABLE_SORT_KEY);
    }
  });

  it('decision_id must NOT be the RANGE key', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const rangeKeys = keySchema.filter((k) => k['KeyType'] === 'RANGE');
    for (const rk of rangeKeys) {
      expect(rk['AttributeName']).not.toBe(DECISION_NARRATIVE_TABLE_PARTITION_KEY);
    }
  });

  it('key schema mutation detection — if RANGE key is removed, test fixture would fail', () => {
    // This test guards the COMPOSITE invariant: removing the RANGE key from
    // the construct would leave KeySchema with exactly 1 element of KeyType=HASH.
    // The other tests in this describe block already verify length=2 and
    // HASH/RANGE assignment; we add an explicit single-key failure-mode guard
    // here as a self-documenting regression marker.
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;

    // Snapshot — if this fails the construct was downgraded to single-key
    const expectedShape = [
      { AttributeName: 'decision_id', KeyType: 'HASH' },
      { AttributeName: 'narrative_type', KeyType: 'RANGE' },
    ];
    expect(keySchema).toEqual(expectedShape);

    // Anti-downgrade guard
    expect(keySchema.length).not.toBe(1);
  });
});

// ─── F. Base-table recovery invariant ──────────────────────────────────────

describe('F. Base-table recovery invariant', () => {
  it('source explicitly forbids GSI as recovery truth', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Allow generous whitespace between "Query" and "BASE TABLE" (multi-line JSDoc)
    expect(content).toMatch(/Query[\s\S]{0,80}BASE TABLE/i);
    // The text must assert that an eventually-consistent GSI is NOT used as recovery truth.
    expect(content).toMatch(/no[\s\S]{0,40}eventually-consistent GSI[\s\S]{0,40}recovery truth/i);
  });

  it('source documents ConsistentRead as client-side, not a table property', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toMatch(/CLIENT-SIDE/i);
    expect(content).toMatch(/Construct[\s\S]*?does not[\s\S]*?cannot[\s\S]*?guarantee strong consistency/i);
  });

  it('PERSONAL_AWS_DEV: zero GSI, zero LSI, zero Stream — recovery must use base table', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    expect(props['GlobalSecondaryIndexes']).toBeUndefined();
    expect(props['LocalSecondaryIndexes']).toBeUndefined();
    expect(props['StreamSpecification']).toBeUndefined();
  });
});

// ─── G. Parameterization and validation ────────────────────────────────────

describe('G. Parameterization and validation', () => {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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
        new DecisionNarrativeTableConstruct(stack, 'X', {
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

  it('exports the three narrative types as documentation', () => {
    // Smoke check that the documented enum is exported and complete.
    expect(NARRATIVE_TYPES).toEqual(['REPORT', 'PUBLIC_ALERT', 'EXPLANATION']);
  });
});

// ─── H. Source-level static checks ─────────────────────────────────────────

describe('H. Source-level static checks', () => {
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'decision_narrative_table.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('decision_narrative_table.ts source contains no 12-digit AWS account literal', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b\d{12}\b/);
  });

  it('decision_narrative_table.ts source contains no hard-coded region', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('decision_narrative_table.ts source does NOT contain a hard-coded competition table name', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/tableName\s*:\s*['"]/);
  });
});
