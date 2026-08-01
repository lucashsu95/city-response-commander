# Implementation Plan: Boundary Snapping & Containment Protocol

Requirements Baseline: `requirements.md` (R1–R14)
Design: `design.md`
Task Plan Status: `DRAFT_PENDING_REVIEW`
Implementation Authorization: `NOT_AUTHORIZED_PENDING_REVIEW`

## Overview

This plan converts `design.md` (§1–§11) into an ordered, agent-executable task list. It is a PLAN ONLY: no production code is created here.

Hard invariants enforced by every applicable task:
- Deterministic code (`Boundary_Snapper`, `Sop_Coverage_Resolver`, `Whitelist_Guard`, `Containment_Assembler`) owns all identifiers/numbers it emits; `Bedrock_Composer` writes text-only fields (design.md §0, §6).
- No task may modify the existing `insufficient_data` / `stop_reason` semantics owned by `DataIngestionService` and `decision_pipeline.ts`'s §21 STOP gate.
- No task may modify the numeric output of `runDeterministicDecision` for `IN_SCOPE` / `IN_SCOPE_BY_INTERSECTION` incidents — Phase 3's integration task is release-blocking specifically to prove this (no-regression).
- Every new "prohibited field" list added in this plan must ship with the equivalent of the existing `prohibited-fields-sync.test.ts` automated check — never a documentation-only claim.

Task ID scheme: `TASK-BS-01..TASK-BS-19`, flat and sequential. `CHECKPOINT` lines are not tasks.

---

## Phase 0 — Shared Types & Config

- [x] TASK-BS-01 Add `EntityScopeResult`, `PerimeterAnchor`, `SnapResult`, `SopCoverageResult`, `UniversalPrinciple`, `ContainmentResult`, `ContainmentDisclosure` types to `packages/shared-schemas`
  - objective: Establish the shared type vocabulary so domain and backend packages compile against the same contracts from the start.
  - requirements_covered: R2, R4, R6, R10, R13
  - design_sections: §4, §5, §6, §7, §8
  - files_or_modules_expected: `packages/shared-schemas/src/boundary_snapping.ts` (new), `packages/shared-schemas/src/sop_coverage.ts` (new), `packages/shared-schemas/src/containment_disclosure.ts` (new), `packages/shared-schemas/src/index.ts` (barrel export)
  - dependencies: []
  - implementation_steps:
    1. Define `EntityScopeResult`, `PerimeterAnchor`, `SnapResult`, `BoundarySnapperConfig` per design.md §4.
    2. Define `SopCoverageStatus`, `SopAuthority`, `SopCoverageResult`, `UniversalPrinciple`, `DEFAULT_UNIVERSAL_SOP` per design.md §5.
    3. Define `ContainmentResult`, `CONTAINMENT_PROHIBITED_KEYS`, `CONTAINMENT_PROHIBITED_PATHS` per design.md §6, §7.
    4. Export all new types/consts from `index.ts`; do not modify existing exports.
  - acceptance_criteria: All types compile in strict mode; no `as any`; `DEFAULT_UNIVERSAL_SOP` contains exactly the 3 principles from R6 AC4.
  - tests_required: `packages/shared-schemas/test/types.test.ts` — type-level smoke test that all new exports are importable.
  - done_definition: Package builds; nothing outside this task's file list is touched.

- [x] TASK-BS-02 Add `boundary_snapping.*` and `containment.*` keys to `CONFIG_SCHEMA`
  - objective: Make the snapping/containment thresholds configurable per deployment without code changes, matching the existing policy-knob pattern.
  - requirements_covered: R11
  - design_sections: §9
  - files_or_modules_expected: `packages/config/src/config_schema.ts`
  - dependencies: []
  - implementation_steps:
    1. Add `boundary_snapping.max_snap_distance_meters` (number, required, **no** `provisionalDefault` — mirrors `orchestration.state_machine_arn`'s "missing means explicit failure, never a guessed value" pattern).
    2. Add `boundary_snapping.coordinate_path_enabled` (boolean, required, default `false`).
    3. Add `boundary_snapping.anchor_gazetteer_source` (string, required: false).
    4. Add `containment.universal_sop_enabled` (boolean, required, default `true`).
  - acceptance_criteria: `validateConfig` rejects a config missing `max_snap_distance_meters`; existing `CONFIG_SCHEMA` entries and their order are untouched (append-only diff).
  - tests_required: extend `packages/config/test/*config_schema*` (or create if absent) with a case for the missing-required-key rejection.
  - done_definition: `ALL_CONFIG_KEYS` includes the 4 new keys; existing config tests still pass unmodified.

---

## Phase 1 — Boundary_Snapper (Layer 1, pure domain)

- [x] TASK-BS-03 Extract `intersectionAppearsInLocation` into a shared helper
  - objective: Boundary_Snapper's Entity_Scope_Check (R2) and the existing `IncidentAnchorResolutionStrategy` (Strategy D) must agree on "does this intersection name appear in the location text" — sharing one implementation prevents behavior drift between the two.
  - requirements_covered: R2 (implicitly, via design.md §4.5)
  - design_sections: §4.5
  - files_or_modules_expected: `packages/domain/src/road_network/intersection_text_match.ts` (new), `packages/domain/src/strategies/incident_anchor_resolution_strategy.ts` (import-only change)
  - dependencies: []
  - implementation_steps:
    1. Move `intersectionAppearsInLocation` (currently a private function in `incident_anchor_resolution_strategy.ts:230-234`) verbatim into the new shared module, exported.
    2. Update `incident_anchor_resolution_strategy.ts` to import it instead of defining it locally.
    3. Do not change the function's behavior in any way.
  - acceptance_criteria: All existing `incident_anchor_resolution_strategy` tests pass unmodified (no golden-value changes); the function is importable from the new module.
  - tests_required: run existing Strategy D test suite as regression proof; no new tests needed for this pure move.
  - done_definition: Single source of truth for the match logic; zero behavior change verified by unmodified existing tests passing.

- [x] TASK-BS-04 Implement `checkEntityScope` (Requirement 2)
  - objective: Deterministically classify whether an incident's location falls inside the road-network coverage using only `affected_segment` / `affected_road` / `location` text — no coordinates required.
  - requirements_covered: R2
  - design_sections: §4.1
  - files_or_modules_expected: `packages/domain/src/boundary/boundary_snapper.ts` (new)
  - dependencies: [TASK-BS-01, TASK-BS-03]
  - implementation_steps:
    1. Implement the 4-step precedence from design.md §4.1 (affected_segment → affected_road → intersection text match → OUT_OF_BOUNDS).
    2. On multiple intersection matches, select longest string match, tie-break by lexicographically smallest segment_id (R2 AC5).
    3. Record matched field/value as snapping evidence (R2 AC6).
  - acceptance_criteria: R2 AC1–AC6 all independently testable and passing.
  - tests_required: `packages/domain/test/unit/boundary_snapper_entity_scope.test.ts` covering each AC; property test P-B2 (pure-function determinism) from design.md §10.
  - done_definition: `checkEntityScope` used with the 3 `live_incidents.json` fixture records produces `IN_SCOPE` for all three (they are official in-network incidents) — captured as a fixture regression test.

- [x] TASK-BS-05 Implement `derivePerimeterAnchors` (Requirement 4 AC1–AC2)
  - objective: Deterministically derive the set of real perimeter gateway nodes from road-network topology alone, with no hardcoded anchor IDs.
  - requirements_covered: R4 (AC1, AC2, AC6, AC7)
  - design_sections: §4.2
  - files_or_modules_expected: `packages/domain/src/boundary/boundary_snapper.ts`
  - dependencies: [TASK-BS-04]
  - implementation_steps:
    1. For each segment, for each `intersections[]` entry, check whether it matches any segment's `name` in the network; if not, it is a `Perimeter_Gateway_Intersection`.
    2. Emit one `PerimeterAnchor` per (segment, gateway_intersection) pair, carrying `capacity_vph`.
    3. Cache the result per `RoadNetworkModel` instance (topology is immutable once loaded).
  - acceptance_criteria: Every emitted anchor's `segment_id` ∈ Road_Whitelist and `gateway_intersection` ∈ Intersection_Whitelist (R4 AC6/AC7); running against the real `road_network_geometry.json` (15 segments) produces a non-empty, deterministic anchor list — assert exact expected set as a fixture test since the 15-segment data is fixed and known.
  - tests_required: `packages/domain/test/unit/perimeter_anchor_derivation.test.ts`.
  - done_definition: Anchor set is stable across repeated calls (no random iteration order dependency) and reviewed against the real fixture data by hand once, then locked as a golden fixture.

- [x] TASK-BS-06 Implement `snap` selection logic + `Max_Snap_Distance_Meters` gate (Requirement 4 AC3–AC5, AC8; Requirement 5)
  - objective: Given an `OUT_OF_BOUNDS` incident, deterministically pick the correct perimeter anchor (or declare the incident out of jurisdiction) using only config-driven thresholds.
  - requirements_covered: R4, R5
  - design_sections: §4.2, §4.3
  - files_or_modules_expected: `packages/domain/src/boundary/boundary_snapper.ts`
  - dependencies: [TASK-BS-05]
  - implementation_steps:
    1. Read `max_snap_distance_meters` from `BoundarySnapperConfig`; if absent, return a config-missing error and do not snap (R5 AC1/AC2 — mirrors TASK-BS-02's schema-level requirement at the domain-function level too).
    2. When coordinate path disabled/unavailable: pick highest `capacity_vph`, tie-break lexicographically smallest `segment_id` (R4 AC3).
    3. When coordinate path enabled and incident coordinate valid: pick nearest by haversine distance (delegates to TASK-BS-07), tie-break lexicographically smallest `segment_id`; if nearest distance > threshold, return `OUT_OF_JURISDICTION` with measured distance and threshold recorded (R4 AC4, R5 AC3).
    4. If `derivePerimeterAnchors` returns empty, return `OUT_OF_JURISDICTION` with `reason: 'no_perimeter_anchor_available'` (R4 AC5).
    5. Skip snapping entirely (anchor = `null`) when scope is `IN_SCOPE`/`IN_SCOPE_BY_INTERSECTION` (R4 AC8) — this function is only called after `checkEntityScope` returns `OUT_OF_BOUNDS`.
  - acceptance_criteria: R4 AC3–AC5, AC8 and R5 AC1–AC3, AC6 all independently testable and passing; boundary test at distance == threshold, threshold−1, threshold+1 (R14.7).
  - tests_required: `packages/domain/test/unit/boundary_snapper_boundary.test.ts`; property tests P-B1, P-B3 from design.md §10.
  - done_definition: `snap()` never returns a `segment_id` outside Road_Whitelist across 100+ fast-check iterations (P-B1).

- [x] TASK-BS-07 Implement haversine coordinate path (Requirement 3) — 與 TASK-BS-06 一併完成，見其 commit
  - objective: Provide ground-distance calculation for the optional coordinate path so a future `Anchor_Gazetteer` integration is correct on day one, even though it is inert against the current official dataset.
  - requirements_covered: R3
  - design_sections: §4.3
  - files_or_modules_expected: `packages/domain/src/boundary/boundary_snapper.ts` (or `haversine.ts` if it grows), used by TASK-BS-06
  - dependencies: [TASK-BS-06 interface, can implement in parallel]
  - implementation_steps:
    1. Implement standard haversine great-circle distance, returning integer meters (R3 AC2, AC5).
    2. Validate lat ∈ [-90,90], lon ∈ [-180,180]; on invalid, fall back to Entity_Scope_Check path and record `invalid_coordinate` evidence (R3 AC4).
    3. When `Anchor_Gazetteer` absent, ignore any incoming coordinate, fall back, and record `gazetteer_unavailable` evidence (R3 AC3).
    4. When coordinate path disabled, record `distance_threshold_not_applicable` in evidence (R5 AC6) and set `distance_meters: null` in the response (R3 AC6).
  - acceptance_criteria: Known-distance test vectors (e.g. two points 1000m apart on a meridian) match haversine formula within rounding; invalid coordinates never throw, always degrade gracefully.
  - tests_required: `packages/domain/test/unit/haversine.test.ts` with known reference distances.
  - done_definition: Function is pure, side-effect free, and unreachable from the demo path given the current dataset (documented as such per design.md §11 Non-Goals).

---

## Phase 2 — Sop_Coverage_Resolver & Whitelist_Guard (Layer 1)

- [x] TASK-BS-08 Implement `Sop_Coverage_Resolver` and `DEFAULT_UNIVERSAL_SOP` (Requirement 6)
  - objective: Deterministically decide whether an incident's `type` maps to an official SOP article or must fall back to the system-default universal containment principles, without ever producing a refusal.
  - requirements_covered: R6
  - design_sections: §5
  - files_or_modules_expected: `packages/domain/src/boundary/sop_coverage_resolver.ts` (new)
  - dependencies: [TASK-BS-01]
  - implementation_steps:
    1. Build the deterministic `type → article_no[]` lookup table, traceable to `emergency_traffic_sop.txt` (reuse `ingestion.sopArticles`, do not re-parse the SOP text).
    2. On match, return `OFFICIAL_SOP_MATCHED` + `sop_authority: 'OFFICIAL_SOP'`.
    3. On no match (by type nor by description text trigger), return `UNKNOWN_TYPE_UNIVERSAL_SOP` + `sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE'` + the 3 `DEFAULT_UNIVERSAL_SOP` principles.
    4. Keep `principle_id` and official `article_no` in visibly separate fields (R6 AC6) — never conflate the two.
  - acceptance_criteria: Every known incident `type` in the official dataset resolves to `OFFICIAL_SOP_MATCHED`; at least 3 synthetic unknown types resolve to `UNKNOWN_TYPE_UNIVERSAL_SOP` (R14.6).
  - tests_required: `packages/domain/test/unit/sop_coverage_resolver.test.ts`.
  - done_definition: Table is fully traceable — each entry cites the article number it maps to, checkable against `emergency_traffic_sop.txt`.

- [x] TASK-BS-09 Implement `Whitelist_Guard` (Requirement 9 AC1, Requirement 12.5 property)
  - objective: Provide a reusable, pure partitioning function that separates any candidate road-id set into whitelisted vs. non-whitelisted members, used both for Safe_Context construction and for auditing Bedrock's output.
  - requirements_covered: R9 (AC1), R14.5
  - design_sections: §4.4
  - files_or_modules_expected: `packages/domain/src/boundary/whitelist_guard.ts` (new)
  - dependencies: [TASK-BS-01]
  - implementation_steps:
    1. Implement `partitionByWhitelist(candidateIds, whitelist)` returning `{allowed, rejected}` with `allowed ∪ rejected == candidateIds` and `allowed ∩ rejected == ∅`.
    2. Implement `extractRoadIdLike(text)` — regex extraction of road-id-shaped substrings (e.g. `RD_TPE_\d{3}`) from free text, for auditing LLM output.
  - acceptance_criteria: Property test — for arbitrary string arrays and arbitrary whitelist sets, partition invariant holds (R14.5); `extractRoadIdLike` finds all valid ids embedded in a mixed Chinese/English sentence in a unit test.
  - tests_required: `packages/domain/test/unit/whitelist_guard.test.ts` with fast-check property (≥100 iterations).
  - done_definition: Zero false negatives/positives on the partition invariant across the property run.

---

## Phase 3 — Containment_Assembler integration (Layer 2, backend)

- [x] TASK-BS-10 Implement `Containment_Assembler` orchestration skeleton with the STOP-gate short-circuit (Requirement 1, Requirement 12 AC1–AC2)
  - objective: Wire the sequence from design.md §3.1 — check `ingestion.data_status` first, and only then run Entity_Scope_Check — as the single entry point backend handlers call.
  - requirements_covered: R1, R12 (AC1, AC2)
  - design_sections: §3, §6
  - files_or_modules_expected: `packages/backend/src/decision/containment_assembler.ts` (new)
  - dependencies: [TASK-BS-04, TASK-BS-08, TASK-BS-09]
  - implementation_steps:
    1. If `ingestion.data_status !== 'ready'`, return immediately with the existing `insufficient_data`/`stop_reason` from `ingestion`, `data_scope_status: null`, no Boundary_Snapper/Sop_Coverage_Resolver calls (R12 AC2).
    2. Otherwise call `checkEntityScope`, then `resolveSopCoverage`, in that order (R1 AC1).
    3. Stub out the branch to `runDeterministicDecision` / `snap` for TASK-BS-11/12 to fill in.
  - acceptance_criteria: Given a mocked `ingestion` with `data_status: 'insufficient_data'`, the assembler never touches `roadNetwork` (verified via a spy/mock that throws if called).
  - tests_required: `packages/backend/test/decision/containment_assembler.test.ts` — STOP-gate short-circuit case.
  - done_definition: The `insufficient_data` path is byte-identical to pre-existing backend behavior (regression-proof via existing `decision_fn.test.ts` fixtures reused here).

- [x] TASK-BS-11 Wire the `IN_SCOPE` / `IN_SCOPE_BY_INTERSECTION` branch to existing `runDeterministicDecision` unchanged (Requirement 12 AC3, AC7)
  - objective: Prove that in-scope incidents are completely unaffected by this feature — the existing golden tests (ACC_001, EVT_002, EVT_003) must keep producing identical output.
  - requirements_covered: R12 (AC3, AC6, AC7)
  - design_sections: §3.2
  - files_or_modules_expected: `packages/backend/src/decision/containment_assembler.ts`
  - dependencies: [TASK-BS-10]
  - implementation_steps:
    1. When `coverage_status` ∈ {`IN_SCOPE`, `IN_SCOPE_BY_INTERSECTION`}, call `runDeterministicDecision` exactly as `decision_fn.ts` does today, with no parameter changes.
    2. Set `data_scope_status` to the resolved value, `mapped_anchor_node: null` (R10 AC9), `incident_anchor` sourced from `facts.incident_anchor` unchanged.
  - acceptance_criteria: Running the 3 golden events (ACC_001, EVT_002, EVT_003) through `Containment_Assembler` produces `facts` deep-equal to calling `runDeterministicDecision` directly (no-regression, R12 AC7 / R14.9).
  - tests_required: `packages/backend/test/decision/containment_assembler.test.ts` — golden no-regression cases, diffed against `packages/backend/test/decision/decision_fn.test.ts` fixtures.
  - done_definition: Zero diff on all three golden fixtures.

- [x] TASK-BS-12 Wire the `OUT_OF_BOUNDS_SNAPPED` / `OUT_OF_JURISDICTION` branch with RD_ sub-pipeline short-circuit (Requirement 12 AC4–AC6)
  - objective: When an incident is a Coverage_Gap, skip the existing RD_ branch's classification/anchor/evacuation/ETE (which would only produce degraded nulls) and assemble the decision from `Boundary_Snapper` + `Sop_Coverage_Resolver` output instead.
  - requirements_covered: R12 (AC4, AC5, AC6)
  - design_sections: §3.2
  - files_or_modules_expected: `packages/backend/src/decision/containment_assembler.ts`
  - dependencies: [TASK-BS-06, TASK-BS-11]
  - implementation_steps:
    1. When `coverage_status` ∈ {`OUT_OF_BOUNDS`→snapped, `OUT_OF_JURISDICTION`}, do NOT call `runDeterministicDecision`'s RD_ branch (classification, Strategy D, `qualifyCandidates`, `selectEvacuation`, ETE).
    2. Still evaluate SOP-3/4/6 (art.3, art.4, art.6) exactly as today, since they key off `BS_ID`, not `affected_segment` (R12 AC5) — extract this sub-piece so it's callable without the RD_ branch (may require a small refactor of `decision_pipeline.ts` to expose the BS_ID-keyed evaluations independently; if so, do it as a non-behavior-changing extraction, mirroring TASK-BS-03's approach).
    3. Set `incident_anchor: null` in the response for this branch (R12 AC6).
    4. Call `Boundary_Snapper.snap()` to get `mapped_anchor_node` (or `null` + jurisdiction reason).
  - acceptance_criteria: For a synthetic out-of-network incident, `facts.incident_anchor` and `facts.primary_evacuation` are absent/null in the assembled result, while `mapped_anchor_node` is populated; SOP-3/4/6 evaluations (when applicable fixtures trigger them) are unaffected.
  - tests_required: `packages/backend/test/decision/containment_assembler.test.ts` — OUT_OF_BOUNDS_SNAPPED and OUT_OF_JURISDICTION cases.
  - done_definition: No API response ever contains both a non-null `incident_anchor.manual_confirmation_required` fact set AND a non-null `mapped_anchor_node` for the same incident.

- [x] TASK-BS-13 Implement Safe_Context construction (Requirement 8)
  - objective: Build the restricted prompt context handed to `Bedrock_Composer`, ensuring the allowed road-id action space is always a subset of `Road_Whitelist`.
  - requirements_covered: R8
  - design_sections: §6.1
  - files_or_modules_expected: `packages/backend/src/decision/containment_assembler.ts`
  - dependencies: [TASK-BS-12]
  - implementation_steps:
    1. Build `allowed_road_whitelist` per branch: `IN_SCOPE*` uses the existing evacuation-candidate whitelist logic; `OUT_OF_BOUNDS_SNAPPED` uses `{anchor.segment_id} ∪ (roadNetwork.alternativesOf(anchor.segment_id) ∩ Road_Whitelist)` (R8 AC2), reusing `RoadNetworkModel.alternativesOf`'s existing one-way semantics unchanged.
    2. Include `official_sop_text` or `universal_principles` (never both mixed into one block — R6 AC8), and `scope_disclosure` text when snapped (R8 AC4).
    3. Never include any road id/intersection/number not sourced from `Boundary_Snapper`/`Sop_Coverage_Resolver` output (R8 AC5).
  - acceptance_criteria: For an `OUT_OF_BOUNDS_SNAPPED` fixture, `allowed_road_whitelist` is exactly the expected 2–3 element set computed by hand from the fixture's `alternatives`.
  - tests_required: `packages/backend/test/decision/containment_assembler.test.ts` — Safe_Context construction cases.
  - done_definition: `allowed_road_whitelist` is provably ⊆ Road_Whitelist for every branch, asserted directly in tests.

- [x] TASK-BS-14 Wire Bedrock call + `Whitelist_Guard` output audit (Requirement 9 AC2–AC6, Requirement 5 AC5)
  - objective: Send Safe_Context to Bedrock, then filter its output through Whitelist_Guard so no fabricated road id ever reaches `decision.reroute_roads`.
  - requirements_covered: R9, R5 (AC5)
  - design_sections: §3.1, §4.4
  - files_or_modules_expected: `packages/backend/src/decision/containment_assembler.ts`
  - dependencies: [TASK-BS-13]
  - implementation_steps:
    1. Skip the Bedrock call entirely when `coverage_status == OUT_OF_JURISDICTION`; produce only the static out-of-jurisdiction explanation (R5 AC5).
    2. Otherwise call `Bedrock_Composer`, then run `extractRoadIdLike` + `partitionByWhitelist` on its output text against `allowed_road_whitelist`.
    3. Any rejected road id goes into `whitelist_violations` (with occurrence count) and is excluded from `decision.reroute_roads` (R9 AC2, AC3, AC4).
    4. `decision.perimeter_control.target_gate` must resolve to a Road_Whitelist member (R9 AC5).
    5. On Bedrock failure/timeout, assemble a deterministic-only response and flag AI explanation as unavailable (R9 AC6) — reuse existing backend fallback pattern if one already exists for the current Bedrock call path.
  - acceptance_criteria: Feeding a mocked Bedrock response containing a fabricated road id produces a non-empty `whitelist_violations` array and excludes that id from `reroute_roads`.
  - tests_required: `packages/backend/test/decision/containment_assembler.test.ts` — whitelist violation case, Bedrock-failure fallback case.
  - done_definition: No test path can produce a `reroute_roads` member outside Road_Whitelist.

---

## Phase 4 — `LLM_PROHIBITED_FIELDS` parity (Requirement 13)

- [ ] TASK-BS-15 Add `CONTAINMENT_PROHIBITED_PATHS` enforcement to `schema_validator.ts`
  - objective: Give the new disclosure fields the same mechanical LLM-write protection that `DecisionCore` fields already have, per the design decision in design.md §7 (separate type, not merged into `DecisionCore`).
  - requirements_covered: R13 (AC4, AC5)
  - design_sections: §7
  - files_or_modules_expected: `packages/rag/src/schema_validator.ts`, `packages/shared-schemas/src/containment_disclosure.ts` (from TASK-BS-01)
  - dependencies: [TASK-BS-01]
  - implementation_steps:
    1. Add a validation pass in `schema_validator.ts` that checks any Bedrock-sourced payload does not attempt to set keys/paths in `CONTAINMENT_PROHIBITED_PATHS`, mirroring the existing `LLM_PROHIBITED_FIELDS` check's structure exactly.
    2. Do not merge this into the existing `LLM_PROHIBITED_FIELDS` set (types differ, per design.md §7 rationale) — keep them as two explicit checks in the same validator function.
  - acceptance_criteria: A crafted payload with a `data_scope_status` key set by "Bedrock" is rejected/stripped by the validator.
  - tests_required: `packages/rag/test/schema_validator.test.ts` — new case for containment fields, alongside existing `DecisionCore` field cases.
  - done_definition: Existing `DecisionCore`-field rejection tests still pass unmodified; new containment-field rejection test passes.

- [ ] TASK-BS-16 Sync `CONTAINMENT_PROHIBITED_KEYS` into `eslint-local-rules.cjs` and extend `prohibited-fields-sync.test.ts`
  - objective: Prevent the exact drift the header comment on `llm_boundary.ts` already warns about — a second manually-maintained copy — for the new field set.
  - requirements_covered: R13 (AC1, AC2, AC3)
  - design_sections: §7
  - files_or_modules_expected: `eslint-local-rules.cjs` (repo root), `eslint-local-rules/test/prohibited-fields-sync.test.ts`
  - dependencies: [TASK-BS-15]
  - implementation_steps:
    1. Add a literal copy of `CONTAINMENT_PROHIBITED_KEYS` to `eslint-local-rules.cjs`, following the exact pattern already used for `PROHIBITED_KEYS`.
    2. Extend `prohibited-fields-sync.test.ts` with a second assertion block comparing `CONTAINMENT_PROHIBITED_KEYS` (imported from shared-schemas) against the new literal copy.
  - acceptance_criteria: Deliberately editing one copy without the other fails the sync test (verify manually once, then revert).
  - tests_required: `prohibited-fields-sync.test.ts` extended case (R14.10).
  - done_definition: CI fails if the two containment-field copies ever diverge, exactly as it already does for `PROHIBITED_KEYS`.

---

## Phase 5 — Integration, Golden & Boundary Tests (Requirement 14)

- [ ] TASK-BS-17 Full `Containment_Assembler` integration test matrix (Requirement 14.8)
  - objective: Prove all four documented response shapes are correct end to end.
  - requirements_covered: R14 (AC8)
  - design_sections: §10
  - files_or_modules_expected: `packages/backend/test/decision/containment_assembler.test.ts`
  - dependencies: [TASK-BS-14]
  - implementation_steps:
    1. Case A: `IN_SCOPE` incident — assert `data_scope_status: 'IN_SCOPE'`, `mapped_anchor_node: null`, `facts` populated as today.
    2. Case B: `OUT_OF_BOUNDS_SNAPPED` incident — assert anchor populated, `reroute_roads` ⊆ whitelist, `incident_anchor: null`.
    3. Case C: `OUT_OF_JURISDICTION` incident (synthetic coordinate > threshold, or empty anchor set) — assert no Bedrock call made, static explanation only.
    4. Case D: `insufficient_data` ∧ conceptually-out-of-bounds incident — assert per design.md §3.3 that `data_scope_status` stays `null` and only the existing `insufficient_data` response is produced (documents the resolved Req 7 AC8 scoping decision as an executable test, not just prose).
  - acceptance_criteria: All 4 cases pass; Case D specifically encodes the design.md §3.3 resolution so a future change to that scoping decision breaks a test instead of silently drifting.
  - tests_required: (this task IS the test task)
  - done_definition: 4/4 cases green.

- [ ] TASK-BS-18 Property test suite for Boundary_Snapper and Whitelist_Guard (Requirement 14.1–14.5, 14.7)
  - objective: Consolidate and run the fast-check property suite referenced piecemeal in Phase 1/2 tasks, at ≥100 iterations each, as a single reviewable suite.
  - requirements_covered: R14 (AC1–AC5, AC7)
  - design_sections: §10
  - files_or_modules_expected: `packages/domain/test/property/p_boundary_snap.test.ts`, `packages/domain/test/unit/whitelist_guard.test.ts`, `packages/domain/test/unit/boundary_snapper_boundary.test.ts`
  - dependencies: [TASK-BS-06, TASK-BS-09]
  - implementation_steps: consolidate the property assertions already written in TASK-BS-04/06/09 into a reviewable suite; add the 3-point boundary case (threshold −1/=/+1) if not already covered.
  - acceptance_criteria: All properties run ≥100 iterations in CI; no flakiness across 3 consecutive local runs.
  - tests_required: (this task IS the test task)
  - done_definition: `npm run test` (domain package) is green and deterministic.

- [ ] TASK-BS-19 No-regression golden diff against existing ACC_001 / EVT_002 / EVT_003 fixtures (Requirement 12 AC7, Requirement 14.9)
  - objective: Final release gate — mechanically prove this feature is additive-only for every existing golden scenario before it can be considered complete.
  - requirements_covered: R12 (AC7), R14 (AC9)
  - design_sections: §3.2, §10
  - files_or_modules_expected: `packages/backend/test/decision/containment_assembler.test.ts`
  - dependencies: [TASK-BS-11, TASK-BS-17]
  - implementation_steps:
    1. Run ACC_001, EVT_002, EVT_003 through both `runDeterministicDecision` directly and through `Containment_Assembler`.
    2. Deep-equal the `facts` portion of both outputs; fail on any diff.
  - acceptance_criteria: Zero diff on all three golden events.
  - tests_required: (this task IS the test task)
  - done_definition: This test is wired into the same CI gate as the existing golden tests (TASK-053/054/055 in `impl1`), not a separate optional suite.
