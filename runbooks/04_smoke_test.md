# 3-Event Smoke Test (TASK-169)

## Purpose and hard gate

This is competition deployment step 3 (design.md §25). It injects the three
official canonical scenarios — `ACC_001`, `EVT_002`, `EVT_003` — and asserts
that decisions, reports, and public alerts are produced and that the **core
numbers the server reports** match the ratified HG-001 golden walkthrough
(design.md §9.5 / §12; tasks.md HG-001 amendment record). It also asserts the
60-second end-to-end observability requirement (design.md §20).

`scripts/smoke_test.ts` never recomputes A/B classification, SOP triggers,
routes, ETE, or anomaly truth. It only compares reported values against the
ratified golden numbers. Any value not present in the ratified walkthrough is
reported as `CONTRACT_EVIDENCE_MISSING`, never guessed.

## Current status: PREPARED_AWAITING_INTEGRATION

As of this authoring, the script/runbook are prepared but **cannot run
against real AWS**, because:

- TASK-167 (`COMPETITION_AWS` deploy runbook) is not yet available — there is
  no deployed HTTP/WebSocket endpoint.
- `COMPETITION_AWS` endpoints do not exist yet.
- KB ingestion (TASK-178) completion has no evidence (`status=COMPLETE` is
  unproven).

The dependency tasks `TASK-098`, `TASK-106`, `TASK-120`, `TASK-167` (declared
`dependencies` of TASK-169) and `TASK-178` (referenced by TASK-169's
`competition_quality_floor`) are unchecked in `tasks.md` at the time this
runbook was authored. Do **not** attempt a `live` run until an operator has
independently confirmed all of the preflight items below.

## Modes

| Mode | Network calls | Use |
| --- | --- | --- |
| `dry-run` | none | Prints the execution plan only; no assertions run. |
| `fixture` | none | Runs the full assertion suite against local fixtures (`scripts/fixtures/smoke/*.json`). Labels every result `fixture:true`. Never claims an AWS smoke pass. |
| `live` | yes | Runs against a real deployed target. Requires a **passing preflight** (below) or the run is `BLOCKED`. |

## Configuration (no hard-coded endpoint/token/account/region)

All target information is supplied by the operator, via CLI flag or
environment variable (CLI takes precedence):

| CLI flag | Env var | Purpose |
| --- | --- | --- |
| `--mode` | `SMOKE_MODE` | `dry-run` \| `fixture` \| `live` (default `dry-run`) |
| `--endpoint` | `SMOKE_HTTP_ENDPOINT` | Base HTTP API URL |
| `--ws-endpoint` | `SMOKE_WS_ENDPOINT` | WebSocket API URL |
| `--admin-token` | `SMOKE_ADMIN_TOKEN` | Admin bearer token for `POST /incidents/{id}/inject` (never logged) |
| `--deployment-readiness-endpoint` | `SMOKE_DEPLOYMENT_READINESS_ENDPOINT` | Operator-provided readiness probe (TASK-167) |
| `--kb-ingestion-status-endpoint` | `SMOKE_KB_INGESTION_STATUS_ENDPOINT` | Operator-provided KB ingestion status probe (TASK-178); must report `status:"COMPLETE"` |
| `--timeout-ms` | `SMOKE_TIMEOUT_MS` | Per-request/poll timeout budget (default `30000`) |
| `--max-retries` | `SMOKE_MAX_RETRIES` | Hard cap on polling attempts per scenario (default `5`) |
| `--poll-interval-ms` | `SMOKE_POLL_INTERVAL_MS` | Delay between polls (default `2000`, matches the §13 WS-fallback default) |
| `--run-id` | `SMOKE_RUN_ID` | Stable run identity. **Required in live mode**; missing live identity blocks before injection. Offline modes may auto-generate a non-live UUID. |
| `--run-ledger` | `SMOKE_RUN_LEDGER` | Cross-process injection ledger directory (default `.task169-smoke-run-ledger` under the invocation directory). Preserve it for the whole named live run; do not commit it. |
| `--scenarios` | `SMOKE_SCENARIOS` | Comma list, subset of `ACC_001,EVT_002,EVT_003` (default: all three) |

## Commands

Dry run (plan only, no I/O):

```sh
npx tsx scripts/smoke_test.ts --mode dry-run
```

Fixture run (deterministic, offline, always fixture-labeled):

```sh
npx tsx scripts/smoke_test.ts --mode fixture
```

Live run (only after preflight passes — see below):

```sh
npx tsx scripts/smoke_test.ts --mode live \
  --endpoint "$SMOKE_HTTP_ENDPOINT" \
  --ws-endpoint "$SMOKE_WS_ENDPOINT" \
  --admin-token "$SMOKE_ADMIN_TOKEN" \
  --deployment-readiness-endpoint "$SMOKE_DEPLOYMENT_READINESS_ENDPOINT" \
  --kb-ingestion-status-endpoint "$SMOKE_KB_INGESTION_STATUS_ENDPOINT" \
  --run-id "$SMOKE_RUN_ID" \
  --run-ledger "$SMOKE_RUN_LEDGER"
```

Every invocation prints one JSON line per stage plus a final `{verdict, mode,
run_id}` line to stdout. Redirect to a file for evidence:

```sh
npx tsx scripts/smoke_test.ts --mode fixture 2>&1 | tee smoke-fixture.log
```

The log is local evidence and is not committed.

## Live-mode preflight (fail closed)

Before injecting any event in `live` mode, the script independently checks:

1. **HTTP endpoint** reachable (`GET /timeline`).
2. **WebSocket endpoint** reachable (HTTP Upgrade handshake attempt).
3. **Admin token** present (value is never inspected, printed, or logged —
   only its presence is checked).
4. **Deployment readiness** — the operator-supplied readiness endpoint
   reports `ready:true`.
5. **KB ingestion status** — the operator-supplied KB status endpoint
   reports `status:"COMPLETE"` (TASK-178; must be verified before any RAG
   smoke test per tasks.md TASK-178 step 5 / TASK-169 dependency).
6. **Stable run identity** — live mode requires an explicit `--run-id` or
   `SMOKE_RUN_ID`. It never substitutes a random UUID.

If **any** of the five checks fails, the run reports `verdict:"BLOCKED"` and
stops before injecting a single event. `dependency_failure` and
`safe_error_code` on the `preflight` stage name exactly which precondition(s)
are missing. A `_NOT_CONFIGURED` failure is reported as
`CONTRACT_EVIDENCE_MISSING` (the operator never supplied evidence); a
`_UNREACHABLE` / `_NOT_READY` / `_NOT_COMPLETE` failure is reported as
`MISSING_DEPENDENCY`.

**The script never fabricates a passing preflight.** There is no bypass flag.

## Per-scenario stages

Each of `ACC_001`, `EVT_002`, `EVT_003` runs through the same bounded stage
sequence:

1. `inject` — single injection call (fixture mode: recorded only; live mode:
   one `POST /incidents/{event_id}/inject` with the exact shared-schema body
   `{"event_id":"<canonical event_id>"}`, `Authorization: Bearer ...`,
   `Content-Type: application/json`, and formal `Idempotency-Key` header).
   Never retried automatically; a failed inject is
   a scenario failure, not a retry trigger (retrying an ambiguous inject
   could double-fire a workflow).
2. `poll_decision` — bounded polling of `GET /decisions/{id}` for
   `execution.status:"completed"`, capped by both `--max-retries` and
   `--timeout-ms` (whichever is reached first; see `boundedPoll` in the
   script). Never polls unboundedly.
3. `verify_decision_core` — compares the returned core sets/routes/ETE
   against the ratified HG-001 golden numbers (comparison only; the script
   never recomputes them). See "HG-001 hard invariants" below.
4. `verify_report_and_alert` — independently validates both the report and
   public alert returned by `GET /reports/{id}`. Both must be non-malformed,
   contain content, and carry the scenario's `decision_id`; either missing or
   mismatched artifact fails the stage.
5. `verify_60s_observable` — asserts the reported end-to-end latency is
   `<= 60000`ms (design.md §20/§25 step 4). If the deployed contract does not
   expose a latency projection, this is `CONTRACT_EVIDENCE_MISSING`, not a
   silent pass.

## HG-001 hard invariants (never violated by this script)

- `ACC_001` ETE = **78.6** minutes.
- `EVT_002` uses the BL17 **22:15** observation; `User_Count = 31000`.
- `EVT_002` **never** uses the BL17 22:30 observation.
- `EVT_002` does not apply ETE (`calculation_status:"NOT_APPLICABLE"`).
- `EVT_002` `affected_road` role stays `DISPLAY_AND_CONTEXT_ONLY`.
- `EVT_003` ETE = **41.0** minutes.

Any core set, route, or number outside these ratified values and the §9.5/§12
walkthrough (e.g. EVT_003's exact affected-intersection count, which is
documented as OQ-010-unresolved) is reported as `CONTRACT_EVIDENCE_MISSING`
rather than guessed.

## Rerun safety (no unbounded re-injection)

Every injection is keyed by
`{event_id}|{canonical_event_timestamp}|smoke-{run_id}`. The key is sent in
the formal `Idempotency-Key` header; the request body remains the exact §12
`InjectIncidentRequest` (`event_id` only).

Before POST, the harness atomically creates a SHA-256-named marker in the run
ledger using exclusive-create semantics. After a valid inject response, that
marker records `decision_id`/`trace_id`. A separate process using the same
scenario, canonical timestamp, run-id, and ledger reuses the recorded
decision and sends **no second POST**. A claimed/malformed marker without a
recorded decision is fail-closed `BLOCKED`; it is never resolved by guessing
whether the first POST reached AWS. Use a new explicit run-id only for a
deliberately new live injection run.

## Output contract

Each stage line is a single JSON object with, at minimum: `scenario`,
`stage`, `status`, `run_id`, `trace_id`, `started_at`, `completed_at`,
`elapsed_ms`, `dependency_failure`, `safe_error_code`, and `fixture`
(boolean). No token, `Authorization` header, credential, or full raw
response body is ever printed — `redact()` strips any key matching
`token|authorization|secret|credential|password` (case-insensitive) before
serialization.

## Exit criteria

- `dry-run` / healthy `fixture`: exit code `0` only with final verdict
  `PREPARED_AWAITING_INTEGRATION`. A fixture assertion failure exits nonzero.
- `live`: exit code `0` only when the final verdict is
  `PREPARED_AWAITING_INTEGRATION` **and every live stage is `PASS`**. A
  `BLOCKED` verdict (preflight/ledger failure) or `FAILED` verdict (a stage
  `FAIL`) exits nonzero and means STOP — do not proceed to step 4
  (latency validation, TASK-170) or treat the release as smoke-clean.

If any live-mode condition fails, STOP. Do not compensate by lowering the
preflight bar, hard-coding a fallback endpoint, or marking a fixture result
as an AWS pass.
