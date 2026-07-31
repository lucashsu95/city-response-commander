/**
 * WebSocketApiConstruct — API Gateway WebSocket API with 4 inbound routes + outbound management contract
 *
 * §4.5, §13, §16, §18
 * TASK-070
 *
 * Defines exactly ONE `apigwv2.WebSocketApi` with a fixed route table:
 *
 *   Inbound route plane (Client → Backend, all to ConnFn):
 *     $connect
 *     $disconnect
 *     $default
 *     ping                  (IMPLEMENTATION_INFRASTRUCTURE_ROUTE)
 *
 *   Outbound management plane (Backend → Client, NOT a route):
 *     WsPushFn → API Gateway Management API
 *     stage.callbackUrl     (@connections)
 *     arn:execute-api:.../POST/@connections/*
 *
 * Invariants enforced by this Construct:
 *   - routeCount = 4
 *   - systemRouteCount = 3 ($connect, $disconnect, $default)
 *   - customRouteCount  = 1 (ping)
 *   - 0 ANY routes, 0 wildcard routes
 *   - 0 anonymous-broadcast routes (broadcast / sendmessage / publish / push / subscribe)
 *   - 0 routes targeted at WsPushFn
 *   - 0 routes outside the contract set
 *
 * ─── Inbound vs outbound plane separation (explicit) ───────────────────────
 *
 *   The WebSocket API has TWO distinct planes; they MUST NOT be conflated.
 *
 *   (a) Inbound route plane — Client → Backend
 *       Each route key in the contract is matched against the body of an
 *       inbound Client message. ALL FOUR routes integrate to ConnFn
 *       exclusively. ConnFn is the only inbound handler surface.
 *
 *   (b) Outbound management plane — Backend → Client
 *       WsPushFn is the SOLE principal that calls the management API at
 *       @connections. It is NOT a route target. There is no Client-
 *       invocable route that reaches WsPushFn. This prevents an
 *       unauthenticated broadcast capability.
 *
 *   This Construct defines the typed contract for (b) — `callbackUrl`,
 *   `managementApiArn`, and `outboundPushBindingContract` — but the
 *   actual `execute-api:ManageConnections` IAM grant is owned by TASK-083
 *   (WsConnFnRole). The final Lambda ↔ role ↔ config binding is owned
 *   by TASK-179 (Lambda/IAM binding) and TASK-180 (Stack composition).
 *
 * ─── Custom route key decision ─────────────────────────────────────────────
 *
 *   `design.md` does NOT pin a specific custom route key. The TASK-070
 *   spec (per §5 of the request) directs us to adopt `ping` and mark it
 *   IMPLEMENTATION_INFRASTRUCTURE_ROUTE — a connection-liveness /
 *   protocol-probe contract, NOT a new city-response business capability.
 *   Server → Client events (timeline.updated, anomaly.detected,
 *   decision.fast_path_ready, decision.enriched, public_alert.ready,
 *   report.ready) are event TYPES, not Client → Backend route keys.
 *
 * ─── Connections table wiring (§4.5) ────────────────────────────────────────
 *
 *   TASK-065 created the connections table; this Construct consumes it
 *   as `dynamodb.ITable` (no second table is created). The table name
 *   and TTL attribute are wired via WebSocket Stage Variables
 *   (`CONNECTIONS_TABLE_NAME`, `CONNECTIONS_TTL_ATTRIBUTE`) so the
 *   inbound ConnFn handler can resolve them at runtime. Lambda env
 *   mutation is explicitly avoided to keep NetworkAuthStack and
 *   ComputeStack from forming a circular dependency.
 *
 *   This Construct intentionally does NOT call:
 *     - table.grantReadWriteData / grantReadData / grantWriteData
 *     - table.addToResourcePolicy / addToRolePolicy
 *     - connFn.addEnvironment(...)
 *     - wsPushFn.addEnvironment(...)
 *
 *   DynamoDB IAM is owned by TASK-083 (WsConnFnRole).
 *
 * ─── Disconnect lifecycle (§4.5) ────────────────────────────────────────────
 *
 *   - $connect is handled by ConnFn which writes the connectionId to the
 *     connections table.
 *   - $disconnect is handled by ConnFn which attempts to delete the
 *     connectionId; this is BEST-EFFORT and MUST NOT be treated as the
 *     sole source of online-status truth.
 *   - The TTL attribute on the connections table is a STALE-ROW CLEANUP
 *     FALLBACK for abnormal client close / missed $disconnect / network
 *     interruption. TTL is NOT an immediate disconnect signal and NOT
 *     online-presence truth.
 *   - If WsPushFn receives `GoneException` / HTTP 410 from the
 *     management API, the owning Handler task (TASK-103 / 119 / 148) is
 *     responsible for cleaning up the stale connection row. TASK-070
 *     does NOT implement Handler code.
 *   - TASK-070 does NOT claim physical exactly-once delivery. Effective
 *     deduplication is `ready_event_id` (frontend TASK-123); HTTP
 *     polling fallback is TASK-122.
 *
 * ─── Endpoint contracts (§13) ───────────────────────────────────────────────
 *
 *   - endpoint (frontend / config key `ws.endpoint`) is sourced from
 *     `webSocketStage.url` — the wss URL the Frontend Client uses to
 *     open a WebSocket connection.
 *   - callbackUrl is sourced from `webSocketStage.callbackUrl` — the
 *     HTTPS URL the Backend uses to POST to `@connections`. It is a
 *     BACKEND-only contract; it is NOT emitted as a frontend config key.
 *   - managementApiArn is the precise execute-api ARN
 *     `arn:<partition>:execute-api:<region>:<account>:<apiId>/<stageName>/POST/@connections/*`
 *     assembled with CDK tokens (Stack.of(this).partition, region, account,
 *     apiId) and the injected stageName. No account/region/apiId literals.
 *
 * ─── IAM ownership (precise, do not blur) ──────────────────────────────────
 *
 *   This Construct emits exactly FOUR resource-based
 *   `AWS::Lambda::Permission` resources — one per inbound route — attached
 *   to the same injected ConnFn. Each permission's SourceArn is scoped to
 *   the specific route key (`*$<routeKey>`); the stage segment is the only
 *   wildcard. The four integration instances are auditable, independently
 *   synthesized, and provable from the CFN template.
 *
 *   It does NOT create any IAM Role, IAM Policy, ManagedPolicy, or
 *   `execute-api:ManageConnections` grant. Those belong to TASK-083
 *   (WsConnFnRole) and downstream tasks.
 *
 *   - WsConnFnRole            → TASK-083 (created)
 *   - WsPushFnRole            → TASK-083 (same shared role, per TASK-067)
 *   - ManageConnections grant → TASK-083 (only Ws roles receive it)
 *   - Final Lambda ↔ role bind → TASK-179
 *   - Stack composition       → TASK-180
 *
 * ─── Out of scope (deferred) ───────────────────────────────────────────────
 *
 * - WebSocket authorizer / Cognito authorizer (TASK-070 spec forbids it)
 * - Stack composition / NetworkAuthStack wiring (TASK-180)
 * - IAM roles / policies / grants (TASK-083)
 * - Lambda environment mutation (TASK-179 final binding)
 * - Handler code: $connect / $disconnect / $default / ping (TASK-103/119/148)
 * - Frontend WebSocket client / ready_event_id dedup (TASK-123)
 * - Polling fallback (TASK-122)
 * - SSM parameter provisioning (TASK-073)
 * - API access logs / metrics / alarms (TASK-075)
 * - GoneException / 410 cleanup (Handler task)
 *
 * LOCAL_MOCK:
 *   - 0 AWS resources, 0 Outputs, no fake endpoint / callbackUrl / ARN
 *   - validation of non-AWS-only inputs (apiName, stageName, customRouteKey,
 *     connectionsTtlAttributeName) still runs
 */

import { Construct } from 'constructs';
import { ArnFormat, CfnOutput, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { EnvironmentContext } from '../env_context.js';

// ─── Route contract ─────────────────────────────────────────────────────────

/**
 * The three system route keys (built-in to API Gateway WebSocket).
 * MUST NOT be renamed.
 */
export const WS_SYSTEM_ROUTE_KEYS = ['$connect', '$disconnect', '$default'] as const;
export type WsSystemRouteKey = (typeof WS_SYSTEM_ROUTE_KEYS)[number];

/**
 * The custom route key — TASK-070 spec §5.
 *
 * Design (§4.5) does not pin a specific custom route key. TASK-070 adopts
 * `ping` and explicitly classifies it as
 * `IMPLEMENTATION_INFRASTRUCTURE_ROUTE` — a connection-liveness /
 * protocol-probe contract, NOT a new city-response business capability.
 *
 * It is NOT:
 *   - `timeline.updated` / `anomaly.detected` / `incident.injected` /
 *     `decision.fast_path_ready` / `decision.enriched` /
 *     `public_alert.ready` / `report.ready` / `publish.status_changed` /
 *     `processing.failed` — those are Server → Client event TYPES.
 *   - `broadcast` / `sendmessage` / `publish` / `push` / `subscribe` —
 *     those would expose WsPushFn as a Client-invocable target and
 *     create an unauthenticated broadcast capability.
 */
export const WS_CUSTOM_ROUTE_KEY = 'ping';
export const WS_CUSTOM_ROUTE_CLASSIFICATION = 'IMPLEMENTATION_INFRASTRUCTURE_ROUTE';

/**
 * Complete contract route set — single source of truth, frozen at module load.
 * System + custom = 4 routes exactly.
 */
export const WS_ROUTE_CONTRACT: readonly string[] = Object.freeze([
  ...WS_SYSTEM_ROUTE_KEYS,
  WS_CUSTOM_ROUTE_KEY,
]);

export const WS_ROUTE_COUNT = WS_ROUTE_CONTRACT.length;
export const WS_SYSTEM_ROUTE_COUNT = WS_SYSTEM_ROUTE_KEYS.length;
export const WS_CUSTOM_ROUTE_COUNT = 1;

/**
 * The route selection expression for the WebSocket API.
 * The Client's `action` field selects the route key.
 */
export const WS_ROUTE_SELECTION_EXPRESSION = '$request.body.action';

/**
 * Config key for `ws.endpoint` — matches `packages/config/src/config_schema.ts`
 * (entry at line ~216 of `config_schema.ts`).
 */
export const WS_ENDPOINT_CONFIG_KEY = 'ws.endpoint';

// ─── Stage variables — inbound ConnFn runtime binding (§4.5) ───────────────

export const WS_STAGE_VAR_CONNECTIONS_TABLE_NAME = 'CONNECTIONS_TABLE_NAME';
export const WS_STAGE_VAR_CONNECTIONS_TTL_ATTRIBUTE = 'CONNECTIONS_TTL_ATTRIBUTE';

/** Forbidden route keys — reserved for system, Server → Client events, or anonymous broadcasts. */
const FORBIDDEN_CUSTOM_ROUTE_KEYS: ReadonlySet<string> = new Set([
  // System
  '$connect', '$disconnect', '$default',
  // Forbidden $prefixed route keys
  '$broadcast', '$sendmessage', '$publish', '$push', '$subscribe',
  // Server → Client event TYPES (must not be inbound Client → Backend route keys)
  'timeline.updated',
  'anomaly.detected',
  'incident.injected',
  'decision.fast_path_ready',
  'decision.enriched',
  'public_alert.ready',
  'report.ready',
  'publish.status_changed',
  'processing.failed',
  // Anonymous-broadcast keys (would expose WsPushFn)
  'broadcast', 'sendmessage', 'publish', 'push', 'subscribe',
]);

// ─── Outbound push binding contract (§4.5) ──────────────────────────────────

/**
 * Typed contract for the outbound management plane.
 *
 * TASK-179 / TASK-180 use this to bind WsPushFn to the WebSocket API's
 * management API. The actual `execute-api:ManageConnections` grant is
 * owned by TASK-083 (WsConnFnRole).
 */
export interface WsOutboundPushBindingContract {
  /** The push Lambda function reference (NOT a route target). */
  readonly wsPushFn: IFunction;
  /** Backend-only HTTPS callback URL (`webSocketStage.callbackUrl`). */
  readonly callbackUrl: string;
  /** Precise execute-api ARN for POST @connections. */
  readonly managementApiArn: string;
  /** WebSocket API id (CDK token). */
  readonly apiId: string;
  /** Stage name (injected). */
  readonly stageName: string;
  /** Connections DynamoDB table name (CDK token via ITable.tableName). */
  readonly connectionsTableName: string;
  /** Connections table TTL attribute name (injected). */
  readonly connectionsTtlAttributeName: string;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface WebSocketApiConstructProps {
  readonly envContext: EnvironmentContext;

  /** Logical name for the WebSocketApi (used as `apiName`). */
  readonly webSocketApiName: string;

  /**
   * Stage name. MUST NOT be `$default` (TASK-070 spec §14) — we always
   * create a named Stage with explicit `stageName` from props. The
   * canonical deployment target is the named stage.
   */
  readonly stageName: string;

  /**
   * Lambda reference for inbound route handler (ConnFn).
   * MUST be distinct from `wsPushFn`.
   */
  readonly connFn: IFunction;

  /**
   * Lambda reference for outbound push (WsPushFn).
   * MUST NOT be the target of any inbound route.
   * The runtime caller; bound to the management API by TASK-083 / TASK-179.
   */
  readonly wsPushFn: IFunction;

  /**
   * Connections DynamoDB table (TASK-065). The table name is wired into
   * Stage Variables — NOT into Lambda env — to avoid the
   * NetworkAuthStack ↔ ComputeStack circular dependency.
   *
   * Under LOCAL_MOCK the table is `undefined` (no resources created);
   * the AWS-only stage variables are skipped entirely.
   */
  readonly connectionsTable: ITable | undefined;

  /**
   * Connections table TTL attribute name.
   * MUST match the runtime writer's attribute.
   * MUST NOT equal `connectionId` (the partition key).
   */
  readonly connectionsTtlAttributeName: string;
}

// ─── Construct ──────────────────────────────────────────────────────────────

export class WebSocketApiConstruct extends Construct {
  // Public contract — consumed by TASK-180 (stack composition)
  public readonly webSocketApi?: apigwv2.IWebSocketApi;
  public readonly webSocketStage?: apigwv2.IWebSocketStage;
  public readonly apiId?: string;
  public readonly endpoint?: string;
  public readonly callbackUrl?: string;
  public readonly managementApiArn?: string;
  public readonly connectionsTable?: ITable;
  /**
   * Echoed for downstream wiring so the runtime writer uses the same
   * attribute name. Always populated, even under LOCAL_MOCK.
   */
  public readonly connectionsTtlAttributeName: string;
  public readonly outboundPushBindingContract?: WsOutboundPushBindingContract;

  /** Map of canonical route key → constructed WebSocketRoute. */
  public readonly routesByKey: Record<string, apigwv2.WebSocketRoute> = {};

  /** Fixed counts. */
  public readonly routeCount: number = WS_ROUTE_COUNT;
  public readonly systemRouteCount: number = WS_SYSTEM_ROUTE_COUNT;
  public readonly customRouteCount: number = WS_CUSTOM_ROUTE_COUNT;

  public constructor(scope: Construct, id: string, props: WebSocketApiConstructProps) {
    super(scope, id);

    const { envContext } = props;
    const { isLocalMock } = envContext;

    // ── Props validation (fail-fast for all profiles) ─────────────────────

    validateApiName(props.webSocketApiName);
    validateStageName(props.stageName);
    validateTtlAttributeName(props.connectionsTtlAttributeName);
    requireFunction('connFn', props.connFn);
    requireFunction('wsPushFn', props.wsPushFn);
    if (props.connFn === props.wsPushFn) {
      throw new Error('connFn and wsPushFn must be distinct Lambda references (not the same Function)');
    }
    // The custom route key is fixed at module load. We re-assert
    // its structural invariants here so accidental edits to the
    // module-level constant fail-fast at construction time.
    validateCustomRouteKey(WS_CUSTOM_ROUTE_KEY);

    // Echo the TTL attribute name (always populated, even under LOCAL_MOCK).
    this.connectionsTtlAttributeName = props.connectionsTtlAttributeName;

    // ── LOCAL_MOCK: short-circuit (0 AWS resources) ───────────────────────

    if (isLocalMock) {
      return;
    }

    // ── WebSocket API ─────────────────────────────────────────────────────
    //
    // NO `$default` stage is created here. CDK's `WebSocketApi` does not
    // create a stage by default (only HttpApi does via createDefaultStage).
    // We create exactly ONE named Stage via `new WebSocketStage(...)`.

    const webSocketApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `${envContext.resourcePrefix}-${props.webSocketApiName}`,
      description: `City Response Commander WebSocket API (TASK-070). Profile=${envContext.profile}`,
      routeSelectionExpression: WS_ROUTE_SELECTION_EXPRESSION,
    });

    // ── Lambda integrations (one per route) ──────────────────────────────
    //
    // We deliberately create FOUR distinct `WebSocketLambdaIntegration`
    // instances — one per inbound route — even though all four point to
    // the SAME injected ConnFn. This is permission-ownership isolation:
    // each route gets its own auditable `AWS::ApiGatewayV2::Integration`
    // resource and its own `AWS::Lambda::Permission` whose SourceArn
    // includes that specific route key.
    //
    // Why not share one integration? CDK 2.262.2 binds each integration
    // instance exactly once (logical-id dedup) and the resulting
    // `AWS::Lambda::Permission` SourceArn only carries the FIRST bound
    // route key. That single Permission cannot prove the other three
    // routes can invoke ConnFn. Per-route Integration instances give
    // four independent route-scoped Permissions and four auditable
    // CFN Integration resources.
    //
    // The integration ID is derived deterministically from the route
    // key so the CFN logical-id is stable across synths:
    //
    //   $connect    → ConnectIntegration
    //   $disconnect → DisconnectIntegration
    //   $default    → DefaultIntegration
    //   ping        → PingIntegration
    //
    // No CfnPermission is hand-written — we let the official L2
    // `WebSocketLambdaIntegration.bind()` emit each Lambda permission.

    const integrationsByRouteKey: Record<string, WebSocketLambdaIntegration> = {};
    for (const routeKey of WS_ROUTE_CONTRACT) {
      const integrationId = routeKeyToIntegrationId(routeKey);
      integrationsByRouteKey[routeKey] = new WebSocketLambdaIntegration(
        integrationId,
        props.connFn,
      );
    }

    // ── Routes ────────────────────────────────────────────────────────────

    for (const routeKey of WS_ROUTE_CONTRACT) {
      const route = new apigwv2.WebSocketRoute(this, `Route_${routeKey.replace(/[^A-Za-z0-9]/g, '_')}`, {
        webSocketApi,
        routeKey,
        integration: integrationsByRouteKey[routeKey],
      });
      this.routesByKey[routeKey] = route;
    }

    // ── Stage variables — runtime binding for the inbound ConnFn ────────
    //
    // Connections table name is sourced from the injected `ITable.tableName`
    // (which is a CDK token; not a hard-coded literal). Under LOCAL_MOCK
    // the table is `undefined` and stage creation is skipped.

    const stageVariables: Record<string, string> = {
      [WS_STAGE_VAR_CONNECTIONS_TABLE_NAME]: props.connectionsTable
        ? props.connectionsTable.tableName
        : '',
      [WS_STAGE_VAR_CONNECTIONS_TTL_ATTRIBUTE]: props.connectionsTtlAttributeName,
    };

    const webSocketStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: props.stageName,
      autoDeploy: true,
      stageVariables,
    });

    // ── Outputs (no cross-stack exportName) ──────────────────────────────

    new CfnOutput(this, 'WebSocketEndpoint', {
      value: webSocketStage.url,
    });

    // ── Outbound management contract ─────────────────────────────────────

    const stack = Stack.of(this);
    const managementApiArn = stack.formatArn({
      service: 'execute-api',
      resource: webSocketApi.apiId,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      resourceName: `${props.stageName}/POST/@connections/*`,
    });

    const outboundPushBindingContract: WsOutboundPushBindingContract = {
      wsPushFn: props.wsPushFn,
      callbackUrl: webSocketStage.callbackUrl,
      managementApiArn,
      apiId: webSocketApi.apiId,
      stageName: props.stageName,
      connectionsTableName: props.connectionsTable ? props.connectionsTable.tableName : '',
      connectionsTtlAttributeName: props.connectionsTtlAttributeName,
    };

    // ── Public surface ───────────────────────────────────────────────────

    this.webSocketApi = webSocketApi;
    this.webSocketStage = webSocketStage;
    this.apiId = webSocketApi.apiId;
    this.endpoint = webSocketStage.url;
    this.callbackUrl = webSocketStage.callbackUrl;
    this.managementApiArn = managementApiArn;
    this.connectionsTable = props.connectionsTable;
    this.connectionsTtlAttributeName = props.connectionsTtlAttributeName;
    this.outboundPushBindingContract = outboundPushBindingContract;
  }
}

// ─── Validation helpers ─────────────────────────────────────────────────────

function fail(label: string, msg: string): never {
  throw new Error(`${label}: ${msg}`);
}

function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

function validateApiName(name: string): void {
  if (isBlank(name)) fail('webSocketApiName', 'must not be blank');
  if (name !== name.trim()) fail('webSocketApiName', 'must not have leading or trailing whitespace');
}

function validateStageName(name: string): void {
  if (isBlank(name)) fail('stageName', 'must not be blank');
  if (name !== name.trim()) fail('stageName', 'must not have leading or trailing whitespace');
  if (name === '$default') {
    fail('stageName', 'must not be "$default"; TASK-070 requires a named Stage');
  }
  // AWS API Gateway stage names: alphanumeric, hyphens, underscores;
  // 1-128 chars. CDK will validate too — but we fail-fast earlier.
  if (name.length > 128) {
    fail('stageName', `must be at most 128 chars; got ${name.length}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    fail('stageName', `must match [A-Za-z0-9_-]+; got "${name}"`);
  }
}

function validateTtlAttributeName(name: string): void {
  if (isBlank(name)) fail('connectionsTtlAttributeName', 'must not be blank');
  if (name !== name.trim()) {
    fail('connectionsTtlAttributeName', 'must not have leading or trailing whitespace');
  }
  // Mirror the table-side invariant from TASK-065.
  if (name === 'connectionId') {
    fail('connectionsTtlAttributeName', 'must not equal the partition key "connectionId"');
  }
}

function validateCustomRouteKey(key: string): void {
  if (isBlank(key)) fail('customRouteKey', 'must not be blank');
  if (key.startsWith('$')) {
    fail('customRouteKey', `must not start with "$"; got "${key}"`);
  }
  if (FORBIDDEN_CUSTOM_ROUTE_KEYS.has(key)) {
    fail('customRouteKey', `forbidden key "${key}" (system, server→client event type, or anonymous broadcast)`);
  }
  if (WS_SYSTEM_ROUTE_KEYS.includes(key as WsSystemRouteKey)) {
    fail('customRouteKey', `must not equal a system route key; got "${key}"`);
  }
}

function requireFunction(label: string, fn: IFunction | undefined): asserts fn is IFunction {
  if (!fn) fail(label, 'must be a valid Lambda function reference');
}

/**
 * Map a route key to a stable CFN-friendly integration id.
 *
 * Deterministic, prefix-stable IDs make the synthesized CFN logical ids
 * stable across synths (no synthetic-hash jitter) and keep permission
 * ownership easy to audit from the template.
 */
function routeKeyToIntegrationId(routeKey: string): string {
  switch (routeKey) {
    case '$connect':    return 'ConnectIntegration';
    case '$disconnect': return 'DisconnectIntegration';
    case '$default':    return 'DefaultIntegration';
    case 'ping':        return 'PingIntegration';
    default:            return `${routeKey.replace(/[^A-Za-z0-9]/g, '_')}Integration`;
  }
}
