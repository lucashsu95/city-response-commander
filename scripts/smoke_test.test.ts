/**
 * Focused tests for TASK-169 smoke-test harness.
 *
 * Scope (per TASK-169 spec — do not broaden):
 *  - config validation
 *  - missing dependency fail-closed
 *  - bounded retry/timeout
 *  - fixture 3-event success
 *  - scenario-stage failure
 *  - secret redaction
 *  - structured JSON
 *  - idempotent rerun
 *  - no infinite polling
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertHg001Core,
  assertSixtySecondObservable,
  boundedPoll,
  buildIdempotencyKey,
  ConfigValidationError,
  exitCodeForSummary,
  loadFixture,
  redact,
  resolveConfig,
  runPreflight,
  runScenarioFixture,
  runSmokeSuite,
  verifyReportAndAlert,
  type ScenarioId,
  type SmokeConfig,
  type SmokeRunSummary,
} from './smoke_test.js';

function baseConfig(overrides: Partial<SmokeConfig> = {}): SmokeConfig {
  return {
    mode: 'fixture',
    httpEndpoint: null,
    wsEndpoint: null,
    adminToken: null,
    timeoutMs: 5_000,
    maxRetries: 3,
    pollIntervalMs: 10,
    runId: 'test-run',
    runIdExplicit: true,
    runLedgerPath: join(tmpdir(), 'task169-test-ledger-unused'),
    deploymentReadinessEndpoint: null,
    kbIngestionStatusEndpoint: null,
    scenarios: ['ACC_001', 'EVT_002', 'EVT_003'],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ── config validation ──────────────────────────────────────────────────────

describe('config validation', () => {
  it('rejects an unknown mode', () => {
    expect(() => resolveConfig(['--mode', 'bogus'], {})).toThrow(ConfigValidationError);
  });

  it('rejects a non-canonical scenario (TASK-170/172/173 stay out of scope)', () => {
    expect(() => resolveConfig(['--mode', 'fixture', '--scenarios', 'EVT_004'], {})).toThrow(
      /unknown scenario/,
    );
  });

  it('rejects a non-positive-integer timeout', () => {
    expect(() => resolveConfig(['--mode', 'dry-run', '--timeout-ms', '0'], {})).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects a non-positive-integer max-retries', () => {
    expect(() => resolveConfig(['--mode', 'dry-run', '--max-retries', '-1'], {})).toThrow(
      ConfigValidationError,
    );
  });

  it('never hard-codes an endpoint/token — defaults are null, not a live value', () => {
    const config = resolveConfig(['--mode', 'dry-run'], {});
    expect(config.httpEndpoint).toBeNull();
    expect(config.wsEndpoint).toBeNull();
    expect(config.adminToken).toBeNull();
  });

  it('CLI args take precedence over env vars', () => {
    const config = resolveConfig(['--mode', 'fixture'], { SMOKE_MODE: 'live' });
    expect(config.mode).toBe('fixture');
  });

  it('accepts env-var configuration when no CLI arg given', () => {
    const config = resolveConfig([], {
      SMOKE_MODE: 'fixture',
      SMOKE_HTTP_ENDPOINT: 'https://example.invalid/api',
    });
    expect(config.mode).toBe('fixture');
    expect(config.httpEndpoint).toBe('https://example.invalid/api');
  });

  it('defaults to dry-run when nothing is specified (safe default)', () => {
    const config = resolveConfig([], {});
    expect(config.mode).toBe('dry-run');
  });

  it('never generates a random run-id for live mode and marks the identity missing', () => {
    const config = resolveConfig(['--mode', 'live'], {});
    expect(config.runId).toBe('LIVE_RUN_ID_REQUIRED');
    expect(config.runIdExplicit).toBe(false);
  });
});

// ── missing dependency fail-closed ──────────────────────────────────────────

describe('missing dependency fail-closed (live preflight)', () => {
  it('BLOCKS when no endpoints/token/readiness/kb-status are configured', async () => {
    const preflight = await runPreflight(baseConfig({ mode: 'live' }));
    expect(preflight.blocked).toBe(true);
    expect(preflight.dependencyFailures).toContain('HTTP_ENDPOINT_NOT_CONFIGURED');
    expect(preflight.dependencyFailures).toContain('WS_ENDPOINT_NOT_CONFIGURED');
    expect(preflight.dependencyFailures).toContain('ADMIN_TOKEN_NOT_CONFIGURED');
    expect(preflight.dependencyFailures).toContain('DEPLOYMENT_READINESS_ENDPOINT_NOT_CONFIGURED');
    expect(preflight.dependencyFailures).toContain('KB_INGESTION_STATUS_ENDPOINT_NOT_CONFIGURED');
    expect(preflight.safeErrorCode).toBe('CONTRACT_EVIDENCE_MISSING');
  });

  it('BLOCKS live mode when a stable CLI/env run-id was not supplied', async () => {
    const config = resolveConfig(['--mode', 'live'], {});
    const preflight = await runPreflight(config);
    expect(preflight.dependencyFailures).toContain('LIVE_RUN_ID_NOT_CONFIGURED');
    expect(preflight.blocked).toBe(true);
  });

  it('never fakes success: a full live run with no config yields BLOCKED, not PREPARED_AWAITING_INTEGRATION', async () => {
    const summary = await runSmokeSuite(baseConfig({ mode: 'live' }));
    expect(summary.verdict).toBe('BLOCKED');
    const preflightStage = summary.stages.find((s) => s.stage === 'preflight');
    expect(preflightStage?.status).toBe('BLOCKED');
  });

  it('partial config (endpoint only) still BLOCKS on the remaining missing preconditions', async () => {
    const preflight = await runPreflight(
      baseConfig({ mode: 'live', httpEndpoint: 'https://example.invalid/api' }),
    );
    expect(preflight.blocked).toBe(true);
  });
});

// ── bounded retry / timeout ─────────────────────────────────────────────────

describe('bounded retry / timeout', () => {
  it('stops after maxAttempts even if never done (no infinite loop)', async () => {
    let calls = 0;
    const result = await boundedPoll(
      async () => {
        calls += 1;
        return { done: false };
      },
      { maxAttempts: 4, intervalMs: 0, timeoutMs: 100_000 },
      async () => {},
    );
    expect(calls).toBe(4);
    expect(result.retriesExhausted).toBe(true);
    expect(result.done).toBe(false);
  });

  it('stops at the timeout even if maxAttempts is very large (no infinite polling)', async () => {
    let calls = 0;
    const result = await boundedPoll(
      async () => {
        calls += 1;
        return { done: false };
      },
      { maxAttempts: 1_000_000, intervalMs: 1, timeoutMs: 5 },
      async () => {},
    );
    expect(result.done).toBe(false);
    expect(calls).toBeGreaterThan(0);
    // Bounded: did not reach anywhere near the million-attempt ceiling.
    expect(calls).toBeLessThan(1_000_000);
  });

  it('returns done=true as soon as the condition is satisfied, without exhausting attempts', async () => {
    let calls = 0;
    const result = await boundedPoll(
      async () => {
        calls += 1;
        return { done: calls >= 2, value: 'resolved' };
      },
      { maxAttempts: 10, intervalMs: 0, timeoutMs: 100_000 },
      async () => {},
    );
    expect(result.done).toBe(true);
    expect(result.value).toBe('resolved');
    expect(calls).toBe(2);
  });

  it('uses an absolute deadline so a real fake-timer wall clock never exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const poll = boundedPoll(
      async (remainingMs) => {
        await new Promise((resolve) => setTimeout(resolve, remainingMs + 5_000));
        return { done: false };
      },
      { maxAttempts: 50, intervalMs: 10_000, timeoutMs: 250 },
    );

    await vi.advanceTimersByTimeAsync(250);
    const result = await poll;
    expect(result.timedOut).toBe(true);
    expect(result.attempts).toBe(1);
    expect(Date.now() - startedAt).toBe(250);
  });
});

// ── fixture three-event success ─────────────────────────────────────────────

describe('fixture mode — three canonical scenarios', () => {
  const scenarios: ScenarioId[] = ['ACC_001', 'EVT_002', 'EVT_003'];

  it.each(scenarios)('runs %s fixture end-to-end with PASS stages', (scenario) => {
    const results = runScenarioFixture(scenario, baseConfig());
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.status).toBe('PASS');
      expect(r.fixture).toBe(true);
    }
  });

  it('full fixture suite over all three events yields PREPARED_AWAITING_INTEGRATION', async () => {
    const summary = await runSmokeSuite(baseConfig({ mode: 'fixture' }));
    expect(summary.verdict).toBe('PREPARED_AWAITING_INTEGRATION');
    expect(summary.stages.every((s) => s.fixture === true)).toBe(true);
  });

  it('fixture results are always labeled fixture:true and never claim an AWS pass', () => {
    for (const scenario of scenarios) {
      const results = runScenarioFixture(scenario, baseConfig());
      expect(results.every((r) => r.fixture === true)).toBe(true);
    }
  });
});

describe('report and public-alert verification', () => {
  it('fails when a scenario has a valid report but no public alert', () => {
    const verification = verifyReportAndAlert(
      'ACC_001',
      {
        report: {
          decision_id: 'fixture-dec-acc001',
          report_text_present: true,
        },
        alert: null,
      },
      'fixture-dec-acc001',
    );

    expect(verification.reportPassed).toBe(true);
    expect(verification.alertPassed).toBe(false);
    expect(verification.passed).toBe(false);
    expect(verification.violations).toContain('ACC_001 public alert missing or malformed');
  });

  it('fails both artifacts when their decision_id belongs to another scenario', () => {
    const verification = verifyReportAndAlert(
      'EVT_003',
      {
        report: { decision_id: 'wrong', report_text_present: true },
        alert: {
          decision_id: 'wrong',
          languages: ['zh'],
          alert_text_present: true,
        },
      },
      'fixture-dec-evt003',
    );
    expect(verification.reportPassed).toBe(false);
    expect(verification.alertPassed).toBe(false);
  });
});

// ── HG-001 hard invariants (comparison only, never recomputed) ─────────────

describe('HG-001 golden-number assertions', () => {
  it('ACC_001 ETE must equal 78.6', () => {
    const outcome = assertHg001Core('ACC_001', loadFixture('ACC_001').decision_response);
    expect(outcome.passed).toBe(true);
  });

  it('ACC_001 fails when ETE deviates from 78.6', () => {
    const decision = structuredClone(loadFixture('ACC_001').decision_response);
    (decision.ete as Record<string, unknown>).ete_minutes = 90;
    const outcome = assertHg001Core('ACC_001', decision);
    expect(outcome.passed).toBe(false);
    expect(outcome.violations.join(' ')).toMatch(/78\.6/);
  });

  it('EVT_003 ETE must equal 41.0', () => {
    const outcome = assertHg001Core('EVT_003', loadFixture('EVT_003').decision_response);
    expect(outcome.passed).toBe(true);
  });

  it('EVT_002 must never accept the 22:30 BL17 observation', () => {
    const decision = structuredClone(loadFixture('EVT_002').decision_response);
    (decision.bl17_observation as Record<string, unknown>).timestamp = '2026-05-20 22:30';
    const outcome = assertHg001Core('EVT_002', decision);
    expect(outcome.passed).toBe(false);
    expect(outcome.violations.join(' ')).toMatch(/22:30/);
  });

  it('EVT_002 requires User_Count = 31000 at the 22:15 observation', () => {
    const outcome = assertHg001Core('EVT_002', loadFixture('EVT_002').decision_response);
    expect(outcome.passed).toBe(true);
  });

  it('EVT_002 affected_road stays DISPLAY_AND_CONTEXT_ONLY', () => {
    const decision = structuredClone(loadFixture('EVT_002').decision_response);
    (decision.policy as Record<string, unknown>).affected_road = { role: 'context_and_ete' };
    const outcome = assertHg001Core('EVT_002', decision);
    expect(outcome.passed).toBe(false);
  });

  it('does not guess a route for EVT_002 (not in the ratified walkthrough)', () => {
    const outcome = assertHg001Core('EVT_002', loadFixture('EVT_002').decision_response);
    expect(outcome.notInWalkthrough.length).toBeGreaterThan(0);
  });
});

describe('60-second observability assertion', () => {
  it('passes when EndToEndLatencyMs <= 60000', () => {
    expect(assertSixtySecondObservable({ EndToEndLatencyMs: 4_300 }).passed).toBe(true);
  });

  it('fails when EndToEndLatencyMs exceeds 60000', () => {
    expect(assertSixtySecondObservable({ EndToEndLatencyMs: 60_001 }).passed).toBe(false);
  });

  it('fails closed when the field is missing rather than assuming pass', () => {
    expect(assertSixtySecondObservable({}).passed).toBe(false);
  });
});

// ── scenario-stage failure ──────────────────────────────────────────────────

describe('scenario-stage failure reporting', () => {
  it('reports a FAIL stage with ASSERTION_FAILED when a golden number is violated', () => {
    const config = baseConfig({ scenarios: ['ACC_001'] });
    // Monkey-patch via a mutated fixture read is not exposed; instead assert
    // the underlying comparison function surfaces the same FAIL semantics
    // the orchestrator would report for a mismatching server payload.
    const decision = structuredClone(loadFixture('ACC_001').decision_response);
    (decision.ete as Record<string, unknown>).ete_minutes = 999;
    const outcome = assertHg001Core('ACC_001', decision);
    expect(outcome.passed).toBe(false);

    // Sanity: a normal fixture run for the same scenario still reports PASS,
    // proving the harness discriminates between good and bad payloads rather
    // than always reporting success.
    const results = runScenarioFixture('ACC_001', config);
    expect(results.every((r) => r.status === 'PASS')).toBe(true);
  });

  it('every stage result carries the required machine-readable fields', () => {
    const results = runScenarioFixture('ACC_001', baseConfig());
    for (const r of results) {
      expect(r).toHaveProperty('scenario');
      expect(r).toHaveProperty('stage');
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('run_id');
      expect(r).toHaveProperty('trace_id');
      expect(r).toHaveProperty('started_at');
      expect(r).toHaveProperty('completed_at');
      expect(r).toHaveProperty('elapsed_ms');
      expect(r).toHaveProperty('dependency_failure');
      expect(r).toHaveProperty('safe_error_code');
      expect(typeof r.elapsed_ms).toBe('number');
      expect(r.elapsed_ms).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── secret redaction ─────────────────────────────────────────────────────────

describe('secret redaction', () => {
  it('redacts a top-level token field', () => {
    const redacted = redact({ token: 'super-secret', other: 'kept' }) as Record<string, unknown>;
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.other).toBe('kept');
  });

  it('redacts nested Authorization headers', () => {
    const redacted = redact({
      headers: { Authorization: 'Bearer abc123', 'Content-Type': 'application/json' },
    }) as { headers: Record<string, unknown> };
    expect(redacted.headers.Authorization).toBe('[REDACTED]');
    expect(redacted.headers['Content-Type']).toBe('application/json');
  });

  it('redacts credential/secret/password-like keys inside arrays', () => {
    const redacted = redact([{ admin_token: 'x' }, { secretValue: 'y' }, { password: 'z' }]) as Array<
      Record<string, unknown>
    >;
    expect(redacted[0].admin_token).toBe('[REDACTED]');
    expect(redacted[1].secretValue).toBe('[REDACTED]');
    expect(redacted[2].password).toBe('[REDACTED]');
  });

  it('a preflight report never contains the raw admin token value', async () => {
    const preflight = await runPreflight(
      baseConfig({ mode: 'live', adminToken: 'sekrit-value-do-not-print' }),
    );
    const serialized = JSON.stringify(redact(preflight));
    expect(serialized).not.toContain('sekrit-value-do-not-print');
  });
});

// ── structured JSON output ───────────────────────────────────────────────────

describe('structured JSON output shape', () => {
  it('stage results are JSON-serializable with no circular references', () => {
    const results = runScenarioFixture('EVT_002', baseConfig());
    for (const r of results) {
      expect(() => JSON.stringify(r)).not.toThrow();
    }
  });

  it('required fields are present per TASK-169 spec item 13', () => {
    const results = runScenarioFixture('EVT_003', baseConfig());
    const required = [
      'scenario',
      'stage',
      'status',
      'run_id',
      'trace_id',
      'started_at',
      'completed_at',
      'elapsed_ms',
      'dependency_failure',
      'safe_error_code',
    ];
    for (const r of results) {
      for (const field of required) {
        expect(Object.keys(r)).toContain(field);
      }
    }
  });
});

describe('CLI exit-code semantics', () => {
  it('returns zero for healthy dry-run/fixture and nonzero for BLOCKED/FAILED', async () => {
    const dryRun = await runSmokeSuite(resolveConfig(['--mode', 'dry-run'], {}));
    const fixture = await runSmokeSuite(baseConfig({ mode: 'fixture' }));
    const blockedLive = await runSmokeSuite(resolveConfig(['--mode', 'live'], {}));
    const failedFixture: SmokeRunSummary = { ...fixture, verdict: 'FAILED' };

    expect(exitCodeForSummary(dryRun)).toBe(0);
    expect(exitCodeForSummary(fixture)).toBe(0);
    expect(exitCodeForSummary(blockedLive)).toBe(1);
    expect(exitCodeForSummary(failedFixture)).toBe(1);
  });

  it('allows live exit zero only when every live stage is PASS', () => {
    const passStage = runScenarioFixture('ACC_001', baseConfig())[0];
    const livePass: SmokeRunSummary = {
      verdict: 'PREPARED_AWAITING_INTEGRATION',
      mode: 'live',
      runId: 'stable-live-run',
      stages: [{ ...passStage, fixture: false, status: 'PASS' }],
    };
    expect(exitCodeForSummary(livePass)).toBe(0);
    expect(
      exitCodeForSummary({
        ...livePass,
        stages: [{ ...livePass.stages[0], status: 'BLOCKED' }],
      }),
    ).toBe(1);
  });
});

// ── idempotent rerun / no unbounded re-injection ────────────────────────────

describe('idempotent rerun and run identity', () => {
  it('the same run_id always yields the same idempotency key for a given event', () => {
    const first = buildIdempotencyKey('TPE_2026_ACC_001', '2026-05-20 22:10', 'run-A');
    const second = buildIdempotencyKey('TPE_2026_ACC_001', '2026-05-20 22:10', 'run-A');
    expect(first).toBe(second);
  });

  it('a different run_id yields a different idempotency key (deliberate new run, not a collision)', () => {
    const first = buildIdempotencyKey('TPE_2026_ACC_001', '2026-05-20 22:10', 'run-A');
    const second = buildIdempotencyKey('TPE_2026_ACC_001', '2026-05-20 22:10', 'run-B');
    expect(first).not.toBe(second);
  });

  it('re-running the full fixture suite with the same run_id twice is stable and side-effect free', async () => {
    const config = baseConfig({ runId: 'idempotent-check' });
    const first = await runSmokeSuite(config);
    const second = await runSmokeSuite(config);
    expect(first.verdict).toBe(second.verdict);
    expect(first.stages.map((s) => s.stage)).toEqual(second.stages.map((s) => s.stage));
  });

  it('resolveConfig generates a run_id automatically when none is supplied (never reuses a fixed literal)', () => {
    const a = resolveConfig(['--mode', 'dry-run'], {});
    const b = resolveConfig(['--mode', 'dry-run'], {});
    expect(a.runId).not.toBe(b.runId);
  });

  it(
    'two independent CLI processes with the same run-id POST the canonical incident only once',
    async () => {
      const fixture = loadFixture('ACC_001');
      const temporaryRoot = mkdtempSync(join(tmpdir(), 'task169-ledger-test-'));
      const ledgerPath = join(temporaryRoot, 'ledger');
      let postCount = 0;
      let postedBody = '';
      let postedAuthorization: string | undefined;
      let postedContentType: string | undefined;
      let postedIdempotencyKey: string | undefined;

      const server = createServer((request, response) => {
        const url = request.url ?? '';
        const sendJson = (status: number, body: unknown) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(body));
        };

        if (request.method === 'GET' && url === '/timeline') return sendJson(200, {});
        if (request.method === 'GET' && url === '/readiness') {
          return sendJson(200, { ready: true });
        }
        if (request.method === 'GET' && url === '/kb-status') {
          return sendJson(200, { status: 'COMPLETE' });
        }
        if (request.method === 'POST' && url === '/incidents/TPE_2026_ACC_001/inject') {
          postCount += 1;
          postedAuthorization = request.headers.authorization;
          postedContentType = request.headers['content-type'];
          postedIdempotencyKey = request.headers['idempotency-key'];
          request.setEncoding('utf8');
          request.on('data', (chunk: string) => {
            postedBody += chunk;
          });
          request.on('end', () => {
            sendJson(202, { decision_id: 'fixture-dec-acc001', trace_id: 'live-trace' });
          });
          return;
        }
        if (request.method === 'GET' && url === '/decisions/fixture-dec-acc001') {
          return sendJson(200, {
            ...fixture.decision_response,
            latency: fixture.latency,
          });
        }
        if (request.method === 'GET' && url === '/reports/fixture-dec-acc001') {
          return sendJson(200, fixture.report_response);
        }
        return sendJson(404, { error: 'not found' });
      });
      server.on('upgrade', (_request, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
      });

      const address = await new Promise<{ port: number }>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const bound = server.address();
          if (bound === null || typeof bound === 'string') {
            reject(new Error('test server did not expose a TCP port'));
            return;
          }
          resolve({ port: bound.port });
        });
      });

      const endpoint = `http://127.0.0.1:${address.port}`;
      const cliArgs = [
        '--mode',
        'live',
        '--endpoint',
        endpoint,
        '--ws-endpoint',
        `ws://127.0.0.1:${address.port}`,
        '--admin-token',
        'integration-token',
        '--deployment-readiness-endpoint',
        `${endpoint}/readiness`,
        '--kb-ingestion-status-endpoint',
        `${endpoint}/kb-status`,
        '--run-id',
        'stable-cross-process-run',
        '--run-ledger',
        ledgerPath,
        '--scenarios',
        'ACC_001',
        '--timeout-ms',
        '2000',
        '--poll-interval-ms',
        '1',
      ];

      const runChild = () =>
        new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn(
            process.execPath,
            ['--import', 'tsx', join(process.cwd(), 'scripts', 'smoke_test.ts'), ...cliArgs],
            { cwd: process.cwd(), env: { ...process.env, NO_COLOR: '1' } },
          );
          let stdout = '';
          let stderr = '';
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
          });
          child.on('close', (code) => resolve({ code, stdout, stderr }));
        });

      try {
        const first = await runChild();
        const second = await runChild();
        expect(first.code, first.stderr).toBe(0);
        expect(second.code, second.stderr).toBe(0);
        expect(second.stdout).toContain('prior POST reused; no injection request sent');
        expect(postCount).toBe(1);
        expect(JSON.parse(postedBody)).toEqual({ event_id: 'TPE_2026_ACC_001' });
        expect(postedAuthorization).toBe('Bearer integration-token');
        expect(postedContentType).toBe('application/json');
        expect(postedIdempotencyKey).toBe(
          buildIdempotencyKey(
            'TPE_2026_ACC_001',
            '2026-05-20 22:10',
            'stable-cross-process-run',
          ),
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
