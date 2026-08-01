# Implementation Plan: Unified Adaptive Reasoning Engine

Requirements Baseline: `requirements.md` (R1–R9)
Design: `design.md`
Task Plan Status: `DRAFT_PENDING_REVIEW`
Implementation Authorization: `NOT_AUTHORIZED_PENDING_REVIEW`

## Overview

This plan converts `design.md` (§3–§9) into an ordered, agent-executable task list. It is a PLAN ONLY: no production code is created here.

Hard invariants enforced by every applicable task:
- Deterministic code (`resolveSopMatch`, `selectGroundingCandidates`, `UNIVERSAL_DEFENSE_PRINCIPLES`) owns all identifiers, numbers, and boolean judgments it emits; `RecommendationGenerator`/Bedrock writes text-only fields (design.md §0, §6).
- No task may modify `article1.ts`–`article6.ts` trigger conditions, `qualifyCandidates`/`selectEvacuation` (SOP-2), or `DataIngestionService`'s `insufficient_data`/`stop_reason` semantics.
- No task may change the `sop_matched: true` branch's prompt output text (no-regression, R4 AC7 / R9.6 is release-blocking for this).
- Any new field added to `DecisionCore` must ship in the same task batch as its `PROHIBITED_KEYS` / `eslint-local-rules.cjs` mirror update — never split across tasks, to avoid an intermediate commit where the field exists but is unprotected.

Task ID scheme: `TASK-UARE-01..TASK-UARE-11`, flat and sequential.

---

## Phase 0 — Shared Types

- [x] TASK-UARE-01 Add `UniversalPrinciple`, `UniversalPrincipleId`, `GroundingCandidate`, `SopMatchResult` types
  - objective: Establish the shared type vocabulary before any package implements against it.
  - requirements_covered: R2, R3, R5
  - design_sections: §3, §4, §5
  - files_or_modules_expected: `packages/shared-schemas/src/universal_defense.ts` (new), `packages/shared-schemas/src/index.ts` (barrel export)
  - dependencies: []
  - implementation_steps:
    1. Define `UniversalPrincipleId`, `UniversalPrinciple`, `GroundingCandidate`, `SopMatchResult` per design.md §3–§5.
    2. Export from `index.ts`; do not modify existing exports.
  - acceptance_criteria: Types compile in strict mode; no `as any`/`@ts-ignore`/`@ts-expect-error`.
  - tests_required: none (type-only file; covered transitively by consumers' tests).
  - done_definition: Package builds; nothing outside this task's file list is touched.

- [x] TASK-UARE-02 Extend `DecisionCore` with `sop_matched`, `sop_authority`, `universal_principles`, `grounding_candidates`
  - objective: Give the new judgment a home in the canonical, immutable decision payload.
  - requirements_covered: R5 AC1, AC2, AC5
  - design_sections: §7
  - files_or_modules_expected: `packages/shared-schemas/src/decision_core.ts`
  - dependencies: [TASK-UARE-01]
  - implementation_steps:
    1. Add the 4 readonly fields to the `DecisionCore` interface, appended after `cms_core_text` (append-only diff, grouped with the other "final decision content" fields).
  - acceptance_criteria: `DecisionCore` compiles; no existing field renamed or reordered.
  - tests_required: none (see implementation note below); confirmed no existing `DecisionCore`-typed fixture broke (`packages/shared-schemas/test/types.test.ts`, `packages/domain`, `packages/ai-generator`, `packages/rag`, `packages/backend` all typecheck clean).
  - done_definition: `packages/shared-schemas` builds; all 5 dependent packages typecheck clean with zero changes required in them.
  - **implementation note (deviation from original plan)**: the 4 fields were added as **optional** (`sop_matched?`, etc.), not required as originally drafted. `DecisionCore` already has precedent for this (`event_facts`, `art1_measures`, `incident_anchor`, `affected_intersection_scope`, `ete` are all optional "for backwards-compatible read models"). Making them required would have broken `decision_core_builder.ts`'s `DecisionCoreBuildInput` (an `Omit<DecisionCore, ...>` of the whole interface) and ~25 files across the monorepo that construct `DecisionCore` literals directly, none of which are touched until TASK-UARE-08 wires the pipeline. Optional fields keep every intermediate commit (01→03, and later 04→07) in a fully-building, fully-green state instead of deliberately breaking the build for several tasks. TASK-UARE-08 is unaffected: it still populates all 4 fields on every decision output; the type just doesn't yet *require* it before that task lands.

- [x] TASK-UARE-03 Add the 4 new field names to `LLM_PROHIBITED_FIELDS` (both copies)
  - objective: Close the enforcement gap the moment the fields exist — never ship a commit where the fields are writable-by-LLM.
  - requirements_covered: R8 AC1, AC2, AC3
  - design_sections: §8
  - files_or_modules_expected: `packages/shared-schemas/src/llm_boundary.ts`, `eslint-local-rules.cjs` (repo root)
  - dependencies: [TASK-UARE-02]
  - implementation_steps:
    1. Append `'sop_matched'`, `'sop_authority'`, `'universal_principles'`, `'grounding_candidates'` to `PROHIBITED_KEYS` in `llm_boundary.ts`.
    2. Append the identical 4 strings to the manual copy in `eslint-local-rules.cjs`.
    3. Extend `eslint-local-rules/test/prohibited-fields-sync.test.ts` to assert both lists still match and both contain the 4 new keys.
  - acceptance_criteria: R8 AC1–AC3; sync test fails if either copy is missing an entry.
  - tests_required: `eslint-local-rules/test/prohibited-fields-sync.test.ts` (extended, new `it` block asserting the 4 keys are present in both sets).
  - done_definition: `npx vitest run packages/shared-schemas/test/types.test.ts eslint-local-rules/test/prohibited-fields-sync.test.ts` — 14 passed, 0 failed (required rebuilding `packages/shared-schemas` dist first, since the sync test imports the built package, not src).

---

## Phase 1 — Domain Logic (Layer 1, pure functions)

- [ ] TASK-UARE-04 Implement `resolveSopMatch` and `UNIVERSAL_DEFENSE_PRINCIPLES`
  - objective: Turn the existing `triggered_articles` output into an explicit, testable boolean judgment, and define the fixed universal-principle text.
  - requirements_covered: R1, R2
  - design_sections: §3, §4
  - files_or_modules_expected: `packages/domain/src/rule_engine/universal_defense.ts` (new)
  - dependencies: [TASK-UARE-01]
  - implementation_steps:
    1. Implement `resolveSopMatch(triggeredArticles)` exactly per design.md §3.
    2. Define `UNIVERSAL_DEFENSE_PRINCIPLES` as the frozen 3-entry constant per design.md §4 (Chinese title/description text final at this task — do not leave placeholder text).
  - acceptance_criteria: R1 AC1–AC5; R2 AC1–AC3.
  - tests_required: `packages/domain/test/unit/universal_defense.test.ts` — `resolveSopMatch([])` → `{sop_matched:false, sop_authority:'SYSTEM_DEFAULT_PRINCIPLE'}`; `resolveSopMatch([1])` → `{sop_matched:true, sop_authority:'OFFICIAL_SOP'}`; `UNIVERSAL_DEFENSE_PRINCIPLES.length === 3` with exactly the 3 specified `principle_id`s.
  - done_definition: Pure function, zero imports beyond `@city-commander/shared-schemas`.

- [ ] TASK-UARE-05 Export `CAPACITY_THRESHOLD` from `article2.ts` for reuse
  - objective: Avoid a second, independently-maintained copy of the capacity threshold (design.md §5.1 explicitly requires reuse, not redeclaration).
  - requirements_covered: R3 AC3 (implicitly, via design.md §5.1)
  - design_sections: §5.1
  - files_or_modules_expected: `packages/domain/src/rule_engine/article2.ts` (export-only change)
  - dependencies: []
  - implementation_steps:
    1. Add `export` to the existing `CAPACITY_THRESHOLD` constant (currently module-private).
    2. Do not change its value or any other behavior of `article2.ts`.
  - acceptance_criteria: Existing `article2.ts` test suite passes unmodified (no golden-value changes).
  - tests_required: run existing article2 tests as regression proof; no new tests needed for this export-only change.
  - done_definition: `CAPACITY_THRESHOLD` importable from `universal_defense.ts` in the next task.

- [ ] TASK-UARE-06 Implement `selectGroundingCandidates`
  - objective: Deterministically ground "peripheral guidance" recommendations in real, currently-low-congestion road segments — the zero-hallucination core of the whole feature.
  - requirements_covered: R3, R6, R7
  - design_sections: §5
  - files_or_modules_expected: `packages/domain/src/rule_engine/universal_defense.ts`
  - dependencies: [TASK-UARE-01, TASK-UARE-04, TASK-UARE-05]
  - implementation_steps:
    1. Implement the filter/sort/slice pipeline from design.md §5.1, importing `CAPACITY_THRESHOLD` from `article2.ts`.
    2. Compute `status_text` via the existing A/B classification thresholds (reuse `classification_engine.ts`'s boundary logic; do not redeclare `0.85`/`0.95`).
    3. Return `{ candidates: [], reason: 'no_grounding_candidate_available' }` when the filtered set is empty (R3 AC7).
  - acceptance_criteria: R3 AC1–AC8; R7 AC1–AC3 (caller supplies `saturationOf` bound to the existing `TimeAlignmentStrategy`; the function itself does not fetch data).
  - tests_required: `packages/domain/test/unit/universal_defense.test.ts` (extend) covering each AC, including the "no record → excluded, not defaulted to 0" case (R7 AC3) and the empty-alternatives case (R3 AC7).
  - done_definition: Function used against all 15 official road segments as anchor produces only `segment_id`s present in `road_network_geometry.json`.

- [ ] TASK-UARE-07 Property tests for `selectGroundingCandidates`
  - objective: Lock in the two invariants that matter most for the "zero hallucination" claim: whitelist membership and determinism.
  - requirements_covered: R9.3, R9.4
  - design_sections: §5, §9
  - files_or_modules_expected: `packages/domain/test/property/p_universal_grounding.test.ts` (new)
  - dependencies: [TASK-UARE-06]
  - implementation_steps:
    1. fast-check property, ≥100 iterations: for arbitrary anchor segment + arbitrary saturation map, every returned `segment_id` is a member of the fixture `road_network_geometry.json`'s 15 `segment_id`s.
    2. fast-check property, ≥100 iterations: calling `selectGroundingCandidates` twice with identical inputs yields identical output (deep-equal).
  - acceptance_criteria: R9.3, R9.4.
  - tests_required: this task's own file.
  - done_definition: Both properties run at ≥100 iterations in CI without flakes.

---

## Phase 2 — Pipeline Wiring

- [ ] TASK-UARE-08 Wire `resolveSopMatch` and `selectGroundingCandidates` into `runDeterministicDecision`
  - objective: Populate the 4 new `DecisionCore` fields from the existing pipeline without altering any pre-existing output.
  - requirements_covered: R1 AC1, R5 AC1–AC2, R6
  - design_sections: §3, §5.2, §5.3, §7
  - files_or_modules_expected: `packages/domain/src/rule_engine/decision_pipeline.ts`
  - dependencies: [TASK-UARE-04, TASK-UARE-06]
  - implementation_steps:
    1. After `const articles = aggregateArticles(...)`, call `resolveSopMatch(articles.triggered_articles)`.
    2. When `sop_matched === false`: determine `anchorSegmentId` per §5.1 precedence (`affected_segment` → `affected_road` → none); if none, produce the empty `GroundingResult` per §5.3 without calling `selectGroundingCandidates`; otherwise call it with `saturationOf` bound to the same `bundle.timeAlignment.select` / `trafficByStation` / `eventDate` already in scope at decision_pipeline.ts:236-239.
    3. When `sop_matched === true`: set `universal_principles: []`, `grounding_candidates: []` (R5 AC2) — do not call `selectGroundingCandidates` at all (avoids wasted computation and keeps the branch's cost proportional to when it's needed).
    4. Add the 4 fields to the `facts: DeterministicDecisionFacts` / `DecisionCore` object being assembled at decision_pipeline.ts:400+.
  - acceptance_criteria: R1 AC1–AC3; R5 AC1, AC2; R6 AC1, AC3 (no `insufficient_data` triggered by an empty grounding result).
  - tests_required: extend `packages/domain/test/golden/dome_and_sop6.golden.test.ts` or add a new golden test file asserting the 4 new fields for all 3 official `live_incidents.json` events (all `sop_matched: true`, per R9.1).
  - done_definition: All existing `decision_pipeline.ts` tests pass unmodified; new fields present and correct on every decision output.

- [ ] TASK-UARE-09 Integration tests: unknown incident types and no-anchor edge case
  - objective: Prove the feature actually solves the stated problem — novel incident types (drone strike on a bridge, unknown gas leak) get a grounded, non-refusing, non-hallucinated response.
  - requirements_covered: R9.2, R9.5
  - design_sections: §5.3, §6
  - files_or_modules_expected: `packages/backend/test/decision/universal_defense_integration.test.ts` (new)
  - dependencies: [TASK-UARE-08]
  - implementation_steps:
    1. Construct ≥3 synthetic incidents whose `type`/`status`/`severity`/`description` do not satisfy any of `article1`–`article6`'s trigger conditions, but whose `affected_segment` is a valid, in-whitelist road (e.g. reuse `RD_TPE_001` with a status/severity combination that fails art.2's 3-AND).
    2. Assert `sop_matched: false`, `sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE'`, and every `segment_id` in `grounding_candidates` is one of the 15 official segments.
    3. Construct 1 synthetic incident whose `affected_segment`/`affected_road` are both outside the whitelist; assert `recommended_routes` fields are all `null` and `data_status` is NOT `insufficient_data`.
  - acceptance_criteria: R9.2, R9.5.
  - tests_required: this task's own file.
  - done_definition: All 4 scenarios pass; no test relies on network/LLM calls (pure pipeline output only — the prompt/LLM layer is covered separately in TASK-UARE-11).

---

## Phase 3 — Prompt / LLM Boundary

- [ ] TASK-UARE-10 Add the `sop_matched: false` branch to `buildRecommendationPrompt`
  - objective: Give the AI a legitimate basis to cite when no official SOP article applies, replacing the current dead-end instruction that invites either refusal or fabrication.
  - requirements_covered: R4
  - design_sections: §6
  - files_or_modules_expected: `packages/ai-generator/src/recommendation-generator.ts`
  - dependencies: [TASK-UARE-08]
  - implementation_steps:
    1. Extract the current fixed `觸發 SOP 條款: ...` line into the `sop_matched: true` branch, unchanged.
    2. Implement `buildUniversalDefenseSection(core)` per design.md §6, sourcing text only from `core.universal_principles` and `core.grounding_candidates` — no new literal road names or principle text introduced in this file (all content is decision-core-sourced).
    3. Insert the branch's output at the same prompt position the old fixed line occupied.
  - acceptance_criteria: R4 AC1–AC7.
  - tests_required: extend `packages/ai-generator/test/recommendation-generator.test.ts` — (a) `sop_matched: true` fixture produces byte-identical prompt output to the pre-change snapshot (no-regression, R9.6); (b) `sop_matched: false` fixture with non-empty `grounding_candidates` produces a prompt containing the anti-refusal instruction and only the whitelisted road names; (c) `sop_matched: false` fixture with empty `grounding_candidates` produces a prompt that forbids naming any specific road.
  - done_definition: R9.6 no-regression test passes; new branch covered by (b) and (c).

- [ ] TASK-UARE-11 Extend `schema_validator.ts` output-filtering coverage and API field mapping
  - objective: Ensure Bedrock's generated text cannot overwrite the new decision fields, and that the API response exposes `sop_clauses_cited` / `recommended_routes` / `universal_principles` per design.md §7.
  - requirements_covered: R5 AC3, AC4; R8 AC4
  - design_sections: §7, §8
  - files_or_modules_expected: `packages/rag/src/schema_validator.ts` (verify existing `LLM_PROHIBITED_FIELDS` path auto-covers new keys per design.md §8 — add an explicit test, not new filtering code, unless verification finds a gap), backend API response assembly layer (existing serialization point — add `sop_clauses_cited`, `recommended_routes`, and pass through `universal_principles`)
  - dependencies: [TASK-UARE-03, TASK-UARE-08]
  - implementation_steps:
    1. Write a test asserting a crafted LLM response attempting to set `sop_matched`/`sop_authority`/`universal_principles`/`grounding_candidates` is stripped/ignored by the existing `schema_validator.ts` path; if it is not, extend the validator (design.md §8 predicts this should already work since the fields are part of `DecisionCore`, so treat any needed code change here as a signal to re-check that assumption before writing it).
    2. Map `sop_clauses_cited` (R5 AC3), `recommended_routes.primary/secondary/excluded` (R5 AC4), and `universal_principles` onto the existing API response assembly, without introducing a new endpoint.
  - acceptance_criteria: R5 AC3, AC4; R8 AC4; R9.7.
  - tests_required: `packages/rag/test/schema_validator.test.ts` (extend); backend API response test asserting the new fields' shape against the design.md §7 JSON example.
  - done_definition: Adversarial-payload test passes; API response for a `sop_matched: false` decision matches the design.md §7 shape.
