# Implementation Plan: Grey-Zone Arbitration Engine

Requirements Baseline: `requirements.md` (R1–R5)
Design: `design.md`
Task Plan Status: `DRAFT_PENDING_REVIEW`
Implementation Authorization: `NOT_AUTHORIZED_PENDING_REVIEW`

## Overview

This plan converts `design.md` (§3–§9) into an ordered, agent-executable task list. It is a PLAN ONLY: no production code is created here.

Hard invariants enforced by every applicable task:
- `classification_engine.ts` (0.85/0.95 thresholds) and `article1.ts`–`article6.ts` trigger conditions are never modified by any task in this plan (design.md §0).
- `excludeSelfBlockedCandidates` (R1) is the **only** function in this plan allowed to change an existing `DecisionCore` output value (`RouteCandidate.role`/`exclusion_reason`, and transitively `primary_evacuation`/`secondary_evacuation`/`excluded_candidates`). It must run strictly after the existing 3-AND qualification (`determineRole`, `article2.ts:225-290`) and must never upgrade an already-`excluded` candidate.
- R2/R3/R4 are additive-only: they may only add new `DecisionCore` fields, never mutate `classifications`, `triggered_articles`, `art1_measures`, or any existing field's value.
- Any new field added to `DecisionCore` must ship in the same task batch as its `PROHIBITED_KEYS` / `eslint-local-rules.cjs` mirror update — never split across tasks, to avoid an intermediate commit where the field exists but is unprotected by the LLM boundary.
- No task may change the wording or existence of `primary_evacuation`/`secondary_evacuation`/`classifications` for the 3 official `live_incidents.json` events beyond what R1 explicitly authorizes (no-regression, R5 AC4 is release-blocking for this).

Task ID scheme: `TASK-GZAE-01..TASK-GZAE-10`, flat and sequential.

---

## Phase 0 — Shared Types

- [ ] TASK-GZAE-01 Add `SignalConflict`, `CascadingRisk` types
  - objective: Establish the shared type vocabulary before any package implements against it.
  - requirements_covered: R3, R4, R5 AC1
  - design_sections: §5, §6, §7.1
  - files_or_modules_expected: `packages/shared-schemas/src/grey_zone.ts` (new), `packages/shared-schemas/src/index.ts` (barrel export)
  - dependencies: []
  - implementation_steps:
    1. Define `SignalConflict` (`segment_id`, `conflict_type: 'crowd_heavy_traffic_light' | 'traffic_heavy_crowd_light'`, `advisory_text`) and `CascadingRisk` (`event_ids: readonly string[]`, `advisory_text`) per design.md §5, §6.
    2. Export from `index.ts`; do not modify existing exports.
  - acceptance_criteria: Types compile in strict mode; no `as any`/`@ts-ignore`/`@ts-expect-error`.
  - tests_required: none (type-only file; covered transitively by consumers' tests).
  - done_definition: Package builds; nothing outside this task's file list is touched.

- [ ] TASK-GZAE-02 Extend `DecisionCore` with `pre_warning_segments`, `signal_conflicts`, `cascading_risk`, `self_blocked_exclusions`
  - objective: Give the four new judgments a home in the canonical, immutable decision payload.
  - requirements_covered: R5 AC1
  - design_sections: §7.1
  - files_or_modules_expected: `packages/shared-schemas/src/decision_core.ts`
  - dependencies: [TASK-GZAE-01]
  - implementation_steps:
    1. Add the 4 readonly fields to the `DecisionCore` interface as optional fields (`pre_warning_segments?`, etc.), following the existing precedent set by UARE's fields (`sop_matched?`, `grounding_candidates?`) to keep every intermediate commit building — see UARE TASK-UARE-02's documented rationale, which applies identically here.
  - acceptance_criteria: `DecisionCore` compiles; no existing field renamed or reordered.
  - tests_required: none; confirm all dependent packages (`packages/domain`, `packages/ai-generator`, `packages/rag`, `packages/backend`) typecheck clean with zero changes required in them.
  - done_definition: `packages/shared-schemas` builds; all dependent packages typecheck clean.

- [ ] TASK-GZAE-03 Add the 4 new field names to `PROHIBITED_KEYS` (both copies)
  - objective: Close the enforcement gap the moment the fields exist — never ship a commit where the fields are writable-by-LLM.
  - requirements_covered: R5 AC2
  - design_sections: §7.2
  - files_or_modules_expected: `packages/shared-schemas/src/llm_boundary.ts`, `eslint-local-rules.cjs` (repo root)
  - dependencies: [TASK-GZAE-02]
  - implementation_steps:
    1. Append `'pre_warning_segments'`, `'signal_conflicts'`, `'cascading_risk'`, `'self_blocked_exclusions'` to `PROHIBITED_KEYS` in `llm_boundary.ts`.
    2. Append the identical 4 strings to the manual copy in `eslint-local-rules.cjs`.
    3. Confirm `eslint-local-rules/test/prohibited-fields-sync.test.ts` (data-driven, no code change expected) now covers the 4 new keys.
  - acceptance_criteria: R5 AC2; sync test fails if either copy is missing an entry.
  - tests_required: run existing `prohibited-fields-sync.test.ts`, confirm it passes with the new keys present in both lists and would fail if one copy omitted a key (manually verify by temporarily removing one, observing red, then restoring).
  - done_definition: Both lists identical (order-insensitive set equality); sync test green.

---

## Phase 1 — R1: Self-Blocked Candidate Exclusion

- [ ] TASK-GZAE-04 Implement `excludeSelfBlockedCandidates`
  - objective: Ensure a route candidate that is itself blocked by another active incident is never recommended.
  - requirements_covered: R1 AC1–AC6
  - design_sections: §3
  - files_or_modules_expected: `packages/domain/src/rule_engine/grey_zone_arbitration.ts` (new)
  - dependencies: [TASK-GZAE-01]
  - implementation_steps:
    1. Export `TRIGGER_STATUSES` from `article2.ts` if not already exported (verify first — do not redeclare the set).
    2. Implement `excludeSelfBlockedCandidates(candidates, currentIncidentEventId, otherActiveIncidents)` exactly per design.md §3: build a `segment_id -> Incident` map from `otherActiveIncidents` filtered to blocking statuses and excluding `currentIncidentEventId`; map over `candidates`, leaving already-`excluded` roles untouched, and rewriting `role`/`exclusion_reason` only for candidates whose `segment_id` matches a blocked entry.
  - acceptance_criteria: R1 AC1–AC6 verbatim; function is pure (no mutation of input arrays).
  - tests_required: unit tests in `packages/domain/test/unit/grey_zone_arbitration.test.ts` covering: candidate blocked by another incident → excluded with correct reason string; candidate already excluded by 3-AND → reason untouched; self-comparison excluded (AC6); no other active incidents → no-op; candidate blocked by an incident with a non-blocking status (e.g. `Caution`) → not excluded.
  - done_definition: All listed tests green; function signature matches design.md §3.

- [ ] TASK-GZAE-04a Wire "other active incidents" into the decision pipeline's input surface
  - objective: `runDeterministicDecision` currently processes exactly one `incident` per call (`decision_pipeline.ts:481-493`); R1 and R4 both need visibility into the rest of `live_incidents.json` that is concurrently active. This task is the one pipeline-input-interface expansion the whole plan depends on — land it before any pipeline wiring task.
  - requirements_covered: R1 (prerequisite), R4 (prerequisite)
  - design_sections: §6 (final paragraph), §8
  - files_or_modules_expected: `packages/domain/src/rule_engine/decision_pipeline.ts` (function signature), and the caller(s) that currently invoke `runDeterministicDecision` with a single incident
  - dependencies: []
  - implementation_steps:
    1. Add an optional parameter (e.g. `otherActiveIncidents: readonly Incident[]`, defaulting to `[]`) to `runDeterministicDecision`'s input so existing single-incident callers/tests continue to compile and behave identically when omitted.
    2. Update the caller(s) that currently drive the pipeline from `live_incidents.json` to pass the full incident list minus the one being decided.
  - acceptance_criteria: Default (`[]`) preserves 100% of existing pipeline behavior for all current tests; no existing test file needs modification to keep passing.
  - tests_required: run full existing `packages/domain` test suite, confirm zero regressions.
  - done_definition: Pipeline compiles and all pre-existing tests pass unmodified with the new optional parameter present but unused by them.

- [ ] TASK-GZAE-05 Wire `excludeSelfBlockedCandidates` into `runDeterministicDecision`
  - objective: Make R1 take effect on real decisions.
  - requirements_covered: R1 AC1–AC6, R5 AC1 (`self_blocked_exclusions`), R5 AC5
  - design_sections: §3, §8
  - files_or_modules_expected: `packages/domain/src/rule_engine/decision_pipeline.ts`
  - dependencies: [TASK-GZAE-04, TASK-GZAE-04a, TASK-GZAE-02, TASK-GZAE-03]
  - implementation_steps:
    1. In the RD_ branch, after the existing `qualifyCandidates(...)` call, call `excludeSelfBlockedCandidates(candidates, incident.event_id, otherActiveIncidents)` and use its return value for every downstream consumer that previously used `candidates` (evacuation selection, `excluded_candidates` output).
    2. Compute `self_blocked_exclusions` as the list of `segment_id`s whose role changed to `excluded` as a result of this call (diff against the pre-call roles), and write it to the `DecisionCore` output.
  - acceptance_criteria: R1 AC1–AC6; `self_blocked_exclusions` contains only segments newly excluded by this mechanism, not pre-existing 3-AND exclusions.
  - tests_required: integration test per requirements.md R5 AC5 (fixture: second incident blocks one of `TPE_2026_ACC_001`'s qualified candidates, e.g. `RD_TPE_004`; assert role flips to `excluded` and the reason string, other qualified candidates unaffected).
  - done_definition: Integration test green; the 3 official `live_incidents.json` events (none of which currently block each other's candidates) still produce byte-identical `primary_evacuation`/`secondary_evacuation` to pre-GZAE baseline (no-regression, R5 AC4).

---

## Phase 2 — R2: Threshold-Boundary Trend Pre-Warning

- [ ] TASK-GZAE-06 Implement `detectPreWarning` and pipeline wiring
  - objective: Surface a non-authoritative early-warning signal for segments approaching but not yet at the B-level threshold with a rising trend, without touching official classification.
  - requirements_covered: R2 AC1–AC8, R5 AC1 (`pre_warning_segments`), R5 AC6
  - design_sections: §4
  - files_or_modules_expected: `packages/domain/src/rule_engine/grey_zone_arbitration.ts`, `packages/domain/src/rule_engine/decision_pipeline.ts`
  - dependencies: [TASK-GZAE-02, TASK-GZAE-03]
  - implementation_steps:
    1. Implement `GREY_ZONE_LOWER_BOUND = 0.80` and `detectPreWarning(segmentId, currentSaturation, recentHistory)` exactly per design.md §4 (strict monotonic-increase check over ≥2 prior points, `false` on insufficient history).
    2. Implement `recentHistoryBefore(cutoff, group, n=3)` reusing the existing `groupTraffic` (`decision_pipeline.ts:517-532`) in-memory grouping — do not add a new data-read path.
    3. Wire into the pipeline: after `classifySegments`, for each segment with `level === null` and `saturation_score` in `[0.80, 0.85)`, call `detectPreWarning` and collect matching `segment_id`s into `pre_warning_segments`.
  - acceptance_criteria: R2 AC1–AC8 verbatim.
  - tests_required: unit tests per requirements.md R5 AC6: (a) grey-zone + monotonic increase → `true`; (b) grey-zone + non-monotonic → `false`; (c) at/above 0.85 (not grey-zone) → `false`; plus a purity/determinism test (same input twice → same output).
  - done_definition: All listed tests green; `classifySegments` output (`level` field) unchanged for every existing test fixture.

---

## Phase 3 — R3: Cross-Signal Contradiction Flagging

- [ ] TASK-GZAE-07 Implement `detectSignalConflicts` and pipeline wiring
  - objective: Flag when traffic (art.1) and crowd (art.3/4) signals for the same area disagree, as an advisory annotation only.
  - requirements_covered: R3 AC1–AC7, R5 AC1 (`signal_conflicts`), R5 AC7
  - design_sections: §5
  - files_or_modules_expected: `packages/domain/src/rule_engine/grey_zone_arbitration.ts`, `packages/domain/src/road_network/road_network_model.ts` (add `nearbyStationsOf`), `packages/domain/src/rule_engine/decision_pipeline.ts`
  - dependencies: [TASK-GZAE-02, TASK-GZAE-03]
  - implementation_steps:
    1. Add `nearbyStationsOf(segmentId): readonly string[]` to `RoadNetworkModel`, reading the existing `nearby_stations` field from `road_network_geometry.json` (no new data file).
    2. Implement `detectSignalConflicts(classifications, nearbyStationsOf, crowdTriggeredStationIds)` exactly per design.md §5, including the two fixed advisory-text templates from requirements.md R3 AC6.
    3. Wire into the pipeline: after art.1/art.3/art.4 have each been evaluated (existing 233-362 range), assemble `crowdTriggeredStationIds` from art.3/art.4's existing trigger outputs and call `detectSignalConflicts`.
  - acceptance_criteria: R3 AC1–AC7 verbatim; advisory text is a fixed template, never Bedrock-generated.
  - tests_required: integration tests per requirements.md R5 AC7, one fixture each for `crowd_heavy_traffic_light` and `traffic_heavy_crowd_light`.
  - done_definition: Both tests green; art.1/art.3/art.4 individual outputs unchanged.

---

## Phase 4 — R4: Cascading Micro-Incident Risk Detection

- [ ] TASK-GZAE-08 Implement `buildAdjacencyGraph`, `detectCascadingRisk` and pipeline wiring
  - objective: Flag when two or more individually-non-escalating incidents are topologically adjacent, as an advisory annotation only.
  - requirements_covered: R4 AC1–AC6, R5 AC1 (`cascading_risk`), R5 AC8
  - design_sections: §6
  - files_or_modules_expected: `packages/domain/src/rule_engine/grey_zone_arbitration.ts`, `packages/domain/src/rule_engine/decision_pipeline.ts`
  - dependencies: [TASK-GZAE-04a, TASK-GZAE-02, TASK-GZAE-03]
  - implementation_steps:
    1. Implement `buildAdjacencyGraph(segments)` per design.md §6, using only the existing `intersections`/`alternatives` fields of `road_network_geometry.json`.
    2. Implement `detectCascadingRisk(activeIncidents, adjacency, isArticle2Triggered)` per design.md §6, directly reusing `article2.ts`'s exported `isArticle2Triggered` — do not reimplement the 3-AND trigger check.
    3. Wire into the pipeline using `otherActiveIncidents` from TASK-GZAE-04a plus the current incident, so the check sees the full active set.
  - acceptance_criteria: R4 AC1–AC6 verbatim; advisory text is a fixed template.
  - tests_required: integration test per requirements.md R5 AC8 (fixture: two incidents, neither triggering art.2, with adjacent `affected_segment`s → `cascading_risk` populated with both `event_id`s; neither incident's `triggered_articles` changes).
  - done_definition: Test green; running the 3 official `live_incidents.json` events together produces `cascading_risk: null` (they are not mutually adjacent and/or `TPE_2026_ACC_001` already triggers art.2) — assert this explicitly as part of the no-regression baseline.

---

## Phase 5 — Regression, Property Tests & Schema Boundary

- [ ] TASK-GZAE-09 No-regression baseline across all 3 official incidents
  - objective: Prove GZAE, taken as a whole, is a pure addition for the dataset the demo actually runs on.
  - requirements_covered: R5 AC4
  - design_sections: §9
  - files_or_modules_expected: `packages/domain/test/integration/grey_zone_arbitration_pipeline.test.ts`
  - dependencies: [TASK-GZAE-05, TASK-GZAE-06, TASK-GZAE-07, TASK-GZAE-08]
  - implementation_steps:
    1. Run each of `TPE_2026_ACC_001`, `TPE_2026_EVT_002`, `TPE_2026_EVT_003` through the full pipeline pre- and post-GZAE (or against a recorded pre-GZAE snapshot) and assert `triggered_articles`, `classifications`, `primary_evacuation`, `secondary_evacuation` are byte-identical.
  - acceptance_criteria: R5 AC4 verbatim.
  - tests_required: the test itself is the deliverable.
  - done_definition: Test green in CI.

- [ ] TASK-GZAE-10 Purity property tests + schema-boundary coverage
  - objective: Lock in determinism of all 4 new judgment functions and confirm the LLM cannot overwrite the new fields.
  - requirements_covered: R5 AC9, R5 AC3
  - design_sections: §7.3, §9
  - files_or_modules_expected: `packages/domain/test/unit/grey_zone_arbitration.test.ts`, `packages/rag/src/schema_validator.ts` test suite (whichever file already exercises `PROHIBITED_KEYS`-driven filtering)
  - dependencies: [TASK-GZAE-04, TASK-GZAE-06, TASK-GZAE-07, TASK-GZAE-08, TASK-GZAE-03]
  - implementation_steps:
    1. Add fast-check (or repeated-call) property tests asserting `excludeSelfBlockedCandidates`, `detectPreWarning`, `detectSignalConflicts`, `detectCascadingRisk` each return identical output for identical input across repeated invocations.
    2. Add a test asserting the existing `PROHIBITED_KEYS`-driven Bedrock-output filter rejects/strips an attempted overwrite of each of the 4 new `DecisionCore` fields, mirroring however UARE's equivalent fields are already covered.
  - acceptance_criteria: R5 AC9, R5 AC3 verbatim.
  - tests_required: the tests themselves are the deliverable.
  - done_definition: All tests green; `packages/domain` and `packages/rag` full suites pass with zero unrelated regressions.
