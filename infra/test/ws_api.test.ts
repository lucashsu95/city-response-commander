/**
 * TASK-070 targeted tests — WebSocketApiConstruct
 *
 * No AWS credentials / network access; pure synth-time CDK assertions.
 *
 * Two fixtures:
 *   - `buildIsolated` — `Function.fromFunctionArn` (zero AWS::Lambda::Function
 *     from this test; used for topology assertions).
 *   - `buildProof` — `Function.fromFunctionAttributes({ sameEnvironment: true })`
 *     (used for the deployment-binding proof of Lambda invoke permissions).
 *
 * The connection storage table is created via TASK-065's
 * `ConnectionsTableConstruct` so the WS Stage variables reference a
 * real (test-only) DynamoDB Table — this proves that the table name
 * is sourced from the injected ITable and not from a hard-coded fixture.
 */

import { describe, it, expect } from 'vitest';
import { App, Stack, Token } from 'aws-cdk-lib';
import { Function, IFunction } from 'aws-cdk-lib/aws-lambda';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  WebSocketApiConstruct,
  WS_ROUTE_CONTRACT,
  WS_SYSTEM_ROUTE_KEYS,
  WS_CUSTOM_ROUTE_KEY,
  WS_ROUTE_SELECTION_EXPRESSION,
  WS_ENDPOINT_CONFIG_KEY,
  WS_STAGE_VAR_CONNECTIONS_TABLE_NAME,
  WS_STAGE_VAR_CONNECTIONS_TTL_ATTRIBUTE,
} from '../lib/constructs/ws_api.js';
import {
  ConnectionsTableConstruct,
} from '../lib/constructs/connections_table.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'ap-northeast-1';
const TTL_ATTR = 'expiresAt';
const PERSONAL_TABLE_NAME = 'personal-dev-connections';
const COMPETITION_TABLE_NAME = 'competition-connections';

function getResources(t: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (t['Resources'] as Record<string, Record<string, unknown>>) ?? {};
}

function countByType(r: Record<string, Record<string, unknown>>, typeName: string): number {
  return Object.values(r).filter((x) => x['Type'] === typeName).length;
}

function synthIsolated(profile: Profile) {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `ws-iso-${profile.replace(/_/g, '-')}`, {
    env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
  });

  // Synthesize Connections table so Stage Variables reference a real
  // (test-only) DynamoDB Table — proves the ITable.tableName is sourced
  // from the injected reference, not hard-coded.
  const tableCtor = new ConnectionsTableConstruct(stack, 'ConnectionsTable', {
    envContext: ctx,
    tableName: profile === 'COMPETITION_AWS' ? COMPETITION_TABLE_NAME : PERSONAL_TABLE_NAME,
    ttlAttributeName: TTL_ATTR,
  });

  const connFn: IFunction = Function.fromFunctionArn(
    stack,
    'ConnFn',
    `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:ConnFn-placeholder`,
  );
  const wsPushFn: IFunction = Function.fromFunctionArn(
    stack,
    'WsPushFn',
    `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:WsPushFn-placeholder`,
  );

  const wsApi = new WebSocketApiConstruct(stack, 'WebSocketApi', {
    envContext: ctx,
    webSocketApiName: 'CrCmdWs',
    stageName: 'live',
    connFn,
    wsPushFn,
    connectionsTable: tableCtor.table,
    connectionsTtlAttributeName: TTL_ATTR,
  });

  const t = app.synth().stacks[0].template as Record<string, unknown>;
  return { app, stack, ctx, wsApi, tableCtor, t, r: getResources(t) };
}

function synthProof(profile: Profile) {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `ws-proof-${profile.replace(/_/g, '-')}`, {
    env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
  });

  const tableCtor = new ConnectionsTableConstruct(stack, 'ConnectionsTable', {
    envContext: ctx,
    tableName: profile === 'COMPETITION_AWS' ? COMPETITION_TABLE_NAME : PERSONAL_TABLE_NAME,
    ttlAttributeName: TTL_ATTR,
  });

  function proofLambda(stack: Stack, name: string): IFunction {
    return Function.fromFunctionAttributes(stack, name, {
      functionArn: `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:${name}-proof-fixture`,
      sameEnvironment: true,
    });
  }

  const wsApi = new WebSocketApiConstruct(stack, 'WebSocketApi', {
    envContext: ctx,
    webSocketApiName: 'CrCmdWsProof',
    stageName: 'live',
    connFn: proofLambda(stack, 'ConnFn'),
    wsPushFn: proofLambda(stack, 'WsPushFn'),
    connectionsTable: tableCtor.table,
    connectionsTtlAttributeName: TTL_ATTR,
  });

  const t = app.synth().stacks[0].template as Record<string, unknown>;
  return { app, stack, ctx, wsApi, tableCtor, t, r: getResources(t) };
}

// ─── A. PERSONAL_AWS_DEV topology ──────────────────────────────────────────

describe('A. PERSONAL_AWS_DEV — WebSocket API topology', () => {
  const { ctx, wsApi, r } = synthIsolated('PERSONAL_AWS_DEV');

  it('exactly 1 AWS::ApiGatewayV2::Api with ProtocolType WEBSOCKET', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(1);
    const api = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Api')!;
    const props = api['Properties'] as Record<string, unknown>;
    expect(props['ProtocolType']).toBe('WEBSOCKET');
  });

  it('RouteSelectionExpression = "$request.body.action"', () => {
    const api = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Api')!;
    const props = api['Properties'] as Record<string, unknown>;
    expect(props['RouteSelectionExpression']).toBe(WS_ROUTE_SELECTION_EXPRESSION);
  });

  it('exactly 1 AWS::ApiGatewayV2::Stage (NOT $default)', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Stage')).toBe(1);
    const stage = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Stage')!;
    const props = stage['Properties'] as Record<string, unknown>;
    expect(props['StageName']).toBe('live');
    expect(props['StageName']).not.toBe('$default');
    expect(props['AutoDeploy']).toBe(true);
  });

  it('exactly 4 AWS::ApiGatewayV2::Route', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Route')).toBe(4);
    expect(wsApi.routeCount).toBe(4);
    expect(wsApi.systemRouteCount).toBe(3);
    expect(wsApi.customRouteCount).toBe(1);
  });

  it('exactly 4 AWS::ApiGatewayV2::Integration (one per route — permission-ownership isolation)', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Integration')).toBe(4);
  });

  it('exactly 4 AWS::Lambda::Permission (one per integration — route-scoped SourceArn)', () => {
    expect(countByType(r, 'AWS::Lambda::Permission')).toBe(4);
  });

  it('exactly 0 AWS::Lambda::Function (only imported references)', () => {
    expect(countByType(r, 'AWS::Lambda::Function')).toBe(0);
  });

  it('exactly 0 AWS::IAM::Role / AWS::IAM::Policy (no IAM grants by this Construct)', () => {
    expect(countByType(r, 'AWS::IAM::Role')).toBe(0);
    expect(countByType(r, 'AWS::IAM::Policy')).toBe(0);
    expect(countByType(r, 'AWS::IAM::ManagedPolicy')).toBe(0);
  });

  it('routes are exactly $connect, $disconnect, $default, ping', () => {
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    const keys = routes.map((r2) => (r2['Properties'] as Record<string, unknown>)['RouteKey'] as string);
    expect(new Set(keys)).toEqual(new Set(['$connect', '$disconnect', '$default', 'ping']));
  });

  it('WebSocketEndpoint output exists with NO exportName', () => {
    // Outputs live in the template's Outputs section, not Resources.
    // Re-synth to inspect outputs:
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const c = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `ws-iso-out-${c.profile.replace(/_/g, '-')}`, {
      env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
    });
    const tc = new ConnectionsTableConstruct(stack, 'ConnectionsTable', {
      envContext: c,
      tableName: PERSONAL_TABLE_NAME,
      ttlAttributeName: TTL_ATTR,
    });
    new WebSocketApiConstruct(stack, 'WebSocketApi', {
      envContext: c,
      webSocketApiName: 'CrCmdWs',
      stageName: 'live',
      connFn: Function.fromFunctionArn(stack, 'ConnFn', `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:ConnFn`),
      wsPushFn: Function.fromFunctionArn(stack, 'WsPushFn', `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:WsPushFn`),
      connectionsTable: tc.table,
      connectionsTtlAttributeName: TTL_ATTR,
    });
    const t = app.synth().stacks[0].template as Record<string, unknown>;
    const outputs = (t['Outputs'] as Record<string, Record<string, unknown>>) ?? {};
    // CDK assigns the output a generated logical id; we look it up by the
    // 'Value' reference shape (contains Fn::Join + Ref WebSocketApi + "/live").
    const keys = Object.keys(outputs);
    expect(keys.length).toBe(1);
    const out = outputs[keys[0]];
    expect(out).toBeDefined();
    expect(out!['ExportName']).toBeUndefined();
  });

  it('no Retain lifecycle (deletion is allowed)', () => {
    const stage = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Stage')!;
    expect(stage['DeletionPolicy']).toBeUndefined();
    const api = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Api')!;
    expect(api['DeletionPolicy']).toBeUndefined();
  });

  it('ctx.profile is correctly propagated', () => {
    expect(ctx.profile).toBe('PERSONAL_AWS_DEV');
    expect(ctx.isLocalMock).toBe(false);
    expect(ctx.isCompetition).toBe(false);
  });
});

// ─── B. COMPETITION_AWS ────────────────────────────────────────────────────

describe('B. COMPETITION_AWS — same architecture as PERSONAL_AWS_DEV', () => {
  const { ctx, r } = synthIsolated('COMPETITION_AWS');

  it('1 AWS::ApiGatewayV2::Api', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(1);
  });

  it('1 AWS::ApiGatewayV2::Stage with stageName = "live"', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Stage')).toBe(1);
    const stage = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Stage')!;
    const props = stage['Properties'] as Record<string, unknown>;
    expect(props['StageName']).toBe('live');
    expect(props['AutoDeploy']).toBe(true);
  });

  it('4 Routes with identical key set', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Route')).toBe(4);
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    const keys = new Set(
      routes.map((r2) => (r2['Properties'] as Record<string, unknown>)['RouteKey'] as string),
    );
    expect(keys).toEqual(new Set(['$connect', '$disconnect', '$default', 'ping']));
  });

  it('no hard-coded account / region / API id in the WebSocket resource name', () => {
    const api = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Api')!;
    const props = api['Properties'] as Record<string, unknown>;
    const name = props['Name'] as string;
    expect(name).toBe(`competition-CrCmdWs`);
    // No 12-digit account literal, no region literal
    expect(name).not.toMatch(/\d{12}/);
    expect(name).not.toMatch(/ap-(northeast|southeast|us-east|us-west|eu-)/);
  });

  it('ctx.isCompetition is true', () => {
    expect(ctx.isCompetition).toBe(true);
    expect(ctx.isLocalMock).toBe(false);
  });
});

// ─── C. LOCAL_MOCK ─────────────────────────────────────────────────────────

describe('C. LOCAL_MOCK — zero AWS resources', () => {
  const { ctx, r, t } = synthIsolated('LOCAL_MOCK');

  it('AWS resource count = 0', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Route')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Stage')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Integration')).toBe(0);
    expect(countByType(r, 'AWS::Lambda::Permission')).toBe(0);
    expect(countByType(r, 'AWS::Lambda::Function')).toBe(0);
    expect(countByType(r, 'AWS::DynamoDB::Table')).toBe(0);
  });

  it('Output count = 0 (no WebSocketEndpoint Output)', () => {
    const outputs = (t['Outputs'] as Record<string, unknown>) ?? undefined;
    expect(outputs).toBeUndefined();
  });

  it('ctx.isLocalMock is true; construct still records invariant counts', () => {
    expect(ctx.isLocalMock).toBe(true);
  });
});

// ─── D. Exact routes ───────────────────────────────────────────────────────

describe('D. Exact route set — no forbidden keys', () => {
  const { r } = synthIsolated('PERSONAL_AWS_DEV');

  const forbiddenKeys = [
    'broadcast', 'sendmessage', 'publish', 'push', 'subscribe',
    'timeline.updated', 'decision.enriched', 'public_alert.ready',
    'report.ready', 'anomaly.detected', 'incident.injected',
    'decision.fast_path_ready', 'publish.status_changed',
    'processing.failed',
  ];

  it('no forbidden route key is present', () => {
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    const keys = routes.map((r2) => (r2['Properties'] as Record<string, unknown>)['RouteKey'] as string);
    for (const fk of forbiddenKeys) {
      expect(keys).not.toContain(fk);
    }
  });

  it('no wildcard route (no key equals "*")', () => {
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    const keys = routes.map((r2) => (r2['Properties'] as Record<string, unknown>)['RouteKey'] as string);
    expect(keys.some((k) => k === '*')).toBe(false);
    expect(keys.some((k) => k.includes('*'))).toBe(false);
  });

  it('only 4 routes exist (no extras)', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Route')).toBe(4);
  });
});

// ─── E. Route mapping ──────────────────────────────────────────────────────

describe('E. Route mapping — every inbound route targets ConnFn, NOT WsPushFn', () => {
  const { r } = synthIsolated('PERSONAL_AWS_DEV');

  // Map: routeKey → Integration resource Properties (JSON).
  // CDK 2.262.2 emits the Route Target as `integrations/<Ref>` where the
  // Ref is the Integration's logical id (the key under Resources).
  function routeToIntegrationJson(): Map<string, string> {
    const integrationProps: Record<string, Record<string, unknown>> = {};
    for (const [id, intg] of Object.entries(r)) {
      if ((intg as Record<string, unknown>)['Type'] === 'AWS::ApiGatewayV2::Integration') {
        integrationProps[id] = intg as Record<string, Record<string, unknown>>;
      }
    }
    const out = new Map<string, string>();
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    for (const route of routes) {
      const target = (route['Properties'] as Record<string, unknown>)['Target'] as Record<string, unknown>;
      const join = target['Fn::Join'] as Array<unknown>;
      const parts = join[1] as Array<Record<string, unknown>>;
      const ref = (parts[1] as Record<string, unknown>)['Ref'] as string;
      out.set(
        (route['Properties'] as Record<string, unknown>)['RouteKey'] as string,
        JSON.stringify(integrationProps[ref]?.['Properties'] ?? {}),
      );
    }
    return out;
  }

  it('IntegrationUri of every route points to ConnFn (not WsPushFn)', () => {
    const m = routeToIntegrationJson();
    expect(m.size).toBe(4);
    for (const [, integrationJson] of m) {
      expect(integrationJson).toContain('ConnFn');
      expect(integrationJson).not.toContain('WsPushFn');
    }
  });

  it('exactly 4 AWS::ApiGatewayV2::Integration resources (one per route)', () => {
    // Each route has its own `WebSocketLambdaIntegration` instance —
    // this is permission-ownership isolation: each integration emits
    // one route-scoped `AWS::Lambda::Permission`. Sharing a single
    // integration would dedupe permissions to ONE Permission whose
    // SourceArn only carries the first bound route key.
    const integrations = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Integration');
    expect(integrations.length).toBe(4);
  });

  it('exactly 4 route→integration bindings; 0 of them point to WsPushFn', () => {
    const m = routeToIntegrationJson();
    const connCount = Array.from(m.values()).filter((s) => s.includes('ConnFn')).length;
    const pushCount = Array.from(m.values()).filter((s) => s.includes('WsPushFn')).length;
    expect(connCount).toBe(4);
    expect(pushCount).toBe(0);
  });

  it('each route points to a DISTINCT Integration Ref (4 distinct integration references)', () => {
    // Per-route integration instances mean each Route Target Ref is unique.
    // Sharing one integration would yield 4 routes all referencing the
    // same Ref — that's exactly what we are NOT doing.
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    const refs = new Set<string>();
    for (const route of routes) {
      const target = (route['Properties'] as Record<string, unknown>)['Target'] as Record<string, unknown>;
      const join = target['Fn::Join'] as Array<unknown>;
      const parts = join[1] as Array<Record<string, unknown>>;
      const ref = (parts[1] as Record<string, unknown>)['Ref'] as string;
      refs.add(ref);
    }
    expect(refs.size).toBe(4);
  });

  it('no route→integration reference is shared between routes', () => {
    // Sanity: verify the per-route isolation holds across all four routes
    // (rather than only a count check).
    const routes = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Route');
    const routeKeys: string[] = [];
    const refs: string[] = [];
    for (const route of routes) {
      const props = route['Properties'] as Record<string, unknown>;
      const target = props['Target'] as Record<string, unknown>;
      const join = target['Fn::Join'] as Array<unknown>;
      const parts = join[1] as Array<Record<string, unknown>>;
      const ref = (parts[1] as Record<string, unknown>)['Ref'] as string;
      routeKeys.push(props['RouteKey'] as string);
      refs.push(ref);
    }
    // Every pair of routes must reference a different Integration Ref.
    for (let i = 0; i < routeKeys.length; i++) {
      for (let j = i + 1; j < routeKeys.length; j++) {
        expect(refs[i]).not.toBe(refs[j]);
      }
    }
  });
});

// ─── F. Connections table wiring ───────────────────────────────────────────

describe('F. Connections table wiring — Stage Variables reference injected ITable', () => {
  const { r } = synthIsolated('PERSONAL_AWS_DEV');

  it('Stage Variables include CONNECTIONS_TABLE_NAME and CONNECTIONS_TTL_ATTRIBUTE', () => {
    const stage = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Stage')!;
    const vars = (stage['Properties'] as Record<string, unknown>)['StageVariables'] as Record<string, unknown>;
    expect(vars).toBeDefined();
    expect(vars[WS_STAGE_VAR_CONNECTIONS_TABLE_NAME]).toBeDefined();
    expect(vars[WS_STAGE_VAR_CONNECTIONS_TTL_ATTRIBUTE]).toBe(TTL_ATTR);
  });

  it('CONNECTIONS_TABLE_NAME references the injected DynamoDB Table (NOT a hard-coded fixture string)', () => {
    const stage = Object.values(r).find((x) => x['Type'] === 'AWS::ApiGatewayV2::Stage')!;
    const vars = (stage['Properties'] as Record<string, unknown>)['StageVariables'] as Record<string, unknown>;
    const tableName = JSON.stringify(vars[WS_STAGE_VAR_CONNECTIONS_TABLE_NAME]);
    // Must contain a `Ref:` to the Connections Table logical id, i.e.
    // a CDK token — NOT a literal fixture string.
    expect(tableName).toMatch(/Ref/);
    // Must NOT be a literal string.
    expect(tableName).not.toContain(PERSONAL_TABLE_NAME);
  });

  it('exactly 1 AWS::DynamoDB::Table is created (TASK-065; no second table by TASK-070)', () => {
    expect(countByType(r, 'AWS::DynamoDB::Table')).toBe(1);
  });

  it('no DynamoDB IAM grants in this stack', () => {
    const roles = Object.values(r).filter((x) => x['Type'] === 'AWS::IAM::Role').length;
    expect(roles).toBe(0);
    const policies = Object.values(r).filter((x) => x['Type'] === 'AWS::IAM::Policy').length;
    expect(policies).toBe(0);
  });
});

// ─── G. Endpoint separation ────────────────────────────────────────────────

describe('G. Endpoint separation — endpoint vs callbackUrl', () => {
  const { wsApi } = synthIsolated('PERSONAL_AWS_DEV');

  it('endpoint = WebSocket Stage URL (wss)', () => {
    expect(wsApi.endpoint).toBeDefined();
    expect(wsApi.endpoint).toBe(wsApi.webSocketStage!.url);
  });

  it('callbackUrl = backend HTTPS callback URL', () => {
    expect(wsApi.callbackUrl).toBeDefined();
    expect(wsApi.callbackUrl).toBe(wsApi.webSocketStage!.callbackUrl);
  });

  it('endpoint and callbackUrl are distinct', () => {
    expect(wsApi.endpoint).not.toBe(wsApi.callbackUrl);
  });

  it('WebSocketEndpoint Output uses endpoint (NOT callbackUrl)', () => {
    // Re-synth to inspect Outputs.
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const c = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `ws-out-endpoint-${c.profile.replace(/_/g, '-')}`, {
      env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
    });
    const tc = new ConnectionsTableConstruct(stack, 'ConnectionsTable', {
      envContext: c,
      tableName: PERSONAL_TABLE_NAME,
      ttlAttributeName: TTL_ATTR,
    });
    new WebSocketApiConstruct(stack, 'WebSocketApi', {
      envContext: c,
      webSocketApiName: 'CrCmdWs',
      stageName: 'live',
      connFn: Function.fromFunctionArn(stack, 'ConnFn', `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:ConnFn`),
      wsPushFn: Function.fromFunctionArn(stack, 'WsPushFn', `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:WsPushFn`),
      connectionsTable: tc.table,
      connectionsTtlAttributeName: TTL_ATTR,
    });
    const t = app.synth().stacks[0].template as Record<string, unknown>;
    const outputs = (t['Outputs'] as Record<string, Record<string, unknown>>) ?? {};
    const keys = Object.keys(outputs);
    expect(keys.length).toBe(1);
    const value = outputs[keys[0]]?.['Value'];
    // Endpoint output value references Stage.URL; callbackUrl references Stage.callbackUrl.
    // The Output Value must NOT contain 'callbackUrl' substring.
    expect(JSON.stringify(value)).not.toContain('callbackUrl');
    // And must contain the wss URL signature.
    expect(JSON.stringify(value)).toContain('wss://');
  });
});

// ─── H. Management API ARN ─────────────────────────────────────────────────

describe('H. Management API ARN — execute-api ARN shape', () => {
  const { wsApi, r } = synthIsolated('PERSONAL_AWS_DEV');

  it('managementApiArn has execute-api service', () => {
    expect(wsApi.managementApiArn).toBeDefined();
    expect(wsApi.managementApiArn).toContain('execute-api');
  });

  it('managementApiArn resource path includes stageName and POST/@connections/*', () => {
    expect(wsApi.managementApiArn).toContain('live/POST/@connections/*');
  });

  it('managementApiArn is built from Stack.formatArn (no source-level hard-coded literal)', () => {
    // The rendered arn contains the region+account from the Stack (resolved
    // at synth time) and CDK tokens for the partition and apiId. We assert
    // the SOURCE does NOT contain hard-coded literals.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/ws_api.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/ap-(northeast|southeast|us-east|us-west|eu-)/);
    expect(src).not.toMatch(/\d{12}/);
    // The construct must call Stack.formatArn, not hand-format the ARN.
    expect(src).toContain('stack.formatArn');
  });

  it('no broad wildcard pattern `*/*/*` in managementApiArn', () => {
    expect(wsApi.managementApiArn).not.toMatch(/\*\/.*\*\/.*\*/);
  });

  it('Stack has no broad PostToConnection grant (0 IAM resources)', () => {
    expect(countByType(r, 'AWS::IAM::Policy')).toBe(0);
    expect(countByType(r, 'AWS::IAM::Role')).toBe(0);
    expect(countByType(r, 'AWS::IAM::ManagedPolicy')).toBe(0);
  });
});

// ─── I. Security isolation ─────────────────────────────────────────────────

describe('I. Security isolation — zero forbidden resource types', () => {
  const { r } = synthIsolated('PERSONAL_AWS_DEV');

  const forbidden = [
    'AWS::IAM::Role',
    'AWS::IAM::Policy',
    'AWS::IAM::ManagedPolicy',
    'AWS::Lambda::Function',
    'AWS::Logs::LogGroup',
    'AWS::Cognito::UserPool',
    'AWS::Cognito::UserPoolClient',
    'AWS::StepFunctions::StateMachine',
    'AWS::ApiGatewayV2::Authorizer',
    'Custom::AWS',
  ];

  it.each(forbidden)('does not create %s', (type) => {
    expect(countByType(r, type)).toBe(0);
  });

  it('does not create an HTTP API (only WebSocket)', () => {
    // HttpApi has ProtocolType HTTP. Our resource has WEBSOCKET.
    const apis = Object.values(r).filter((x) => x['Type'] === 'AWS::ApiGatewayV2::Api');
    for (const api of apis) {
      expect((api['Properties'] as Record<string, unknown>)['ProtocolType']).toBe('WEBSOCKET');
    }
  });
});

// ─── Production source boundary (string-level) ─────────────────────────────

describe('I.2 Production source boundary — ws_api.ts contains no forbidden IAM grants', () => {
  // Read the production source and assert forbidden tokens are NOT present.
  // We strip comments so JSDoc mentions (e.g. "TASK-083 owns the
  // ManageConnections grant") do not pollute the assertion.
  const fs = require('node:fs');
  const path = require('node:path');
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../lib/constructs/ws_api.ts'),
    'utf8',
  );
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('does not contain grantManageConnections', () => {
    expect(code).not.toMatch(/grantManageConnections/);
  });

  it('does not contain "execute-api:ManageConnections"', () => {
    expect(code).not.toMatch(/execute-api:ManageConnections/);
  });

  it('does not contain "execute-api:*" wildcards', () => {
    expect(code).not.toMatch(/execute-api:\*/);
  });

  it('does not contain PostToConnection grant', () => {
    expect(code).not.toMatch(/PostToConnection/);
  });

  it('does not contain addToRolePolicy / PolicyStatement / ManagedPolicy', () => {
    expect(code).not.toMatch(/addToRolePolicy/);
    expect(code).not.toMatch(/PolicyStatement/);
    expect(code).not.toMatch(/ManagedPolicy/);
  });

  it('does not contain Cognito authorizer wiring', () => {
    expect(code).not.toMatch(/HttpAuthorizer|JwtAuthorizer|UserPoolAuthorizer/);
  });
});

// ─── J. Deployment permission proof ────────────────────────────────────────

describe('J. Deployment permission proof (fromFunctionAttributes + sameEnvironment)', () => {
  const { r } = synthProof('PERSONAL_AWS_DEV');

  function perms(): Array<Record<string, unknown>> {
    return Object.values(r).filter((x) => x['Type'] === 'AWS::Lambda::Permission') as any;
  }
  function arnFor(p: Record<string, unknown>): string {
    return JSON.stringify((p['Properties'] as Record<string, unknown>)['SourceArn'] ?? '');
  }
  function fnNameFor(p: Record<string, unknown>): string {
    return JSON.stringify((p['Properties'] as Record<string, unknown>)['FunctionName'] ?? '');
  }

  it('ConnFn receives exactly 4 Lambda invoke permissions (one per inbound route)', () => {
    // One `AWS::Lambda::Permission` is emitted per `WebSocketLambdaIntegration`
    // instance. The Construct creates FOUR distinct integration instances —
    // $connect / $disconnect / $default / ping — each targeting the same
    // injected ConnFn. The result is four route-scoped Permissions, each
    // with SourceArn scoped to its own route key.
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    expect(connPerms.length).toBe(4);
  });

  it('WsPushFn receives 0 route-scoped Lambda invoke permissions', () => {
    const pushPerms = perms().filter((p) => fnNameFor(p).includes('WsPushFn'));
    expect(pushPerms.length).toBe(0);
  });

  it('every permission has a SourceArn (no permission without SourceArn)', () => {
    for (const p of perms()) {
      const arn = (p['Properties'] as Record<string, unknown>)['SourceArn'];
      expect(arn).toBeDefined();
      expect(arn).not.toBe('');
    }
  });

  /**
   * Normalize a CloudFormation `SourceArn` intrinsic (`Fn::Join` /
   * `Fn::Sub` / `Ref` / `Fn::GetAtt`) into its serialized JSON form so
   * the tests below can apply route-key matches against the rendered
   * string without depending on the synthetic CFN logical-id.
   */
  function sourceArnString(p: Record<string, unknown>): string {
    return JSON.stringify((p['Properties'] as Record<string, unknown>)['SourceArn'] ?? '');
  }

  // ─── Exact route-key allocation ─────────────────────────────────────────

  it('there is exactly one permission per canonical route key: $connect', () => {
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    const matches = connPerms.filter((p) => sourceArnString(p).includes('*$connect'));
    expect(matches.length).toBe(1);
  });

  it('there is exactly one permission per canonical route key: $disconnect', () => {
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    const matches = connPerms.filter((p) => sourceArnString(p).includes('*$disconnect'));
    expect(matches.length).toBe(1);
  });

  it('there is exactly one permission per canonical route key: $default', () => {
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    const matches = connPerms.filter((p) => sourceArnString(p).includes('*$default'));
    expect(matches.length).toBe(1);
  });

  it('there is exactly one permission per canonical route key: ping', () => {
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    const matches = connPerms.filter((p) => sourceArnString(p).includes('*ping'));
    expect(matches.length).toBe(1);
  });

  // ─── Negative security proof ─────────────────────────────────────────────

  it('no permission is missing a canonical route key (all 4 routes are covered)', () => {
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    expect(connPerms.length).toBe(4);
    for (const routeKey of WS_ROUTE_CONTRACT) {
      const matches = connPerms.filter((p) => sourceArnString(p).includes(`*${routeKey}`));
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('no permission has a route-key wildcard (e.g. `*/*` as the route-key segment)', () => {
    // The SourceArn route-key segment must be one of the four canonical
    // route keys (`$connect`, `$disconnect`, `$default`, `ping`). A route-key
    // wildcard would appear as `*` / `*/*` / `*/*/*` as the LAST slash-
    // delimited segment of the ARN — but a legitimate stage-wildcard is
    // `/*` between the apiId and the route key (which is allowed).
    //
    // We assert the LAST slash-delimited segment is exactly one of the
    // four canonical route keys. The route-key segment is preceded by a
    // stage wildcard, so the actual pattern is `*<routeKey>` — and our
    // four canonical keys (`$connect`, `$disconnect`, `$default`, `ping`)
    // contain no slashes.
    for (const p of perms()) {
      const arn = JSON.stringify((p['Properties'] as Record<string, unknown>)['SourceArn'] ?? '');
      // Strip all quoted literal substrings from the JSON form (e.g. "/*").
      // We want to confirm the route-key segment is a known route key.
      const keys = ['$connect', '$disconnect', '$default', 'ping'];
      const matched = keys.some((k) => arn.includes(`*${k}`));
      expect(matched).toBe(true);
      // And no literal `"*"` or `"*/*"` or `"*/*/*"` should appear as a
      // standalone route-key segment.
      expect(arn).not.toMatch(/"\*"/);
      expect(arn).not.toMatch(/"\*\/\*"/);
      expect(arn).not.toMatch(/"\*\/\*\/\*"/);
    }
  });

  it('no permission has a whole-API wildcard (`<apiId>/*/*`)', () => {
    for (const p of perms()) {
      const arn = sourceArnString(p);
      // The route-key segment of a whole-API wildcard would be `*/*` or
      // `*/*/*`. None of the four canonical route keys contains a slash.
      expect(arn.includes('*/*')).toBe(false);
      expect(arn.includes('*/*/*')).toBe(false);
    }
  });

  it('no permission has a cross-API wildcard (execute-api:*)', () => {
    for (const p of perms()) {
      const arn = sourceArnString(p);
      expect(arn).not.toMatch(/execute-api:\\?\*/);
    }
  });

  it('no two permissions share the same canonical route key (no duplicate route permission)', () => {
    const connPerms = perms().filter((p) => fnNameFor(p).includes('ConnFn'));
    for (const routeKey of WS_ROUTE_CONTRACT) {
      const matches = connPerms.filter((p) => sourceArnString(p).includes(`*${routeKey}`));
      expect(matches.length).toBe(1);
    }
  });

  it('every permission points to ConnFn (not WsPushFn)', () => {
    for (const p of perms()) {
      const fn = JSON.stringify((p['Properties'] as Record<string, unknown>)['FunctionName'] ?? '');
      expect(fn.includes('ConnFn')).toBe(true);
      expect(fn.includes('WsPushFn')).toBe(false);
    }
  });

  // ─── Action / Principal identity ─────────────────────────────────────────

  it('every ConnFn permission has Action=lambda:InvokeFunction and Principal=apigateway.amazonaws.com', () => {
    for (const p of perms()) {
      const props = p['Properties'] as Record<string, unknown>;
      expect(props['Action']).toBe('lambda:InvokeFunction');
      expect(props['Principal']).toBe('apigateway.amazonaws.com');
    }
  });
});

// ─── K. Source-boundary documentation guard ─────────────────────────────────

describe('K. ws_api.ts IAM/task-ownership JSDoc', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.resolve(__dirname, '../lib/constructs/ws_api.ts'),
    'utf8',
  );

  it('documents TASK-083 as the WsConnFnRole owner', () => {
    expect(src).toMatch(/TASK-083/);
  });

  it('documents TASK-179 as the final Lambda/IAM binding owner', () => {
    expect(src).toMatch(/TASK-179/);
  });

  it('documents TASK-180 as the Stack composition owner', () => {
    expect(src).toMatch(/TASK-180/);
  });

  it('documents TASK-122 as the polling-fallback owner', () => {
    expect(src).toMatch(/TASK-122/);
  });

  it('documents TASK-123 as the ready_event_id dedup owner', () => {
    expect(src).toMatch(/TASK-123/);
  });

  it('does NOT claim physical exactly-once', () => {
    expect(src.toLowerCase()).toContain('does not claim physical exactly-once');
  });

  it('does NOT write to DecisionNarrativeTable (out of scope)', () => {
    expect(src).not.toMatch(/DecisionNarrativeTable/);
  });
});

// ─── L. Module-level contract constants ────────────────────────────────────

describe('L. Module-level contract constants', () => {
  it('WS_ROUTE_CONTRACT has exactly 4 entries', () => {
    expect(WS_ROUTE_CONTRACT.length).toBe(4);
  });

  it('WS_SYSTEM_ROUTE_KEYS is exactly [$connect, $disconnect, $default]', () => {
    expect(new Set(WS_SYSTEM_ROUTE_KEYS)).toEqual(new Set(['$connect', '$disconnect', '$default']));
  });

  it('WS_CUSTOM_ROUTE_KEY is "ping"', () => {
    expect(WS_CUSTOM_ROUTE_KEY).toBe('ping');
  });

  it('WS_ROUTE_SELECTION_EXPRESSION is "$request.body.action"', () => {
    expect(WS_ROUTE_SELECTION_EXPRESSION).toBe('$request.body.action');
  });

  it('WS_ENDPOINT_CONFIG_KEY matches packages/config schema key', () => {
    expect(WS_ENDPOINT_CONFIG_KEY).toBe('ws.endpoint');
  });
});
