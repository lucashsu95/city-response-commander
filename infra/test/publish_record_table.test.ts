/**
 * TASK-064 targeted tests — PublishRecordTable Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  PublishRecordTableConstruct,
  PUBLISH_RECORD_TABLE_PARTITION_KEY,
  PUBLISH_RECORD_TABLE_CONFIG_KEY,
} from '../lib/constructs/publish_record_table.js';
import { DecisionCoreTableConstruct } from '../lib/constructs/decision_core_table.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

function synthTemplate(profile: Profile, tableName: string): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-publish-record-test`);
  new PublishRecordTableConstruct(stack, 'PublishRecordTable', {
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

const TEST_TABLE_NAME = 'personal-dev-publish-record';
const TEST_TABLE_NAME_COMPETITION = 'competition-publish-record';

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
    expect(keySchema[0]['AttributeName']).toBe(PUBLISH_RECORD_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('no RANGE key', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const rangeKeys = keySchema.filter((k) => k['KeyType'] === 'RANGE');
    expect(rangeKeys).toHaveLength(0);
  });

  it('AttributeDefinitions has only decision_id (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(PUBLISH_RECORD_TABLE_PARTITION_KEY);
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
    expect(keySchema[0]['AttributeName']).toBe(PUBLISH_RECORD_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('AttributeDefinitions has only decision_id (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(PUBLISH_RECORD_TABLE_PARTITION_KEY);
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
    const template = synthTemplate('LOCAL_MOCK', 'local-publish-record');
    expect(countResourcesByType(getResources(template), 'AWS::DynamoDB::Table')).toBe(0);
  });

  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK', 'local-publish-record');
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

  it('does not pre-declare backend publish attributes as AttributeDefinitions', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    const names = attrs.map((a) => a['AttributeName']);
    expect(names).toEqual([PUBLISH_RECORD_TABLE_PARTITION_KEY]);

    // §10.11d publish attributes must NOT be in AttributeDefinitions
    const forbiddenAttrs = [
      'publish_state',
      'channels',
      'published_payload_ref',
      'approved_by',
      'audit_trail',
      'published_by',
      'commander_actor',
      'failure_reason',
      'version',
      'updated_at',
      'core_version_ref',
    ];
    for (const a of forbiddenAttrs) {
      expect(names).not.toContain(a);
    }
  });

  it('source contains no IAM grant calls', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\.grantRead\b/);
    expect(content).not.toMatch(/\.grantWrite\b/);
    expect(content).not.toMatch(/\.grantReadWriteData\b/);
  });

  it('source contains no IAM policy / role / Lambda / handler creation', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/PolicyStatement/);
    expect(content).not.toMatch(/new\s+Policy\b/);
    expect(content).not.toMatch(/new\s+Role\b/);
    expect(content).not.toMatch(/new\s+(Function|NodejsFunction)\b/);
    // No publish-state-machine / handler class
    expect(content).not.toMatch(/class\s+\w*PublishFn\b/);
    expect(content).not.toMatch(/class\s+\w*Handler\b/);
    // No CMS/SMS / Cognito / WebSocket references
    expect(content).not.toMatch(/Cognito/);
    expect(content).not.toMatch(/PostToConnection/);
    expect(content).not.toMatch(/amazon-sns|amazon-sqs/i);
    // No DecisionCore write logic
    expect(content).not.toMatch(/DecisionCore\.put|DynamoDB\.putItem[\s\S]{0,40}DecisionCore/);
  });

  it('source contains no conditional Update implementation', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/ConditionExpression\s*[:=]/);
    expect(content).not.toMatch(/attribute_exists|attribute_not_exists/);
  });

  it('source does not introduce environment-specific duplicate Construct', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    const classMatches = content.match(/export\s+class\s+\w+Construct\b/g) ?? [];
    expect(classMatches).toHaveLength(1);
    expect(classMatches[0]).toBe('export class PublishRecordTableConstruct');
  });
});

// ─── E. Physical separation from DecisionCore ──────────────────────────────

describe('E. Physical separation from DecisionCore', () => {
  function synthBothTables(): Record<string, unknown> {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-separation-test`);
    new DecisionCoreTableConstruct(stack, 'DecisionCore', {
      envContext: ctx,
      tableName: `${ctx.resourcePrefix}-decision-core`,
    });
    new PublishRecordTableConstruct(stack, 'PublishRecord', {
      envContext: ctx,
      tableName: `${ctx.resourcePrefix}-publish-record`,
    });
    const assembly = app.synth();
    return assembly.stacks[0].template as Record<string, unknown>;
  }

  it('co-instantiating DecisionCore + PublishRecord produces exactly 2 tables', () => {
    const template = synthBothTables();
    const tables = getDynamoTables(getResources(template));
    expect(Object.keys(tables)).toHaveLength(2);
  });

  it('the two tables have distinct TableNames', () => {
    const template = synthBothTables();
    const tables = Object.values(getDynamoTables(getResources(template)));
    const names = tables.map((t) => (getTableProperties(t)['TableName'] as string));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('personal-dev-decision-core');
    expect(names).toContain('personal-dev-publish-record');
  });

  it('both tables use decision_id as HASH key', () => {
    const template = synthBothTables();
    const tables = Object.values(getDynamoTables(getResources(template)));
    for (const t of tables) {
      const props = getTableProperties(t);
      const keySchema = props['KeySchema'] as Array<Record<string, string>>;
      const hashKeys = keySchema.filter((k) => k['KeyType'] === 'HASH');
      expect(hashKeys).toHaveLength(1);
      expect(hashKeys[0]['AttributeName']).toBe('decision_id');
    }
  });

  it('PublishRecordTable does NOT equal DecisionCoreTable (separate resources)', () => {
    const template = synthBothTables();
    const tables = getDynamoTables(getResources(template));
    const logicalIds = Object.keys(tables);
    expect(logicalIds).toHaveLength(2);
    // Ensure the two constructs produced two distinct logical-id keys
    expect(new Set(logicalIds).size).toBe(2);
  });

  it('DecisionCore Table does not declare publish_state / version / audit_trail as AttributeDefinitions', () => {
    const template = synthBothTables();
    const tables = Object.values(getDynamoTables(getResources(template)));
    const coreTable = tables.find((t) =>
      (getTableProperties(t)['TableName'] as string) === 'personal-dev-decision-core',
    );
    expect(coreTable).toBeDefined();
    const coreAttrs = (getTableProperties(coreTable!)['AttributeDefinitions'] as Array<Record<string, string>>).map(
      (a) => a['AttributeName'],
    );
    expect(coreAttrs).not.toContain('publish_state');
    expect(coreAttrs).not.toContain('version');
    expect(coreAttrs).not.toContain('audit_trail');
  });

  it('no IAM grants are created between DecisionCore and PublishRecord tables', () => {
    const template = synthBothTables();
    const resources = getResources(template);
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });

  it('no explicit cross-stack dependency is generated (no DependsOn)', () => {
    const template = synthBothTables();
    const tables = Object.values(getDynamoTables(getResources(template)));
    for (const t of tables) {
      expect(t['DependsOn']).toBeUndefined();
    }
  });

  it('both tables are independently synth-able (each can stand alone)', () => {
    const t1 = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const tables1 = getDynamoTables(getResources(t1));
    expect(Object.keys(tables1)).toHaveLength(1);
    expect(getTableProperties(Object.values(tables1)[0])['TableName']).toBe(TEST_TABLE_NAME);

    const t2 = synthBothTables();
    const tables2 = getDynamoTables(getResources(t2));
    expect(Object.keys(tables2)).toHaveLength(2);
  });
});

// ─── F. Mutable-state boundary documentation ───────────────────────────────

describe('F. Mutable-state boundary documentation', () => {
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('JSDoc states publish_state is never written back to DecisionCore', () => {
    const content = readConstructSource();
    // Use flexible whitespace; em-dash tolerant
    expect(content).toMatch(/publish_state[\s\S]{0,200}never[\s\S]{0,80}(written back|written to DecisionCore)/i);
  });

  it('JSDoc asserts physical separation of the two tables', () => {
    const content = readConstructSource();
    expect(content).toMatch(/physically separate/i);
  });

  it('JSDoc identifies version as an item-level (not key) optimistic lock', () => {
    const content = readConstructSource();
    expect(content).toMatch(/version[\s\S]{0,120}ITEM-level/i);
    expect(content).toMatch(/optimistic[\s-]lock/i);
  });

  it('JSDoc defers optimistic-lock to TASK-145', () => {
    const content = readConstructSource();
    expect(content).toMatch(/TASK-145/);
  });

  it('JSDoc defers sole writer to TASK-082', () => {
    const content = readConstructSource();
    expect(content).toMatch(/TASK-082/);
  });

  it('JSDoc defers audit_trail content to the application layer', () => {
    const content = readConstructSource();
    expect(content).toMatch(/audit_trail[\s\S]{0,200}application[\s\S]{0,80}(layer|TASK-145)/i);
  });

  it('JSDoc documents the intended draft→approved→published state machine', () => {
    const content = readConstructSource();
    expect(content).toMatch(/draft[\s\S]{0,40}approved[\s\S]{0,40}published/i);
    expect(content).toMatch(/publish_failed/);
  });
});

// ─── G. Optimistic-lock boundary ───────────────────────────────────────────

describe('G. Optimistic-lock boundary', () => {
  it('version is NOT in KeySchema', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    for (const k of keySchema) {
      expect(k['AttributeName']).not.toBe('version');
    }
  });

  it('version is NOT in AttributeDefinitions', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    const names = attrs.map((a) => a['AttributeName']);
    expect(names).not.toContain('version');
  });

  it('Construct does not implement conditional Update', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/ConditionExpression\s*[:=]/);
    expect(content).not.toMatch(/attribute_exists\s*\(/);
    expect(content).not.toMatch(/attribute_not_exists\s*\(/);
  });

  it('Construct JSDoc documents version as item-level optimistic lock and defers protection to TASK-145', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Item-level optimistic lock, not key
    expect(content).toMatch(/version[\s\S]{0,200}optimistic[\s-]lock/i);
    // Lost-update protection deferred to TASK-145 (multi-line; widen window)
    expect(content).toMatch(/lost[\s-]?update[\s\S]{0,500}TASK-145/i);
  });
});

// ─── H. Parameterization and validation ────────────────────────────────────

describe('H. Parameterization and validation', () => {
  it('changing tableName changes only TableName (no code changes)', () => {
    const t1 = synthTemplate('PERSONAL_AWS_DEV', 'name-one');
    const t2 = synthTemplate('PERSONAL_AWS_DEV', 'name-two');
    const table1 = Object.values(getDynamoTables(getResources(t1)))[0];
    const table2 = Object.values(getDynamoTables(getResources(t2)))[0];
    const p1 = getTableProperties(table1);
    const p2 = getTableProperties(table2);
    expect(p1['TableName']).toBe('name-one');
    expect(p2['TableName']).toBe('name-two');
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
        new PublishRecordTableConstruct(stack, 'X', {
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
        new PublishRecordTableConstruct(stack, 'X', {
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
        new PublishRecordTableConstruct(stack, 'X', {
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
        new PublishRecordTableConstruct(stack, 'X', {
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
        new PublishRecordTableConstruct(stack, 'X', {
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
        new PublishRecordTableConstruct(stack, 'X', {
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
        new PublishRecordTableConstruct(stack, 'X', {
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

// ─── I. Source-level static checks ─────────────────────────────────────────

describe('I. Source-level static checks', () => {
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'publish_record_table.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('publish_record_table.ts source contains no 12-digit AWS account literal', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b\d{12}\b/);
  });

  it('publish_record_table.ts source contains no hard-coded region', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('publish_record_table.ts source does NOT contain a hard-coded competition table name', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/tableName\s*:\s*['"]/);
  });

  it('exports the documented config-key constant with the exact required value', () => {
    expect(PUBLISH_RECORD_TABLE_CONFIG_KEY).toBe('dynamodb.publish_record_table');
  });
});
