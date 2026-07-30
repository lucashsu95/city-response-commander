/**
 * TASK-065 targeted tests — ConnectionsTable Construct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  ConnectionsTableConstruct,
  CONNECTIONS_TABLE_PARTITION_KEY,
  CONNECTIONS_TABLE_CONFIG_KEY,
} from '../lib/constructs/connections_table.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

function synthTemplate(profile: Profile, tableName: string, ttlName: string): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-connections-test`);
  new ConnectionsTableConstruct(stack, 'ConnectionsTable', {
    envContext: ctx,
    tableName,
    ttlAttributeName: ttlName,
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

const TEST_TABLE_NAME = 'personal-dev-connections';
const TEST_TABLE_NAME_COMPETITION = 'competition-connections';
const TEST_TTL_ATTR = 'expiresAt';

// ─── A. PERSONAL_AWS_DEV ───────────────────────────────────────────────────

describe('A. PERSONAL_AWS_DEV', () => {
  let template: Record<string, unknown>;
  let table: Record<string, unknown>;
  let props: Record<string, unknown>;

  beforeEach(() => {
    template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
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

  it('KeySchema has only connectionId (HASH, STRING)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(1);
    expect(keySchema[0]['AttributeName']).toBe(CONNECTIONS_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('no RANGE key', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    const rangeKeys = keySchema.filter((k) => k['KeyType'] === 'RANGE');
    expect(rangeKeys).toHaveLength(0);
  });

  it('AttributeDefinitions has only connectionId (S)', () => {
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    expect(attrs).toHaveLength(1);
    expect(attrs[0]['AttributeName']).toBe(CONNECTIONS_TABLE_PARTITION_KEY);
    expect(attrs[0]['AttributeType']).toBe('S');
  });

  it('BillingMode = PAY_PER_REQUEST', () => {
    expect(props['BillingMode']).toBe('PAY_PER_REQUEST');
  });

  it('TTL: AttributeName equals props.ttlAttributeName, Enabled = true', () => {
    const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
    expect(ttl).toBeDefined();
    expect(ttl['AttributeName']).toBe(TEST_TTL_ATTR);
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
    template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION, TEST_TTL_ATTR);
    const tables = getDynamoTables(getResources(template));
    expect(Object.keys(tables)).toHaveLength(1);
    table = Object.values(tables)[0];
    props = getTableProperties(table);
  });

  it('exactly 1 AWS::DynamoDB::Table', () => {
    expect(Object.keys(getDynamoTables(getResources(template)))).toHaveLength(1);
  });

  it('uses same construct class — key schema, TTL, and billing mode identical to PERSONAL_AWS_DEV', () => {
    const t2 = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
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

  it('KeySchema has only connectionId (HASH, STRING)', () => {
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    expect(keySchema).toHaveLength(1);
    expect(keySchema[0]['AttributeName']).toBe(CONNECTIONS_TABLE_PARTITION_KEY);
    expect(keySchema[0]['KeyType']).toBe('HASH');
  });

  it('TTL: AttributeName equals injected value, Enabled = true', () => {
    const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
    expect(ttl).toBeDefined();
    expect(ttl['AttributeName']).toBe(TEST_TTL_ATTR);
    expect(ttl['Enabled']).toBe(true);
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
    const template = synthTemplate('LOCAL_MOCK', 'local-connections', TEST_TTL_ATTR);
    expect(countResourcesByType(getResources(template), 'AWS::DynamoDB::Table')).toBe(0);
  });

  it('produces 0 AWS resources', () => {
    const template = synthTemplate('LOCAL_MOCK', 'local-connections', TEST_TTL_ATTR);
    expect(countNonCdkResources(getResources(template))).toBe(0);
  });

  it('still echoes ttlAttributeName so downstream wiring remains consistent', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'LOCAL_MOCK');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'LocalStack');
    const c = new ConnectionsTableConstruct(stack, 'C', {
      envContext: ctx,
      tableName: 'local-connections',
      ttlAttributeName: TEST_TTL_ATTR,
    });
    expect(c.ttlAttributeName).toBe(TEST_TTL_ATTR);
    expect(c.table).toBeUndefined();
  });
});

// ─── D. TTL anti-regression ────────────────────────────────────────────────

describe('D. TTL anti-regression', () => {
  it('TTL specification must be present', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    expect(props['TimeToLiveSpecification']).toBeDefined();
  });

  it('TTL Enabled must be true (not false)', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
    expect(ttl['Enabled']).toBe(true);
    expect(ttl['Enabled']).not.toBe(false);
  });

  it('TTL AttributeName must equal the injected ttlAttributeName', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, 'custom_ttl_attr');
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
    expect(ttl['AttributeName']).toBe('custom_ttl_attr');
  });

  it('TTL attribute must NOT appear in KeySchema', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const keySchema = props['KeySchema'] as Array<Record<string, string>>;
    for (const k of keySchema) {
      expect(k['AttributeName']).not.toBe(TEST_TTL_ATTR);
    }
  });

  it('TTL attribute must NOT appear in AttributeDefinitions', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    const attrs = props['AttributeDefinitions'] as Array<Record<string, string>>;
    const names = attrs.map((a) => a['AttributeName']);
    expect(names).not.toContain(TEST_TTL_ATTR);
  });

  it('TTL attribute must NOT equal connectionId (validator guard)', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: CONNECTIONS_TABLE_PARTITION_KEY,
        }),
    ).toThrow(/must not equal the partition key/i);
  });

  it('changing ttlAttributeName changes only the TTL AttributeName', () => {
    const t1 = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, 'ttl_a');
    const t2 = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, 'ttl_b');
    const table1 = Object.values(getDynamoTables(getResources(t1)))[0];
    const table2 = Object.values(getDynamoTables(getResources(t2)))[0];
    const p1 = getTableProperties(table1);
    const p2 = getTableProperties(table2);
    expect((p1['TimeToLiveSpecification'] as Record<string, unknown>)['AttributeName']).toBe('ttl_a');
    expect((p2['TimeToLiveSpecification'] as Record<string, unknown>)['AttributeName']).toBe('ttl_b');
    // Same TableName
    expect(p1['TableName']).toBe(p2['TableName']);
    // Same KeySchema
    expect(p1['KeySchema']).toEqual(p2['KeySchema']);
    // Same BillingMode
    expect(p1['BillingMode']).toEqual(p2['BillingMode']);
  });
});

// ─── E. Prohibited resources and properties ────────────────────────────────

describe('E. Prohibited resources and properties', () => {
  const FORBIDDEN_PROPS = [
    'GlobalSecondaryIndexes',
    'LocalSecondaryIndexes',
    'StreamSpecification',
    'ProvisionedThroughput',
    'PointInTimeRecoverySpecification',
  ];

  it('PERSONAL_AWS_DEV: no GSI, LSI, Stream, ProvisionedThroughput, PITR', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    for (const p of FORBIDDEN_PROPS) {
      expect(props[p]).toBeUndefined();
    }
  });

  it('COMPETITION_AWS: no GSI, LSI, Stream, ProvisionedThroughput, PITR', () => {
    const template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION, TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(template)))[0];
    const props = getTableProperties(table);
    for (const p of FORBIDDEN_PROPS) {
      expect(props[p]).toBeUndefined();
    }
  });

  it('PERSONAL_AWS_DEV: no IAM / Lambda / API Gateway / KMS / Custom resource', () => {
    const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, TEST_TTL_ATTR);
    const resources = getResources(template);
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::ApiGatewayV2::Api')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::KMS::Key')).toBe(0);
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });

  it('COMPETITION_AWS: no IAM / Lambda / API Gateway / KMS / Custom resource', () => {
    const template = synthTemplate('COMPETITION_AWS', TEST_TABLE_NAME_COMPETITION, TEST_TTL_ATTR);
    const resources = getResources(template);
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::ApiGatewayV2::Api')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::KMS::Key')).toBe(0);
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });

  it('source contains no IAM grant calls', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'connections_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/\.grantRead\b/);
    expect(content).not.toMatch(/\.grantWrite\b/);
    expect(content).not.toMatch(/\.grantReadWriteData\b/);
  });

  it('source contains no PostToConnection IAM action / permission implementation', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'connections_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    // The action string itself must NOT appear as a literal permission assignment
    expect(content).not.toMatch(/execute-api:ManageConnections/);
    // When mentioned in JSDoc it must only be in the deferred-boundary sense,
    // not paired with `new Policy`, `addActions`, `PolicyStatement`, etc.
    expect(content).not.toMatch(/PolicyStatement/);
    expect(content).not.toMatch(/new\s+Policy\b/);
    expect(content).not.toMatch(/new\s+Role\b/);
  });

  it('source contains no Lambda handler, WebSocket route, or AWS SDK client', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'connections_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toMatch(/new\s+(Function|NodejsFunction)\b/);
    expect(content).not.toMatch(/class\s+\w*Handler\b/);
    expect(content).not.toMatch(/WebSocketHandler|WebSocketRoute/);
    expect(content).not.toMatch(/ApiGatewayWebSocket/);
    // Runtime PutItem/DeleteItem not present
    expect(content).not.toMatch(/\.putItem\s*\(/);
    expect(content).not.toMatch(/\.deleteItem\s*\(/);
    expect(content).not.toMatch(/@aws-sdk\/lib-dynamodb/);
    expect(content).not.toMatch(/from '@aws-sdk/);
    expect(content).not.toMatch(/from "aws-sdk"/);
  });

  it('source does not introduce environment-specific duplicate Construct', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'connections_table.ts');
    const content = fs.readFileSync(file, 'utf8');
    const classMatches = content.match(/export\s+class\s+\w+Construct\b/g) ?? [];
    expect(classMatches).toHaveLength(1);
    expect(classMatches[0]).toBe('export class ConnectionsTableConstruct');
  });
});

// ─── F. Permission-isolation documentation ─────────────────────────────────

describe('F. Permission-isolation documentation', () => {
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'connections_table.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('JSDoc defers sole runtime writer to TASK-083 (WsConnFnRole)', () => {
    const content = readConstructSource();
    expect(content).toMatch(/TASK-083/);
    expect(content).toMatch(/WsConnFnRole/);
  });

  it('JSDoc defers WebSocket API wiring to TASK-070', () => {
    const content = readConstructSource();
    expect(content).toMatch(/TASK-070/);
  });

  it('JSDoc identifies TTL as a cleanup fallback, not immediate disconnect truth', () => {
    const content = readConstructSource();
    expect(content).toMatch(/TTL[\s\S]{0,80}CLEANUP/i);
    // Must explicitly say TTL is NOT immediate disconnect truth
    expect(content).toMatch(/TTL[\s\S]{0,400}NOT[\s\S]{0,80}immediate disconnect/i);
  });

  it('JSDoc states runtime writer must use the SAME ttlAttributeName', () => {
    const content = readConstructSource();
    expect(content).toMatch(/ttlAttributeName/);
    expect(content).toMatch(/IDENTICAL|identical|same/i);
  });

  it('JSDoc states no credentials or business data stored in this table', () => {
    const content = readConstructSource();
    expect(content).toMatch(/credentials|JWT|Secrets/);
    expect(content).toMatch(/TRANSIENT|transient/);
  });
});

// ─── G. Parameterization and validation ────────────────────────────────────

describe('G. Parameterization and validation', () => {
  it('changing tableName changes only TableName (no code changes)', () => {
    const t1 = synthTemplate('PERSONAL_AWS_DEV', 'name-one', TEST_TTL_ATTR);
    const t2 = synthTemplate('PERSONAL_AWS_DEV', 'name-two', TEST_TTL_ATTR);
    const table1 = Object.values(getDynamoTables(getResources(t1)))[0];
    const table2 = Object.values(getDynamoTables(getResources(t2)))[0];
    const p1 = getTableProperties(table1);
    const p2 = getTableProperties(table2);
    expect(p1['TableName']).toBe('name-one');
    expect(p2['TableName']).toBe('name-two');
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
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: '',
          ttlAttributeName: TEST_TTL_ATTR,
        }),
    ).toThrow(/non-empty string/i);
  });

  it('illegal tableName (slash) throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: 'has/slash',
          ttlAttributeName: TEST_TTL_ATTR,
        }),
    ).toThrow(/not a valid DynamoDB table name/i);
  });

  it.each([
    ['All.Upper_With-Mixed.Digit0'],
    ['lowercase_table-2.0'],
    ['has_underscore-only'],
  ])('valid table name %s is accepted', (name) => {
    const template = synthTemplate('PERSONAL_AWS_DEV', name, TEST_TTL_ATTR);
    const tables = getDynamoTables(getResources(template));
    expect(Object.keys(tables)).toHaveLength(1);
    const props = getTableProperties(Object.values(tables)[0]);
    expect(props['TableName']).toBe(name);
  });

  it('does not lowercase tableName', () => {
    const t = synthTemplate('PERSONAL_AWS_DEV', 'Mixed-Case-Table', TEST_TTL_ATTR);
    const table = Object.values(getDynamoTables(getResources(t)))[0];
    const props = getTableProperties(table);
    expect(props['TableName']).toBe('Mixed-Case-Table');
  });

  it('empty ttlAttributeName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: '',
        }),
    ).toThrow(/non-empty string/i);
  });

  it('whitespace-only ttlAttributeName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: '   ',
        }),
    ).toThrow(/non-empty string|leading or trailing whitespace/i);
  });

  it('leading whitespace ttlAttributeName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: ' has-leading',
        }),
    ).toThrow(/leading or trailing whitespace/i);
  });

  it('trailing whitespace ttlAttributeName throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: 'has-trailing ',
        }),
    ).toThrow(/leading or trailing whitespace/i);
  });

  it('ttlAttributeName containing "." throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: 'has.dot',
        }),
    ).toThrow(/not a valid DynamoDB attribute name/i);
  });

  it('ttlAttributeName containing ":" throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'TestStack');
    expect(
      () =>
        new ConnectionsTableConstruct(stack, 'X', {
          envContext: ctx,
          tableName: TEST_TABLE_NAME,
          ttlAttributeName: 'has:colon',
        }),
    ).toThrow(/not a valid DynamoDB attribute name/i);
  });

  it.each(['expiresAt', 'ttl', 'EXPIRES_AT', 'expires_at', 'connection_ttl', 'ws-t'])(
    'valid ttlAttributeName %s is accepted',
    (name) => {
      const template = synthTemplate('PERSONAL_AWS_DEV', TEST_TABLE_NAME, name);
      const table = Object.values(getDynamoTables(getResources(template)))[0];
      const props = getTableProperties(table);
      const ttl = props['TimeToLiveSpecification'] as Record<string, unknown>;
      expect(ttl['AttributeName']).toBe(name);
    },
  );
});

// ─── H. Source-level static checks ─────────────────────────────────────────

describe('H. Source-level static checks', () => {
  function readConstructSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'connections_table.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('connections_table.ts source contains no 12-digit AWS account literal', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b\d{12}\b/);
  });

  it('connections_table.ts source contains no hard-coded region', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('connections_table.ts source does NOT contain a hard-coded competition table name', () => {
    const content = readConstructSource();
    expect(content).not.toMatch(/tableName\s*:\s*['"]/);
  });

  it('exports the documented config-key constant with the exact required value', () => {
    expect(CONNECTIONS_TABLE_CONFIG_KEY).toBe('dynamodb.connections_table');
  });
});
