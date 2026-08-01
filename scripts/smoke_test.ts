/**
 * TASK-169 — 3-Event Smoke Test Harness
 *
 * Injects the three official canonical scenarios (ACC_001 / EVT_002 / EVT_003)
 * and asserts that decisions/reports/public alerts are produced and that the
 * core numbers the SERVER reports match the ratified HG-001 golden walkthrough
 * (design.md §9.5, §12; tasks.md TASK-169 / HG-001 amendment record).
 *
 * HARD RULES (do not violate — see TASK-169 spec):
 *   - This script NEVER recomputes A/B classification, SOP triggers, routes,
 *     ETE, or anomaly truth. It only compares values the server/fixture
 *     reports against the ratified golden numbers.
 *   - Any core number/route not present in the ratified §9.5/§12 walkthrough
 *     is reported as CONTRACT_EVIDENCE_MISSING — never guessed.
 *   - `live` mode never runs unless HTTP endpoint, WS endpoint, admin token,
 *     deployment readiness, and KB ingestion COMPLETE are all independently
 *     confirmed (preflight). Any missing precondition -> BLOCKED, fail closed.
 *   - `fixture` mode results are always labeled `fixture:true` and never
 *     claim an AWS smoke pass.
 *   - No endpoint/token/account/region is hard-coded; all come from CLI/env.
 *   - No secret value (token, Authorization header, full raw response) is
 *     ever written to stdout/stderr.
 *
 * Usage:
 *   tsx scripts/smoke_test.ts --mode dry-run
 *   tsx scripts/smoke_test.ts --mode fixture
 *   tsx scripts/smoke_test.ts --mode live --endpoint https://... --ws-endpoint wss://... --admin-token *** \
 *       --deployment-readiness-endpoint https://.../readiness \
 *       --kb-ingestion-status-endpoint https://.../kb-status --run-id stable-run-001 \
 *       --run-ledger /secure/operator/evidence/task169-ledger
 *
 * Env equivalents: SMOKE_MODE, SMOKE_HTTP_ENDPOINT, SMOKE_WS_ENDPOINT, SMOKE_ADMIN_TOKEN,
 *   SMOKE_TIMEOUT_MS, SMOKE_MAX_RETRIES, SMOKE_POLL_INTERVAL_MS, SMOKE_RUN_ID,
 *   SMOKE_DEPLOYMENT_READINESS_ENDPOINT, SMOKE_KB_INGESTION_STATUS_ENDPOINT,
 *   SMOKE_RUN_LEDGER, SMOKE_SCENARIOS
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type SmokeMode = 'dry-run' | 'fixture' | 'live';
export const SMOKE_MODES: readonly SmokeMode[] = ['dry-run', 'fixture', 'live'] as const;

export const CANONICAL_SCENARIOS = ['ACC_001', 'EVT_002', 'EVT_003'] as const;
export type ScenarioId = (typeof CANONICAL_SCENARIOS)[number];

export type SafeErrorCode =
  | 'NONE'
  | 'CONFIG_INVALID'
  | 'MISSING_DEPENDENCY'
  | 'CONTRACT_EVIDENCE_MISSING'
  | 'PREFLIGHT_BLOCKED'
  | 'TIMEOUT_EXCEEDED'
  | 'RETRY_EXHAUSTED'
  | 'ASSERTION_FAILED';

export type StageStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'NOT_IN_WALKTHROUGH';

export interface StageResult {
  scenario: ScenarioId | 'PREFLIGHT' | 'SUITE';
  stage: string;
  status: StageStatus;
  run_id: string;
  trace_id: string | null;
  started_at: string;
  completed_at: string;
  elapsed_ms: number;
  dependency_failure: string | null;
  safe_error_code: SafeErrorCode;
  fixture: boolean;
  detail?: string;
}

export interface SmokeConfig {
  mode: SmokeMode;
  httpEndpoint: string | null;
  wsEndpoint: string | null;
  adminToken: string | null;
  timeoutMs: number;
  maxRetries: number;
  pollIntervalMs: number;
  runId: string;
  runIdExplicit: boolean;
  runLedgerPath: string;
  deploymentReadinessEndpoint: string | null;
  kbIngestionStatusEndpoint: string | null;
  scenarios: ScenarioId[];
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Secret redaction (requirement 14: never print token/Authorization/raw response)
// ─────────────────────────────────────────────────────────────────────────

const SECRET_KEY_PATTERN = /token|authorization|secret|credential|password/i;

/** Recursively strips any object key that looks like a secret. Safe for logging. */
export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(v);
    }
    return out as unknown as T;
  }
  return value;
}

function printJsonLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(redact(obj))}\n`);
}

// ─────────────────────────────────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────────────────────────────────

function isoNow(): string {
  return new Date().toISOString();
}

function stage(
  scenario: StageResult['scenario'],
  stageName: string,
  status: StageStatus,
  config: { runId: string; fixture: boolean },
  opts: {
    traceId?: string | null;
    startedAt: string;
    dependencyFailure?: string | null;
    safeErrorCode?: SafeErrorCode;
    detail?: string;
  },
): StageResult {
  const completedAt = isoNow();
  return {
    scenario,
    stage: stageName,
    status,
    run_id: config.runId,
    trace_id: opts.traceId ?? null,
    started_at: opts.startedAt,
    completed_at: completedAt,
    elapsed_ms: new Date(completedAt).getTime() - new Date(opts.startedAt).getTime(),
    dependency_failure: opts.dependencyFailure ?? null,
    safe_error_code: opts.safeErrorCode ?? 'NONE',
    fixture: config.fixture,
    ...(opts.detail ? { detail: opts.detail } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Idempotent run identity (requirement 15: bounded, no unlimited re-injection)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Deterministic idempotency key: same run_id + scenario always yields the
 * same key, so a script bug that calls inject twice within one run is
 * deduped server-side. A different run_id yields a new key deliberately
 * (an intentional new run), so reruns never collide silently with a
 * previous run's in-flight state, and never loop unboundedly against
 * a single key.
 */
export function buildIdempotencyKey(
  eventId: string,
  eventTimestamp: string,
  runId: string,
): string {
  return `${eventId}|${eventTimestamp}|smoke-${runId}`;
}

interface LiveRunLedgerEntry {
  readonly idempotency_key: string;
  readonly scenario: ScenarioId;
  readonly run_id: string;
  readonly status: 'claimed' | 'posted';
  readonly claimed_at: string;
  readonly decision_id?: string;
  readonly trace_id?: string;
}

interface LiveRunLedgerClaim {
  readonly claimed: boolean;
  readonly markerPath: string;
  readonly entry: LiveRunLedgerEntry | null;
  readonly error?: string;
}

function ledgerMarkerPath(ledgerPath: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
  return join(ledgerPath, `${digest}.json`);
}

/**
 * Atomically claims a live injection key with an exclusive-create marker.
 * `open(..., 'wx')` is the cross-process fence: exactly one process may POST.
 */
function claimLiveInjection(
  ledgerPath: string,
  idempotencyKey: string,
  scenario: ScenarioId,
  runId: string,
): LiveRunLedgerClaim {
  mkdirSync(ledgerPath, { recursive: true });
  const markerPath = ledgerMarkerPath(ledgerPath, idempotencyKey);
  const entry: LiveRunLedgerEntry = {
    idempotency_key: idempotencyKey,
    scenario,
    run_id: runId,
    status: 'claimed',
    claimed_at: isoNow(),
  };

  try {
    const descriptor = openSync(markerPath, 'wx');
    try {
      writeFileSync(descriptor, `${JSON.stringify(entry)}\n`, 'utf8');
    } finally {
      closeSync(descriptor);
    }
    return { claimed: true, markerPath, entry };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      return {
        claimed: false,
        markerPath,
        entry: null,
        error: `run ledger claim failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  try {
    const existing = JSON.parse(readFileSync(markerPath, 'utf8')) as LiveRunLedgerEntry;
    if (
      existing.idempotency_key !== idempotencyKey ||
      existing.scenario !== scenario ||
      existing.run_id !== runId
    ) {
      return { claimed: false, markerPath, entry: null, error: 'run ledger marker identity mismatch' };
    }
    return { claimed: false, markerPath, entry: existing };
  } catch (error) {
    return {
      claimed: false,
      markerPath,
      entry: null,
      error: `run ledger marker malformed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function completeLiveInjectionClaim(
  claim: LiveRunLedgerClaim,
  decisionId: string,
  traceId: string | undefined,
): void {
  if (!claim.claimed || claim.entry === null) return;
  const completed: LiveRunLedgerEntry = {
    ...claim.entry,
    status: 'posted',
    decision_id: decisionId,
    ...(traceId ? { trace_id: traceId } : {}),
  };
  const temporaryPath = `${claim.markerPath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(completed)}\n`, 'utf8');
  renameSync(temporaryPath, claim.markerPath);
}

// ─────────────────────────────────────────────────────────────────────────
// CLI / env config resolution
// ─────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(key, next);
      i += 1;
    } else {
      out.set(key, 'true');
    }
  }
  return out;
}

function positiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigValidationError(`${label} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

/**
 * Resolves the run configuration from CLI args (highest precedence) then
 * environment variables, with safe, non-live defaults. Never hard-codes an
 * endpoint/token/account/region; every one of those is caller-supplied.
 */
export function resolveConfig(argv: string[], env: Record<string, string | undefined>): SmokeConfig {
  const cli = parseArgs(argv);

  const modeRaw = cli.get('mode') ?? env.SMOKE_MODE ?? 'dry-run';
  if (!SMOKE_MODES.includes(modeRaw as SmokeMode)) {
    throw new ConfigValidationError(
      `mode must be one of ${SMOKE_MODES.join(', ')}, got: ${modeRaw}`,
    );
  }
  const mode = modeRaw as SmokeMode;

  const httpEndpoint = cli.get('endpoint') ?? env.SMOKE_HTTP_ENDPOINT ?? null;
  const wsEndpoint = cli.get('ws-endpoint') ?? env.SMOKE_WS_ENDPOINT ?? null;
  const adminToken = cli.get('admin-token') ?? env.SMOKE_ADMIN_TOKEN ?? null;
  const deploymentReadinessEndpoint =
    cli.get('deployment-readiness-endpoint') ?? env.SMOKE_DEPLOYMENT_READINESS_ENDPOINT ?? null;
  const kbIngestionStatusEndpoint =
    cli.get('kb-ingestion-status-endpoint') ?? env.SMOKE_KB_INGESTION_STATUS_ENDPOINT ?? null;

  const timeoutMs = positiveInt(
    cli.get('timeout-ms') ?? env.SMOKE_TIMEOUT_MS,
    30_000,
    'timeout-ms',
  );
  const maxRetries = positiveInt(cli.get('max-retries') ?? env.SMOKE_MAX_RETRIES, 5, 'max-retries');
  // Default 2s poll interval mirrors the documented WebSocket-fallback polling
  // default in design.md §13 ("可設定間隔，預設 2s").
  const pollIntervalMs = positiveInt(
    cli.get('poll-interval-ms') ?? env.SMOKE_POLL_INTERVAL_MS,
    2_000,
    'poll-interval-ms',
  );

  const suppliedRunId = cli.get('run-id') ?? env.SMOKE_RUN_ID;
  const runIdExplicit = suppliedRunId !== undefined && suppliedRunId.trim() !== '';
  // Live runs must never receive a random identity: preflight blocks this
  // sentinel before any network mutation. Offline modes retain convenient,
  // explicitly non-live UUID identities.
  const runId = runIdExplicit
    ? suppliedRunId.trim()
    : mode === 'live'
      ? 'LIVE_RUN_ID_REQUIRED'
      : randomUUID();
  const runLedgerPath =
    cli.get('run-ledger') ??
    env.SMOKE_RUN_LEDGER ??
    join(process.cwd(), '.task169-smoke-run-ledger');

  const scenariosRaw = cli.get('scenarios') ?? env.SMOKE_SCENARIOS ?? CANONICAL_SCENARIOS.join(',');
  const scenarios = scenariosRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as ScenarioId[];
  for (const s of scenarios) {
    if (!CANONICAL_SCENARIOS.includes(s)) {
      throw new ConfigValidationError(
        `unknown scenario "${s}"; only ${CANONICAL_SCENARIOS.join(', ')} are canonical (TASK-170/172/173 are out of scope for TASK-169)`,
      );
    }
  }

  return {
    mode,
    httpEndpoint,
    wsEndpoint,
    adminToken,
    timeoutMs,
    maxRetries,
    pollIntervalMs,
    runId,
    runIdExplicit,
    runLedgerPath,
    deploymentReadinessEndpoint,
    kbIngestionStatusEndpoint,
    scenarios,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fixture loading (dry-run / fixture modes)
// ─────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, 'fixtures', 'smoke');

const FIXTURE_FILENAMES: Record<ScenarioId, string> = {
  ACC_001: 'acc_001.json',
  EVT_002: 'evt_002.json',
  EVT_003: 'evt_003.json',
};

export interface FixtureData {
  fixture: true;
  scenario: ScenarioId;
  incident: Record<string, unknown>;
  decision_response: Record<string, unknown>;
  report_response: { report: Record<string, unknown> | null; alert: Record<string, unknown> | null };
  latency: { FastPathLatencyMs: number; EndToEndLatencyMs: number };
}

export function loadFixture(scenario: ScenarioId): FixtureData {
  const path = join(FIXTURE_DIR, FIXTURE_FILENAMES[scenario]);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as FixtureData;
  if (parsed.fixture !== true) {
    throw new Error(`fixture file for ${scenario} is missing fixture:true marker`);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// HG-001 golden-number assertions (comparison only — never recomputed here)
// ─────────────────────────────────────────────────────────────────────────

export interface AssertionOutcome {
  passed: boolean;
  violations: string[];
  notInWalkthrough: string[];
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Compares a decision-response payload (server or fixture) against the
 * ratified HG-001 golden values (tasks.md HG-001 record; design.md §9.5/§12).
 * This performs equality CHECKS ONLY. It never computes ETE, classification,
 * routes, or SOP triggers itself (TASK-169 rule 9).
 */
export function assertHg001Core(scenario: ScenarioId, decision: Record<string, unknown>): AssertionOutcome {
  const violations: string[] = [];
  const notInWalkthrough: string[] = [];

  if (scenario === 'ACC_001') {
    // Golden: ACC_001 ETE = 78.6 (tasks.md HG-001; design.md §9.5/§12).
    const ete = get(decision, 'ete.ete_minutes');
    if (ete !== 78.6) violations.push(`ACC_001 ete.ete_minutes expected 78.6, got ${String(ete)}`);

    const primary = get(decision, 'primary_evacuation.segment_id');
    if (primary !== 'RD_TPE_004') {
      violations.push(`ACC_001 primary_evacuation.segment_id expected RD_TPE_004, got ${String(primary)}`);
    }
    const secondary = get(decision, 'secondary_evacuation.0.segment_id');
    if (secondary !== 'RD_TPE_005') {
      violations.push(`ACC_001 secondary_evacuation[0].segment_id expected RD_TPE_005, got ${String(secondary)}`);
    }
    const triggered = get(decision, 'triggered_articles');
    if (!Array.isArray(triggered) || !triggered.includes(1) || !triggered.includes(2)) {
      violations.push(`ACC_001 triggered_articles expected to include [1, 2], got ${JSON.stringify(triggered)}`);
    }
    if (get(decision, 'provisional') !== true) {
      violations.push('ACC_001 provisional flag must be true (never presented as official)');
    }
  } else if (scenario === 'EVT_002') {
    // Golden: EVT_002 uses the 22:15 BL17 observation; 22:30 is FORBIDDEN;
    // ETE not applicable; affected_road is DISPLAY_AND_CONTEXT_ONLY (tasks.md HG-001).
    const bl17Timestamp = get(decision, 'bl17_observation.timestamp');
    if (bl17Timestamp === '2026-05-20 22:30') {
      violations.push('EVT_002 must never use the 22:30 BL17 observation (HG-001 hard invariant)');
    }
    if (bl17Timestamp !== '2026-05-20 22:15') {
      violations.push(`EVT_002 bl17_observation.timestamp expected 2026-05-20 22:15, got ${String(bl17Timestamp)}`);
    }
    const userCount = get(decision, 'bl17_observation.user_count');
    if (userCount !== 31000) {
      violations.push(`EVT_002 bl17_observation.user_count expected 31000, got ${String(userCount)}`);
    }
    const eteStatus = get(decision, 'ete.calculation_status');
    if (eteStatus !== 'NOT_APPLICABLE') {
      violations.push(`EVT_002 ete.calculation_status expected NOT_APPLICABLE, got ${String(eteStatus)}`);
    }
    const roadRole = get(decision, 'policy.affected_road.role');
    if (roadRole !== 'DISPLAY_AND_CONTEXT_ONLY') {
      violations.push(`EVT_002 policy.affected_road.role expected DISPLAY_AND_CONTEXT_ONLY, got ${String(roadRole)}`);
    }
    // No route/evacuation is defined by the ratified walkthrough for EVT_002
    // (SOP-3 is a transit-diversion procedure, not a road-evacuation
    // selection) — do not guess a route assertion here.
    notInWalkthrough.push('EVT_002 primary/secondary evacuation route (SOP-3 does not define one)');
  } else if (scenario === 'EVT_003') {
    // Golden: EVT_003 ETE = 41.0 (tasks.md HG-001; design.md §9.5).
    const ete = get(decision, 'ete.ete_minutes');
    if (ete !== 41.0) violations.push(`EVT_003 ete.ete_minutes expected 41.0, got ${String(ete)}`);

    const affectedSet = get(decision, 'ete.affected_set');
    const ids = Array.isArray(affectedSet)
      ? affectedSet.map((s) => (s as { segment_id?: string }).segment_id)
      : [];
    if (!ids.includes('RD_TPE_007') || !ids.includes('RD_TPE_011')) {
      violations.push(`EVT_003 ete.affected_set expected to include RD_TPE_007 and RD_TPE_011, got ${JSON.stringify(ids)}`);
    }
    const triggered = get(decision, 'triggered_articles');
    if (!Array.isArray(triggered) || !triggered.includes(5)) {
      violations.push(`EVT_003 triggered_articles expected to include [5], got ${JSON.stringify(triggered)}`);
    }
    // affected_intersection_scope / total police remain OQ-010 unresolved by
    // official source and are configurable (Strategy E) — the smoke test
    // does not assert a specific strategy value, only that the field exists.
    if (get(decision, 'affected_intersection_scope') === undefined) {
      notInWalkthrough.push('EVT_003 affected_intersection_scope (OQ-010 unresolved by official source)');
    }
  }

  return { passed: violations.length === 0, violations, notInWalkthrough };
}

/** Verifies the 60-second end-to-end observability requirement (design.md §20/§25 step 4). */
export function assertSixtySecondObservable(latency: { EndToEndLatencyMs?: unknown }): AssertionOutcome {
  const value = latency.EndToEndLatencyMs;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { passed: false, violations: ['EndToEndLatencyMs missing or not a number'], notInWalkthrough: [] };
  }
  if (value > 60_000) {
    return { passed: false, violations: [`EndToEndLatencyMs ${value}ms exceeds the 60s budget`], notInWalkthrough: [] };
  }
  return { passed: true, violations: [], notInWalkthrough: [] };
}

// ─────────────────────────────────────────────────────────────────────────
// Bounded retry / polling (requirement 12: every retry/poll has a hard cap)
// ─────────────────────────────────────────────────────────────────────────

export interface BoundedPollOptions {
  maxAttempts: number;
  intervalMs: number;
  timeoutMs: number;
}

export interface BoundedPollResult<T> {
  done: boolean;
  value?: T;
  attempts: number;
  timedOut: boolean;
  retriesExhausted: boolean;
}

/**
 * Polls `fn` until it reports done=true, or until EITHER maxAttempts OR
 * timeoutMs is reached (whichever comes first) — never both conditions
 * unbounded. Guarantees termination.
 */
export async function boundedPoll<T>(
  fn: (remainingMs: number) => Promise<{ done: boolean; value?: T }>,
  opts: BoundedPollOptions,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<BoundedPollResult<T>> {
  const deadline = Date.now() + opts.timeoutMs;
  let attempts = 0;

  while (attempts < opts.maxAttempts) {
    const requestRemainingMs = deadline - Date.now();
    if (requestRemainingMs <= 0) {
      return { done: false, attempts, timedOut: true, retriesExhausted: false };
    }
    attempts += 1;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlineReached = new Promise<null>((resolve) => {
      deadlineTimer = setTimeout(() => resolve(null), requestRemainingMs);
    });
    const result = await Promise.race([fn(requestRemainingMs), deadlineReached]);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (result === null) {
      return { done: false, attempts, timedOut: true, retriesExhausted: false };
    }
    if (result.done) {
      return { done: true, value: result.value, attempts, timedOut: false, retriesExhausted: false };
    }
    const sleepRemainingMs = deadline - Date.now();
    if (sleepRemainingMs <= 0) {
      return { done: false, attempts, timedOut: true, retriesExhausted: false };
    }
    if (attempts >= opts.maxAttempts) {
      return { done: false, attempts, timedOut: false, retriesExhausted: true };
    }
    await sleep(Math.min(opts.intervalMs, sleepRemainingMs));
    if (deadline - Date.now() <= 0) {
      return { done: false, attempts, timedOut: true, retriesExhausted: false };
    }
  }
  return { done: false, attempts, timedOut: false, retriesExhausted: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Live-mode network helpers (no dependency added; bounded, redacted)
// ─────────────────────────────────────────────────────────────────────────

interface BoundedFetchOptions {
  readonly timeoutMs: number;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/** Bounded JSON request with an explicit timeout. Never throws past the timeout. */
async function boundedFetch(
  url: string,
  options: BoundedFetchOptions,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  if (options.timeoutMs <= 0) return { ok: false, error: 'timeout' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      headers: options.headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // leave as text
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded check that a WebSocket endpoint accepts an HTTP Upgrade handshake.
 * Implemented with node:http/https directly (no extra dependency) so the
 * preflight can prove reachability without a full client library.
 */
export async function checkWebSocketEndpoint(
  wsUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let target: URL;
    try {
      target = new URL(wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
    } catch (error) {
      settle({ ok: false, error: `invalid ws endpoint URL: ${String(error)}` });
      return;
    }

    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const key = Buffer.from(randomUUID()).toString('base64').slice(0, 24);
    const req = requester(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
        timeout: timeoutMs,
      },
      (res) => {
        // A non-upgrade HTTP response still proves basic reachability of the
        // endpoint (many API Gateway WS endpoints reject a bare GET with 4xx
        // rather than upgrading) — reachability, not protocol correctness, is
        // what preflight needs.
        settle({ ok: (res.statusCode ?? 0) < 500 });
        res.resume();
      },
    );

    req.on('upgrade', (res) => {
      settle({ ok: (res.statusCode ?? 0) === 101 });
    });

    req.on('timeout', () => {
      req.destroy();
      settle({ ok: false, error: 'timeout' });
    });

    req.on('error', (error) => {
      settle({ ok: false, error: error.message });
    });

    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Preflight (requirement 4/5: live mode fails closed on ANY missing precondition)
// ─────────────────────────────────────────────────────────────────────────

export interface PreflightResult {
  blocked: boolean;
  dependencyFailures: string[];
  safeErrorCode: SafeErrorCode;
  checks: Record<string, { ok: boolean; detail: string }>;
}

export async function runPreflight(config: SmokeConfig): Promise<PreflightResult> {
  const checks: PreflightResult['checks'] = {};
  const dependencyFailures: string[] = [];

  // 1. HTTP endpoint
  if (!config.httpEndpoint) {
    checks.httpEndpoint = { ok: false, detail: 'no HTTP endpoint configured (--endpoint / SMOKE_HTTP_ENDPOINT)' };
    dependencyFailures.push('HTTP_ENDPOINT_NOT_CONFIGURED');
  } else {
    const result = await boundedFetch(`${config.httpEndpoint.replace(/\/$/, '')}/timeline`, {
      timeoutMs: config.timeoutMs,
    });
    checks.httpEndpoint = {
      ok: result.ok,
      detail: result.ok ? 'reachable' : `unreachable: ${result.error ?? `HTTP ${result.status}`}`,
    };
    if (!result.ok) dependencyFailures.push('HTTP_ENDPOINT_UNREACHABLE');
  }

  // 2. WebSocket endpoint
  if (!config.wsEndpoint) {
    checks.wsEndpoint = { ok: false, detail: 'no WebSocket endpoint configured (--ws-endpoint / SMOKE_WS_ENDPOINT)' };
    dependencyFailures.push('WS_ENDPOINT_NOT_CONFIGURED');
  } else {
    const result = await checkWebSocketEndpoint(config.wsEndpoint, config.timeoutMs);
    checks.wsEndpoint = { ok: result.ok, detail: result.ok ? 'reachable' : `unreachable: ${result.error ?? 'unknown'}` };
    if (!result.ok) dependencyFailures.push('WS_ENDPOINT_UNREACHABLE');
  }

  // 3. Admin token (presence only — this script never prints or validates
  //    the token value itself; content validation happens server-side)
  if (!config.adminToken) {
    checks.adminToken = { ok: false, detail: 'no admin token configured (--admin-token / SMOKE_ADMIN_TOKEN)' };
    dependencyFailures.push('ADMIN_TOKEN_NOT_CONFIGURED');
  } else {
    checks.adminToken = { ok: true, detail: 'present (value not inspected or logged)' };
  }

  // 4. Deployment readiness — TASK-167 (deploy runbook) has no ratified
  //    public readiness contract yet; requires an explicit operator-supplied
  //    endpoint. Absent that, this is CONTRACT_EVIDENCE_MISSING, not a guess.
  if (!config.deploymentReadinessEndpoint) {
    checks.deploymentReadiness = {
      ok: false,
      detail: 'no deployment-readiness endpoint configured; TASK-167 deploy runbook is not yet available',
    };
    dependencyFailures.push('DEPLOYMENT_READINESS_ENDPOINT_NOT_CONFIGURED');
  } else {
    const result = await boundedFetch(config.deploymentReadinessEndpoint, {
      timeoutMs: config.timeoutMs,
    });
    const ready = result.ok && (result.body as { ready?: boolean } | undefined)?.ready === true;
    checks.deploymentReadiness = {
      ok: ready,
      detail: ready ? 'ready' : `not ready: ${result.error ?? `HTTP ${result.status}`}`,
    };
    if (!ready) dependencyFailures.push('DEPLOYMENT_NOT_READY');
  }

  // 5. KB ingestion status = COMPLETE — TASK-178. Must be verified BEFORE any
  //    RAG smoke test (tasks.md TASK-178 step 5 / TASK-169 dependency).
  if (!config.kbIngestionStatusEndpoint) {
    checks.kbIngestionComplete = {
      ok: false,
      detail: 'no KB ingestion status endpoint configured; TASK-178 completion has no evidence',
    };
    dependencyFailures.push('KB_INGESTION_STATUS_ENDPOINT_NOT_CONFIGURED');
  } else {
    const result = await boundedFetch(config.kbIngestionStatusEndpoint, {
      timeoutMs: config.timeoutMs,
    });
    const status = (result.body as { status?: string } | undefined)?.status;
    const complete = result.ok && status === 'COMPLETE';
    checks.kbIngestionComplete = {
      ok: complete,
      detail: complete ? 'COMPLETE' : `not COMPLETE (status=${String(status)})`,
    };
    if (!complete) dependencyFailures.push('KB_INGESTION_NOT_COMPLETE');
  }

  // 6. Stable live run identity. Missing identity is a hard block and never
  //    falls back to a random UUID in live mode.
  if (!config.runIdExplicit) {
    checks.runIdentity = {
      ok: false,
      detail: 'no stable live run-id configured (--run-id / SMOKE_RUN_ID)',
    };
    dependencyFailures.push('LIVE_RUN_ID_NOT_CONFIGURED');
  } else {
    checks.runIdentity = { ok: true, detail: 'stable operator-supplied run-id present' };
  }

  const blocked = dependencyFailures.length > 0;
  const safeErrorCode: SafeErrorCode = blocked
    ? dependencyFailures.some((f) => f.endsWith('_NOT_CONFIGURED'))
      ? 'CONTRACT_EVIDENCE_MISSING'
      : 'MISSING_DEPENDENCY'
    : 'NONE';

  return { blocked, dependencyFailures, safeErrorCode, checks };
}

export interface ReportAndAlertVerification {
  readonly passed: boolean;
  readonly reportPassed: boolean;
  readonly alertPassed: boolean;
  readonly violations: string[];
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasNonEmptyTextMap(value: unknown): boolean {
  const record = recordOrNull(value);
  return (
    record !== null &&
    Object.values(record).some((text) => typeof text === 'string' && text.trim() !== '')
  );
}

/** Separately validates both artifacts and binds each to the scenario decision. */
export function verifyReportAndAlert(
  scenario: ScenarioId,
  responseBody: unknown,
  expectedDecisionId: string,
): ReportAndAlertVerification {
  const violations: string[] = [];
  const response = recordOrNull(responseBody);
  const report = recordOrNull(response?.report);
  const alert = recordOrNull(response?.alert);

  let reportPassed = true;
  if (report === null) {
    reportPassed = false;
    violations.push(`${scenario} report missing or malformed`);
  } else {
    if (report.decision_id !== expectedDecisionId) {
      reportPassed = false;
      violations.push(`${scenario} report decision_id does not match ${expectedDecisionId}`);
    }
    const reportHasContent =
      report.report_text_present === true ||
      (typeof report.report_text === 'string' && report.report_text.trim() !== '') ||
      (recordOrNull(report.event_identification) !== null && typeof report.format === 'string');
    if (!reportHasContent) {
      reportPassed = false;
      violations.push(`${scenario} report content is missing or malformed`);
    }
  }

  let alertPassed = true;
  if (alert === null) {
    alertPassed = false;
    violations.push(`${scenario} public alert missing or malformed`);
  } else {
    if (alert.decision_id !== expectedDecisionId) {
      alertPassed = false;
      violations.push(`${scenario} public alert decision_id does not match ${expectedDecisionId}`);
    }
    const languages = Array.isArray(alert.languages)
      ? alert.languages.filter((language): language is string => typeof language === 'string')
      : [];
    if (languages.length === 0 || !languages.includes('zh')) {
      alertPassed = false;
      violations.push(`${scenario} public alert languages must include zh`);
    }
    const alertHasContent =
      alert.alert_text_present === true ||
      hasNonEmptyTextMap(alert.text) ||
      hasNonEmptyTextMap(alert.public_alert_text);
    if (!alertHasContent) {
      alertPassed = false;
      violations.push(`${scenario} public alert content is missing or malformed`);
    }
  }

  return {
    passed: reportPassed && alertPassed,
    reportPassed,
    alertPassed,
    violations,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario execution — fixture mode
// ─────────────────────────────────────────────────────────────────────────

export function runScenarioFixture(scenario: ScenarioId, config: SmokeConfig): StageResult[] {
  const results: StageResult[] = [];
  const runCfg = { runId: config.runId, fixture: true };
  const fixtureData = loadFixture(scenario);
  const traceId = (fixtureData.decision_response.trace_id as string | undefined) ?? null;

  // Stage: inject
  {
    const startedAt = isoNow();
    const idempotencyKey = buildIdempotencyKey(
      String((fixtureData.incident as Record<string, unknown>).event_id),
      String((fixtureData.incident as Record<string, unknown>).timestamp),
      config.runId,
    );
    results.push(
      stage(scenario, 'inject', 'PASS', runCfg, {
        traceId,
        startedAt,
        detail: `fixture injection only; idempotency_key=${idempotencyKey}`,
      }),
    );
  }

  // Stage: bounded poll (fixture data is already resolved; still bounded)
  {
    const startedAt = isoNow();
    results.push(
      stage(scenario, 'poll_decision', 'PASS', runCfg, {
        traceId,
        startedAt,
        detail: 'fixture data is pre-resolved (0 polling attempts required)',
      }),
    );
  }

  // Stage: verify decision core numbers (comparison only — see assertHg001Core)
  {
    const startedAt = isoNow();
    const outcome = assertHg001Core(scenario, fixtureData.decision_response);
    results.push(
      stage(scenario, 'verify_decision_core', outcome.passed ? 'PASS' : 'FAIL', runCfg, {
        traceId,
        startedAt,
        safeErrorCode: outcome.passed ? 'NONE' : 'ASSERTION_FAILED',
        detail: outcome.passed
          ? `HG-001 golden numbers matched${outcome.notInWalkthrough.length ? `; not-in-walkthrough: ${outcome.notInWalkthrough.join('; ')}` : ''}`
          : outcome.violations.join('; '),
      }),
    );
  }

  // Stage: verify report + public alert produced
  {
    const startedAt = isoNow();
    const expectedDecisionId = String(fixtureData.decision_response.decision_id ?? '');
    const verification = verifyReportAndAlert(
      scenario,
      fixtureData.report_response,
      expectedDecisionId,
    );
    results.push(
      stage(scenario, 'verify_report_and_alert', verification.passed ? 'PASS' : 'FAIL', runCfg, {
        traceId,
        startedAt,
        safeErrorCode: verification.passed ? 'NONE' : 'ASSERTION_FAILED',
        detail: verification.passed
          ? 'report=valid; public_alert=valid; both match scenario decision_id'
          : verification.violations.join('; '),
      }),
    );
  }

  // Stage: verify 60s observable
  {
    const startedAt = isoNow();
    const outcome = assertSixtySecondObservable(fixtureData.latency);
    results.push(
      stage(scenario, 'verify_60s_observable', outcome.passed ? 'PASS' : 'FAIL', runCfg, {
        traceId,
        startedAt,
        safeErrorCode: outcome.passed ? 'NONE' : 'ASSERTION_FAILED',
        detail: outcome.passed
          ? `EndToEndLatencyMs=${fixtureData.latency.EndToEndLatencyMs}`
          : outcome.violations.join('; '),
      }),
    );
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario execution — live mode (only reached if preflight is not blocked)
// ─────────────────────────────────────────────────────────────────────────

export async function runScenarioLive(scenario: ScenarioId, config: SmokeConfig): Promise<StageResult[]> {
  const results: StageResult[] = [];
  const runCfg = { runId: config.runId, fixture: false };
  const fixtureShape = loadFixture(scenario); // used ONLY for the official incident payload shape, never for asserted results
  const incident = fixtureShape.incident as Record<string, unknown>;
  const eventId = String(incident.event_id);
  const idempotencyKey = buildIdempotencyKey(eventId, String(incident.timestamp), config.runId);

  const baseUrl = (config.httpEndpoint ?? '').replace(/\/$/, '');
  const authHeaders: Record<string, string> = config.adminToken
    ? { Authorization: `Bearer ${config.adminToken}` }
    : {};

  // Stage: inject. The official §12/shared-schema request contract is exactly
  // POST /incidents/{event_id}/inject with body {event_id}. The run-scoped
  // Idempotency-Key header and exclusive ledger marker prevent another POST
  // for the same canonical timestamp + run identity, including other processes.
  const injectStart = isoNow();
  const ledgerClaim = claimLiveInjection(
    config.runLedgerPath,
    idempotencyKey,
    scenario,
    config.runId,
  );
  let decisionId: string | undefined;
  if (!ledgerClaim.claimed) {
    if (ledgerClaim.entry?.status === 'posted' && ledgerClaim.entry.decision_id) {
      decisionId = ledgerClaim.entry.decision_id;
      results.push(
        stage(scenario, 'inject', 'PASS', runCfg, {
          traceId: ledgerClaim.entry.trace_id ?? null,
          startedAt: injectStart,
          detail: 'run ledger replay: prior POST reused; no injection request sent',
        }),
      );
    } else {
      results.push(
        stage(scenario, 'inject', 'BLOCKED', runCfg, {
          startedAt: injectStart,
          dependencyFailure: 'RUN_LEDGER_INJECTION_STATE_AMBIGUOUS',
          safeErrorCode: 'PREFLIGHT_BLOCKED',
          detail:
            ledgerClaim.error ??
            'an earlier process claimed this injection without a recorded decision_id; refusing a second POST',
        }),
      );
      return results;
    }
  } else {
    const injectResponse = await boundedFetch(
      `${baseUrl}/incidents/${encodeURIComponent(eventId)}/inject`,
      {
        timeoutMs: config.timeoutMs,
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: { event_id: eventId },
      },
    );
    const responseBody = recordOrNull(injectResponse.body);
    decisionId =
      typeof responseBody?.decision_id === 'string' ? responseBody.decision_id : undefined;
    const traceId = typeof responseBody?.trace_id === 'string' ? responseBody.trace_id : undefined;
    if (injectResponse.ok && decisionId) {
      completeLiveInjectionClaim(ledgerClaim, decisionId, traceId);
    }
    results.push(
      stage(scenario, 'inject', injectResponse.ok && decisionId ? 'PASS' : 'FAIL', runCfg, {
        traceId: traceId ?? null,
        startedAt: injectStart,
        safeErrorCode: injectResponse.ok && decisionId ? 'NONE' : 'ASSERTION_FAILED',
        detail:
          injectResponse.ok && decisionId
            ? 'POST accepted; decision_id recorded in run ledger'
            : `inject failed: ${injectResponse.error ?? `HTTP ${injectResponse.status ?? 'unknown'} or malformed response`}`,
      }),
    );
  }
  if (!decisionId) {
    return results;
  }

  // Stage: bounded poll for decision.fast_path_ready equivalent (GET /decisions/{id})
  const pollStart = isoNow();
  let lastDecision: Record<string, unknown> | undefined;
  const pollResult = await boundedPoll(
    async (remainingMs) => {
      const response = await boundedFetch(
        `${baseUrl}/decisions/${encodeURIComponent(decisionId)}`,
        { timeoutMs: remainingMs, headers: authHeaders },
      );
      const body = response.body as Record<string, unknown> | undefined;
      lastDecision = body;
      const execStatus = get(body, 'execution.status');
      return { done: response.ok && execStatus === 'completed', value: body };
    },
    { maxAttempts: config.maxRetries, intervalMs: config.pollIntervalMs, timeoutMs: config.timeoutMs },
  );
  results.push(
    stage(scenario, 'poll_decision', pollResult.done ? 'PASS' : 'FAIL', runCfg, {
      traceId: (lastDecision?.trace_id as string | undefined) ?? null,
      startedAt: pollStart,
      safeErrorCode: pollResult.timedOut ? 'TIMEOUT_EXCEEDED' : pollResult.retriesExhausted ? 'RETRY_EXHAUSTED' : 'NONE',
      detail: `attempts=${pollResult.attempts}`,
    }),
  );
  if (!pollResult.done || !lastDecision) {
    return results;
  }

  // Stage: verify decision core numbers (comparison only)
  const verifyStart = isoNow();
  const reportedCore = recordOrNull(lastDecision.core) ?? lastDecision;
  const outcome = assertHg001Core(scenario, reportedCore);
  results.push(
    stage(scenario, 'verify_decision_core', outcome.passed ? 'PASS' : 'FAIL', runCfg, {
      traceId: (lastDecision.trace_id as string | undefined) ?? null,
      startedAt: verifyStart,
      safeErrorCode: outcome.passed ? 'NONE' : 'ASSERTION_FAILED',
      detail: outcome.passed
        ? `HG-001 golden numbers matched${outcome.notInWalkthrough.length ? `; not-in-walkthrough: ${outcome.notInWalkthrough.join('; ')}` : ''}`
        : outcome.violations.join('; '),
    }),
  );

  // Stage: verify report + alert produced
  const reportStart = isoNow();
  const reportResponse = await boundedFetch(
    `${baseUrl}/reports/${encodeURIComponent(decisionId)}`,
    { timeoutMs: config.timeoutMs, headers: authHeaders },
  );
  const reportVerification = verifyReportAndAlert(
    scenario,
    reportResponse.ok ? reportResponse.body : null,
    decisionId,
  );
  results.push(
    stage(
      scenario,
      'verify_report_and_alert',
      reportVerification.passed ? 'PASS' : 'FAIL',
      runCfg,
      {
        startedAt: reportStart,
        safeErrorCode: reportVerification.passed ? 'NONE' : 'ASSERTION_FAILED',
        detail: reportVerification.passed
          ? 'report=valid; public_alert=valid; both match scenario decision_id'
          : [
              ...(reportResponse.ok
                ? []
                : [`reports request failed: ${reportResponse.error ?? `HTTP ${reportResponse.status}`}`]),
              ...reportVerification.violations,
            ].join('; '),
      },
    ),
  );

  // Stage: verify 60s observable (from the decision's own latency projection, if the
  // deployed contract exposes one; otherwise CONTRACT_EVIDENCE_MISSING — never guessed)
  const latencyStart = isoNow();
  const latency = get(lastDecision, 'latency') as { EndToEndLatencyMs?: unknown } | undefined;
  if (!latency) {
    results.push(
      stage(scenario, 'verify_60s_observable', 'FAIL', runCfg, {
        startedAt: latencyStart,
        safeErrorCode: 'CONTRACT_EVIDENCE_MISSING',
        detail: 'no latency projection present on the decision payload',
      }),
    );
  } else {
    const latencyOutcome = assertSixtySecondObservable(latency);
    results.push(
      stage(scenario, 'verify_60s_observable', latencyOutcome.passed ? 'PASS' : 'FAIL', runCfg, {
        startedAt: latencyStart,
        safeErrorCode: latencyOutcome.passed ? 'NONE' : 'ASSERTION_FAILED',
        detail: latencyOutcome.passed
          ? `EndToEndLatencyMs=${String(latency.EndToEndLatencyMs)}`
          : latencyOutcome.violations.join('; '),
      }),
    );
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Dry run
// ─────────────────────────────────────────────────────────────────────────

function runDryRun(config: SmokeConfig): StageResult[] {
  const runCfg = { runId: config.runId, fixture: true };
  const startedAt = isoNow();
  return [
    stage('SUITE', 'plan', 'SKIPPED', runCfg, {
      startedAt,
      detail: `mode=dry-run; scenarios=${config.scenarios.join(',')}; would run fixture assertions with no network calls`,
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Main orchestration
// ─────────────────────────────────────────────────────────────────────────

export interface SmokeRunSummary {
  verdict: 'PREPARED_AWAITING_INTEGRATION' | 'BLOCKED' | 'FAILED';
  mode: SmokeMode;
  runId: string;
  stages: StageResult[];
}

export async function runSmokeSuite(config: SmokeConfig): Promise<SmokeRunSummary> {
  const stages: StageResult[] = [];

  if (config.mode === 'dry-run') {
    stages.push(...runDryRun(config));
    return { verdict: 'PREPARED_AWAITING_INTEGRATION', mode: config.mode, runId: config.runId, stages };
  }

  if (config.mode === 'fixture') {
    for (const scenario of config.scenarios) {
      stages.push(...runScenarioFixture(scenario, config));
    }
    const anyFailed = stages.some((s) => s.status === 'FAIL');
    return {
      verdict: anyFailed ? 'FAILED' : 'PREPARED_AWAITING_INTEGRATION',
      mode: config.mode,
      runId: config.runId,
      stages,
    };
  }

  // live mode
  const preflightStart = isoNow();
  const preflight = await runPreflight(config);
  stages.push(
    stage('PREFLIGHT', 'preflight', preflight.blocked ? 'BLOCKED' : 'PASS', { runId: config.runId, fixture: false }, {
      startedAt: preflightStart,
      dependencyFailure: preflight.blocked ? preflight.dependencyFailures.join(',') : null,
      safeErrorCode: preflight.safeErrorCode,
      detail: JSON.stringify(Object.fromEntries(Object.entries(preflight.checks).map(([k, v]) => [k, v.detail]))),
    }),
  );

  if (preflight.blocked) {
    return { verdict: 'BLOCKED', mode: config.mode, runId: config.runId, stages };
  }

  for (const scenario of config.scenarios) {
    stages.push(...(await runScenarioLive(scenario, config)));
  }
  const anyBlocked = stages.some((s) => s.status === 'BLOCKED');
  const anyFailed = stages.some((s) => s.status === 'FAIL');
  return {
    verdict: anyBlocked ? 'BLOCKED' : anyFailed ? 'FAILED' : 'PREPARED_AWAITING_INTEGRATION',
    mode: config.mode,
    runId: config.runId,
    stages,
  };
}

/** Maps the documented mode/verdict contract to a process exit code. */
export function exitCodeForSummary(summary: SmokeRunSummary): number {
  if (summary.mode === 'live') {
    return summary.verdict === 'PREPARED_AWAITING_INTEGRATION' &&
      summary.stages.length > 0 &&
      summary.stages.every((stageResult) => stageResult.status === 'PASS')
      ? 0
      : 1;
  }
  return summary.verdict === 'PREPARED_AWAITING_INTEGRATION' ? 0 : 1;
}

/** Testable CLI entry point; returns rather than mutating process state. */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  let config: SmokeConfig;
  try {
    config = resolveConfig(argv, env);
  } catch (error) {
    printJsonLine({
      scenario: 'SUITE',
      stage: 'config_validation',
      status: 'FAIL',
      run_id: 'unresolved',
      trace_id: null,
      started_at: isoNow(),
      completed_at: isoNow(),
      elapsed_ms: 0,
      dependency_failure: null,
      safe_error_code: 'CONFIG_INVALID',
      fixture: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }

  const summary = await runSmokeSuite(config);
  for (const s of summary.stages) {
    printJsonLine(s);
  }
  printJsonLine({ verdict: summary.verdict, mode: summary.mode, run_id: summary.runId });

  return exitCodeForSummary(summary);
}

async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2), process.env);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  void main();
}
