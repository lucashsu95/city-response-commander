# Implementation Plan: City Response Commander (智慧交通指揮系統)

Requirements Baseline: AMENDED_BY_HG-001
Design Status: RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW
Task Plan Status: RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW
Implementation Authorization: NOT_AUTHORIZED_PENDING_READ_ONLY_REVIEW
Open Questions: HG-001 resolves OQ-001, OQ-002, and OQ-003 for implementation and partially resolves the time dimension of OQ-005. OQ-004 and OQ-006..OQ-011 remain OPEN / AWAITING_HOST_REPLY.

## HG-001 Organizer Guidance Amendment Record (2026-07-24)

**Authority**: `ORGANIZER_WRITTEN_GUIDANCE`  
**Implementation uniqueness**: `NON_UNIQUE`  
**Selected policy class**: `ORGANIZER_GUIDED_TEAM_POLICY`  
**Runtime official source**: `false`  
**Official SOP amendment**: `false`  
**Seven-source manifest member**: `false`

```text
policy.time_alignment.mode = GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY
policy.affected_road.role = DISPLAY_AND_CONTEXT_ONLY
policy.ete.affected_set = INCIDENT_PRIMARY_AND_SELECTED_SECONDARY
policy.ete.snapshot_mode = COMMON_EXACT_TIMESTAMP
```

OQ-001, OQ-002, and OQ-003 are resolved for implementation by HG-001. OQ-005 is partially resolved for the time dimension only; its station-set scope remains open. OQ-004 and OQ-006..OQ-011 remain open. These organizer-guided policies are deterministic, reproducible, disclosed, and configurable. They are not an eighth official source and do not alter the seven official source hashes.

Golden expectations:
- ACC_001 ETE = 78.6 minutes using 22:00 common snapshot and RD_TPE_002/RD_TPE_004/RD_TPE_005.
- EVT_002 uses the 22:15 BL17 observation for event 22:20; 22:30 is never used; affected_road is context only; ETE not applicable.
- EVT_003 ETE = 41.0 minutes using the 22:30 common snapshot and RD_TPE_007/RD_TPE_011.

## Overview

This plan converts the approved `design.md` (§1–§31, 14 diagrams, P1–P37, canonical `core_hash` §10.11a-1, FIX 1–5) into an ordered, agent-executable set of coding tasks. It is a PLAN ONLY: no production code, no AWS resources, and no deployment are created here.

Authoritative sources (read-only; never modified by any task):
- Technical truth: `design.md` (single source of truth for architecture, data models, IAM, strategies, sequences).
- Requirement IDs: `references/cursor_requirements_baseline.md` (Cursor `REQ-001..032`) and `requirements.md` (Kiro `R1..R17`).

Implementation language (from design, not pseudocode): **TypeScript** is the primary language for the deterministic domain, Lambda handlers, CDK IaC (§4.13), and the React/TS SPA. Property-based tests use **`fast-check`** (TypeScript). Any module authored in **Python** at a package boundary mirrors the same properties with **`Hypothesis`** (§22.2). The TS/Python boundary is fixed in Phase 0 (TASK-002).

Hard invariants enforced by every applicable task:
- Deterministic code owns ALL numeric/boolean truth; Bedrock writes text-only fields and is rejected by `SchemaValidator` if it attempts to overwrite core fields (§9).
- HG-001 resolves OQ-001, OQ-002, and OQ-003 for implementation and partially resolves only the time dimension of OQ-005. OQ-004, OQ-006..OQ-011, and the OQ-005 station-set dimension remain OPEN / AWAITING_HOST_REPLY. Organizer-guided and provisional Strategies remain configurable via `ConfigProvider`; no task may present a team-selected policy as a unique official rule.
- No task requires an LLM to compute a numeric/boolean truth, and no task guesses an undefined official rule (such cases route to Strategy/config + `manual_confirmation_required`).

Task ID scheme: flat, unique, sequential `TASK-001..TASK-180` (TASK-177 `WhatIfFnRole`, TASK-178 deployment-time KB ingestion, TASK-179 Lambda/IAM/Step-Functions final binding, and TASK-180 shared-stack final integration were added during competition-quality remediation; IDs remain unique and contiguous, physically placed in Phase 3). Test work is embedded per task via `tests_required`, and dedicated deterministic test tasks live in Phase 2 (plus cross-cutting tests in later phases). Every task carries a `delivery_class` (see "Competition Quality Principles"); `optional_marker` is retained ONLY on genuine `BONUS_OPTIONAL` tasks and is NOT a general-purpose skip flag — no core/test/security/latency/source-integrity/smoke work is ever waived. Test / security / latency / source-integrity / smoke tasks are `MANDATORY_ACCEPTANCE_GATE` (release-blocking), not optional. `CHECKPOINT` lines are not tasks and are excluded from the dependency graph and matrices.

---

## Competition Quality Principles

This plan is executed to win a live generative-AI hackathon, not merely to clear an MVP bar. Every task is held to a competition-quality floor and is scored against the **four official weighted criteria plus two official bonus criteria** (baseline §4). No task may be simplified, stubbed, mocked-as-final, or degraded to a "temporary"/low-completeness path on the COMPETITION_AWS profile; TODO/placeholder/stub/fake are never an acceptable COMPETITION_AWS deliverable.

The official scoring per the Cursor FINAL baseline §4 is exactly: **four weighted criteria** — (1) 技術可行性／決策邏輯準確性 35%; (2) 商業應用性／國際化與人性化 10%; (3) 主題切合度／儀表板與智慧指揮官 35%; (4) 完成度 20% — plus **two bonus criteria** — Dashboard 外觀直觀性與設計性 +5% and 中英以外語言(日/韓) +5%. **Team creativity/originality is retained and applied as a `TEAM_QUALITY_PRINCIPLE`, NOT an official weighted item.**

- **A. Team creativity / originality principle (`TEAM_QUALITY_PRINCIPLE`, non-official weight)** — Originality of the solution the demo must showcase: the deterministic-truth vs Bedrock-language split, the Decision Fast Path + async enrichment, deterministic What-if recomputation, and the explainable EvidenceTrace. Applied throughout; not one of the four official weighted items.
- **B. Official — Technical feasibility / decision-logic accuracy (技術可行性／決策邏輯準確性, 35%)** — Every SOP numeric/boolean rule is computed deterministically and exactly (art.1 grading, art.2 3-AND qualification, art.3/4/6 triggers, art.7 ETE formula), proven by property/boundary/golden tests. Bedrock never decides a numeric/boolean truth.
- **C. Official — Business applicability / i18n & humanization (商業應用性／國際化與人性化, 10%)** — Multilingual public warnings (zh/en, +ja/ko), one-click publish with audit trail, human-readable reasoning, and `manual_confirmation_required` flows make the system usable by a real command center.
- **D. Official — Theme alignment / dashboard & smart commander (主題切合度／儀表板與智慧指揮官, 35%)** — A real-time Dashboard decision hub with auto-sensing, anomaly popups, route/ETE/evidence display, and a What-if advisor embodies the "smart commander" theme.
- **E. Official — Completeness (完成度, 20%)** — All 32 REQ, all 7 SOP, three official events, three environment profiles, the full deployment lifecycle, and the three official deliverables (proposal deck incl. AWS architecture diagram; live Dashboard URL + recorded video; GitHub source) are delivered and evidenced.
- **F/G. Official bonus (+5% / +5%)** — Dashboard visual/intuitive design (REQ-030) and non-zh/en languages ja/ko (REQ-031). These are the only genuinely optional (`BONUS_OPTIONAL`) scope.

Each task below carries four competition fields — `delivery_class`, `judging_criteria_contribution`, `competition_quality_floor`, and `demo_or_evidence_output` — so the competition value and the non-negotiable quality minimum of every task are explicit. `optional_marker` applies ONLY to genuine `BONUS_OPTIONAL` tasks and is never a general-purpose skip flag. Test/security/latency/source-integrity/smoke tasks are `MANDATORY_ACCEPTANCE_GATE` (release-blocking), not optional.

## Competition Differentiation Matrix

Ten differentiators that make this entry competitive. Each is concrete and provable (implemented + tested + demonstrable), never marketing prose.

| # | Differentiator | Judging criteria | User / business value | Technical proof | Demo evidence | Responsible Task IDs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Deterministic-truth + Bedrock-language separation | B, D, E | Trustworthy, auditable decisions; AI never fabricates numbers | SchemaValidator + IAM `Deny` mechanically block LLM writes to core fields (§9/§18) | Live rejection of an LLM core-overwrite attempt falls back to template; core unchanged | TASK-099, TASK-111, TASK-077, TASK-078, TASK-035, TASK-048, TASK-161 |
| 2 | Official SOP traceability & citation | B, D, E | Every action cites the exact SOP article | `citation_article_set = triggered ∪ applied_formula`; verbatim KB source location (P27) | Report/EvidenceTrace shows art.1/2/7 citations for ACC_001 | TASK-017, TASK-033, TASK-110, TASK-108, TASK-049, TASK-129 |
| 3 | Decision Fast Path + async enrichment | A, B, D | ≤5s initial public warning, ≤60s full update | MARK_CORE_COMMITTED gates `fast_path_ready`; enrichment parallel; Bedrock failure never blocks (§20) | Latency panel shows FastPath ms and 60s end-to-end on the 3 events | TASK-068, TASK-102, TASK-103, TASK-104, TASK-105, TASK-107, TASK-170 |
| 4 | Explainable EvidenceTrace | A, D, E | Commander sees WHY (grading, route exclusions) | EvidenceTrace records values+thresholds+exclusion reasons (P26) | Dashboard reasoning panel + excluded-route reasons | TASK-034, TASK-049, TASK-115, TASK-129 |
| 5 | What-if deterministic recomputation | A, B, D | Safe hypothetical analysis without mutating state | Stage 3 re-runs Rule Engine; `does_not_mutate_state`; ambiguity→`clarification_required` (P28/P35) | Live "BL17=40000" query returns triggered articles + citations, no state change | TASK-136, TASK-137, TASK-138, TASK-139, TASK-140, TASK-142, TASK-141, TASK-177 |
| 6 | Idempotency / execution fencing / stale recovery | B, E | No duplicate decisions/alerts under retries/failures | IdempotencyTable lease + `$$.Execution.Id` fencing + canonical `core_hash` (P33, FIX 1–4) | Failure-injection replay shows one DecisionCore, correct 202/503/409 | TASK-085, TASK-096, TASK-098, TASK-100, TASK-101, TASK-051 |
| 7 | Real-time WebSocket + polling resilience | B, D | Live updates that survive connection loss | WebSocket push + `ready_event_id` dedup + polling fallback (§13/§16.4) | Drop WebSocket in demo; UI shows degraded badge and keeps updating | TASK-070, TASK-122, TASK-123, TASK-133, TASK-158 |
| 8 | Configurable provisional policies | B, E | Host replies switch behavior with zero engine edits | Strategies A–F + config knobs; OQ stays OPEN (§11/§30) | Flip a policy in config; decision changes; provisional badge shown | TASK-006, TASK-020, TASK-026, TASK-029, TASK-030, TASK-031, TASK-032, TASK-057 |
| 9 | Multilingual public warning | C, D | Reaches tourists/roamers; humane alerts | SOP-6 trigger + zh/en(+ja/ko); deterministic template fallback never zh-only (P20/P36) | Alert panel shows multilingual message even with Bedrock down | TASK-030, TASK-114, TASK-117, TASK-046, TASK-050 |
| 10 | Immutable DecisionCore + auditable publication | B, E | Tamper-evident record + accountable one-click publish | DecisionCore `immutable_after_commit`; PublishRecord `audit_trail` (§10.11) | Publish flow shows draft→approved→published with audit trail | TASK-062, TASK-100, TASK-144, TASK-145, TASK-147, TASK-152 |

---

## Phase 0 — Repository & Guardrails

- [ ] TASK-001 Initialize monorepo workspace and folder structure
  - objective: Create the single-repository layout (IaC + application + shared) that all later phases build on, with workspace tooling wired so packages resolve each other.
  - requirements_covered: REQ-025, REQ-032 (DELIVERABLE: single GitHub repo), R-supporting (all)
  - design_sections: §6, §24 (stack split), §25.1 (single repository), §23
  - components: (repository scaffold for all components)
  - files_or_modules_expected: `package.json` (workspaces), `pnpm-workspace.yaml` or `npm` workspaces, `tsconfig.base.json`, `packages/shared-schemas/`, `packages/config/`, `packages/domain/`, `packages/backend/`, `packages/rag/`, `packages/frontend/`, `infra/`, `config/`, `README.md`
  - dependencies: []
  - implementation_steps:
    1. Create root `package.json` declaring workspaces `packages/*` and `infra`.
    2. Add `tsconfig.base.json` with strict mode, path aliases per package.
    3. Create empty package folders with `package.json` + `src/` + `tsconfig.json` for `shared-schemas`, `config`, `domain`, `backend`, `rag`, `frontend`.
    4. Create `infra/` (CDK app root placeholder) and `config/` (env config files placeholder).
    5. Add root scripts: `build`, `test`, `lint`, `typecheck` that fan out to workspaces.
  - acceptance_criteria: `npm install`/`pnpm install` resolves the workspace with no missing-package errors; `npm run typecheck` runs across all packages (even if empty); folder layout matches the listed paths.
  - tests_required: build/typecheck smoke (workspace resolves); no unit tests yet.
  - failure_cases: none runtime; guard against accidental network calls during install.
  - done_definition: Workspace installs and typechecks cleanly; all listed directories exist.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Single-repo workspace resolves and typechecks across all packages (IaC + app + shared) with no missing-package errors; folder layout matches the design; no ad-hoc structure.
  - demo_or_evidence_output: `npm`/`pnpm install` + `npm run typecheck` green across workspaces; directory tree present as listed.

- [ ] TASK-002 Fix TypeScript/Python boundary and shared build conventions
  - objective: Declare TypeScript as the primary language and define the exact, narrow conditions under which a package boundary may be Python, so PBT libraries and toolchains are unambiguous downstream.
  - requirements_covered: REQ-025 (DELIVERABLE), R-supporting (all)
  - design_sections: §4.13, §22.2 (fast-check / Hypothesis)
  - components: (build convention for domain/backend)
  - files_or_modules_expected: `docs/language-boundary.md` (or `CONTRIBUTING.md` section), `packages/domain/package.json`, `tooling/python/pyproject.toml` (only if a Python boundary is declared)
  - dependencies: [TASK-001]
  - implementation_steps:
    1. Record: TS is primary for domain, backend Lambdas, IaC, frontend; `fast-check` is the PBT library.
    2. Define the only allowed Python boundary (a Lambda explicitly authored in Python) and require it to mirror properties with `Hypothesis`.
    3. Add a lint rule / CI check that flags mixed-language modules within a single package.
  - acceptance_criteria: A written, checked-in convention exists; CI check fails if a package mixes TS and Python sources.
  - tests_required: CI convention check (unit-level lint rule test).
  - failure_cases: none runtime.
  - done_definition: Boundary doc committed and enforced by a CI check.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: TS declared primary; `fast-check` the PBT library; the only allowed Python boundary defined and CI-enforced; no mixed-language package.
  - demo_or_evidence_output: Committed language-boundary doc + CI check that fails on a seeded mixed-language fixture.

- [ ] TASK-003 Implement shared-schemas package (types, enums, schema_version)
  - objective: Provide the canonical TypeScript types/enums shared across domain, backend, and frontend so contracts (§10, §12, §13) are defined once.
  - requirements_covered: REQ-001, REQ-011, REQ-012..REQ-022, R1, R13, R14
  - design_sections: §10 (all data models), §12, §13
  - components: shared-schemas (types for DecisionCore/DecisionNarrative/PublishRecord/IdempotencyTable/RouteCandidate/SelectedSnapshot/AffectedRoadContext/ETEResult/EvidenceTrace/PolicyMetadata)
  - files_or_modules_expected: `packages/shared-schemas/src/index.ts`, `.../decision_core.ts`, `.../decision_narrative.ts`, `.../publish_record.ts`, `.../idempotency.ts`, `.../route_candidate.ts`, `.../selected_snapshot.ts`, `.../affected_road_context.ts`, `.../ete.ts`, `.../evidence.ts`, `.../policy_metadata.ts`, `.../enums.ts`
  - dependencies: [TASK-001]
  - implementation_steps:
    1. Encode enums: `narrative_type` (REPORT/PUBLIC_ALERT/EXPLANATION), `IdempotencyTable.status` (starting/running/completed/start_failed/processing_failed), `recovery_stage`, `recovery_mode`, `evidence_source`, `core_write_status`, `status_action_result`.
    2. Encode field-level markers as TS doc tags: `immutable-official`/`normalized`/`derived`/`provisional`/`LLM-writable`/`LLM-prohibited`.
    3. Add `schema_version` constant and `trace_id`/`policy_version` typing.
    4. Export a discriminated union for API/event payloads (§12/§13).
  - acceptance_criteria: All §10 tables have a corresponding exported type; enums match design exactly (5 status values, 3 narrative types); no `LLM-writable` marker on any core numeric field.
  - tests_required: type-level unit tests (compile-time assertions); enum-completeness unit test.
  - failure_cases: reject compilation if an LLM-writable field overlaps a core field name set.
  - done_definition: Package builds; downstream packages can import all model types.
  - provisional_policy_notes: `PolicyMetadata` type carries `classification=PROVISIONAL_TEAM_POLICY`/`status=AWAITING_HOST_REPLY` and all Strategy A–F mode fields as configurable enums (not hard-coded).
  - hg001_amendment:
    - Add `decision_cutoff_timestamp`, `observation_timestamp`, `staleness_minutes`, `selection_mode`, and `guidance_id` to snapshot contracts.
    - Add `AffectedRoadContext` with `role=DISPLAY_AND_CONTEXT_ONLY`, `mandatory_action=false`, and no ETE/article trigger authority.
    - Add ETE common-snapshot status, affected road roles, per-road inputs, lower bound, and manual-confirmation fields.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Every §10 data model has an exported type; enums match design exactly (5 status values, 3 narrative_type values); no `LLM-writable` marker on any core numeric/boolean field.
  - demo_or_evidence_output: Package builds; type-level + enum-completeness tests green; downstream packages import all model types.

- [ ] TASK-004 Implement ConfigProvider interface and LocalFileConfigProvider
  - objective: Provide the single entry point for configuration (`get`/`getAll`) with the offline local implementation so LOCAL_MOCK runs with zero AWS calls (§23.1).
  - requirements_covered: REQ-024 (DELIVERABLE hosting config), R-supporting (all)
  - design_sections: §23.1, §4.12
  - components: ConfigProvider, LocalFileConfigProvider
  - files_or_modules_expected: `packages/config/src/config_provider.ts` (interface), `packages/config/src/local_file_config_provider.ts`, `config/config.local.yaml`
  - dependencies: [TASK-001]
  - implementation_steps:
    1. Define `ConfigProvider.get(key)` and `getAll(prefix)` returning the shared schema keys.
    2. Implement `LocalFileConfigProvider` reading `config.local.yaml` + env overrides.
    3. Seed `config.local.yaml` with all configurable keys (see TASK-006) using safe local defaults.
  - acceptance_criteria: `LocalFileConfigProvider.get`/`getAll` returns typed values offline; no AWS SDK import in the local provider path.
  - tests_required: unit tests for key resolution, prefix listing, env override precedence; test proving no network access.
  - failure_cases: missing key → typed error (not silent default for required keys); malformed YAML → explicit load error.
  - done_definition: Local provider fully resolves the config schema offline.
  - provisional_policy_notes: Exposes `policy.*` knobs for Strategies A–F and OQ items; defaults are provisional and overridable.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: No secrets in YAML; secrets go to Secrets Manager (TASK-083). Local file must not contain credentials.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `LocalFileConfigProvider` resolves the full config schema fully offline (zero AWS SDK on the local path); a missing required key yields a typed error, never a silent default.
  - demo_or_evidence_output: Unit tests for key resolution, prefix listing, env-override precedence + a test proving no network access.

- [ ] TASK-005 Implement SsmConfigProvider and environment profile selection
  - objective: Provide the AWS-backed configuration implementation and the mechanism that selects LOCAL_MOCK / PERSONAL_AWS_DEV / COMPETITION_AWS, sharing one schema across all three (§23).
  - requirements_covered: REQ-024 (DELIVERABLE), R-supporting (all)
  - design_sections: §23, §23.1, §4.12
  - components: SsmConfigProvider, environment profile resolver
  - files_or_modules_expected: `packages/config/src/ssm_config_provider.ts`, `packages/config/src/provider_factory.ts`
  - dependencies: [TASK-004]
  - implementation_steps:
    1. Implement `SsmConfigProvider` reading SSM Parameter Store by key prefix.
    2. Implement `provider_factory` that returns `LocalFileConfigProvider` for LOCAL_MOCK and `SsmConfigProvider` for the two AWS profiles based on `env`/`config.provider`.
    3. Ensure identical key schema across providers.
  - acceptance_criteria: Factory returns the correct provider per profile; both providers satisfy the same interface and key set.
  - tests_required: unit tests with a mocked SSM client; contract test that both providers expose identical keys.
  - failure_cases: SSM unavailable → fail-closed typed error (no silent fallback to hard-coded values); missing required parameter → explicit error.
  - done_definition: Provider selection works for all three profiles behind one interface.
  - provisional_policy_notes: `policy.*` knobs resolvable from SSM in AWS profiles; switching a Strategy is a config change only.
  - aws_services_touched: SSM Parameter Store (client only; no resource creation here)
  - security_or_iam_notes: Read-only SSM access; no credentials in code; secrets never read via this path.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Both providers satisfy one interface and identical key set; SSM unavailable → fail-closed typed error (no silent fallback to hard-coded values); correct provider selected per profile.
  - demo_or_evidence_output: Unit tests with a mocked SSM client + a contract test proving both providers expose identical keys.

- [ ] TASK-006 Define configuration schema keys and provisional policy knobs
  - objective: Enumerate every configurable key (endpoints, model IDs, buckets, feature flags, and all `policy.*` Strategy/OQ knobs including HG-001 selected defaults) so provisional policies stay switchable without touching the Rule Engine (§30).
  - requirements_covered: R-supporting (all), REQ-005/013/016/018/019/022 (policy-dependent behavior)
  - design_sections: §23.1 (configurable keys), §11 (Strategies A–F), §30
  - components: config schema definition
  - files_or_modules_expected: `packages/config/src/config_schema.ts`, `config/config.local.yaml` (populated)
  - dependencies: [TASK-004]
  - implementation_steps:
    1. Declare infra keys: `env`, `bedrock.region`, `bedrock.model_id`, `bedrock.model_id_fallbacks`, `bedrock.embedding_model_id`, `kb.knowledge_base_id`, `s3.*`, `api.endpoint`, `ws.endpoint`, `auth.user_pool_id`, `observability.xray_enabled`, `orchestration.mode`, `enrichment.fanout`, `frontend.hosting`, `config.provider`.
    2. Declare policy knobs: `policy.time_alignment.*` (A), `policy.affected_road.role` (B), `policy.ete.affected_set` (C), `policy.incident_anchor.mode` (D), `policy.affected_intersection_scope.mode` (E), `policy.multilingual_scope.mode` (F).
    3. Provide typed validation for each key and default provisional values.
  - acceptance_criteria: Every key in §23.1 is present and typed; each Strategy A–F has a mode key with ≥2 allowed values; defaults are marked provisional.
  - tests_required: schema-completeness unit test cross-checking §23.1 key list; validation tests for enum bounds.
  - failure_cases: unknown/mis-typed key → validation error; out-of-enum policy mode → rejected.
  - done_definition: Config schema enumerates all keys and enforces types.
  - provisional_policy_notes: This task is the central registry that keeps OQ-001..005/010 (Strategies A–F) and OQ-006/007/008/009/011 configurable; no default is presented as official.
  - hg001_amendment:
    - Set active defaults: `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY`, `DISPLAY_AND_CONTEXT_ONLY`, `INCIDENT_PRIMARY_AND_SELECTED_SECONDARY`, and `COMMON_EXACT_TIMESTAMP`.
    - Classify selected HG-001 values as `ORGANIZER_GUIDED_TEAM_POLICY`, `configurable=true`, `guidance_id=HG-001`.
    - Keep OQ-005 station-set scope and OQ-004/OQ-006..OQ-011 configurable/open.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Secret-typed keys are referenced by name only, resolved via Secrets Manager, never inlined.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: Every §23.1 key present and typed; each Strategy A–F has a mode key with ≥2 allowed values; provisional defaults never presented as official; central registry keeps OQ-001..011 policies switchable via config only.
  - demo_or_evidence_output: Schema-completeness test cross-checking the §23.1 key list + enum-bound validation tests.

- [ ] TASK-007 Implement OfficialSourceManifest, SHA-256 verifier, and 7-source STOP gate
  - objective: Compute and verify SHA-256 for the seven official sources at load/boot and STOP the decision pipeline on any mismatch, never using an unknown version silently (§10.0, §15, §21).
  - requirements_covered: REQ-032, R1 (authoritative read), REQ-001
  - design_sections: §10.0, §10.0a, §10.0b (7 expected hashes), §15, §21 (source hash verification)
  - components: OfficialSourceManifest, SubmissionProvenanceManifest, RuntimeDecisionSourceManifest
  - files_or_modules_expected: `packages/domain/src/source_manifest/official_source_manifest.ts`, `.../hash_verifier.ts`, `.../manifest_gate.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Encode the seven expected UPPERCASE SHA-256 values and `source_type` enum from §10.0b (PDF/DOCX/2 CSV/2 JSON/1 SOP txt).
    2. Implement SHA-256 computation and comparison producing `validation_status` (verified/hash_mismatch/missing/unreadable).
    3. Implement the STOP gate: any `validation_status != verified` aborts decisioning and reports; expose `source_manifest_hash` for DecisionCore.
    4. Distinguish the 5-file `RuntimeDecisionSourceManifest` from the 7-source `SubmissionProvenanceManifest`.
  - acceptance_criteria: Correct hashes → all `verified`; any altered byte → `hash_mismatch` and STOP; the manifest lists exactly 7 official sources (命題解說 = DOCX only, PDF = 命題文件 only).
  - tests_required: unit tests for verified/mismatch/missing/unreadable; STOP-gate test (mismatch aborts) — see Phase 2 TASK-056.
  - failure_cases: official data load failure / hash mismatch → `data_status=insufficient_data`, STOP, no fabrication (§21).
  - done_definition: Verifier + STOP gate operate on the 7 sources and expose `source_manifest_hash`.
  - provisional_policy_notes: none (hashes are official fact)
  - aws_services_touched: none (pure domain; S3 read wiring added in Phase 3/parsers)
  - security_or_iam_notes: Read-only; do not log file contents; reference sources by filename not content.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: 7 official sources with exact UPPERCASE SHA-256; any mismatch/missing/unreadable → STOP decisioning (never silently use an unknown version); 5-file runtime vs 7-source provenance distinguished; 命題解說 = DOCX only, PDF = 命題文件 only.
  - demo_or_evidence_output: Unit tests (verified/mismatch/missing/unreadable) + STOP-gate abort test (TASK-056); `source_manifest_hash` exposed to DecisionCore.

- [ ] TASK-008 Implement DerivedArtifactManifest (mirrors are NOT source of truth)
  - objective: Register `.md`/`docx_extracted.txt` mirrors as `derived_searchable_mirror` in a separate manifest so they can never substitute for the official PDF/DOCX/SOP/CSV/JSON (§10.0c).
  - requirements_covered: REQ-032, R1
  - design_sections: §10.0c
  - components: DerivedArtifactManifest
  - files_or_modules_expected: `packages/domain/src/source_manifest/derived_artifact_manifest.ts`
  - dependencies: [TASK-007]
  - implementation_steps:
    1. Model `derived_filename`, `artifact_type=derived_searchable_mirror`, `derived_from`, `is_source_of_truth=false`, `sha256`.
    2. Assert `derived_searchable_mirror` is NOT a valid `OfficialSourceManifest.source_type`.
    3. Prevent any decision-path code from reading a derived mirror as authority.
  - acceptance_criteria: Mirrors register here only; a compile/lint guard blocks importing derived mirrors into the decision path.
  - tests_required: unit test asserting mirror rejection from official manifest; guard test.
  - failure_cases: attempt to treat a mirror as official → rejected.
  - done_definition: Derived manifest isolated from official manifest.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Mirrors registered only as `derived_searchable_mirror`; `derived_searchable_mirror` is never a valid `OfficialSourceManifest.source_type`; the decision path cannot read a mirror as authority.
  - demo_or_evidence_output: Unit test asserting mirror rejection from the official manifest + a compile/lint guard test blocking mirror imports into the decision path.

- [ ] TASK-009 Set up lint and format tooling
  - objective: Establish consistent linting/formatting across all packages to keep the deterministic/Bedrock boundary and naming conventions enforceable.
  - requirements_covered: REQ-025 (DELIVERABLE quality)
  - design_sections: §22 (test architecture support)
  - components: (repo tooling)
  - files_or_modules_expected: `.eslintrc.cjs`, `.prettierrc`, `eslint-local-rules/` (custom rule for LLM-prohibited fields)
  - dependencies: [TASK-001]
  - implementation_steps:
    1. Configure ESLint + Prettier for TS.
    2. Add a custom lint rule flagging writes to `LLM-prohibited` fields from renderer modules.
    3. Wire `npm run lint` at root.
  - acceptance_criteria: Lint runs repo-wide; custom rule triggers on a renderer writing a core field fixture.
  - tests_required: lint-rule unit test (positive/negative fixtures).
  - failure_cases: none runtime.
  - done_definition: Lint/format pass on the scaffold.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Repo-wide lint/format; a custom rule mechanically flags any renderer write to an `LLM-prohibited` core field (§9 boundary guard); not skippable.
  - demo_or_evidence_output: Lint runs repo-wide; custom-rule unit test triggers on a renderer-writing-a-core-field fixture (positive/negative).

- [ ] TASK-010 Set up test frameworks (fast-check for TS, Hypothesis for Python)
  - objective: Install and configure the PBT and unit-test frameworks so §22.1 properties run with ≥100 iterations and the required labels.
  - requirements_covered: R-supporting (all), REQ-032
  - design_sections: §22.1, §22.2
  - components: (test harness)
  - files_or_modules_expected: `vitest.config.ts` (or `jest.config.js`), `packages/*/test/`, `tooling/python/conftest.py` (only if Python boundary exists)
  - dependencies: [TASK-001, TASK-002]
  - implementation_steps:
    1. Configure the TS test runner + `fast-check`; set default `numRuns >= 100`.
    2. Add a helper that stamps the label `Feature: city-response-commander, Property {n}: {text}` on each property test.
    3. If a Python boundary exists, configure `Hypothesis` with equivalent settings.
  - acceptance_criteria: A sample property test runs ≥100 iterations and emits the label; test command works at root.
  - tests_required: harness self-test (sample property).
  - failure_cases: none runtime.
  - done_definition: PBT + unit frameworks operational.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: PBT + unit frameworks operational; default `numRuns >= 100`; a label helper stamps `Feature: city-response-commander, Property {n}: {text}` on every property test; no framework built from scratch.
  - demo_or_evidence_output: A sample property test runs ≥100 iterations and emits the required label; root test command works.

- [ ] TASK-011 Establish CI skeleton (LOCAL_MOCK full deterministic run, no credentials)
  - objective: Create CI that runs all deterministic unit/property/golden tests in LOCAL_MOCK with no AWS calls and no credentials in the repo (§22.3, §23).
  - requirements_covered: REQ-025, REQ-032 (DELIVERABLE)
  - design_sections: §22.3, §23, §23.1
  - components: (CI pipeline)
  - files_or_modules_expected: `.github/workflows/ci.yml` (or provider equivalent)
  - dependencies: [TASK-009, TASK-010]
  - implementation_steps:
    1. Add CI stages: install, typecheck, lint, test (LOCAL_MOCK).
    2. Force `env=LOCAL_MOCK` and a Mock Bedrock adapter; assert no AWS SDK network calls in unit/property jobs.
    3. Add a secret-scan step that fails on committed credentials.
  - acceptance_criteria: CI runs green on the scaffold; deterministic test job requires no AWS credentials.
  - tests_required: CI dry-run; secret-scan on a seeded fixture.
  - failure_cases: any AWS call in the deterministic job → CI failure.
  - done_definition: CI pipeline runs the deterministic suite offline.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain in CI)
  - security_or_iam_notes: No credentials in repo; secret-scan enforced.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: CI runs the full deterministic unit/property/golden suite in LOCAL_MOCK with zero AWS calls and no credentials; a secret-scan step fails on committed credentials; any AWS call in the deterministic job fails CI.
  - demo_or_evidence_output: Green CI on the scaffold; deterministic test job requires no AWS credentials; secret-scan on a seeded fixture.

- [ ] TASK-012 Enforce no-credentials-in-repo guard and .gitignore hygiene
  - objective: Prevent secrets/artifacts from entering the repository and codify the "no hard-coded account/region/keys" rule (§17, §23).
  - requirements_covered: REQ-025 (DELIVERABLE), R-supporting (security)
  - design_sections: §17, §23, §4.12
  - components: (repo hygiene)
  - files_or_modules_expected: `.gitignore`, `.git-secrets` config (or pre-commit hook), `docs/security-notes.md`
  - dependencies: [TASK-001]
  - implementation_steps:
    1. Ignore build outputs, `.env`, local credentials, CDK `cdk.out`.
    2. Add a pre-commit/secret-scan hook rejecting key-like strings.
    3. Document that account/region/model IDs come only from ConfigProvider.
  - acceptance_criteria: Seeded fake key is blocked by the hook; no account/region literals in source.
  - tests_required: hook unit test on positive/negative fixtures.
  - failure_cases: credential commit attempt → blocked.
  - done_definition: Hygiene guard active.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Core of secrets hygiene; complements Secrets Manager (TASK-083).
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Pre-commit/secret-scan blocks key-like strings; no account/region/key literals in source; account/region/model IDs come only from `ConfigProvider`.
  - demo_or_evidence_output: Seeded fake key blocked by the hook; hook unit test on positive/negative fixtures.

CHECKPOINT A (not a task): Ensure all Phase 0 tests pass, ask the user if questions arise.

---

## Phase 1 — Deterministic Domain Core (no Bedrock)

- [ ] TASK-013 Parse city_traffic_flow.csv into RawTrafficRecord
  - objective: Read the traffic CSV read-only into typed `RawTrafficRecord`, preserving official fields exactly (§10.1).
  - requirements_covered: REQ-001, REQ-011, R1
  - design_sections: §10.1, §15.1, §3.1
  - components: DataIngestionService (traffic parser)
  - files_or_modules_expected: `packages/domain/src/ingestion/traffic_parser.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Parse rows to `{timestamp_raw, Segment_ID, Road_Name, Avg_Speed, Vehicle_Count, Saturation_Score, Lane_Status}`.
    2. Keep `timestamp_raw` verbatim (never overwrite); defer normalization to TASK-018.
    3. Validate types and required columns; reject on schema mismatch (no fabrication).
  - acceptance_criteria: All 15 segments parse; `Saturation_Score` is a number in 0..1; `timestamp_raw` byte-identical to source.
  - tests_required: unit (well-formed + malformed rows); feeds P2 (immutability) / P34 (timestamp) in Phase 2.
  - failure_cases: official data load failure / schema invalid → `insufficient_data`, abort (§21).
  - done_definition: Traffic CSV parses into typed records read-only.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain; S3 fetch wired later)
  - security_or_iam_notes: Read-only source; never mutate input.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Read-only parse of all 15 segments; `Saturation_Score` a number in 0..1; `timestamp_raw` byte-identical to source; schema mismatch aborts (`insufficient_data`) — no fabrication, no dropped rows.
  - demo_or_evidence_output: Unit tests (well-formed + malformed rows); typed `RawTrafficRecord[]` for 15 segments; feeds P2/P34.

- [ ] TASK-014 Parse signaling_crowd_density.csv and implement PercentParser
  - objective: Read the crowd CSV into `RawCrowdRecord` and parse `Roaming_User_Pct` strings to `roaming_pct_value` (e.g., "30%"→0.30) (§10.2, R1.3).
  - requirements_covered: REQ-001, REQ-010, REQ-019, R1
  - design_sections: §10.2, §8 (PercentParser), §3.1
  - components: DataIngestionService (crowd parser), PercentParser
  - files_or_modules_expected: `packages/domain/src/ingestion/crowd_parser.ts`, `packages/domain/src/ingestion/percent_parser.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Parse `{timestamp_raw, BS_ID, Location_Name, User_Count, Stay_Time_Avg, Growth_Rate, Roaming_User_Pct}`.
    2. Implement `PercentParser.parse("30%") === 0.30`; store as `roaming_pct_value` (normalized), keep original string immutable.
    3. Validate ranges (User_Count int, Growth_Rate number).
  - acceptance_criteria: `roaming_pct_value` correct for "5%"/"30%"/"45%"; original `Roaming_User_Pct` unchanged.
  - tests_required: unit + feeds P1 (round-trip) in Phase 2.
  - failure_cases: unparseable percent → typed error, no fabrication.
  - done_definition: Crowd CSV + percent parsing produce typed records.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Read-only source.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `roaming_pct_value` exact for "5%"/"30%"/"45%"; original `Roaming_User_Pct` immutable; `User_Count` int / `Growth_Rate` number validated; unparseable percent → typed error, no fabrication.
  - demo_or_evidence_output: Unit tests + feeds P1 (percent round-trip).

- [ ] TASK-015 Parse road_network_geometry.json into RoadSegment and load RoadNetworkModel
  - objective: Read the road network JSON into `RoadSegment` records and load them into `RoadNetworkModel` (§10.3, R7).
  - requirements_covered: REQ-026, REQ-027, REQ-028, R7
  - design_sections: §10.3, §9.4 (geometry), §15.1
  - components: DataIngestionService (road parser), RoadNetworkModel (load)
  - files_or_modules_expected: `packages/domain/src/ingestion/road_network_parser.ts`, `packages/domain/src/road_network/road_network_model.ts` (load path)
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Parse `{segment_id, name, flow_direction, intersections[], capacity_vph, alternatives[], nearby_stations[]}`.
    2. Preserve `intersections` order (upstream→downstream) and `alternatives` order verbatim.
    3. Treat empty `nearby_stations` as a valid empty set (do not fill).
  - acceptance_criteria: Segments load with array order preserved; empty `nearby_stations` remains empty.
  - tests_required: unit + feeds P13/P14/P15 in Phase 2.
  - failure_cases: malformed geometry → abort, no fabrication.
  - done_definition: Road network parsed and loaded, order-preserving.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Read-only source.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `intersections` order (upstream→downstream) and `alternatives` order preserved verbatim; empty `nearby_stations` kept empty (never filled); malformed geometry → abort, no fabrication.
  - demo_or_evidence_output: Unit tests (order-preserving, empty nearby) + feeds P13/P14/P15.

- [ ] TASK-016 Parse live_incidents.json into Incident
  - objective: Read incidents JSON into typed `Incident` records including optional `affected_road` (only EVT_002) (§10.4).
  - requirements_covered: REQ-003, REQ-012, REQ-016, R5, R6
  - design_sections: §10.4, §3.1
  - components: DataIngestionService (incident parser)
  - files_or_modules_expected: `packages/domain/src/ingestion/incident_parser.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Parse `{event_id, type, location, affected_segment, affected_road?, status, severity, description, timestamp}`.
    2. Keep `affected_road` optional; do not infer semantics here (deferred to Strategy B).
    3. Validate `severity ∈ {Critical,High,Medium}`.
  - acceptance_criteria: The three official events parse; `affected_road` present only where provided.
  - tests_required: unit for ACC_001/EVT_002/EVT_003 shapes.
  - failure_cases: unknown severity → typed error.
  - done_definition: Incidents parse into typed records.
  - provisional_policy_notes: `affected_road` role deferred to Strategy B (OQ-002); not interpreted here.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Read-only source.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: The three official events parse; `affected_road` present only where provided (EVT_002), semantics deferred to Strategy B (not interpreted here); `severity ∈ {Critical,High,Medium}`; unknown severity → typed error.
  - demo_or_evidence_output: Unit tests for ACC_001/EVT_002/EVT_003 shapes.

- [ ] TASK-017 Load emergency_traffic_sop.txt with article chunking metadata
  - objective: Load the 7-article SOP text and split it per article (article_no metadata) to support precise citation and S3 fallback retrieval (§14.1).
  - requirements_covered: REQ-005, REQ-020, R5, R12
  - design_sections: §14.1, §3.1, §10.0b
  - components: DataIngestionService (SOP loader)
  - files_or_modules_expected: `packages/domain/src/ingestion/sop_loader.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Load SOP text read-only; split into 7 article chunks with `article_no`.
    2. Preserve verbatim text per article for citation source location.
    3. Expose a lookup by `article_no` (used by KB fallback in Phase 6).
  - acceptance_criteria: Exactly 7 article chunks with correct `article_no`; text preserved verbatim.
  - tests_required: unit (7 chunks, verbatim); feeds RAG citation tests (Phase 6).
  - failure_cases: article count != 7 → abort/flag.
  - done_definition: SOP loaded and chunked per article.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain; S3/KB wiring later)
  - security_or_iam_notes: Read-only source.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Exactly 7 article chunks with correct `article_no`; verbatim text preserved for citation source location; lookup by `article_no` for the KB S3 fallback; article count != 7 → abort/flag.
  - demo_or_evidence_output: Unit test (7 chunks, verbatim) + feeds RAG citation tests (Phase 6).

- [ ] TASK-018 Implement timestamp normalization (raw immutable, normalized, display)
  - objective: Produce `timestamp_normalized` (for comparison) and `timestamp_display` (`YYYY-MM-DD HH:MM`) while `timestamp_raw` is never overwritten (§10.1/§10.2, R11.5).
  - requirements_covered: REQ-019, R1, R11
  - design_sections: §10.1, §10.2, §9.4 (art.6 format)
  - components: DataIngestionService (timestamp normalizer)
  - files_or_modules_expected: `packages/domain/src/ingestion/timestamp_normalizer.ts`
  - dependencies: [TASK-013, TASK-014]
  - implementation_steps:
    1. Parse formats incl. `2026/5/20 22:10` (no zero-pad, slash) into a normalized instant.
    2. Derive `timestamp_display` = `YYYY-MM-DD HH:MM`.
    3. Guarantee `timestamp_raw` remains byte-identical (add a normalized field, never mutate raw).
  - acceptance_criteria: `timestamp_display` always `YYYY-MM-DD HH:MM`; `timestamp_normalized` denotes the same instant as raw; raw unchanged.
  - tests_required: unit + P34 / P21 in Phase 2.
  - failure_cases: unparseable timestamp → typed error, no guessing.
  - done_definition: Normalization produces derived fields without touching raw.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `timestamp_display` always `YYYY-MM-DD HH:MM`; `timestamp_normalized` denotes the same instant as raw; `timestamp_raw` never overwritten; unparseable timestamp → typed error, no guessing.
  - demo_or_evidence_output: Unit tests + feeds P34/P21.

- [ ] TASK-019 Implement DataIngestionService orchestration (load + verify + read-only)
  - objective: Compose the five parsers with the manifest STOP gate into one read-only ingestion entry point (§8, §15.1, Figure 4).
  - requirements_covered: REQ-001, REQ-032, R1
  - design_sections: §8, §15.1, §10.0, Figure 4
  - components: DataIngestionService
  - files_or_modules_expected: `packages/domain/src/ingestion/data_ingestion_service.ts`
  - dependencies: [TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-007]
  - implementation_steps:
    1. Verify the 5 runtime sources via the manifest gate (TASK-007) before parsing; STOP on mismatch.
    2. Load all 5 files, normalize timestamps, and expose an immutable in-memory model.
    3. Surface `data_status` and `source_manifest_hash`.
  - acceptance_criteria: On verified sources, all datasets load; on mismatch, ingestion STOPs with `insufficient_data`.
  - tests_required: unit + P2 (immutability); STOP integration in TASK-056.
  - failure_cases: any source unverified/unreadable → abort (§21).
  - done_definition: One read-only ingestion service gated by manifest verification.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain; S3 read abstracted behind a port)
  - security_or_iam_notes: Read-only; no mutation of inputs.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Five parsers composed behind the manifest STOP gate into one read-only ingestion entry point; load failure / hash mismatch → `insufficient_data`, no fabrication; official data never mutated.
  - demo_or_evidence_output: Orchestration unit tests + STOP-gate integration (feeds P2 read-only invariance).

- [ ] TASK-020 Implement SnapshotSelector (Strategy A / TimeAlignmentStrategy)
  - objective: Implement HG-001 event-cutoff/latest-prior selection per entity, never using future rows, while exposing observation timestamp, staleness, provenance, and insufficient-data behavior.
  - requirements_covered: REQ-001, REQ-004, REQ-009, R1
  - design_sections: §11.1, §10.5, §8
  - components: SnapshotSelector, TimeAlignmentStrategy (A)
  - files_or_modules_expected: `packages/domain/src/strategies/time_alignment_strategy.ts`, `packages/domain/src/snapshot/snapshot_selector.ts`
  - dependencies: [TASK-019, TASK-006]
  - implementation_steps:
    1. Set `decision_cutoff_timestamp = event.timestamp`.
    2. For each required entity, select the latest row whose `Timestamp <= decision_cutoff_timestamp`; an exact row is naturally selected when present.
    3. Take all fields for one entity from the same selected row.
    4. Persist `entity_id`, cutoff, `observation_timestamp`, `exact_match`, `staleness_minutes`, `selection_mode`, `data_status`, and `guidance_id=HG-001`.
    5. Never use future, nearest-future, interpolated, or fabricated data.
    6. If no prior row exists, return `INSUFFICIENT_DATA` and `manual_confirmation_required=true`.
  - acceptance_criteria: Active mode is `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY`; all components share one logical event cutoff; no selected row is after cutoff; same-entity fields are from one row; missing prior data fails closed.
  - tests_required: unit + P3 in Phase 2; policy-switch test (TASK-057).
  - failure_cases: no legal prior row → `INSUFFICIENT_DATA`; never fall forward to a post-event row.
  - done_definition: Strategy A selects reproducible as-of snapshots and exposes full timing evidence.
  - provisional_policy_notes: OQ-001 is `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE`; the selected policy remains configurable because HG-001 is NON_UNIQUE.
  - hg001_amendment:
    - ETE uses TASK-031 common-exact-timestamp selection rather than mixed latest-prior road timestamps.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Latest-prior per entity, no future data, same-row fields, explicit staleness/provenance, fail-closed missing data.
  - demo_or_evidence_output: P3 evidence showing event cutoff, observation timestamps, staleness, and rejection of future rows.

- [ ] TASK-021 Implement RoadNetworkModel semantics (one-way alternatives, empty nearby, upstream/downstream)
  - objective: Provide geometry query methods honoring one-way `alternatives`, empty `nearby_stations` as normal, and `intersections` upstream→downstream ordering with `flow_direction` (§9.4, R7).
  - requirements_covered: REQ-026, REQ-027, REQ-028, R7
  - design_sections: §10.3, §9.4, §11.5 (used by anchor)
  - components: RoadNetworkModel
  - files_or_modules_expected: `packages/domain/src/road_network/road_network_model.ts` (query methods)
  - dependencies: [TASK-015]
  - implementation_steps:
    1. `alternativesOf(segment)` returns only that segment's own list (no symmetric inference, no symmetric graph search).
    2. `nearbyStations(segment)` returns the exact set (empty stays empty).
    3. `positionRelativeToAnchor(segment, anchorIntersection)` uses `intersections` order + `flow_direction` to classify upstream/downstream.
  - acceptance_criteria: A listing B in alternatives never implies B→A; empty nearby preserved; upstream/downstream matches array order.
  - tests_required: unit + P13/P14/P15 in Phase 2.
  - failure_cases: intersection label not resolvable to a segment_id → surfaced for OQ-006 handling (no invention).
  - done_definition: Geometry semantics implemented exactly per official field definitions.
  - provisional_policy_notes: OQ-006 (intersection label without segment_id) handled as PARTIALLY_DEFINED: labels used only for ordering/display, never invented capacity/attributes; behavior flagged configurable.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `alternatives` one-way (never assume B→A, no symmetric graph search); empty `nearby_stations` kept as empty set; upstream/downstream from `intersections` order + `flow_direction`.
  - demo_or_evidence_output: Feeds P13/P14/P15.

- [ ] TASK-022 Implement ClassificationEngine (A/B grading)
  - objective: Grade every segment A iff `>=0.95`, B iff `0.85<=score<0.95`, else neither, applied identically to all 15 segments (§9.4 art.1, R2).
  - requirements_covered: REQ-011, R2
  - design_sections: §9.4 (art.1 grading), §10.11a (classifications)
  - components: ClassificationEngine
  - files_or_modules_expected: `packages/domain/src/rule_engine/classification_engine.ts`
  - dependencies: [TASK-020]
  - implementation_steps:
    1. Implement boundary-exact grading (0.85 inclusive B, 0.95 inclusive A).
    2. Produce `classifications: {segment_id, level}[]` for all segments.
  - acceptance_criteria: Boundary values map exactly (0.85→B, 0.9499→B, 0.95→A); consistent for all 15 segments.
  - tests_required: unit boundary + P4 in Phase 2.
  - failure_cases: missing saturation → `insufficient_data` for that segment (no guess).
  - done_definition: Deterministic A/B grading implemented.
  - provisional_policy_notes: none (official thresholds)
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: A iff `Saturation>=0.95`; B iff `0.85<=score<0.95`; else non-A/B; consistent across all 15 segments; exact official boundaries (no drift, no rounding shortcuts).
  - demo_or_evidence_output: Feeds P4; boundary tests (TASK-052) at 0.8499/0.85/0.9499/0.95.

- [ ] TASK-023 Implement RuleEngine article1 (trigger segments, measures, invoked_procedures)
  - objective: Encode SOP-1 measures for RD_TPE_001/002 (B-level actions; A-level additionally invokes `article2_alternative_route_guidance` recorded in `invoked_procedures`), keeping A-level alone from adding art.2 to `triggered_articles` (§9.4 art.1, R3).
  - requirements_covered: REQ-011, R3
  - design_sections: §9.4 (art.1), §10.11a (art1_measures/invoked_procedures)
  - components: RuleEngine.article1
  - files_or_modules_expected: `packages/domain/src/rule_engine/article1.ts`
  - dependencies: [TASK-022]
  - implementation_steps:
    1. For {RD_TPE_001, RD_TPE_002}: B → long-green timing + alternatives green +25% + clear intersections.
    2. A → additionally set `invoked_procedures += article2_alternative_route_guidance` and `art1_measures.a_level_invokes_article2_alternative_route_guidance=true`.
    3. Ensure A-level alone does NOT add 2 to `triggered_articles`.
  - acceptance_criteria: B/A measures correct; A-level records the guidance procedure without asserting art.2 incident trigger.
  - tests_required: unit + P5 in Phase 2.
  - failure_cases: none numeric guessing (uses graded input only).
  - done_definition: Article 1 measures + invoked_procedures encoded.
  - provisional_policy_notes: none (official)
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: RD_TPE_001/002 — B → long-green timing + that segment's alternatives green +25% + clear intersections; A additionally INVOKES `article2_alternative_route_guidance` (recorded in `invoked_procedures`); A alone does NOT put 2 in `triggered_articles` (art.2 trigger requires its own 3 conditions).
  - demo_or_evidence_output: Feeds P5; ACC_001 golden (invoked_procedures + art.1 measures).

- [ ] TASK-024 Implement RuleEngine article2 trigger and candidate qualification (3-AND)
  - objective: Encode SOP-2 trigger (status∈{Closed,Blocked,Restricted} AND severity∈{High,Critical} AND affected_segment starts with RD_) and candidate qualification as exactly three ANDs (capacity>=1000, direct intersection, upstream), with Saturation NOT a filter (§9.4 art.2, R6).
  - requirements_covered: REQ-012, REQ-013, R6
  - design_sections: §9.4 (art.2), §10.8 (RouteCandidate)
  - components: RuleEngine.article2
  - files_or_modules_expected: `packages/domain/src/rule_engine/article2.ts`
  - dependencies: [TASK-021]
  - implementation_steps:
    1. Implement the 3-AND trigger; BS_ routes to art.3 (not art.2).
    2. For each alternative, compute `passes_capacity`, `is_direct_intersection`, `upstream_or_downstream` (upstream requires anchor from Strategy D).
    3. Qualification = the three ANDs only; `saturation_at_snapshot` is recorded but excluded from qualification.
  - acceptance_criteria: Trigger matches 3-AND exactly; qualification uses only the three ANDs; capacity boundary 999 fail / 1000 pass.
  - tests_required: unit + P8/P9 in Phase 2; boundary (TASK-052).
  - failure_cases: BS_ event → not art.2 (route to art.3); no fourth saturation filter.
  - done_definition: Article 2 trigger + qualification encoded.
  - provisional_policy_notes: Saturation-vs-congestion precedence is OQ-008 (PARTIALLY_DEFINED); this task must NOT turn Saturation into a fourth hard filter; behavior stays per §11.7 config.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: art.2 triggers iff `status∈{Closed,Blocked,Restricted}` AND `severity∈{High,Critical}` AND `affected_segment` starts `RD_`; candidate qualification is EXACTLY 3 AND (`capacity_vph>=1000`, direct intersection, upstream); Saturation is NEVER a 4th hard filter; `BS_` routes to art.3.
  - demo_or_evidence_output: Feeds P8/P9; ACC_001 golden; TC-SOP2 capacity boundary (999/1000).

- [ ] TASK-025 Implement EvacuationSelector (lowest-saturation primary, downstream secondary, congested-maintain, no-candidate)
  - objective: Among qualified candidates pick the lowest `Saturation_Score` as primary, list downstream intersecting arterials as secondary, maintain a congested primary (>=0.85) with long-green + public-transit note, and record "查無合規替代路段" when none qualify (§9.4 art.2, §11.7, R6).
  - requirements_covered: REQ-013, REQ-014, REQ-005, R5, R6
  - design_sections: §9.4 (art.2), §11.7 (OQ-008), §10.8
  - components: EvacuationSelector
  - files_or_modules_expected: `packages/domain/src/rule_engine/evacuation_selector.ts`
  - dependencies: [TASK-024, TASK-020]
  - implementation_steps:
    1. Select primary = lowest saturation among qualified; assign downstream direct intersections role=secondary.
    2. If primary saturation>=0.85: keep route, set long-green, note congestion, recommend public transit.
    3. If no candidate qualifies: emit "查無合規替代路段" and include no non-alternative roads (R6.8).
    4. Populate `excluded_candidates` with reasons (capacity / not-direct / downstream).
  - acceptance_criteria: Primary is a qualified lowest-saturation candidate; downstream never primary; no fabricated roads; congested-maintain path applied when applicable.
  - tests_required: unit + P10/P11/P12 in Phase 2; golden ACC_001 (TASK-053).
  - failure_cases: no legal alternative → documented, no fabrication (§21); anchor unresolved → no primary selected (defer to TASK-026).
  - done_definition: Evacuation selection + congestion handling + no-candidate path implemented.
  - provisional_policy_notes: OQ-007 (no legal alternative official response) PARTIALLY_DEFINED: only documents absence + suggests public transit; OQ-008 disclosure per §11.7; both remain configurable.
  - hg001_amendment:
    - Persist selected primary and selected secondary routes in deterministic order so TASK-031 can construct the ETE affected set.
    - Route saturation comparisons use TASK-020 latest-prior observations under the same event cutoff.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Primary = lowest Saturation among qualified candidates; downstream direct intersections → secondary only; congested primary (`>=0.85`) is MAINTAINED + long-green + report note + public-transit recommendation; no qualifying candidate → "no compliant alternative" (never fabricate a road). OQ-008 disclosure stays configurable.
  - demo_or_evidence_output: Feeds P9/P10/P11/P12; ACC_001 golden (primary RD_TPE_004 / secondary RD_TPE_005, PROVISIONAL).

- [ ] TASK-026 Implement IncidentAnchorResolutionStrategy (Strategy D) and conservative fallback
  - objective: Map `Incident.location` text to a structured anchor (intersection, direction, upstream/downstream) for art.2, and when it cannot be uniquely resolved, return `manual_confirmation_required` with no primary and unranked direct intersections (§11.5, R6).
  - requirements_covered: REQ-013, REQ-028, R6, R7
  - design_sections: §11.5, §10.8a (IncidentAnchor)
  - components: IncidentAnchorResolutionStrategy (D)
  - files_or_modules_expected: `packages/domain/src/strategies/incident_anchor_resolution_strategy.ts`
  - dependencies: [TASK-021, TASK-006]
  - implementation_steps:
    1. Default `incident_anchor_from_location_text`: evidence-based match of `intersections` names within `location`.
    2. Output `IncidentAnchor` with confidence + `source_evidence`; set `provisional=true`.
    3. On non-unique resolution: `manual_confirmation_required=true`, `primary_evacuation=null`, list `unranked_direct_intersections`; never invent direction.
    4. Feed `upstream_or_downstream` into EvacuationSelector (RoadNetworkModel + anchor, NOT Strategy A).
  - acceptance_criteria: Unique anchor drives upstream/downstream via geometry+anchor; non-unique → conservative behavior with no ranking.
  - tests_required: unit + P30 in Phase 2; unresolved-anchor failure test (TASK-056); policy switch (TASK-057).
  - failure_cases: anchor parse failure → `unranked_direct_intersections` + `manual_confirmation_required` (§21).
  - done_definition: Strategy D implemented and switchable (`policy.incident_anchor.mode`).
  - provisional_policy_notes: Strategy D = OQ-004, PROVISIONAL; `explicit_host_mapping` alternative kept configurable; never presented as official.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Anchor uniquely resolved from `location` text → upstream/downstream via RoadNetworkModel + Strategy D (NOT time-alignment Strategy A); if not uniquely resolvable → `manual_confirmation_required`, `primary_evacuation=null`, no auto-ranking (all `unranked_direct_intersection`), no fabricated up/down; provisional and configurable.
  - demo_or_evidence_output: Feeds P30; policy-switch verification (TASK-057).

- [ ] TASK-027 Implement RuleEngine article3 (SOP-3 MRT shuttle)
  - objective: Encode SOP-3 OR-trigger for BS_MRT_BL17 (Growth_Rate>0.30 OR User_Count>25000) with exact boundaries and the shuttle actions (§9.4 art.3, R8).
  - requirements_covered: REQ-016, R8
  - design_sections: §9.4 (art.3), §10.7
  - components: RuleEngine.article3
  - files_or_modules_expected: `packages/domain/src/rule_engine/article3.ts`
  - dependencies: [TASK-020]
  - implementation_steps:
    1. Trigger iff Growth_Rate>0.30 OR User_Count>25000 (=25000 not met, =25001 met, Growth=0.30 not met).
    2. Actions: MRT skip-stop, notify bus authority, guide walk to BS_MRT_BL18.
  - acceptance_criteria: Boundaries 25000/25001 and 0.30 exact; actions present when triggered.
  - tests_required: unit + P16 in Phase 2; boundary (TASK-052).
  - failure_cases: missing readings → `insufficient_data`, no assumption of trigger.
  - done_definition: Article 3 encoded with boundaries.
  - provisional_policy_notes: OQ-002 (affected_road role for BS_ events) handled only via Strategy B (TASK-032); this task never uses affected_road to trigger.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: art.3 triggers iff `BL17 Growth_Rate>0.30` OR `User_Count>25000` (=25000 not, =25001 yes, =0.30 not); actions include skip-stop + bus shuttle + walk to BS_MRT_BL18; EVT_002 must be COMPUTED, never assumed triggered.
  - demo_or_evidence_output: Feeds P16; TC-SOP3 boundaries; EVT_002 golden (must-compute).

- [ ] TASK-028 Implement RuleEngine article4 (SOP-4 dome dispersal)
  - objective: Encode SOP-4: mark dispersal iff BS_TPE_DOME historical peak>=30000 AND current Growth_Rate<=-0.20, then proactively invoke art.3 (§9.4 art.4, R9).
  - requirements_covered: REQ-017, R9
  - design_sections: §9.4 (art.4), §10.7
  - components: RuleEngine.article4
  - files_or_modules_expected: `packages/domain/src/rule_engine/article4.ts`
  - dependencies: [TASK-027]
  - implementation_steps:
    1. Compute historical peak across the series and current Growth_Rate.
    2. Trigger on AND of both conditions; on trigger, chain art.3 shuttle mechanism.
  - acceptance_criteria: Peak 40000 + growth -0.31 → dispersal marked and art.3 linked; single condition alone does not trigger.
  - tests_required: unit + P17 in Phase 2; DOME golden (TASK-058).
  - failure_cases: incomplete series → `insufficient_data`.
  - done_definition: Article 4 encoded with art.3 chaining.
  - provisional_policy_notes: Peak window uses Strategy A alignment (OQ-001) for "current"; remains configurable.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Dispersal iff DOME historical peak `>=30000` AND current `Growth_Rate<=-0.20`; once marked, proactively links the art.3 shuttle mechanism.
  - demo_or_evidence_output: Feeds P17; DOME golden (peak 40000, growth −0.31).

- [ ] TASK-029 Implement RuleEngine article5 (SOP-5) and AffectedIntersectionScopeStrategy (E)
  - objective: Encode SOP-5 trigger (type=Power_Failure OR description contains 號誌失效/故障) and manual-command output with official `police_per_intersection=2`, leaving affected-intersection scope unresolved by default (§9.4 art.5, §11.6, R10).
  - requirements_covered: REQ-018, R10
  - design_sections: §9.4 (art.5), §11.6, §10.9a
  - components: RuleEngine.article5, AffectedIntersectionScopeStrategy (E)
  - files_or_modules_expected: `packages/domain/src/rule_engine/article5.ts`, `packages/domain/src/strategies/affected_intersection_scope_strategy.ts`
  - dependencies: [TASK-021, TASK-006]
  - implementation_steps:
    1. Trigger on Power_Failure OR description keyword match.
    2. Set `police_per_intersection=2` (official); default scope mode `unresolved_manual_confirmation` → `affected_intersection_count=unresolved`, `total_police=unresolved`, `manual_confirmation_required=true`.
    3. Emit CMS annotation "<road> 號誌故障，請依現場指揮通行".
    4. Any demo count must be flagged `PROVISIONAL_DERIVED_EXAMPLE`, `official_golden_answer=false`.
  - acceptance_criteria: 2-per-intersection always holds; total police stays `unresolved` unless scope confirmed; CMS text matches template.
  - tests_required: unit + P18/P19/P31 in Phase 2; EVT_003 golden (TASK-055); policy switch (TASK-057).
  - failure_cases: never multiply "all intersections × 2" as official (§11.6); unresolved police scope test (TASK-056).
  - done_definition: Article 5 + Strategy E encoded, scope switchable.
  - provisional_policy_notes: Strategy E = OQ-010; OQ-011 (SOP5 duration vs SOP7 ETE) kept separate/non-overwriting; both configurable, never official.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: art.5 triggers iff `type=Power_Failure` OR description contains 號誌失效/故障; `police_per_intersection=2` (official); affected scope default `unresolved_manual_confirmation` → `affected_intersection_count`/`total_police=unresolved`, `manual_confirmation_required=true`; NEVER multiply all segment intersections × 2; Strategy E configurable.
  - demo_or_evidence_output: Feeds P18/P19/P31; EVT_003 golden (CMS "松高路 號誌故障，請依現場指揮通行").

- [ ] TASK-030 Implement RuleEngine article6 (SOP-6 trigger) and MultilingualScopeStrategy (F)
  - objective: Encode SOP-6 trigger using latest-prior observations at the event cutoff while keeping the station-set dimension configurable and open.
  - requirements_covered: REQ-010, REQ-019, R11
  - design_sections: §9.4 (art.6), §11.8, §14.4
  - components: RuleEngine.article6, MultilingualTrigger, MultilingualScopeStrategy (F)
  - files_or_modules_expected: `packages/domain/src/rule_engine/article6.ts`, `packages/domain/src/rule_engine/multilingual_trigger.ts`, `packages/domain/src/strategies/multilingual_scope_strategy.ts`
  - dependencies: [TASK-020, TASK-014, TASK-006]
  - implementation_steps:
    1. Select the station set via configurable Strategy F.
    2. For every in-scope station, use TASK-020 latest-prior observation under the same event cutoff.
    3. Trigger iff any in-scope `roaming_pct_value >= 0.30`; never treat a future row or arbitrary historical peak as current.
    4. Persist each station observation timestamp and staleness.
    5. Set `multilingual_required` as LLM-prohibited deterministic truth.
  - acceptance_criteria: 30% triggers; all evaluated values obey the event cutoff; station-set mode remains config-driven.
  - tests_required: unit + P20/P32 in Phase 2; boundary TASK-052.
  - failure_cases: missing prior observation → `INSUFFICIENT_DATA`, never guess.
  - done_definition: Article 6 trigger and Strategy F timing are encoded.
  - provisional_policy_notes: OQ-005 time dimension is `PARTIALLY_RESOLVED_BY_ORGANIZER_GUIDANCE`; station-set scope remains OPEN / AWAITING_HOST_REPLY.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: Event-cutoff timing is fixed by HG-001; station-set remains visibly configurable; Bedrock cannot alter trigger truth.
  - demo_or_evidence_output: P20/P32 and 29.99% versus 30% evidence with observation timestamps.

- [ ] TASK-031 Implement ETECalculator (art.7) and EteAffectedSetStrategy (C)
  - objective: Encode the official ETE formula plus HG-001 affected-set and common-exact-timestamp policies, with strict insufficient-common-snapshot handling.
  - requirements_covered: REQ-009, REQ-020, REQ-015, R12
  - design_sections: §9.4 (art.7), §11.3, §10.9, §11.4
  - components: ETECalculator, EteAffectedSetStrategy (C), CommonSnapshotSelector
  - files_or_modules_expected: `packages/domain/src/rule_engine/ete_calculator.ts`, `packages/domain/src/strategies/ete_affected_set_strategy.ts`, `packages/domain/src/ete/common_snapshot_selector.ts`
  - dependencies: [TASK-020, TASK-006]
  - implementation_steps:
    1. Build `stable_unique([incident.affected_segment, selected_primary, ...selected_secondary])` in INCIDENT, PRIMARY, SECONDARY order.
    2. Exclude raw alternatives, rejected candidates, capacity-failed candidates, non-intersecting candidates, unranked or unrelated roads, fabricated roads, and BS contextual affected_road.
    3. Find the latest timestamp `<= event.timestamp` for which every affected-set road has an exact traffic record.
    4. Never mix road timestamps, use future rows, interpolate, or average only an available subset.
    5. Compute base 60/40/20, `avg=sum/count`, `penalty=max(0,(avg-0.5)*60)`, and `ETE=base+penalty`.
    6. If no common timestamp exists, return `INSUFFICIENT_COMMON_SNAPSHOT`, `ete_minutes=null`, `ete_lower_bound_minutes=base`, `congestion_penalty=null`, and `manual_confirmation_required=true`.
    7. Persist roles, per-road saturation, common timestamp, sum, count, average, base, penalty, ETE, status, policy modes, and `guidance_id=HG-001`.
  - acceptance_criteria: Active policies are `INCIDENT_PRIMARY_AND_SELECTED_SECONDARY` and `COMMON_EXACT_TIMESTAMP`; art.7 appears only in `applied_formula_articles`.
  - tests_required: unit + P22/P23; Golden TASK-053 and TASK-055.
  - failure_cases: no common exact timestamp fails closed; no partial average.
  - done_definition: ETE calculation is deterministic, traceable, and policy-configurable.
  - provisional_policy_notes: OQ-003 is `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE`; selected policies remain configurable and are not represented as a unique official algorithm.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Correct affected set, one common exact timestamp, full formula trace, no partial average, Bedrock never recomputes ETE.
  - demo_or_evidence_output: ACC_001 78.6 and EVT_003 41.0 derivations plus an insufficient-common-snapshot case.

- [ ] TASK-032 Implement AffectedRoadStrategy (Strategy B) for EVT_002 affected_road role
  - objective: Implement HG-001 `DISPLAY_AND_CONTEXT_ONLY` behavior for BS_ event affected_road.
  - requirements_covered: REQ-016, R8
  - design_sections: §11.2, §10.9b
  - components: AffectedRoadStrategy (B), AffectedRoadContext
  - files_or_modules_expected: `packages/domain/src/strategies/affected_road_strategy.ts`, `packages/shared-schemas/src/affected_road_context.ts`
  - dependencies: [TASK-016, TASK-006]
  - implementation_steps:
    1. Preserve the raw affected_road.
    2. Emit `role=DISPLAY_AND_CONTEXT_ONLY`, `mandatory_action=false`, `enters_ete_set=false`, `triggers_article1_or_2=false`, and `guidance_id=HG-001`.
    3. Display it in Dashboard, event details, and report; allow only an optional non-binding local context note.
    4. Do not let it change A/B, become primary/secondary, enter ETE, trigger art.1/art.2, or create a mandatory action.
    5. Bedrock may explain context but cannot alter these deterministic fields.
  - acceptance_criteria: EVT_002 affected_road is visible but non-binding; BS_ routing is based on affected_segment and art.3 inputs.
  - tests_required: unit + TASK-057 policy contract + TASK-054 Golden.
  - failure_cases: any art.1/art.2 trigger, route role, ETE membership, or mandatory action derived from affected_road fails.
  - done_definition: Strategy B is implemented with organizer-guidance provenance and configurable interface.
  - provisional_policy_notes: OQ-002 is `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE`; selected role remains configurable because HG-001 is NON_UNIQUE.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: affected_road is context only and cannot mutate numeric/boolean truth.
  - demo_or_evidence_output: EVT_002 panel showing RD_TPE_001 as context only and no ETE/article trigger.

- [ ] TASK-033 Implement triggered/applied_formula/invoked_procedures separation and citation_article_set
  - objective: Assemble `triggered_articles` (art.1–6), `applied_formula_articles` (art.7), `invoked_procedures`, and derive `citation_article_set = triggered ∪ applied_formula` (§9.5, §14.2).
  - requirements_covered: REQ-021, REQ-008, R13, R15
  - design_sections: §9.4/§9.5, §14.2, §10.11a
  - components: RuleEngine (aggregation), EvidenceTrace inputs
  - files_or_modules_expected: `packages/domain/src/rule_engine/article_aggregation.ts`
  - dependencies: [TASK-023, TASK-024, TASK-027, TASK-028, TASK-029, TASK-030, TASK-031]
  - implementation_steps:
    1. Collect triggered articles from art.1–6 evaluations; never place art.7 in triggered.
    2. Collect `applied_formula_articles` (e.g., [7]) and `invoked_procedures` (e.g., article2_alternative_route_guidance).
    3. Compute `citation_article_set = union(triggered, applied_formula)`.
  - acceptance_criteria: ACC_001 → triggered=[1,2], invoked=[article2_alternative_route_guidance], applied=[7], citation={1,2,7}.
  - tests_required: unit + P27 in Phase 2; golden ACC_001 (TASK-053).
  - failure_cases: art.7 misclassified as trigger → rejected by assertion.
  - done_definition: Article set separation + citation set computed.
  - provisional_policy_notes: none (classification is official structure)
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `triggered_articles` vs `applied_formula_articles` vs `invoked_procedures` strictly separated (art.7 never triggered); `citation_article_set = triggered ∪ applied_formula` (covers art.7 when applied); ACC_001 → {1,2,7}.
  - demo_or_evidence_output: Feeds P27; ACC_001 golden citation set {1,2,7}.

- [ ] TASK-034 Implement EvidenceTraceBuilder
  - objective: Build the deterministic explanation-chain facts (classification reasoning, excluded routes with reasons, SOP citations, data points) for R15 (§10.10).
  - requirements_covered: REQ-008, R15
  - design_sections: §10.10, §9.2
  - components: EvidenceTraceBuilder
  - files_or_modules_expected: `packages/domain/src/rule_engine/evidence_trace_builder.ts`
  - dependencies: [TASK-022, TASK-025, TASK-033]
  - implementation_steps:
    1. Capture `classification_reasoning` (value+threshold+conclusion).
    2. Capture `excluded_routes` with non-empty reasons for each.
    3. Capture `sop_citations` and `data_points` (source/field/value/timestamp).
  - acceptance_criteria: Every excluded route has a reason; citations reference `citation_article_set`; all facts deterministic.
  - tests_required: unit + P26 in Phase 2.
  - failure_cases: missing reason → build error (no empty reasons allowed).
  - done_definition: EvidenceTrace facts produced deterministically.
  - provisional_policy_notes: Provisional route/anchor facts carry `provisional=true` markers.
  - hg001_amendment:
    - Record event cutoff, observation selection, staleness, affected-set construction, ETE common timestamp, formula substitution, and HG-001 provenance.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: EvidenceTrace records grading reasoning (values+thresholds+conclusion), a non-empty exclusion reason for every excluded route, SOP citations, and data points; deterministic facts only (no LLM authorship of facts).
  - demo_or_evidence_output: Feeds P26; drives the explanation-chain UI (TASK-129).

- [ ] TASK-035 Implement canonical core_hash (§10.11a-1) and DecisionCore assembly
  - objective: Assemble the immutable `DecisionCore` payload and compute `core_hash` via the canonical serialization algorithm (SHA-256 over canonical deterministic payload, excluding all execution-volatile metadata) (§10.11a, §10.11a-1, FIX 4).
  - requirements_covered: REQ-011..REQ-022 (core assembly), R2..R16
  - design_sections: §10.11a, §10.11a-1, §15.2, §22.1 P33(i)
  - components: DecisionCore builder, CanonicalCoreHash, PolicyMetadata
  - files_or_modules_expected: `packages/domain/src/core_hash/canonical_core_hash.ts`, `packages/domain/src/decision/decision_core_builder.ts`
  - dependencies: [TASK-033, TASK-034, TASK-020, TASK-026, TASK-029, TASK-030, TASK-031]
  - implementation_steps:
    1. Implement canonical serialization: lexicographic object keys, no insignificant whitespace, UTF-8, normalized numbers, semantic-order arrays preserved, set-like arrays stable-sorted, null-vs-absent fixed.
    2. INCLUDE the deterministic decision facts listed in §10.11a-1; EXCLUDE `injection_run_id`/`workflow_execution_*`/`trace_id`/`attempt_count`/lease/status/lifecycle timestamps/latency/observability metadata.
    3. Compute `core_hash = SHA-256(UTF-8(canonical_serialize(payload)))`.
    4. Assemble `DecisionCore` with `PolicyMetadata` (provisional markers, Strategy modes) and `source_manifest_hash`.
  - acceptance_criteria: Same decision facts under different execution metadata → identical `core_hash`; any changed decision fact → different `core_hash`; reordered set-like arrays → identical hash.
  - tests_required: canonical core_hash A/B/C tests (TASK-051); feeds P33(i)/identity classification (Phase 5).
  - failure_cases: including volatile metadata in the hash → test failure; unstable ordering → test failure.
  - done_definition: Canonical `core_hash` + DecisionCore assembly implemented.
  - provisional_policy_notes: DecisionCore embeds PolicyMetadata reflecting the active (provisional) Strategy modes; hash covers policy version/content so switching policy changes the hash intentionally.
  - hg001_amendment:
    - Include deterministic HG-001 decision fields in the canonical core payload; exclude volatile presentation metadata from `core_hash` according to the existing canonicalization contract.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `core_hash` = SHA-256 of the canonical serialization per §10.11a-1 (lexicographic keys, no insignificant whitespace, UTF-8, number normalization, set-like stable sort, null-vs-absent fixed); INCLUDE decision facts, EXCLUDE execution-volatile metadata; DecisionCore `immutable_after_commit`.
  - demo_or_evidence_output: Feeds TASK-051 canonical core_hash A/B/C tests and P33 identity classification.

CHECKPOINT B (not a task): Ensure all Phase 1 unit tests pass and the deterministic core assembles a DecisionCore offline; ask the user if questions arise.

---

## Phase 2 — Deterministic Tests (property, boundary, golden, policy-switching)

> Every property test is implemented as its own `fast-check` (TS) / `Hypothesis` (Python) test with ≥100 iterations and the label `Feature: city-response-commander, Property {n}: {text}`. No test requires an LLM to compute truth. Every Phase 2 test task is a MANDATORY_ACCEPTANCE_GATE. No property, boundary, golden, policy-switch, source-integrity, failure-mode, idempotency, IAM, security, latency, or smoke test may be skipped for LOCAL_MOCK release validation, PERSONAL_AWS_DEV validation, or COMPETITION_AWS release.

- [ ] TASK-036 Property tests P1, P21, P34 (percent round-trip, time format, timestamp preservation)
  - objective: Verify percent parsing round-trip, `YYYY-MM-DD HH:MM` output format, and `timestamp_raw` immutability with correct normalization.
  - requirements_covered: REQ-001, REQ-019, R1, R11
  - design_sections: §22.1 (P1,P21,P34), §10.1, §10.2
  - components: PercentParser, timestamp normalizer
  - files_or_modules_expected: `packages/domain/test/property/p01_percent.test.ts`, `.../p21_time_format.test.ts`, `.../p34_timestamp_preserve.test.ts`
  - dependencies: [TASK-014, TASK-018, TASK-010]
  - implementation_steps:
    1. P1: generate valid percent strings; assert `parse` then format restores original and `parse("30%")==0.30`.
    2. P21: for any emitted time value, assert format matches `YYYY-MM-DD HH:MM`.
    3. P34: for raw strings incl `2026/5/20 22:10`, assert raw unchanged, display normalized, normalized instant equals raw.
  - acceptance_criteria: All three properties pass ≥100 iterations with labels.
  - tests_required: property P1, P21, P34.
  - failure_cases: record and surface any counterexample from the PBT library.
  - done_definition: P1/P21/P34 green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P1/P21/P34 each a single `fast-check` property with ≥100 iterations and the label `Feature: city-response-commander, Property {n}: {text}`; universal (not example-only); fails with a shrunk counterexample on any violation. Release-blocking, not skippable.
  - demo_or_evidence_output: Green ≥100-iteration runs for P1/P21/P34 with the required labels; a seeded violation is caught with a shrunk counterexample.

- [ ] TASK-037 Property test P2 (official data read-only invariance)
  - objective: Verify that any sequence of read/query/decision operations leaves the five official sources deeply equal to load time.
  - requirements_covered: REQ-001, R1
  - design_sections: §22.1 (P2), §15.1
  - components: DataIngestionService
  - files_or_modules_expected: `packages/domain/test/property/p02_immutability.test.ts`
  - dependencies: [TASK-019, TASK-010]
  - implementation_steps:
    1. Snapshot loaded datasets (deep clone).
    2. Run randomized operation sequences (grade, evaluate, select snapshot).
    3. Assert deep equality of source content afterward.
  - acceptance_criteria: Sources unchanged across all sequences (≥100 iterations).
  - tests_required: property P2.
  - failure_cases: any mutation → counterexample reported.
  - done_definition: P2 green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P2 a single `fast-check` property with ≥100 iterations and the required label; proves the five official sources are deep-equal before/after any read/query/decision sequence; fails with a shrunk counterexample. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration P2 run with the label; a seeded mutation of official data is caught.

- [ ] TASK-038 Property test P3 (Strategy A snapshot selection)
  - objective: Verify selected row Timestamp <= event and is the per-entity latest prior, single-row field cohesion, and `insufficient_data` instead of post-event rows.
  - requirements_covered: REQ-001, R1
  - design_sections: §22.1 (P3), §11.1
  - components: SnapshotSelector / TimeAlignmentStrategy
  - files_or_modules_expected: `packages/domain/test/property/p03_snapshot.test.ts`
  - dependencies: [TASK-020, TASK-010]
  - implementation_steps:
    1. Generate entity timeseries + event times.
    2. Assert selection is latest `<= event`; station fields from same row; no legal row → `insufficient_data`.
  - acceptance_criteria: Property holds ≥100 iterations.
  - tests_required: property P3.
  - failure_cases: post-event selection → counterexample.
  - done_definition: P3 green.
  - provisional_policy_notes: Tests default Strategy A mode; policy-switch coverage in TASK-057.
  - hg001_amendment:
    - Property P3 must prove one logical cutoff, no future row, same-row fields, latest-prior selection, staleness metadata, and `INSUFFICIENT_DATA` when no prior row.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P3 a single `fast-check` property with ≥100 iterations and the required label; proves selected row `Timestamp <= event_timestamp` and per-entity latest-prior, same-row fields, and `insufficient_data` when no legal row (never event-after); provisional Strategy A. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration P3 run with the label; counterexample on an event-after selection.

- [ ] TASK-039 Property tests P4, P5, P7 (classification, art.1 mapping, light mapping)
  - objective: Verify A/B grading correctness, RD_TPE_001/002 level→measure mapping (incl. A invokes guidance without art.2 trigger), and level→light color mapping.
  - requirements_covered: REQ-011, REQ-004, R2, R3, R4
  - design_sections: §22.1 (P4,P5,P7), §9.4 (art.1)
  - components: ClassificationEngine, RuleEngine.article1, light-render mapping
  - files_or_modules_expected: `packages/domain/test/property/p04_classification.test.ts`, `.../p05_trigger_segment.test.ts`, `.../p07_light_mapping.test.ts`
  - dependencies: [TASK-022, TASK-023, TASK-010]
  - implementation_steps:
    1. P4: assert A iff >=0.95, B iff 0.85..<0.95, else neither, for all segments.
    2. P5: assert B measures and A additionally invokes `article2_alternative_route_guidance`; A alone does not put 2 in triggered.
    3. P7: assert A→red, B→yellow deterministic mapping.
  - acceptance_criteria: All three pass ≥100 iterations.
  - tests_required: property P4, P5, P7.
  - failure_cases: boundary misclassification → counterexample.
  - done_definition: P4/P5/P7 green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: P4/P5/P7 each a single `fast-check` property with ≥100 iterations and the required label; exact A/B boundaries (0.85/0.95), art.1 measure mapping (A invokes article2 guidance, A alone ≠ triggered art.2), and A=red/B=yellow rendering. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P4/P5/P7 with labels; boundary counterexamples caught.

- [ ] TASK-040 Property test P6 (threshold auto-popup)
  - objective: Verify `anomaly.detected` is produced iff any road/station meets an SOP (art.1/3/4/6) threshold, and not otherwise.
  - requirements_covered: REQ-002, R4
  - design_sections: §22.1 (P6), §16.2
  - components: AlertMonitor
  - files_or_modules_expected: `packages/domain/test/property/p06_anomaly.test.ts`
  - dependencies: [TASK-022, TASK-027, TASK-028, TASK-030, TASK-010]
  - implementation_steps:
    1. Generate snapshots crossing/not-crossing thresholds.
    2. Assert popup emitted iff a threshold is met.
  - acceptance_criteria: Property holds ≥100 iterations.
  - tests_required: property P6.
  - failure_cases: false popup / missed popup → counterexample.
  - done_definition: P6 green.
  - provisional_policy_notes: Thresholds official; scope for art.6 uses Strategy F default (configurable).
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: P6 a single `fast-check` property with ≥100 iterations and the required label; proves `anomaly.detected` iff any SOP art.1/3/4/6 threshold met, no popup otherwise. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration P6 run with the label; a below-threshold false-popup is caught.

- [ ] TASK-041 Property tests P8, P9, P10, P11, P12 (SOP-2 trigger/qualification/selection/congestion/no-candidate)
  - objective: Verify art.2 3-AND trigger, 3-AND candidate qualification (Saturation excluded), lowest-saturation primary with downstream secondary, congested-maintain, and no-candidate documentation without fabrication.
  - requirements_covered: REQ-012, REQ-013, REQ-014, REQ-005, R5, R6
  - design_sections: §22.1 (P8–P12), §9.4 (art.2), §11.7
  - components: RuleEngine.article2, EvacuationSelector
  - files_or_modules_expected: `packages/domain/test/property/p08_sop2_trigger.test.ts` .. `p12_no_candidate.test.ts`
  - dependencies: [TASK-024, TASK-025, TASK-010]
  - implementation_steps:
    1. P8: trigger iff status/severity/RD_ ANDs; BS_ not art.2.
    2. P9: qualified set = capacity>=1000 AND direct-intersection AND upstream (Saturation not a filter); chosen primary passes all three and has lowest saturation among qualified.
    3. P10: primary lowest saturation; downstream role=secondary.
    4. P11: primary saturation>=0.85 → maintain + long-green + note + public transit.
    5. P12: no qualifying candidate → "查無合規替代路段" and no non-alternative road appears.
  - acceptance_criteria: All five properties pass ≥100 iterations.
  - tests_required: property P8, P9, P10, P11, P12.
  - failure_cases: fourth saturation filter or fabricated road → counterexample.
  - done_definition: P8–P12 green.
  - provisional_policy_notes: OQ-008 disclosure and OQ-007 no-candidate remain configurable; tests assert Saturation is never a qualification filter.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: P8/P9/P10/P11/P12 each a single `fast-check` property with ≥100 iterations and the required label; proves art.2 3-AND trigger, 3-AND candidate qualification (Saturation not a 4th filter), lowest-Saturation primary / downstream secondary, congested-maintain + long-green, and no-candidate → "no compliant alternative" (no fabrication). Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P8–P12 with labels; counterexamples on a 4th-filter or fabricated-road violation.

- [ ] TASK-042 Property tests P13, P14, P15 (alternatives one-way, empty nearby, upstream/downstream)
  - objective: Verify geometry semantics: directional alternatives (no symmetry), empty nearby preserved, upstream/downstream by intersections order + flow_direction.
  - requirements_covered: REQ-026, REQ-027, REQ-028, R7
  - design_sections: §22.1 (P13–P15), §10.3, §9.4
  - components: RoadNetworkModel
  - files_or_modules_expected: `packages/domain/test/property/p13_alternatives.test.ts`, `.../p14_nearby.test.ts`, `.../p15_up_down.test.ts`
  - dependencies: [TASK-021, TASK-010]
  - implementation_steps:
    1. P13: A lists B never implies B lists A; no symmetric search.
    2. P14: empty nearby stays empty.
    3. P15: position matches array order + direction.
  - acceptance_criteria: All three pass ≥100 iterations.
  - tests_required: property P13, P14, P15.
  - failure_cases: symmetric inference or auto-fill → counterexample.
  - done_definition: P13–P15 green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P13/P14/P15 each a single `fast-check` property with ≥100 iterations and the required label; proves one-way alternatives (no symmetric search), empty `nearby_stations` kept empty, and upstream/downstream from order + `flow_direction`. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P13/P14/P15 with labels; a symmetric-search or nearby-fill violation is caught.

- [ ] TASK-043 Property test P30 (anchor resolution + conservative fallback)
  - objective: Verify unique anchor drives upstream/downstream via geometry+anchor (not Strategy A), and non-unique resolution yields manual_confirmation with null primary and unranked intersections, no invented direction.
  - requirements_covered: REQ-013, REQ-028, R6, R7
  - design_sections: §22.1 (P30), §11.5
  - components: IncidentAnchorResolutionStrategy (D)
  - files_or_modules_expected: `packages/domain/test/property/p30_anchor.test.ts`
  - dependencies: [TASK-026, TASK-010]
  - implementation_steps:
    1. Generate location texts (resolvable and ambiguous).
    2. Assert resolvable → geometry-driven up/down; ambiguous → manual_confirmation, null primary, unranked list.
  - acceptance_criteria: Property holds ≥100 iterations.
  - tests_required: property P30.
  - failure_cases: invented direction / ranking under ambiguity → counterexample.
  - done_definition: P30 green.
  - provisional_policy_notes: Strategy D provisional; both modes exercised in TASK-057.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P30 a single `fast-check` property with ≥100 iterations and the required label; proves upstream/downstream via RoadNetworkModel + Strategy D (not Strategy A), and non-unique anchor → `manual_confirmation_required` + `primary_evacuation=null` + no auto-ranking + no fabricated up/down. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration P30 run with the label; a fabricated-anchor case is caught.

- [ ] TASK-044 Property tests P16, P17 (SOP-3 OR trigger + actions, SOP-4 dispersal)
  - objective: Verify art.3 OR-trigger with exact boundaries and actions, and art.4 AND-trigger with art.3 chaining.
  - requirements_covered: REQ-016, REQ-017, R8, R9
  - design_sections: §22.1 (P16,P17), §9.4 (art.3/art.4)
  - components: RuleEngine.article3, RuleEngine.article4
  - files_or_modules_expected: `packages/domain/test/property/p16_sop3.test.ts`, `.../p17_sop4.test.ts`
  - dependencies: [TASK-027, TASK-028, TASK-010]
  - implementation_steps:
    1. P16: trigger iff Growth>0.30 OR Count>25000 (25000 no, 25001 yes, 0.30 no); actions present.
    2. P17: dispersal iff peak>=30000 AND growth<=-0.20; chains art.3.
  - acceptance_criteria: Both pass ≥100 iterations.
  - tests_required: property P16, P17.
  - failure_cases: boundary error → counterexample.
  - done_definition: P16/P17 green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: P16/P17 each a single `fast-check` property with ≥100 iterations and the required label; proves art.3 OR trigger with exact boundaries (25000/25001, 0.30) + actions, and art.4 dispersal (peak>=30000 AND growth<=-0.20) linking art.3. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P16/P17 with labels; boundary counterexamples caught.

- [ ] TASK-045 Property tests P18, P19, P31 (SOP-5 trigger, manual command, unresolved police scope)
  - objective: Verify art.5 trigger conditions, 2-per-confirmed-intersection police rule with unresolved totals until scope confirmed, and CMS annotation; Strategy E provisional behavior.
  - requirements_covered: REQ-018, R10
  - design_sections: §22.1 (P18,P19,P31), §9.4 (art.5), §11.6
  - components: RuleEngine.article5, AffectedIntersectionScopeStrategy (E)
  - files_or_modules_expected: `packages/domain/test/property/p18_sop5_trigger.test.ts`, `.../p19_manual_command.test.ts`, `.../p31_police_scope.test.ts`
  - dependencies: [TASK-029, TASK-010]
  - implementation_steps:
    1. P18: trigger iff type=Power_Failure OR description contains 號誌失效/故障.
    2. P19: police_per_confirmed=2; unresolved scope → count/total unresolved; confirmed → total=count×2; CMS annotation present.
    3. P31: default unresolved mode → unresolved + manual_confirmation; any shown number flagged PROVISIONAL_DERIVED_EXAMPLE, official_golden_answer=false.
  - acceptance_criteria: All three pass ≥100 iterations.
  - tests_required: property P18, P19, P31.
  - failure_cases: deriving total police as official under unresolved scope → counterexample.
  - done_definition: P18/P19/P31 green.
  - provisional_policy_notes: Strategy E provisional; policy-switch in TASK-057.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P18/P19/P31 each a single `fast-check` property with ≥100 iterations and the required label; proves art.5 trigger (Power_Failure OR 號誌失效/故障), `police_per_confirmed_affected_intersection=2`, and unresolved scope → `affected_intersection_count`/`total_police=unresolved` (any shown number is PROVISIONAL_DERIVED_EXAMPLE). Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P18/P19/P31 with labels; an "all intersections × 2" derivation is caught.

- [ ] TASK-046 Property tests P20, P32 (SOP-6 trigger, event-cutoff timing and configurable station-set scope)
  - objective: Verify multilingual trigger iff any in-scope roaming>=0.30 with same-response zh+en, zh-only when not triggered, and that latest-prior observations at the event cutoff drive the trigger; station-set scope remains configurable.
  - requirements_covered: REQ-010, REQ-019, R11
  - design_sections: §22.1 (P20,P32), §9.4 (art.6), §11.8
  - components: MultilingualTrigger, MultilingualScopeStrategy (F)
  - files_or_modules_expected: `packages/domain/test/property/p20_sop6_trigger.test.ts`, `.../p32_scope_current.test.ts`
  - dependencies: [TASK-030, TASK-010]
  - implementation_steps:
    1. P20: trigger iff any roaming>=0.30; triggered → zh+en same response + flagged; else zh only + flagged not-triggered.
    2. P32: a station historically >=30% but currently below must not make current triggered.
  - acceptance_criteria: Both pass ≥100 iterations.
  - tests_required: property P20, P32.
  - failure_cases: historical-as-current trigger → counterexample.
  - done_definition: P20/P32 green.
  - provisional_policy_notes: Strategy F provisional; scope modes exercised in TASK-057.
  - hg001_amendment:
    - Verify OQ-005 time dimension follows HG-001 while station-set mode remains OPEN/configurable.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: P20/P32 each a single `fast-check` property with ≥100 iterations and the required label; proves art.6 trigger iff any in-scope station `roaming_pct_value>=0.30` (=30% triggers), multilingual zh+en on trigger, and event-cutoff timing and configurable station-set scope (historical peak never a current trigger). Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P20/P32 with labels; a historical-peak false trigger is caught.

- [ ] TASK-047 Property tests P22, P23 (ETE affected set, common snapshot, formula, no partial average)
  - objective: Verify incident+primary+secondary affected-set construction, one exact common timestamp, official ETE formula, non-negative penalty, and insufficient-common-snapshot behavior.
  - requirements_covered: REQ-009, REQ-020, R12
  - design_sections: §22.1 (P22,P23), §9.4 (art.7)
  - components: ETECalculator
  - files_or_modules_expected: `packages/domain/test/property/p22_ete.test.ts`, `.../p23_penalty.test.ts`
  - dependencies: [TASK-031, TASK-010]
  - implementation_steps:
    1. P22: for random severity + avg saturation, assert exact formula.
    2. P23: assert penalty>=0 (0 when avg<0.5).
  - acceptance_criteria: Both pass ≥100 iterations.
  - tests_required: property P22, P23.
  - failure_cases: negative penalty → counterexample.
  - done_definition: P22/P23 green.
  - provisional_policy_notes: Affected-set is Strategy C (config); formula itself official.
  - hg001_amendment:
    - Generate road histories with and without a common timestamp; prove no mixed-timestamp or partial-subset average is accepted.
    - Assert BS contextual affected_road is excluded.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P22/P23 each a single `fast-check` property with ≥100 iterations and the required label; proves `ETE=base_clearance+congestion_penalty` (60/40/20) and `congestion_penalty=max(0,(avg-0.5)*60)>=0`. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P22/P23 with labels; a negative-penalty violation is caught.

- [ ] TASK-048 Property tests P24, P25, P37 (report completeness, alert/CMS completeness, CMS permission split)
  - objective: Verify report content completeness, public-alert + CMS content completeness, and that `cms_core_text` is deterministic/LLM-prohibited while `cms_explanation_text` is LLM-writable.
  - requirements_covered: REQ-021, REQ-022, REQ-015, REQ-014, R13, R14, R6, R10
  - design_sections: §22.1 (P24,P25,P37), §10.11b, §10.12, §14.3
  - components: report/alert content assembly, SchemaValidator (permission)
  - files_or_modules_expected: `packages/domain/test/property/p24_report.test.ts`, `.../p25_alert_cms.test.ts`, `.../p37_cms_permission.test.ts`
  - dependencies: [TASK-033, TASK-034, TASK-031, TASK-010]
  - implementation_steps:
    1. P24: report includes event id+SOP articles, classification+values, primary/secondary+exclusion reasons, signal timing (+25%), ETE; cross-system requests when art.3/art.5.
    2. P25: alert includes location/reroute/delay/avoidance; SOP2 CMS includes incident road + primary + ETE; report notes ETE + basis.
    3. P37: any attempt to overwrite `cms_core_text` is rejected; only `cms_explanation_text` writable.
  - acceptance_criteria: All three pass ≥100 iterations.
  - tests_required: property P24, P25, P37.
  - failure_cases: missing required field or CMS-core overwrite → counterexample.
  - done_definition: P24/P25/P37 green.
  - provisional_policy_notes: none (structure is official; provisional values flagged where applicable)
  - aws_services_touched: none (pure domain; renderer permission tested via SchemaValidator stub)
  - security_or_iam_notes: Validates the §9 boundary at the data layer.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: P24/P25/P37 each a single `fast-check` property with ≥100 iterations and the required label; proves report completeness (event id + SOP clauses + grading + routes/exclusions + signal timing + cross-system + ETE), alert/CMS completeness, and `cms_core_text` LLM-prohibited vs `cms_explanation_text` LLM-writable split. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P24/P25/P37 with labels; an LLM core-CMS overwrite is rejected.

- [ ] TASK-049 Property tests P26, P27 (evidence chain, citation coverage)
  - objective: Verify evidence chain completeness (reasoning + data + non-empty exclusion reasons) and that `citation_article_set` covers `triggered ∪ applied_formula` (not only triggered).
  - requirements_covered: REQ-008, R15
  - design_sections: §22.1 (P26,P27), §14.2
  - components: EvidenceTraceBuilder, article aggregation
  - files_or_modules_expected: `packages/domain/test/property/p26_evidence.test.ts`, `.../p27_citation.test.ts`
  - dependencies: [TASK-033, TASK-034, TASK-010]
  - implementation_steps:
    1. P26: assert reasoning + data points present; each excluded route has a non-empty reason.
    2. P27: assert citation set ⊇ triggered ∪ applied_formula (e.g., art.7 included).
  - acceptance_criteria: Both pass ≥100 iterations.
  - tests_required: property P26, P27.
  - failure_cases: citation missing applied-formula article → counterexample.
  - done_definition: P26/P27 green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: P26/P27 each a single `fast-check` property with ≥100 iterations and the required label; proves evidence-chain completeness (reasoning + non-empty exclusion reasons) and `citation_article_set ⊇ triggered ∪ applied_formula` (covers art.7 when applied, not only triggered). Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration runs for P26/P27 with labels; a citation that omits an applied-formula article is caught.

- [ ] TASK-050 Property tests P29, P36 (bonus ja/ko languages, multilingual template no zh-only degradation)
  - objective: Verify that when the bonus is enabled and art.6 triggers, ja+ko are included, and that on Bedrock failure the language floor (zh+en, or zh+en+ja+ko) is met via deterministic approved templates, never degrading to zh-only.
  - requirements_covered: REQ-031, REQ-010, REQ-019, R11, R17
  - design_sections: §22.1 (P29,P36), §14.4, §21.3
  - components: MultilingualTrigger, template renderer (language floor)
  - files_or_modules_expected: `packages/domain/test/property/p29_bonus_lang.test.ts`, `.../p36_multilingual_fallback.test.ts`
  - dependencies: [TASK-030, TASK-010]
  - implementation_steps:
    1. P29: triggered + bonus on → languages include ja, ko.
    2. P36: simulate Bedrock failure; assert language set meets floor via templates inserting deterministic facts only.
  - acceptance_criteria: Both pass ≥100 iterations.
  - tests_required: property P29, P36.
  - failure_cases: zh-only under triggered art.6 → counterexample.
  - done_definition: P29/P36 green.
  - provisional_policy_notes: Scope via Strategy F (config); language floor is deterministic.
  - aws_services_touched: none (pure domain; template renderer is deterministic)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: P36 (core) and P29 (bonus scope) each a single `fast-check` property with ≥100 iterations and the required label; P36 proves SOP-6 multilingual never degrades to zh-only even when Bedrock fails (deterministic template, language floor zh+en, +ja/ko when bonus enabled); P29 proves ja/ko present when bonus enabled. Core P36 is release-blocking (the ja/ko-only assertion is the bonus portion).
  - demo_or_evidence_output: Green ≥100-iteration runs for P36/P29 with labels; a Bedrock-down zh-only degradation is caught.

- [ ] TASK-051 Canonical core_hash A/B/C tests (FIX 4)
  - objective: Verify the canonical `core_hash`: (A) volatile-metadata-only differences → same hash; (B) any decision-fact change → different hash; (C) semantically-equal reordering → same hash.
  - requirements_covered: REQ-011..REQ-022 (integrity), R-supporting
  - design_sections: §10.11a-1, §22.1 P33(i), §22.2 (Canonical core_hash)
  - components: CanonicalCoreHash
  - files_or_modules_expected: `packages/domain/test/property/corehash_abc.test.ts`
  - dependencies: [TASK-035, TASK-010]
  - implementation_steps:
    1. A: vary injection_run_id/execution ARN/name/trace_id/attempt_count/lifecycle timestamps; assert identical hash.
    2. B: vary classification/route/triggered article/ETE/source manifest/evidence/policy fact/CMS core; assert different hash.
    3. C: reorder set-like arrays and object keys; assert identical hash (null-vs-absent fixed).
  - acceptance_criteria: A/B/C all hold ≥100 iterations.
  - tests_required: canonical core_hash property tests (A/B/C).
  - failure_cases: volatile metadata affecting hash → counterexample.
  - done_definition: A/B/C green.
  - provisional_policy_notes: Policy version/content is part of the hash by design; switching policy intentionally changes the hash.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Three canonical `core_hash` properties (FIX 4) with ≥100 iterations and labels: (A) volatile-metadata-only change → same hash; (B) any decision-fact change → different hash; (C) semantically-equal reorder → same hash (set-like stable sort, lexicographic keys, null-vs-absent fixed). Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration A/B/C runs with labels; ALREADY_COMMITTED_SAME_DECISION vs CORE_IDENTITY_CONFLICT decided correctly on fixtures.

- [ ] TASK-052 Boundary unit tests (all official numeric boundaries)
  - objective: Encode EDGE_CASE unit tests for 0.85, 0.9499, 0.95, 25000, 25001, 0.30, 1000, 30% per the derived boundary matrix.
  - requirements_covered: REQ-011, REQ-016, REQ-019, REQ-013, R2, R8, R11, R6
  - design_sections: §22.3, cursor baseline §6 (TC-SAT/TC-SOP3/TC-SOP6/TC-SOP2)
  - components: ClassificationEngine, article3, article6, article2
  - files_or_modules_expected: `packages/domain/test/unit/boundaries.test.ts`
  - dependencies: [TASK-022, TASK-024, TASK-027, TASK-030, TASK-010]
  - implementation_steps:
    1. TC-SAT-001..004 (0.8499/0.85/0.9499/0.95).
    2. TC-SOP3-001..004 (25000/25001/0.30/0.3001).
    3. TC-SOP6-001..002 (29.99%/30%).
    4. TC-SOP2-001..002 (999/1000 capacity).
  - acceptance_criteria: All boundary cases assert exact official results.
  - tests_required: boundary unit tests (8 boundary values).
  - failure_cases: off-by-one boundary → test failure.
  - done_definition: Boundary matrix green.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Every official numeric boundary covered as an edge-case unit test with the exact official inequality (no drift): 0.8499/0.85 (B lower), 0.9499/0.95 (A lower), 25000/25001 (count), 0.30 (growth/roaming), 1000 (capacity), 30% (roaming). Release-blocking.
  - demo_or_evidence_output: Green boundary suite; each boundary asserts the exact expected classification/trigger per the derived boundary matrix.

- [ ] TASK-053 Golden test ACC_001 (deterministic core)
  - objective: End-to-end deterministic golden for ACC_001: triggered=[1,2], invoked=[article2_alternative_route_guidance], applied=[7], citation={1,2,7}, primary RD_TPE_004 / secondary RD_TPE_005 (provisional), ETE=78.6 under HG-001 selected policy, with full road-set and formula evidence.
  - requirements_covered: REQ-012, REQ-013, REQ-014, REQ-015, REQ-009, REQ-020, R6, R12
  - design_sections: §9.5, §11.4, §22.3
  - components: RuleEngine, EvacuationSelector, ETECalculator, DecisionCore builder
  - files_or_modules_expected: `packages/domain/test/golden/acc_001.golden.test.ts`
  - dependencies: [TASK-035, TASK-025, TASK-031, TASK-033]
  - implementation_steps:
    1. Feed ACC_001 with HG-001 selected strategies.
    2. Assert triggered/invoked/applied/citation sets and excluded reasons (RD_TPE_006 not-direct, RD_TPE_008 capacity 600<1000).
    3. Assert affected set RD_TPE_002/RD_TPE_004/RD_TPE_005, common timestamp 22:00, values 1.00/0.78/0.65, avg 0.81, base 60, penalty 18.6, ETE 78.6, and `guidance_id=HG-001`.
  - acceptance_criteria: Golden matches the HG-001 §9.5/§11.4 walkthrough exactly.
  - tests_required: golden ACC_001.
  - failure_cases: art.1 omitted or art.7 mislabeled as trigger → failure.
  - done_definition: ACC_001 golden green.
  - provisional_policy_notes: Strategy D remains provisional; HG-001 A/C policies are organizer-guided, selected, configurable, and not a unique official algorithm.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: ACC_001 end-to-end golden: `triggered_articles=[1,2]`, `invoked_procedures=[article2_alternative_route_guidance]`, `applied_formula_articles=[7]`, citation {1,2,7}, primary RD_TPE_004 / secondary RD_TPE_005 / excluded RD_TPE_006,008, ETE=78.6 with the complete derivation and organizer-guidance provenance. Release-blocking.
  - demo_or_evidence_output: Green ACC_001 golden asserting the exact core sets with provisional markers.

- [ ] TASK-054 Golden test EVT_002 (SOP-3 evaluation, must-compute)
  - objective: Golden for EVT_002 verifying event 22:20 uses BL17 22:15 latest-prior data, triggers art.3 by User_Count=31000, never uses 22:30, and treats affected_road as DISPLAY_AND_CONTEXT_ONLY.
  - requirements_covered: REQ-016, R8
  - design_sections: §9.5, §11.2, §22.3
  - components: RuleEngine.article3, AffectedRoadStrategy (B)
  - files_or_modules_expected: `packages/domain/test/golden/evt_002.golden.test.ts`
  - dependencies: [TASK-027, TASK-032, TASK-035]
  - implementation_steps:
    1. Feed EVT_002 at 22:20; assert selected observation is BL17 22:15 with User_Count=31000 and Growth_Rate=0.08; assert 22:30 is never selected.
    2. Assert art.3 triggers by User_Count>25000; affected_road=RD_TPE_001 is displayed as context only and does not trigger art.1/art.2 or enter ETE.
  - acceptance_criteria: Golden shows computed art.3 evaluation; no art.2 auto-trigger.
  - tests_required: golden EVT_002.
  - failure_cases: asserting art.3 trigger without computation → failure.
  - done_definition: EVT_002 golden green.
  - provisional_policy_notes: Strategy B default; configurable.
  - hg001_amendment:
    - Assert ETE is NOT_APPLICABLE for EVT_002.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: EVT_002 golden proves art.3 is EVALUATED (must-compute BL17 User_Count>25000 / Growth>0.30), never assumed; `affected_road=RD_TPE_001` handled via Strategy B (does not trigger art.2); provisional flags surfaced. Release-blocking.
  - demo_or_evidence_output: Green EVT_002 golden showing computed art.3 result + Strategy-B handling, not an assumed trigger.

- [ ] TASK-055 Golden test EVT_003 (SOP-5)
  - objective: Golden for EVT_003 verifying art.5 trigger, CMS, unresolved police scope, and HG-001 ETE=41.0.
  - requirements_covered: REQ-018, R10
  - design_sections: §9.5, §11.6, §22.3
  - components: RuleEngine.article5, AffectedIntersectionScopeStrategy (E)
  - files_or_modules_expected: `packages/domain/test/golden/evt_003.golden.test.ts`
  - dependencies: [TASK-029, TASK-035]
  - implementation_steps:
    1. Feed EVT_003; assert art.5 triggered, CMS "松高路 號誌故障，請依現場指揮通行".
    2. Assert count/total police unresolved + manual_confirmation.
    3. Assert affected set RD_TPE_007 INCIDENT + RD_TPE_011 PRIMARY, common timestamp 22:30, saturations 0.85/0.85, Medium base 20, penalty 21.0, ETE 41.0.
  - acceptance_criteria: Golden matches §9.5 with unresolved police totals.
  - tests_required: golden EVT_003.
  - failure_cases: fixed total police as official → failure.
  - done_definition: EVT_003 golden green.
  - provisional_policy_notes: Strategy E default unresolved; configurable.
  - hg001_amendment:
    - OQ-010 and OQ-011 remain open; ETE calculation does not resolve police scope or overwrite SOP5 duration semantics.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: EVT_003 golden proves art.5 trigger (Power_Failure), `police_per_intersection=2` (official) with unresolved scope (`affected_intersection_count`/`total_police=unresolved`), and exact CMS "松高路 號誌故障，請依現場指揮通行". Release-blocking.
  - demo_or_evidence_output: Green EVT_003 golden asserting CMS text + unresolved police scope (no fabricated total).

- [ ] TASK-056 Failure-mode deterministic tests (source-hash STOP, no-candidate, unresolved anchor, unresolved police)
  - objective: Verify STOP on source hash mismatch, no-legal-alternative documentation, unresolved-anchor conservative behavior, and unresolved police scope.
  - requirements_covered: REQ-032, REQ-005, REQ-013, REQ-018, R1, R6, R10
  - design_sections: §10.0, §21.2, §11.5, §11.6
  - components: manifest gate, EvacuationSelector, Strategy D, Strategy E
  - files_or_modules_expected: `packages/domain/test/unit/failure_modes.test.ts`
  - dependencies: [TASK-007, TASK-025, TASK-026, TASK-029, TASK-010]
  - implementation_steps:
    1. Alter a source byte → assert STOP + `insufficient_data` (no decision).
    2. Craft SOP-2 with all candidates disqualified → assert "查無合規替代路段", no fabricated road.
    3. Ambiguous anchor → assert manual_confirmation, null primary.
    4. Default SOP-5 scope → assert unresolved totals.
  - acceptance_criteria: All four failure modes behave per §21 without fabrication.
  - tests_required: failure-mode unit tests (4 scenarios).
  - failure_cases: silent use of unknown version / fabricated road → failure.
  - done_definition: Failure-mode suite green.
  - provisional_policy_notes: Confirms provisional paths degrade safely and stay configurable.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Hash mismatch fails closed.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Deterministic failure-mode tests: source-hash mismatch → STOP (no fabrication), no compliant alternative → documented (no invented road), unresolved anchor → `manual_confirmation_required`, unresolved police scope → `unresolved`. Release-blocking.
  - demo_or_evidence_output: Green failure-mode suite proving fail-closed/no-fabrication behaviors.

- [ ] TASK-057 Policy-switching contract tests (Strategies A–F, ≥2 impls each)
  - objective: Verify that switching each Strategy's mode via `ConfigProvider` changes outputs and `policy` metadata WITHOUT modifying the Rule Engine, per §30.
  - requirements_covered: REQ-005, REQ-009, REQ-013, REQ-016, REQ-018, REQ-019, R-supporting
  - design_sections: §11, §22.3, §30, §23.1
  - components: Strategies A, B, C, D, E, F
  - files_or_modules_expected: `packages/domain/test/contract/policy_switching.test.ts`
  - dependencies: [TASK-020, TASK-026, TASK-029, TASK-030, TASK-031, TASK-032, TASK-006]
  - implementation_steps:
    1. For each Strategy, run ≥2 configured modes and assert differing, correct outputs.
    2. Assert `policy` metadata reflects active mode and `classification=ORGANIZER_GUIDED_TEAM_POLICY` for HG-001 selected A/B/C modes, and `PROVISIONAL_TEAM_POLICY`/`AWAITING_HOST_REPLY` for unresolved modes.
    3. Assert Rule Engine source is untouched (interface-only swap).
  - acceptance_criteria: Each of A–F demonstrates ≥2 impls with correct switching; no engine change required.
  - tests_required: contract tests (A/B/C/D/E/F).
  - failure_cases: policy hard-coded / engine change needed → failure.
  - done_definition: Policy-switch contract suite green.
  - provisional_policy_notes: This task proves HG-001 selected A/B/C and OQ-005 time policy stay configurable while unresolved OQ dimensions remain open.
  - hg001_amendment:
    - Changing a non-selected mode must not rewrite RuleEngine logic or erase `guidance_id`/policy provenance.
  - aws_services_touched: none (pure domain; LOCAL_MOCK ConfigProvider)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Contract tests prove each Strategy A–F switches behavior via `ConfigProvider` (≥2 implementations each) with the decision changing and `policy` metadata reflecting the new value, WITHOUT any Rule Engine code edit; no OQ is closed. Release-blocking.
  - demo_or_evidence_output: Green policy-switch suite: flipping each Strategy mode changes output + provisional metadata, engine unchanged.

- [ ] TASK-058 Golden tests for SOP-4 DOME and SOP-6 stations
  - objective: Golden for BS_TPE_DOME (peak 40000, growth -0.31 → dispersal + art.3) and art.6 stations (BS_TPE_101 40%/45%, BS_XY_ATT 30%/35% → multilingual triggered).
  - requirements_covered: REQ-017, REQ-010, REQ-019, R9, R11
  - design_sections: §22.3, §9.4 (art.4/art.6)
  - components: RuleEngine.article4, RuleEngine.article6
  - files_or_modules_expected: `packages/domain/test/golden/dome_and_sop6.golden.test.ts`
  - dependencies: [TASK-028, TASK-030, TASK-035]
  - implementation_steps:
    1. Feed DOME series; assert dispersal + art.3 chaining.
    2. Feed station snapshots; assert multilingual triggered at/above 30%.
  - acceptance_criteria: Goldens match §22.3 expectations.
  - tests_required: golden DOME + SOP-6.
  - failure_cases: single-condition dispersal / missed 30% trigger → failure.
  - done_definition: DOME + SOP-6 goldens green.
  - provisional_policy_notes: art.4 "current" via Strategy A; art.6 scope via Strategy F; configurable.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: DOME golden (historical peak 40000, growth −0.31 → dispersal + art.3 link) and SOP-6 station goldens (BS_TPE_101 40%/45%, BS_XY_ATT 30%/35% → multilingual) assert exact triggers with provisional markers where policy-dependent. Release-blocking.
  - demo_or_evidence_output: Green DOME + SOP-6 goldens asserting dispersal linkage and multilingual trigger.

CHECKPOINT C (not a task): Ensure all Phase 2 property/boundary/golden/policy-switch tests pass in LOCAL_MOCK; ask the user if questions arise.

---

## Phase 3 — AWS Infrastructure & IAM (IaC only, NO deploy)

> All Phase 3 tasks author **AWS CDK (TypeScript)** infrastructure definitions only (§4.13, §24). No `cdk deploy` is performed here; deployment runbooks live in Phase 11. Every resource name carries an environment prefix and is parameterized via CDK context (`--context env=...`) so LOCAL_MOCK / PERSONAL_AWS_DEV / COMPETITION_AWS switch without code edits (§23). IAM is `Deny`-by-default with per-role least privilege that mechanically enforces the §9 boundary and the FIX-1/2/3 writer isolation.

- [x] TASK-059 Bootstrap CDK app, env-context profiles, and stack wiring
  - objective: Create the CDK app root that instantiates the four stacks and resolves all three environment profiles from context, so later infra tasks attach resources to a working, parameterized app.
  - requirements_covered: REQ-032, REQ-024 (DELIVERABLE), R-supporting (all)
  - design_sections: §24 (stack split), §23 (profiles), §4.13
  - components: NetworkAuthStack, DataStack, ComputeStack, FrontendStack (app wiring)
  - files_or_modules_expected: `infra/bin/app.ts`, `infra/lib/env_context.ts`, `infra/lib/network_auth_stack.ts` (shell), `infra/lib/data_stack.ts` (shell), `infra/lib/compute_stack.ts` (shell), `infra/lib/frontend_stack.ts` (shell), `infra/cdk.json`
  - dependencies: [TASK-001, TASK-006]
  - implementation_steps:
    1. Define `env_context.ts` mapping `env` (LOCAL_MOCK/PERSONAL_AWS_DEV/COMPETITION_AWS) to a typed settings object sourced from CDK context; no account/region literals in code.
    2. Instantiate the four stacks in `app.ts` with environment-prefixed names and cross-stack references (exports/imports).
    3. Wire `cdk.json` context defaults and a `--context env=` selector.
  - acceptance_criteria: `cdk synth --context env=PERSONAL_AWS_DEV` synthesizes all four stacks with prefixed names; no hard-coded account/region; changing context changes resource names/params only.
  - tests_required: `cdk synth` snapshot test per env profile (assertions on stack/resource naming); no deploy.
  - failure_cases: missing context → explicit synth error (no silent default account/region).
  - done_definition: Four-stack CDK app synthesizes cleanly for all three profiles.
  - provisional_policy_notes: none
  - aws_services_touched: AWS CDK / CloudFormation (IaC definition only, no deploy)
  - security_or_iam_notes: No credentials/account/region literals; all from context/ConfigProvider.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: CDK app bootstraps with the three env-context profiles (LOCAL_MOCK/PERSONAL_AWS_DEV/COMPETITION_AWS); resources env-prefixed; stacks wired; `--context env=...` switches params with zero code edits; no hard-coded account/region.
  - demo_or_evidence_output: `cdk synth` per profile; context switch changes parameters only (no resource redefinition).

- [x] TASK-060 DataStack: S3 buckets (raw, sop_source, artifact)
  - objective: Define the three S3 buckets for official raw data, SOP KB source, and generated artifacts with parameterized names and secure defaults (§4.8, §15.1).
  - requirements_covered: REQ-001, REQ-005, REQ-013, REQ-032, R1, R5
  - design_sections: §4.8, §15.1, §10.0 (source storage)
  - components: DataStack (S3)
  - files_or_modules_expected: `infra/lib/constructs/buckets.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define `s3.raw_bucket`, `s3.sop_source_bucket`, `s3.artifact_bucket` with names from context params.
    2. Enable block-public-access, encryption at rest, and versioning where appropriate.
    3. Set removal policy + `autoDeleteObjects` for non-production profiles only (teardown handled in TASK-084).
  - acceptance_criteria: Three buckets synthesize with block-public-access on and parameterized names; no public read.
  - tests_required: `cdk synth` assertion tests (bucket count, public-access-block, encryption).
  - failure_cases: public bucket policy → synth-time assertion failure.
  - done_definition: Three secure, parameterized buckets defined.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon S3 (IaC definition only)
  - security_or_iam_notes: Block public access; encryption at rest; no bucket policy granting anonymous write.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: raw / sop_source / artifact buckets parameterized; per-profile removal policy; official raw bucket read-only for the decision path (no public write); no hard-coded names.
  - demo_or_evidence_output: `cdk synth` assertion (three buckets, parameterized names, removal policies).

- [x] TASK-061 DataStack: IdempotencyTable (DynamoDB) with TTL
  - objective: Define the `IdempotencyTable` (PK `idempotency_key`, TTL on `expires_at`) that backs dedup, lease state, and stale-running reconciliation (§10.11e, §15.1).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §10.11e, §15.1, §6
  - components: DataStack (IdempotencyTable)
  - files_or_modules_expected: `infra/lib/constructs/idempotency_table.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define table with PK `idempotency_key`, on-demand billing, TTL attribute `expires_at`.
    2. Parameterize table name; no GSI required for recovery truth (RecoveryGateFn queries base tables only).
    3. Set removal policy per profile.
  - acceptance_criteria: Table synthesizes with PK `idempotency_key`, on-demand, TTL enabled; name parameterized.
  - tests_required: `cdk synth` assertion (key schema, TTL, billing mode).
  - failure_cases: wrong key schema → assertion failure.
  - done_definition: IdempotencyTable defined per §10.11e.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (IaC definition only)
  - security_or_iam_notes: Table-scoped access granted per-role in TASK-076/079/081; no wildcard grants here.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: PK `idempotency_key` + TTL(`expires_at`); on-demand; schema supports the lease/recovery conditional Put/Update state machine (starting/running/completed/start_failed/processing_failed) with fencing attributes.
  - demo_or_evidence_output: `cdk synth` assertion (PK, TTL, on-demand).

- [x] TASK-062 DataStack: DecisionCoreTable (immutable) DynamoDB
  - objective: Define the `DecisionCoreTable` (PK `decision_id`) that stores immutable core decisions written solely by DecisionFn (§10.11a, §15.1).
  - requirements_covered: REQ-011..REQ-022, R2..R16
  - design_sections: §10.11a, §15.1, §6
  - components: DataStack (DecisionCoreTable)
  - files_or_modules_expected: `infra/lib/constructs/decision_core_table.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define table with PK `decision_id`, on-demand billing, parameterized name.
    2. Document `immutable_after_commit` semantics (enforced by conditional Put + IAM, not by table config).
    3. Set removal policy per profile.
  - acceptance_criteria: Table synthesizes with PK `decision_id`, on-demand; name parameterized.
  - tests_required: `cdk synth` assertion (key schema, billing).
  - failure_cases: wrong key schema → assertion failure.
  - done_definition: DecisionCoreTable defined.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (IaC definition only)
  - security_or_iam_notes: Only DecisionFnRole gets write (TASK-077); Renderer/Publish/ApiRead read-only (TASK-078/082/081).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: PK `decision_id`; on-demand; immutability enforced by writer isolation (DecisionFn sole writer, TASK-077) + app-level `immutable_after_commit`; no publish/mutable state in this table.
  - demo_or_evidence_output: `cdk synth` assertion (PK decision_id, on-demand); writer-isolation asserted via IAM (TASK-077).

- [x] TASK-063 DataStack: DecisionNarrativeTable (PK decision_id + SK narrative_type)
  - objective: Define the `DecisionNarrativeTable` composite-key table so each `narrative_type` (REPORT/PUBLIC_ALERT/EXPLANATION) is an independent item written by its own RendererFn branch (§10.11b, §15.1).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R13, R14, R15
  - design_sections: §10.11b, §15.1, §6
  - components: DataStack (DecisionNarrativeTable)
  - files_or_modules_expected: `infra/lib/constructs/decision_narrative_table.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define table with PK `decision_id` + SK `narrative_type`, on-demand billing, parameterized name.
    2. Ensure recovery reads use the base table only (no eventually-consistent GSI as recovery truth).
    3. Set removal policy per profile.
  - acceptance_criteria: Table synthesizes with composite key (PK `decision_id`, SK `narrative_type`); name parameterized.
  - tests_required: `cdk synth` assertion (composite key schema).
  - failure_cases: single-key schema → assertion failure.
  - done_definition: DecisionNarrativeTable defined with PK+SK.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (IaC definition only)
  - security_or_iam_notes: Only RendererFnRole writes (conditional Put per item, TASK-078); RealtimePublisher never writes this table.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: PK `decision_id` + SK `narrative_type` (REPORT/PUBLIC_ALERT/EXPLANATION); supports per-branch `attribute_not_exists(decision_id)` conditional Put on the composite key (single-arg form only); no double-arg `attribute_not_exists`.
  - demo_or_evidence_output: `cdk synth` assertion (composite PK+SK key schema).

- [x] TASK-064 DataStack: PublishRecordTable (DynamoDB)
  - objective: Define the `PublishRecordTable` (PK `decision_id`) holding mutable publish state + audit trail, isolated from immutable DecisionCore (§10.11d, §10.17).
  - requirements_covered: REQ-022, R11
  - design_sections: §10.11d, §10.17, §15.1
  - components: DataStack (PublishRecordTable)
  - files_or_modules_expected: `infra/lib/constructs/publish_record_table.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define table with PK `decision_id`, on-demand billing, parameterized name.
    2. Set removal policy per profile.
    3. Document that `publish_state` is never written back to DecisionCore.
  - acceptance_criteria: Table synthesizes with PK `decision_id`, on-demand.
  - tests_required: `cdk synth` assertion (key schema).
  - failure_cases: wrong key schema → assertion failure.
  - done_definition: PublishRecordTable defined.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (IaC definition only)
  - security_or_iam_notes: Only PublishFnRole writes (TASK-082); zero write to DecisionCore.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: PK `decision_id` + optimistic-lock `version`; on-demand; physically separate from the immutable DecisionCoreTable (publish_state never written back to Core).
  - demo_or_evidence_output: `cdk synth` assertion (separate table, version attribute).

- [x] TASK-065 DataStack: connections table (WebSocket)
  - objective: Define the DynamoDB `connections` table (PK `connectionId`, TTL) for WebSocket connection storage per the AWS reference pattern (§4.5, §15.1).
  - requirements_covered: REQ-001, REQ-004, R4, R5
  - design_sections: §4.5, §15.1, §6
  - components: DataStack (connections)
  - files_or_modules_expected: `infra/lib/constructs/connections_table.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define table PK `connectionId`, on-demand, TTL for cleanup.
    2. Parameterize table name.
  - acceptance_criteria: Table synthesizes with PK `connectionId` and TTL.
  - tests_required: `cdk synth` assertion (key schema, TTL).
  - failure_cases: missing TTL → assertion failure.
  - done_definition: connections table defined.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (IaC definition only)
  - security_or_iam_notes: Only WsConnFnRole reads/writes (TASK-083).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: PK `connectionId` + TTL; on-demand; WebSocket connection storage per the AWS reference pattern; `PostToConnection` confined to Ws roles (TASK-083).
  - demo_or_evidence_output: `cdk synth` assertion (PK connectionId, TTL) + connections-table wiring to the WebSocket API.

- [-] TASK-066 DataStack: Bedrock Knowledge Base, data source, and vector store config
  - objective: Define the Bedrock Knowledge Base (SOP source in S3, article-chunked) with parameterized `kb.knowledge_base_id`, `kb.embedding_model_id`, and vector store, for RAG retrieval (§4.1, §4.2, §14.1).
  - requirements_covered: REQ-005, REQ-007, REQ-008, R5, R15, R16
  - design_sections: §4.1, §4.2, §14.1
  - components: DataStack (Bedrock KB + data source + vector store)
  - files_or_modules_expected: `infra/lib/constructs/knowledge_base.ts`
  - dependencies: [TASK-060]
  - implementation_steps:
    1. Define KB with data source pointing at `s3.sop_source_bucket` (7 article chunks) and parameterized embedding model.
    2. Define vector store (default OpenSearch Serverless) parameterized; document S3 direct-read fallback (Phase 6).
    3. Parameterize `kb.knowledge_base_id`, `kb.data_source_bucket`, region.
  - acceptance_criteria: KB + data source + vector store synthesize with parameterized IDs/models; region-parameterized.
  - tests_required: `cdk synth` assertion (KB + data source present, params wired).
  - failure_cases: hard-coded model/region → assertion failure.
  - done_definition: KB infrastructure defined and parameterized.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon Bedrock Knowledge Bases, OpenSearch Serverless, S3 (IaC definition only)
  - security_or_iam_notes: This task defines KB + data source + vector store only; the actual S3→KB ingestion JOB (StartIngestionJob) is the deployment-time mechanism in TASK-178 (owned by IngestionRole, TASK-083), NOT a runtime Lambda. RendererFnRole gets KB `Retrieve` only (TASK-078).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: KB + data source (7 article chunks) + vector store fully parameterized (`kb.knowledge_base_id`/`kb.embedding_model_id`/region), no hard-coded model/region; ingestion job execution deferred to deployment-time TASK-178 (never a runtime handler).
  - demo_or_evidence_output: `cdk synth` assertion showing KB + data source + parameterized vector store; documented S3 direct-read fallback.

- [ ] TASK-067 ComputeStack: Lambda function definitions (all 10 runtime handlers)
  - objective: Define the ten RUNTIME Lambda functions (InjectFn, WorkflowStatusFn, RecoveryGateFn, DecisionFn, RendererFn, PublishFn, ApiReadFn, WsPushFn, ConnFn, WhatIfFn) with memory/timeout/reserved-concurrency and env wiring, referencing their handler code packages (§6 圖2, §8, §20, §27). There is NO `IngestionFn` runtime Lambda — §6 圖2 defines no such runtime node; S3→KB ingestion is a DEPLOYMENT-TIME mechanism (§14.1, §25 step 1) provisioned by TASK-178, not a runtime handler. `WhatIfFn` is the dedicated What-if host (§12 POST /what-if, §14.5) so What-if never runs inside RendererFn/ApiReadFn/DecisionFn (preserves write-isolation/single-responsibility).
  - requirements_covered: REQ-003..REQ-022, REQ-006 (What-if host), R2..R16
  - design_sections: §6 圖2 (compute nodes), §8, §14.5 (What-if), §18, §20 (timeouts), §27 (concurrency)
  - components: ComputeStack (Lambda provisioning for the 10 runtime functions incl. dedicated WhatIfFn; no IngestionFn)
  - files_or_modules_expected: `infra/lib/constructs/lambdas.ts`
  - dependencies: [TASK-059, TASK-061, TASK-062, TASK-063, TASK-064, TASK-065]
  - implementation_steps:
    1. Define each function with parameterized memory/timeout (e.g., RendererFn and WhatIfFn 30s < 900s cap) and reserved concurrency for DecisionFn (Fast Path priority); WhatIfFn gets its own memory/timeout and Bedrock/KB env.
    2. Inject env: table names, endpoints, model IDs, `env` — all from context/SSM, none hard-coded; WhatIfFn env includes `bedrock.*` and `kb.*` for stage-1 parse + stage-4 explanation.
    3. Accept an explicit injected execution-role reference for every function (constructs expose a role parameter and set NO CDK auto-generated execution role); this task does NOT perform the final role→function binding — the FINAL binding and exact cross-resource grants are completed and verified by TASK-179. Roles are defined in TASK-076..083 and TASK-177 (WhatIfFnRole).
    4. Do NOT define an `IngestionFn` runtime Lambda; the KB ingestion mechanism is the deployment-time CDK Custom Resource Provider in TASK-178 (deployment-support, not a runtime handler, not counted among the 10 runtime Lambdas).
  - acceptance_criteria: Exactly 10 runtime functions synthesize (InjectFn, WorkflowStatusFn, RecoveryGateFn, DecisionFn, RendererFn, PublishFn, ApiReadFn, WsPushFn, ConnFn, WhatIfFn) with parameterized config; each accepts an explicit injected role reference and NO CDK auto-generated runtime execution role is created; DecisionFn has reserved concurrency; NO IngestionFn runtime function present; WhatIfFn handler path wired. FINAL role binding + grants are asserted by TASK-179 (not here).
  - tests_required: `cdk synth` assertion (exactly 10 runtime functions incl WhatIfFn and excluding IngestionFn, memory/timeout params, reserved concurrency on DecisionFn, no auto-generated runtime execution role); final-binding assertion lives in TASK-179.
  - failure_cases: missing reserved concurrency on DecisionFn → assertion failure; an IngestionFn runtime function present → assertion failure; WhatIfFn absent → assertion failure; any CDK auto-generated runtime execution role present → assertion failure.
  - done_definition: Ten runtime Lambdas (incl WhatIfFn, excl IngestionFn) defined with config and explicit role-injection points, using no auto-generated role; final role binding completed by TASK-179.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda (IaC definition only)
  - security_or_iam_notes: Each function exposes an explicit role-injection point for its dedicated least-privilege role (TASK-076..083 + TASK-177 WhatIfFnRole); no shared over-privileged role; no CDK auto-generated runtime execution role; the FINAL role→function binding and exact cross-resource grants are performed and verified by TASK-179.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: All 10 runtime Lambdas defined with parameterized memory/timeout/reserved-concurrency and explicit role-injection points (no auto-generated role); NO IngestionFn runtime Lambda (KB ingestion is the deployment-time CDK Custom Resource Provider, TASK-178); dedicated WhatIfFn present; no shared over-privileged role; no hard-coded account/region/model. Final role binding + grants completed by TASK-179.
  - demo_or_evidence_output: `cdk synth` assertion output listing exactly the 10 runtime functions (incl WhatIfFn, excl IngestionFn) with DecisionFn reserved concurrency, explicit role-injection points, and no auto-generated execution role (final binding verified in TASK-179).

- [ ] TASK-068 ComputeStack: Step Functions Express state machine (ASL)
  - objective: Define the Express Workflow ASL with `MARK_RUNNING` as the first state (`$$.Execution.Id`), the DecisionFn Choice Gate, the ENRICHMENT_ONLY RecoveryGate branch, parallel enrichment branches, and terminal `MARK_COMPLETED`/`MARK_PROCESSING_FAILED` (§4.6, §6, §15.2, Figure 8).
  - requirements_covered: REQ-004, REQ-005, R5
  - design_sections: §4.6, §6, §15.2, Figure 8
  - components: ComputeStack (Step Functions Express)
  - files_or_modules_expected: `infra/statemachine/workflow.asl.json`
  - dependencies: [TASK-067]
  - implementation_steps:
    1. Author ASL: first state `MARK_RUNNING` ($$.Execution.Id); then branch on `recovery_mode` (NORMAL/FULL_WORKFLOW → DecisionFn; ENRICHMENT_ONLY → RecoveryGate).
    2. Add Choice Gate on `core_write_status` (COMMITTED / ALREADY_COMMITTED_SAME_DECISION / CORE_IDENTITY_CONFLICT) and `MARK_CORE_COMMITTED` before fast_path_ready.
    3. Add parallel enrichment branches (REPORT/PUBLIC_ALERT/EXPLANATION) and terminal `MARK_COMPLETED`; Catch → `MARK_PROCESSING_FAILED`.
    4. Parameterize state-machine ARN output for InjectFn; Express type.
  - acceptance_criteria: State machine synthesizes as Express, first state is MARK_RUNNING, includes Choice Gate with the three `core_write_status` branches and parallel enrichment; ARN exported.
  - tests_required: `cdk synth` + ASL structural assertion (first state, choice branches, parallel).
  - failure_cases: DecisionFn before MARK_RUNNING → assertion failure; missing CORE_IDENTITY_CONFLICT branch → failure.
  - done_definition: Express state machine ASL defined per Figure 8.
  - provisional_policy_notes: `orchestration.mode=lambda_direct` is a deployment-time alternative only (not runtime); not wired as a runtime fallback.
  - aws_services_touched: AWS Step Functions Express (IaC definition only)
  - security_or_iam_notes: OrchestratorRole invokes the Lambdas only (TASK-083); state machine does not modify data directly.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Express state machine; first state `MARK_RUNNING` (`$$.Execution.Id`); Choice Gate with the three `core_write_status` branches (COMMITTED / ALREADY_COMMITTED_SAME_DECISION / CORE_IDENTITY_CONFLICT); ENRICHMENT_ONLY RecoveryGate branch; parallel enrichment (REPORT/PUBLIC_ALERT/EXPLANATION); terminal MARK_COMPLETED / MARK_PROCESSING_FAILED; DecisionFn never before MARK_RUNNING; `lambda_direct` is deployment-time-only (never a runtime fallback).
  - demo_or_evidence_output: `cdk synth` + ASL structural assertion (first state, choice branches, parallel enrichment, exported ARN).

- [ ] TASK-069 NetworkAuthStack: API Gateway HTTP API + routes + Cognito authorizer
  - objective: Define the HTTP API with all §12 routes and Cognito authorization on write paths (POST), leaving GET public/relaxed (§4.4, §12, §17).
  - requirements_covered: REQ-003, REQ-006, REQ-021, REQ-022, R5, R13, R14, R16
  - design_sections: §4.4, §12 (route table), §17
  - components: NetworkAuthStack (HTTP API)
  - files_or_modules_expected: `infra/lib/constructs/http_api.ts`
  - dependencies: [TASK-067, TASK-071]
  - implementation_steps:
    1. Define routes: GET `/timeline`,`/roads`,`/crowd`,`/incidents`,`/decisions/{id}`,`/reports/{id}`; POST `/incidents/{id}/inject`,`/what-if`,`/decisions/{id}/publish`.
    2. Attach Cognito authorizer to POST routes (admin/operator/commander scopes); GET public/relaxed.
    3. Integrate routes with InjectFn (POST /incidents/{id}/inject) / ApiReadFn (all GET routes) / WhatIfFn (POST /what-if — dedicated What-if Lambda, TASK-067, role TASK-177) / PublishFn (POST /decisions/{id}/publish); export `api.endpoint`.
  - acceptance_criteria: All §12 routes synthesize; POST routes require Cognito; GET routes do not require admin; endpoint exported.
  - tests_required: `cdk synth` assertion (route count/methods, authorizer on POSTs).
  - failure_cases: unauthenticated POST /inject → assertion failure (must be Cognito-protected).
  - done_definition: HTTP API with authorized write paths defined.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon API Gateway HTTP API, Amazon Cognito (IaC definition only)
  - security_or_iam_notes: Write paths fail-closed without Cognito; least-privilege integration to backend functions only; POST /what-if integrated to the dedicated WhatIfFn (operator scope).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: All §12 routes synthesize; every POST (inject/what-if/publish) Cognito-protected (admin/operator/commander) and fail-closed; POST /what-if integrated to dedicated WhatIfFn; `api.endpoint` exported; no unauthenticated write path.
  - demo_or_evidence_output: `cdk synth` assertion (route count/methods, Cognito authorizer on all POSTs incl /what-if→WhatIfFn, exported api.endpoint).

- [ ] TASK-070 NetworkAuthStack: WebSocket API + routes
  - objective: Define the WebSocket API with `$connect`/`$disconnect`/`$default` + custom routes and `@connections` push integration, backed by the connections table (§4.5, §13).
  - requirements_covered: REQ-001, REQ-004, REQ-008, R4, R5, R15
  - design_sections: §4.5, §13, §16
  - components: NetworkAuthStack (WebSocket API)
  - files_or_modules_expected: `infra/lib/constructs/ws_api.ts`
  - dependencies: [TASK-067, TASK-065]
  - implementation_steps:
    1. Define WebSocket API with `$connect`/`$disconnect`/`$default` and custom routes integrated with ConnFn/WsPushFn.
    2. Grant `PostToConnection` to WsPushFn/WsConnFn only (TASK-083); export `ws.endpoint`.
    3. Wire connection storage to the connections table.
  - acceptance_criteria: WebSocket API synthesizes with the three system routes + custom; `ws.endpoint` exported.
  - tests_required: `cdk synth` assertion (routes present, connections table wired).
  - failure_cases: PostToConnection granted broadly → assertion failure.
  - done_definition: WebSocket API defined with connection management.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon API Gateway WebSocket API (IaC definition only)
  - security_or_iam_notes: Only Ws roles get PostToConnection; other roles explicitly denied (TASK-079/080/081).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: `$connect`/`$disconnect`/`$default` + custom routes; `PostToConnection` granted only to Ws roles (TASK-083); connections table wired; `ws.endpoint` exported; no broad PostToConnection grant.
  - demo_or_evidence_output: `cdk synth` assertion (three system routes + custom, connections table wired, ws.endpoint output).

- [ ] TASK-071 NetworkAuthStack: Cognito user pool + groups (admin/operator/commander)
  - objective: Define the Cognito user pool, app client, and the three groups/scopes that separate admin (inject), operator (what-if), and commander (publish) from public read (§4.10, §17).
  - requirements_covered: REQ-003, REQ-006, REQ-022, R5, R11, R16
  - design_sections: §4.10, §17
  - components: NetworkAuthStack (Cognito)
  - files_or_modules_expected: `infra/lib/constructs/cognito.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define user pool + app client; parameterize `auth.user_pool_id`, `auth.app_client_id`.
    2. Define groups `admin`, `operator`, `commander` with scope/claim mapping.
    3. Document LOCAL_MOCK auth-disabled path (ConfigProvider toggle).
  - acceptance_criteria: User pool + three groups synthesize; IDs parameterized; groups map to write-path scopes.
  - tests_required: `cdk synth` assertion (pool + 3 groups + client).
  - failure_cases: missing group → assertion failure.
  - done_definition: Cognito with role separation defined.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon Cognito (IaC definition only)
  - security_or_iam_notes: Fail-closed on write paths when Cognito unavailable (tested TASK-161); read paths unaffected.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: user pool + app client + admin/operator/commander groups/scopes; public read separate; write paths fail-closed without Cognito (§17).
  - demo_or_evidence_output: `cdk synth` assertion (three groups/scopes; write-path authorizer wiring).

- [ ] TASK-072 FrontendStack: Amplify Hosting (or S3+CloudFront) with hosting switch
  - objective: Define frontend hosting selectable via `frontend.hosting` (Amplify default, S3+CloudFront alternative) with build-time endpoint injection (§4.9, §24).
  - requirements_covered: REQ-024, REQ-030, REQ-032, R4, R17
  - design_sections: §4.9, §24, §25.1
  - components: FrontendStack (hosting)
  - files_or_modules_expected: `infra/lib/constructs/frontend_hosting.ts`
  - dependencies: [TASK-059, TASK-069, TASK-070]
  - implementation_steps:
    1. Define Amplify Hosting for the React/TS SPA; alternative S3+CloudFront behind `frontend.hosting`.
    2. Inject `api.endpoint`/`ws.endpoint` as build-time env; export deployment URL param.
    3. Set removal policy per profile.
  - acceptance_criteria: Hosting synthesizes for both `amplify` and `s3_cloudfront`; endpoints injected; URL exported.
  - tests_required: `cdk synth` assertion for both hosting modes.
  - failure_cases: endpoints hard-coded in build → assertion failure.
  - done_definition: Frontend hosting defined and switchable.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Amplify Hosting, Amazon S3, Amazon CloudFront (IaC definition only)
  - security_or_iam_notes: HTTPS only; no secrets in build env; public read is static assets only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: Amplify Hosting (or S3+CloudFront) selectable via `frontend.hosting`; build injects `api.endpoint`/`ws.endpoint`; provides the hosting that yields the accessible deployment URL for the official "Dashboard Live Demo" deliverable (REQ-024, realized via TASK-167/171); no placeholder hosting.
  - demo_or_evidence_output: `cdk synth` assertion (hosting construct + hosting switch); deployment URL is the live-demo evidence (via TASK-171 keep-URL).

- [ ] TASK-073 SSM Parameter Store provisioning and env-param definitions
  - objective: Define the SSM parameters for all non-secret configuration keys (§23.1) so PERSONAL_AWS_DEV/COMPETITION_AWS resolve config with no hard-coding (§4.12).
  - requirements_covered: REQ-024, REQ-032, R-supporting (all)
  - design_sections: §4.12, §23.1
  - components: (SSM parameter definitions across stacks)
  - files_or_modules_expected: `infra/lib/constructs/ssm_params.ts`
  - dependencies: [TASK-059, TASK-006]
  - implementation_steps:
    1. Define SSM parameters for every non-secret key in §23.1 (region, model IDs, KB ID, buckets, endpoints, flags, `policy.*`).
    2. Parameterize name prefixes per environment.
    3. Ensure `SsmConfigProvider` (TASK-005) key prefixes match.
  - acceptance_criteria: All §23.1 non-secret keys have SSM parameters; prefixes align with provider; no secret values here.
  - tests_required: `cdk synth` assertion cross-checking §23.1 key list; secret-exclusion check.
  - failure_cases: a secret placed in SSM → assertion failure (must be Secrets Manager).
  - done_definition: SSM parameters defined for the full config schema.
  - provisional_policy_notes: `policy.*` Strategy A–F knobs are SSM parameters, keeping provisional policies switchable in AWS profiles.
  - aws_services_touched: AWS Systems Manager Parameter Store (IaC definition only)
  - security_or_iam_notes: Non-secret only; read access granted narrowly per role.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: All §23.1 non-secret keys provisioned (incl `policy.*` knobs); no secrets in Parameter Store; endpoints written back post-deploy; no hard-coded account/region/model.
  - demo_or_evidence_output: `cdk synth` assertion (parameter set matches §23.1 key list).

- [ ] TASK-074 Secrets Manager provisioning
  - objective: Define Secrets Manager secret placeholders for any real secrets so credentials never live in code, SSM, or logs (§4.12, §17).
  - requirements_covered: REQ-032, R-supporting (security)
  - design_sections: §4.12, §17
  - components: (Secrets Manager definitions)
  - files_or_modules_expected: `infra/lib/constructs/secrets.ts`
  - dependencies: [TASK-059]
  - implementation_steps:
    1. Define secret placeholders (by name/ARN) for any runtime secret; no secret material in IaC.
    2. Grant read only to roles that require it (RendererFnRole for model access if needed).
    3. Document fail-closed on secret fetch failure.
  - acceptance_criteria: Secret placeholders synthesize; no secret literals; narrow read grants.
  - tests_required: `cdk synth` assertion (no inline secret values).
  - failure_cases: secret value inlined → assertion failure.
  - done_definition: Secrets Manager placeholders defined.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Secrets Manager (IaC definition only)
  - security_or_iam_notes: Fail-closed; secrets referenced by name; never logged.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Secret placeholders only; retrieval failure → fail-closed (no plaintext fallback); no plaintext secret in IaC or logs.
  - demo_or_evidence_output: `cdk synth` assertion (Secrets Manager construct; no inline secret values).

- [ ] TASK-075 CloudWatch log groups, custom metrics, alarms, and optional X-Ray toggle
  - objective: Define per-Lambda log groups, custom latency/failure metric namespaces, latency alarms, and an `observability.xray_enabled` toggle (§4.11, §19).
  - requirements_covered: REQ-004, REQ-032, R4, R5
  - design_sections: §4.11, §19, §10.16
  - components: (CloudWatch + optional X-Ray)
  - files_or_modules_expected: `infra/lib/constructs/observability.ts`
  - dependencies: [TASK-067]
  - implementation_steps:
    1. Define log groups per function (parameterized names) and a metric namespace.
    2. Define alarms for `EndToEndLatencyMs > 60s` and high Bedrock failure rate.
    3. Add `observability.xray_enabled` toggle enabling X-Ray tracing on functions.
  - acceptance_criteria: Log groups + alarms synthesize; X-Ray toggle switches tracing; namespace parameterized.
  - tests_required: `cdk synth` assertion (alarms present, toggle honored).
  - failure_cases: alarm missing 60s threshold → assertion failure.
  - done_definition: Observability infra defined with optional X-Ray.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon CloudWatch, AWS X-Ray (optional) (IaC definition only)
  - security_or_iam_notes: Logs must not contain credentials (enforced in Phase 10 logging tasks).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Log groups + custom metrics `FastPathLatencyMs` (5s TEAM_TARGET) and `EndToEndLatencyMs` (60s OFFICIAL) + failure counters + alarms; X-Ray behind `observability.xray_enabled` toggle; structured logs never contain credentials.
  - demo_or_evidence_output: `cdk synth` assertion (metrics namespace, alarms, X-Ray toggle).

- [ ] TASK-076 IAM: InjectFnRole (precise allow/deny, FIX 2)
  - objective: Define `InjectFnRole` with exact allows (Idempotency Get/Put/Update, StartExecution on the selected state-machine ARN, `lambda:InvokeFunction` on ONLY RecoveryGateFn + WorkflowStatusFn exact ARNs, CloudWatch Logs, SSM read) and explicit denies (no invoke wildcard, no decision-table writes, no Bedrock/KB/PostToConnection/S3-write, no DynamoDB table wildcard) (§18).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §18 (InjectFnRole), §8, §15.1
  - components: IAM (InjectFnRole)
  - files_or_modules_expected: `infra/lib/iam/inject_fn_role.ts`
  - dependencies: [TASK-061, TASK-067, TASK-068]
  - implementation_steps:
    1. Allow: `dynamodb:GetItem/PutItem/UpdateItem` on IdempotencyTable ARN; `states:StartExecution` on the state-machine ARN; `lambda:InvokeFunction` on RecoveryGateFn ARN and WorkflowStatusFn ARN (exact); CloudWatch Logs; SSM read.
    2. Explicit `Deny`: `lambda:InvokeFunction` `*`, writes to DecisionCore/DecisionNarrative/PublishRecord, Bedrock, KB `Retrieve`, WebSocket `PostToConnection`, S3 write, any DynamoDB table wildcard.
    3. Bind role to InjectFn (TASK-067).
  - acceptance_criteria: Synth shows exact ARNs (no wildcards) and the explicit denies; invoke limited to the two exact function ARNs.
  - tests_required: IAM policy assertion tests (allow/deny statements); IAM denial test in TASK-160.
  - failure_cases: any wildcard invoke or table write present → assertion failure.
  - done_definition: InjectFnRole matches §18 exactly.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: Enforces FIX-2 writer isolation and stale-running orchestration path at the IAM layer.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Precise ALLOW (GetItem/PutItem/UpdateItem on IdempotencyTable, StartExecution on the chosen state-machine ARN, InvokeFunction on RecoveryGateFn + WorkflowStatusFn EXACT ARNs, CloudWatch, SSM read); explicit DENY (wildcard `lambda:InvokeFunction`, Core/Narrative/Publish writes, Bedrock, KB Retrieve, PostToConnection, S3 write, DynamoDB table wildcard). FIX-2 shared-status ownership.
  - demo_or_evidence_output: IAM policy assertion (allow/deny sets) + denial test (TASK-160) proving no wildcard invoke and no decision-table write.

- [ ] TASK-077 IAM: DecisionFnRole (Deny IdempotencyTable writes)
  - objective: Define `DecisionFnRole` allowing S3 raw read, DecisionCoreTable read/write (sole writer), CloudWatch, SSM read, with explicit `Deny` on any IdempotencyTable write (incl `core_committed`) and no Bedrock/Narrative/Publish writes (§18, §9.3).
  - requirements_covered: REQ-011..REQ-022, R2..R16
  - design_sections: §18 (DecisionFnRole), §9.3, §15.1
  - components: IAM (DecisionFnRole)
  - files_or_modules_expected: `infra/lib/iam/decision_fn_role.ts`
  - dependencies: [TASK-061, TASK-062, TASK-060, TASK-067]
  - implementation_steps:
    1. Allow: S3 raw read, `dynamodb:GetItem/PutItem/UpdateItem` on DecisionCoreTable, CloudWatch Logs, SSM read.
    2. Explicit `Deny`: `dynamodb:PutItem/UpdateItem/DeleteItem` on IdempotencyTable; no Bedrock; no writes to DecisionNarrative/PublishRecord.
    3. Bind to DecisionFn.
  - acceptance_criteria: Synth shows DecisionCore write allow + IdempotencyTable write Deny; no Bedrock permission.
  - tests_required: IAM policy assertion; denial test (TASK-160).
  - failure_cases: any IdempotencyTable write allow present → assertion failure.
  - done_definition: DecisionFnRole matches §18.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: Guarantees `core_committed` is written only by WorkflowStatusFn (PATCH 2 / FIX 2).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ALLOW read S3 raw + read/write DecisionCoreTable (SOLE writer) + CloudWatch + SSM; explicit DENY any IdempotencyTable write (incl `core_committed`), Narrative/Publish writes, and Bedrock. Enforces §9 at the IAM layer.
  - demo_or_evidence_output: IAM policy assertion + denial test (TASK-160) proving DecisionFn cannot write IdempotencyTable.

- [ ] TASK-078 IAM: RendererFnRole (Deny DecisionCore write)
  - objective: Define `RendererFnRole` allowing Bedrock InvokeModel/Converse, KB `Retrieve`, S3 SOP read, DecisionCore read-only, and conditional Put of DecisionNarrative `narrative_type` items, with explicit `Deny` on any DecisionCore write and Publish/Idempotency writes (§18, §9.3).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R13, R14, R15
  - design_sections: §18 (RendererFnRole), §9.3, §10.11b
  - components: IAM (RendererFnRole)
  - files_or_modules_expected: `infra/lib/iam/renderer_fn_role.ts`
  - dependencies: [TASK-062, TASK-063, TASK-066, TASK-067]
  - implementation_steps:
    1. Allow: Bedrock InvokeModel/Converse, KB `Retrieve`, S3 SOP read, DecisionCore `GetItem` (read-only), DecisionNarrative conditional `PutItem`, CloudWatch, SSM/Secrets read.
    2. Explicit `Deny`: `dynamodb:PutItem/UpdateItem/DeleteItem` on DecisionCoreTable; no writes to PublishRecord/Idempotency.
    3. Bind to RendererFn.
  - acceptance_criteria: Synth shows DecisionCore read-only + explicit write Deny; Narrative write allowed (conditional Put).
  - tests_required: IAM policy assertion; denial test (TASK-160).
  - failure_cases: any DecisionCore write allow present → assertion failure.
  - done_definition: RendererFnRole matches §18.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM, Amazon Bedrock (IaC definition only)
  - security_or_iam_notes: IAM-level enforcement of the §9 deterministic/Bedrock boundary.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ALLOW Bedrock InvokeModel/Converse + KB Retrieve + read S3 SOP + read-only DecisionCore + `attribute_not_exists(decision_id)` conditional Put on the DecisionNarrativeTable `narrative_type` item; explicit DENY DecisionCore write (Put/Update/Delete) and Publish/Idempotency writes. Enforces §9 (text-only) at the IAM layer.
  - demo_or_evidence_output: IAM policy assertion + denial test (TASK-160) proving zero DecisionCore write.

- [ ] TASK-079 IAM: WorkflowStatusFnRole (IdempotencyTable-only, fencing)
  - objective: Define `WorkflowStatusFnRole` allowing only `GetItem` (with `ConsistentRead`) / `UpdateItem` on IdempotencyTable and CloudWatch Logs, with explicit `Deny` on writing any other DynamoDB table, Bedrock, S3 raw write, and WebSocket `PostToConnection` (§18).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §18 (WorkflowStatusFnRole), §10.11e, §15.2
  - components: IAM (WorkflowStatusFnRole)
  - files_or_modules_expected: `infra/lib/iam/workflow_status_fn_role.ts`
  - dependencies: [TASK-061, TASK-067]
  - implementation_steps:
    1. Allow: `dynamodb:GetItem`/`UpdateItem` on IdempotencyTable only; CloudWatch Logs.
    2. Explicit `Deny`: writes to DecisionCore/DecisionNarrative/PublishRecord/connections; Bedrock; S3 raw write; WebSocket `PostToConnection`.
    3. Bind to WorkflowStatusFn.
  - acceptance_criteria: Synth shows Idempotency-only write and the four explicit denies; no PostToConnection.
  - tests_required: IAM policy assertion; denial test (TASK-160).
  - failure_cases: any other-table write or PostToConnection allow → assertion failure.
  - done_definition: WorkflowStatusFnRole matches §18.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: Ensures WorkflowStatusFn never pushes public alerts or writes decision tables.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ALLOW only `GetItem`(ConsistentRead)/`UpdateItem` on IdempotencyTable for the five fenced actions; explicit DENY writing any other table, Bedrock, S3 raw write, and WebSocket PostToConnection (never pushes public alerts).
  - demo_or_evidence_output: IAM policy assertion + denial test (TASK-160) proving IdempotencyTable-only writes and no PostToConnection.

- [ ] TASK-080 IAM: RecoveryGateFnRole (read-only, ConsistentRead)
  - objective: Define `RecoveryGateFnRole` allowing only strong-consistent reads — `GetItem` (ConsistentRead) on Idempotency and DecisionCore, `Query` (ConsistentRead, base table only) on DecisionNarrative — plus CloudWatch Logs, with explicit `Deny` on all DynamoDB writes, Bedrock, WebSocket, and S3 write (§18).
  - requirements_covered: REQ-004, R5
  - design_sections: §18 (RecoveryGateFnRole), §10.11e, §15.2
  - components: IAM (RecoveryGateFnRole)
  - files_or_modules_expected: `infra/lib/iam/recovery_gate_fn_role.ts`
  - dependencies: [TASK-061, TASK-062, TASK-063, TASK-067]
  - implementation_steps:
    1. Allow: `dynamodb:GetItem` (ConsistentRead) on Idempotency + DecisionCore; `dynamodb:Query` (ConsistentRead) on DecisionNarrative base table; CloudWatch Logs.
    2. Explicit `Deny`: all DynamoDB writes (Put/Update/Delete, all tables); Bedrock; WebSocket `PostToConnection`; S3 write.
    3. Bind to RecoveryGateFn.
  - acceptance_criteria: Synth shows read-only strong-consistent grants + explicit write/Bedrock/WS/S3 denies; no GSI dependency.
  - tests_required: IAM policy assertion; denial test (TASK-160).
  - failure_cases: any DynamoDB write allow → assertion failure.
  - done_definition: RecoveryGateFnRole matches §18.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: Separates "read judgment" from "state change" (state change only by WorkflowStatusFn/InjectFn).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ALLOW only strong-consistent `GetItem` (Idempotency/Core) + `Query` (Narrative base table, not eventually-consistent GSI); explicit DENY any DynamoDB write, Bedrock, WebSocket PostToConnection, S3 write. Read/judgment separated from state change.
  - demo_or_evidence_output: IAM policy assertion + denial test (TASK-160) proving zero writes across all tables.

- [ ] TASK-081 IAM: ApiReadFnRole (read-only incl IdempotencyTable GetItem, FIX 1)
  - objective: Define `ApiReadFnRole` allowing only read (`GetItem`/`Query`) on DecisionCore/DecisionNarrative/PublishRecord and `GetItem` (read-only) on IdempotencyTable for the execution summary, plus CloudWatch and SSM read, with explicit `Deny` on all DynamoDB writes, Bedrock, StartExecution, PostToConnection, and S3 write (§18, §10.11c FIX 1).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R13, R14, R15
  - design_sections: §18 (ApiReadFnRole), §10.11c, §12
  - components: IAM (ApiReadFnRole)
  - files_or_modules_expected: `infra/lib/iam/api_read_fn_role.ts`
  - dependencies: [TASK-061, TASK-062, TASK-063, TASK-064, TASK-067]
  - implementation_steps:
    1. Allow: read on DecisionCore/DecisionNarrative/PublishRecord; `GetItem` (read-only) on IdempotencyTable (execution summary); CloudWatch Logs; SSM read.
    2. Explicit `Deny`: all DynamoDB writes (incl IdempotencyTable); Bedrock; `states:StartExecution`; `PostToConnection`; S3 write.
    3. Bind to ApiReadFn.
  - acceptance_criteria: Synth shows read-only on four tables + explicit denies; IdempotencyTable is GetItem-only.
  - tests_required: IAM policy assertion; denial test (TASK-160).
  - failure_cases: any write allow → assertion failure.
  - done_definition: ApiReadFnRole matches §18 (FIX 1).
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: Enables the read-only `execution` projection without any write capability.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ALLOW read-only `GetItem`/`Query` on Core/Narrative/Publish + read-only `GetItem` on IdempotencyTable (execution summary, FIX 1) + CloudWatch + SSM; explicit DENY any DynamoDB write (all tables), Bedrock, StartExecution, PostToConnection, S3 write.
  - demo_or_evidence_output: IAM policy assertion + denial test (TASK-160) proving read-only incl. IdempotencyTable GetItem and no writes.

- [ ] TASK-082 IAM: PublishFnRole (Deny DecisionCore write)
  - objective: Define `PublishFnRole` allowing DecisionCore/DecisionNarrative read-only, PublishRecordTable write, publish-simulation channels, and CloudWatch, with explicit `Deny` on any DecisionCore write (§18, §10.11d).
  - requirements_covered: REQ-022, R11
  - design_sections: §18 (PublishFnRole), §10.11d
  - components: IAM (PublishFnRole)
  - files_or_modules_expected: `infra/lib/iam/publish_fn_role.ts`
  - dependencies: [TASK-062, TASK-063, TASK-064, TASK-067]
  - implementation_steps:
    1. Allow: read-only DecisionCore/DecisionNarrative; write PublishRecordTable; CloudWatch Logs.
    2. Explicit `Deny`: any DecisionCore write; no Idempotency write.
    3. Bind to PublishFn.
  - acceptance_criteria: Synth shows PublishRecord write + DecisionCore read-only + explicit DecisionCore write Deny.
  - tests_required: IAM policy assertion; denial test (TASK-160).
  - failure_cases: DecisionCore write allow → assertion failure.
  - done_definition: PublishFnRole matches §18.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: `publish_state` never written back to immutable DecisionCore.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ALLOW read-only Core/Narrative + write PublishRecordTable (`publish_state`/`audit_trail`) + publish-simulation channels + CloudWatch; explicit DENY DecisionCore write; `publish_state` never written back to the immutable Core.
  - demo_or_evidence_output: IAM policy assertion + denial test (TASK-160) proving PublishFn cannot write DecisionCore.

- [ ] TASK-083 IAM: WsConnFnRole, OrchestratorRole, IngestionRole
  - objective: Define the remaining roles — WsConnFnRole (connections R/W + PostToConnection), OrchestratorRole (invoke the workflow Lambdas only), IngestionRole (exact Bedrock ingestion API actions + SOP-source S3 read + config SSM read) — each least-privilege per §18. IngestionRole is an implementation-level least-privilege realization of the Frozen Design §18 isolation principle; it is attached to the deployment-time CDK Custom Resource Provider handlers defined in TASK-178 (it is NOT a runtime Lambda role, and is never attached to any application runtime Lambda). It does not alter the logical architecture.
  - requirements_covered: REQ-001, REQ-004, REQ-005, R1, R4, R5
  - design_sections: §18 (WsConnFnRole/OrchestratorRole/IngestionRole), §14.1 (deployment-time ingestion)
  - components: IAM (WsConnFnRole, OrchestratorRole, IngestionRole)
  - files_or_modules_expected: `infra/lib/iam/ws_conn_fn_role.ts`, `infra/lib/iam/orchestrator_role.ts`, `infra/lib/iam/ingestion_role.ts`
  - dependencies: [TASK-065, TASK-066, TASK-067, TASK-068]
  - implementation_steps:
    1. WsConnFnRole: connections table R/W + `PostToConnection`; `Deny` raw read + DecisionCore write.
    2. OrchestratorRole: `lambda:InvokeFunction` on the workflow Lambdas ONLY (DecisionFn/RendererFn/WorkflowStatusFn/RecoveryGateFn exact ARNs); no direct data modification; MUST NOT invoke WhatIfFn/InjectFn/PublishFn/ApiReadFn/WsPushFn/ConnFn; attached ONLY to Step Functions (final binding verified in TASK-179).
    3. IngestionRole (attached to the TASK-178 CDK Custom Resource Provider onEvent/isComplete handlers): exact Bedrock ALLOW `bedrock:StartIngestionJob`, `bedrock:GetIngestionJob`, `bedrock:GetKnowledgeBase`, `bedrock:GetDataSource` (add `bedrock:ListIngestionJobs` ONLY if TASK-178 actually lists jobs); S3 ALLOW only `s3:GetObject` + `s3:ListBucket` scoped to the SOP source bucket/prefix; SSM ALLOW only the necessary config prefix; CloudWatch Logs for the provider's own log group. Explicit `Deny`: S3 write (read-only source); write to DecisionCoreTable/DecisionNarrativeTable/PublishRecordTable/IdempotencyTable; `states:StartExecution`; WebSocket `PostToConnection`; Bedrock model invocation (`InvokeModel`/`Converse`); wildcard `lambda:InvokeFunction`; wildcard DynamoDB write. Use the minimal supported ARN scope; if any action only supports `Resource:"*"`, explain in `security_or_iam_notes` and narrow via condition keys — never a bare wildcard without explanation.
  - acceptance_criteria: All three roles synthesize with least privilege and the listed denies; IngestionRole uses exact Bedrock ingestion actions (not "KB data source write"), is attached to the TASK-178 CDK Custom Resource Provider handlers (traceable: IngestionRole → deployment provider → TASK-178 → handler modules → exact permissions → tests → deployment validation → smoke gate), and is attached to NO application runtime Lambda; OrchestratorRole attached only to Step Functions.
  - tests_required: IAM policy assertion (3 roles; IngestionRole exact Bedrock/S3/SSM allow set + full deny set); denial test (TASK-160); binding assertion in TASK-179.
  - failure_cases: IngestionRole S3 write allow → assertion failure; IngestionRole attached to a runtime Lambda → assertion failure; IngestionRole Bedrock model-invoke or state/StartExecution/PostToConnection allow → assertion failure; OrchestratorRole invoking any non-workflow Lambda → assertion failure.
  - done_definition: Remaining roles match §18; IngestionRole realized with exact Bedrock ingestion actions and attached to the TASK-178 CDK Custom Resource Provider handlers.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: RealtimePublisher push capability confined to Ws roles; IngestionRole is an implementation-derived least-privilege enforcement artifact realizing §18 isolation, attached only to the TASK-178 deployment-time provider handlers, cannot mutate the read-only source, and cannot invoke Bedrock models or write any application-state table; never a runtime handler role.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Three least-privilege roles with exact allow/deny; IngestionRole realized with exact Bedrock ingestion API actions (`StartIngestionJob`/`GetIngestionJob`/`GetKnowledgeBase`/`GetDataSource`) + SOP-source S3 read + config SSM read, attached to the TASK-178 CDK Custom Resource Provider handlers (explicit owner, fully traceable), never attached to a runtime Lambda; OrchestratorRole invokes only the four workflow Lambdas and is attached only to Step Functions; no orphaned role, no over-privileged role, no wildcard.
  - demo_or_evidence_output: IAM policy assertion output for the 3 roles + denial test (TASK-160) proving IngestionRole cannot write raw/invoke Bedrock models/write state tables and Orchestrator cannot mutate data or invoke non-workflow Lambdas.

- [ ] TASK-177 IAM: WhatIfFnRole (dedicated What-if runtime least privilege)
  - objective: Define the dedicated `WhatIfFnRole` for the What-if runtime Lambda (WhatIfFn, TASK-067). `WhatIfFnRole` is an implementation-derived least-privilege IAM enforcement artifact: it is an implementation-level least-privilege realization of the Frozen Design §9 and §18 isolation principles, and it does not alter the logical architecture. What-if is an already-approved frozen capability (§12 POST /what-if Cognito(operator); §14.5 four stages) that must NOT mutate state or write any decision table, yet needs Bedrock + KB + deterministic recompute; this role introduces no new business rule, API route, DynamoDB table, AWS service, decision authority, or user capability — it uses the already-frozen Lambda service and the design's least-privilege IAM pattern (adds NO new AWS service; respects §9/§18).
  - requirements_covered: REQ-006, REQ-007, R16
  - design_sections: §9 (deterministic/Bedrock boundary), §12 (POST /what-if operator), §14.5 (4 stages), §18 (least-privilege pattern)
  - components: IAM (WhatIfFnRole)
  - files_or_modules_expected: `infra/lib/iam/whatif_fn_role.ts`
  - dependencies: [TASK-066, TASK-067, TASK-071]
  - implementation_steps:
    1. ALLOW: Bedrock `InvokeModel`/`Converse` (stage-1 ScenarioParser + stage-4 explanation), KB `Retrieve` (SOP citation), read-only source data + read-only `DecisionCoreTable` `GetItem` (context for recompute if needed), CloudWatch Logs, SSM read.
    2. Explicit `Deny`: writes to `DecisionCoreTable`/`DecisionNarrativeTable`/`PublishRecordTable`/`IdempotencyTable`; `states:StartExecution`; WebSocket `PostToConnection`; S3 write; any wildcard `lambda:InvokeFunction`/table write.
    3. Bind WhatIfFnRole to WhatIfFn (TASK-067); Cognito `operator` authorization enforced at the API (TASK-069).
  - acceptance_criteria: WhatIfFnRole synthesizes with the exact ALLOW set and explicit DENY set; zero write to any decision/narrative/publish/idempotency table; no `StartExecution`; no `PostToConnection`; no wildcard.
  - tests_required: IAM policy assertion (allow Bedrock/KB/read-only; deny all writes/StartExecution/PostToConnection/wildcard); denial test folded into TASK-160.
  - failure_cases: any write allow or wildcard → assertion failure; `StartExecution`/`PostToConnection` allow → assertion failure.
  - done_definition: Dedicated WhatIfFnRole defined per least privilege, enforcing What-if write-isolation.
  - provisional_policy_notes: OQ-009 boundary stays configurable; the role never grants numeric-truth authority to Bedrock.
  - aws_services_touched: AWS IAM (IaC definition only)
  - security_or_iam_notes: Enforces §9 boundary for What-if at the IAM layer — Bedrock+KB read only, zero state writes, fail-closed operator scope.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Dedicated least-privilege role with exact ALLOW (Bedrock/KB/read-only/CloudWatch/SSM) and explicit DENY (all decision/narrative/publish/idempotency writes, StartExecution, PostToConnection, S3 write, wildcards); never shared/over-privileged.
  - demo_or_evidence_output: IAM policy assertion output proving the ALLOW/DENY sets; denial test showing a What-if write/StartExecution/PostToConnection attempt is rejected.

- [ ] TASK-178 Deployment-time KB ingestion mechanism (AWS CDK Custom Resource Provider Framework, NO runtime Lambda)
  - objective: Provide the DEPLOYMENT-TIME S3→Bedrock KB ingestion mechanism whose primary and only mechanism is the **AWS CDK Custom Resource Provider Framework**: an `onEvent` handler that calls `StartIngestionJob` and an `isComplete` handler that calls `GetIngestionJob` until `COMPLETE`/`FAILED`/timeout. It loads the article-chunked SOP into the KB data source and verifies completion — replacing the removed `IngestionFn` runtime Lambda (§6 圖2 defines no runtime ingestion node; §14.1 + §25 step 1 define ingestion as deployment-time). The Provider Framework runs under `IngestionRole` (TASK-083). This is deployment-support (NOT counted among the 10 application runtime Lambdas). `scripts/kb_ingest.ts` MAY exist ONLY as a manual recovery-and-verification fallback and is never the primary mechanism.
  - requirements_covered: REQ-005, REQ-007, REQ-008, REQ-032, R5, R15, R16
  - design_sections: §14.1 (KB build, deployment-time), §25 step 1 (deploy + KB sync), §10.0 (source hash), §18 (IngestionRole)
  - components: Deployment-time ingestion mechanism (AWS CDK Custom Resource Provider Framework: onEvent + isComplete handlers), IngestionRole (owner/attached role)
  - files_or_modules_expected: `infra/lib/constructs/kb_ingestion_provider.ts` (CDK Custom Resource Provider construct), `infra/lib/constructs/kb_ingestion_custom_resource.ts`, `scripts/kb_ingest.ts` (manual recovery/verification fallback ONLY)
  - dependencies: [TASK-007, TASK-060, TASK-066, TASK-083]
  - implementation_steps:
    1. Primary mechanism = AWS CDK Custom Resource Provider Framework: `onEvent` handler calls `StartIngestionJob` against the KB data source; `isComplete` handler calls `GetIngestionJob` and polls until `COMPLETE`/`FAILED`/timeout. No operator runbook step and no runtime Lambda is the primary mechanism; the implementation does not choose the primary mechanism at runtime.
    2. Verify the 7-source SHA-256 (TASK-007) BEFORE ingestion; a hash mismatch STOPs ingestion (never ingest an unknown version); derived mirrors are never treated as source of truth.
    3. Require a deterministic client token: `clientToken = SHA-256(knowledge_base_id + data_source_id + source_manifest_hash)` (or an equivalent stable canonical token) so a repeat deploy of the same source version creates no semantically-duplicate ingestion job (duplicate-safe/idempotent).
    4. On ingestion failure/timeout/unknown status → fail closed and STOP gate: block competition release (no smoke/RAG until ingestion verified `COMPLETE`); derived KB mirrors never become source of truth.
    5. Expose completion verification consumed by the deploy runbook (TASK-167) and the smoke gate (TASK-169): KB ingestion `COMPLETE` is verified BEFORE any RAG smoke test.
    6. `application_runtime_lambda_count: 10`; `deployment_support_lambda_count_status: SYNTH_DERIVED`. TASK-178 and TASK-180 must use CDK synth assertions to enumerate and record the exact physical deployment-support Lambda resources separately from the ten application runtime Lambdas. Deployment-support Lambdas MUST NOT be counted among the 10 application runtime Lambdas.
  - acceptance_criteria: (1) source hash mismatch → no ingestion; (2) `StartIngestionJob` accepted with the deterministic client token; (3) repeated same client token is duplicate-safe (no semantically-duplicate job); (4) status transitions STARTING→IN_PROGRESS→COMPLETE handled; (5) `FAILED` → release blocked; (6) timeout → release blocked; (7) unknown status → fail closed; (8) RAG smoke cannot start before `COMPLETE`; (9) a derived mirror is rejected as source; (10) IngestionRole cannot mutate the source. Runs at deployment time only (never a runtime handler).
  - tests_required: unit tests for (1) source hash mismatch→no ingestion; (2) StartIngestionJob accepted; (3) repeated clientToken duplicate-safe; (4) STARTING→IN_PROGRESS→COMPLETE; (5) FAILED→release blocked; (6) timeout→release blocked; (7) unknown status→fail closed; (8) RAG smoke cannot start before COMPLETE; (9) derived mirror rejected; (10) IngestionRole cannot mutate source; deployment-validation folded into TASK-167/TASK-169 runbooks (operator-executed; no deploy here).
  - failure_cases: hash mismatch → STOP (no ingest); ingestion FAILED/timeout/unknown → fail closed, release blocked, RAG smoke not run; treating a derived mirror as source → rejected.
  - done_definition: Deployment-time KB ingestion realized via the AWS CDK Custom Resource Provider Framework (onEvent StartIngestionJob + isComplete GetIngestionJob) with deterministic client token, completion verification + STOP gate; no runtime IngestionFn; deployment-support Lambdas distinguished from the 10 runtime Lambdas.
  - provisional_policy_notes: none (source hashes and ingestion completion are official/deployment facts).
  - aws_services_touched: Amazon Bedrock Knowledge Bases (StartIngestionJob/GetIngestionJob/GetKnowledgeBase/GetDataSource), S3 (read), AWS IAM IngestionRole, AWS CDK Custom Resource Provider Framework (IaC/custom-resource definition only; no deploy executed here)
  - security_or_iam_notes: Runs under IngestionRole attached to the Provider Framework onEvent/isComplete handlers — exact Bedrock ingestion actions (`StartIngestionJob`/`GetIngestionJob`/`GetKnowledgeBase`/`GetDataSource`), SOP-source `s3:GetObject`/`s3:ListBucket` only, config-prefix SSM read, provider log group; explicit Deny on S3 write, all application-state table writes, StartExecution, PostToConnection, Bedrock model invocation, wildcard invoke, wildcard DynamoDB write; not a runtime Lambda; cannot mutate the read-only official source.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Real deployment-time ingestion via the AWS CDK Custom Resource Provider Framework (onEvent StartIngestionJob + isComplete GetIngestionJob polling) with source-hash-before-ingest STOP + deterministic client-token idempotency + completion-verified-before-RAG-smoke; never a runtime Lambda, never a placeholder, never ingest-on-unknown-version, never an operator-only primary path.
  - demo_or_evidence_output: Ingestion-job completion log + verification that KB returns the 7 SOP articles before smoke (TASK-169); STOP demonstrated on a seeded hash mismatch; duplicate-safe re-deploy demonstrated with the deterministic client token.

- [ ] TASK-179 Finalize Lambda execution-role bindings and exact cross-resource grants
  - objective: Complete and verify the FINAL binding of every application runtime Lambda to its expected explicit execution role and the exact cross-resource IAM grants, so no CDK auto-generated runtime execution role exists and no runtime Lambda shares a generic role (TASK-067 only declared the specs/constructs and role-injection points; this task performs the final binding).
  - requirements_covered: REQ-003, REQ-004, REQ-005, REQ-006, REQ-032, R5, R16, R-supporting (security)
  - design_sections: §6 圖2, §8, §9.3, §15.1, §18, §4.6
  - components: Runtime role bindings (compute↔IAM integration across all 10 runtime Lambdas + Step Functions + deployment-time ingestion provider)
  - files_or_modules_expected: `infra/lib/constructs/runtime_bindings.ts`, `infra/test/runtime_role_bindings.test.ts`
  - dependencies: [TASK-067, TASK-068, TASK-076, TASK-077, TASK-078, TASK-079, TASK-080, TASK-081, TASK-082, TASK-083, TASK-177, TASK-178]
  - implementation_steps:
    1. Bind each runtime Lambda to its exact assigned execution role: InjectFn→InjectFnRole; WorkflowStatusFn→WorkflowStatusFnRole; RecoveryGateFn→RecoveryGateFnRole; DecisionFn→DecisionFnRole; RendererFn→RendererFnRole; PublishFn→PublishFnRole; ApiReadFn→ApiReadFnRole; WsPushFn→WsConnFnRole; ConnFn→WsConnFnRole; WhatIfFn→WhatIfFnRole. Bind Step Functions→OrchestratorRole; bind the deployment-time ingestion provider→IngestionRole.
    2. Guarantee: every Lambda is created with an explicit assigned execution role; NO CDK auto-generated runtime execution role; NO shared generic runtime role; WhatIfFn uses WhatIfFnRole; IngestionRole is attached to NO application runtime Lambda; OrchestratorRole is attached ONLY to Step Functions; WsPushFn+ConnFn sharing WsConnFnRole is the Frozen-Design-permitted explicit mapping; no other runtime Lambda shares a role.
    3. Apply exact cross-resource grants — InjectFnRole: `states:StartExecution` on ONLY the chosen Express state-machine ARN; `lambda:InvokeFunction` on ONLY the RecoveryGateFn exact ARN + WorkflowStatusFn exact ARN.
    4. Apply exact cross-resource grants — OrchestratorRole: `lambda:InvokeFunction` on ONLY DecisionFn/RendererFn/WorkflowStatusFn/RecoveryGateFn exact ARNs; MUST NOT allow OrchestratorRole to invoke WhatIfFn/InjectFn/PublishFn/ApiReadFn/WsPushFn/ConnFn.
    5. Add `cdk synth` assertions verifying all bindings and grants.
  - acceptance_criteria: (1) Exactly 10 application runtime Lambdas; (2) every runtime Lambda has the expected explicit Role ARN; (3) zero CDK auto-generated runtime execution roles; (4) Step Functions uses OrchestratorRole; (5) exact cross-resource grants only; (6) no wildcard Lambda invoke; (7) no wildcard DynamoDB write; (8) IngestionRole not attached to application runtime; (9) WhatIfFnRole cannot write state; (10) `cdk synth` assertions verify all bindings.
  - tests_required: `infra/test/runtime_role_bindings.test.ts` asserting every binding + grant (10 items above); denial coverage cross-referenced with TASK-160.
  - failure_cases: any auto-generated runtime execution role → assertion failure; any shared generic runtime role → assertion failure; OrchestratorRole invoking a non-workflow Lambda → assertion failure; IngestionRole attached to a runtime Lambda → assertion failure; any wildcard invoke/DynamoDB write → assertion failure.
  - done_definition: All runtime Lambda→role bindings and exact cross-resource grants finalized and verified by `cdk synth` assertions.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM, AWS Lambda, AWS Step Functions, AWS CDK (IaC definition + synth assertions only; no deploy)
  - security_or_iam_notes: This task is the IAM-layer enforcement of the §9/§18 writer-isolation and least-privilege boundary at the binding level; no auto-generated or shared role may weaken it.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Exactly 10 runtime Lambdas each bound to its expected explicit role; zero auto-generated runtime execution roles; zero shared generic runtime roles (WsPushFn+ConnFn→WsConnFnRole is the only permitted shared mapping); Step Functions→OrchestratorRole only; exact InjectFnRole/OrchestratorRole cross-resource grants; no wildcard Lambda invoke or DynamoDB write; verified by `cdk synth` assertions.
  - demo_or_evidence_output: `cdk synth` assertion output listing every Lambda→role binding + the exact StartExecution/InvokeFunction grants; zero auto-generated/shared runtime roles proven.

- [ ] TASK-180 Finalize shared stack composition and concurrency-safe integration
  - objective: As the SOLE final integration owner of the four stack shells and the app entrypoint, compose all independent construct modules into the stacks so all four stacks synthesize with zero unresolved cross-stack references, zero CloudFormation cyclic dependencies, and zero unresolved shared-file conflicts (TASK-059 may create initial shells, but TASK-060..084 and TASK-177..179 create independent construct modules, not parallel rewrites of the shells).
  - requirements_covered: REQ-024, REQ-032, R-supporting (all)
  - design_sections: §24 (stack split), §6, §23, §4.13
  - components: Shared stack composition (data_stack / compute_stack / network_auth_stack / frontend_stack / app entrypoint) from independent construct modules
  - files_or_modules_expected: `infra/lib/data_stack.ts`, `infra/lib/compute_stack.ts`, `infra/lib/network_auth_stack.ts`, `infra/lib/frontend_stack.ts`, `infra/bin/app.ts`, `infra/test/full_stack_integration.test.ts`, `infra/test/shared_file_ownership.test.ts`
  - dependencies: [TASK-059, TASK-060, TASK-061, TASK-062, TASK-063, TASK-064, TASK-065, TASK-066, TASK-068, TASK-069, TASK-070, TASK-071, TASK-072, TASK-073, TASK-074, TASK-075, TASK-076, TASK-077, TASK-078, TASK-079, TASK-080, TASK-081, TASK-082, TASK-083, TASK-084, TASK-177, TASK-178, TASK-179]
  - implementation_steps:
    1. Refactor so TASK-060..084 and TASK-177..179 create independent construct modules (e.g., `infra/lib/constructs/buckets.ts`, `idempotency_table.ts`, `decision_core_table.ts`, `decision_narrative_table.ts`, `publish_record_table.ts`, `connections_table.ts`, `knowledge_base.ts`, `lambda_specs.ts`, `http_api.ts`, `ws_api.ts`, `cognito.ts`, `frontend_hosting.ts`, `ssm_params.ts`, `secrets.ts`, `observability.ts`, `kb_ingestion_provider.ts`, `runtime_bindings.ts`) rather than each re-writing the stack shells in parallel.
    2. TASK-180 (this task) is the SOLE final integration owner of `infra/lib/data_stack.ts`, `infra/lib/compute_stack.ts`, `infra/lib/network_auth_stack.ts`, `infra/lib/frontend_stack.ts`, and `infra/bin/app.ts`; it composes the independent construct modules into these shells.
    3. Wire the WhatIfFn route+role, the deployment-time ingestion provider + IngestionRole, and the frontend API/WebSocket endpoints; validate cross-stack references and absence of cyclic dependencies.
    4. Add full-stack integration + shared-file ownership assertion tests.
  - acceptance_criteria: (1) four stacks synthesize; (2) no unresolved cross-stack reference; (3) no CloudFormation cyclic dependency; (4) every Lambda uses its expected explicit role; (5) every API route points to an existing Lambda; (6) every SFN state points to an existing Lambda; (7) every table referenced by intended writer/reader only; (8) WhatIfFn route+role connected; (9) deployment-time ingestion provider + IngestionRole connected; (10) frontend receives API + WebSocket endpoints; (11) PERSONAL_AWS_DEV synth passes; (12) COMPETITION_AWS synth passes; (13) LOCAL_MOCK requires no AWS resource creation; (14) all CDK assertion tests pass; (15) zero unresolved shared-file conflict.
  - tests_required: `infra/test/full_stack_integration.test.ts` (15 acceptance items) + `infra/test/shared_file_ownership.test.ts` (single-owner composition, zero same-wave shared-file conflicts).
  - failure_cases: unresolved cross-stack reference → failure; CloudFormation cyclic dependency → failure; API route/SFN state pointing at a missing Lambda → failure; any shared stack shell rewritten by a non-owner task → failure.
  - done_definition: Four stacks composed from independent construct modules by the single integration owner; all 15 acceptance items pass with zero shared-file conflicts.
  - provisional_policy_notes: none
  - aws_services_touched: AWS CDK / CloudFormation (composition + synth assertions only; no deploy)
  - security_or_iam_notes: Composition preserves the TASK-179 explicit role bindings and the §9/§18 isolation; no integration step introduces a shared or auto-generated role.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Single-owner composition of the four stacks + app entrypoint from independent construct modules; four stacks synthesize for PERSONAL_AWS_DEV and COMPETITION_AWS; LOCAL_MOCK needs no AWS resource creation; every API route/SFN state points to an existing Lambda; every Lambda uses its expected explicit role; zero cyclic dependency; zero unresolved shared-file conflict; all CDK assertion tests pass.
  - demo_or_evidence_output: `cdk synth` (PERSONAL_AWS_DEV + COMPETITION_AWS) + `infra/test/full_stack_integration.test.ts` + `infra/test/shared_file_ownership.test.ts` all green; zero cross-stack/cyclic/shared-file conflicts.

- [ ] TASK-084 Teardown lifecycle, removal policies, and cdk destroy readiness (IaC only)
  - objective: Configure per-profile removal policies, `autoDeleteObjects` (non-production), and KB/vector-store cleanup so `cdk destroy` can fully remove resources later (§26) — definition only, no destroy executed here.
  - requirements_covered: REQ-032, R-supporting (all)
  - design_sections: §26, §25 (POST-JUDGING CLEANUP)
  - components: (removal policy config across stacks)
  - files_or_modules_expected: `infra/lib/lifecycle/removal_policies.ts`
  - dependencies: [TASK-060, TASK-061, TASK-062, TASK-063, TASK-064, TASK-065, TASK-066]
  - implementation_steps:
    1. Set removal policies: destroy for non-production, retain/guard for competition until organizer confirmation.
    2. Configure S3 `autoDeleteObjects` for non-production; KB data source + vector store cleanup wiring.
    3. Document that destroy is a Phase 11 runbook step (organizer-gated), not executed here.
  - acceptance_criteria: Synth shows profile-appropriate removal policies; no destroy is run; cleanup wiring present.
  - tests_required: `cdk synth` assertion (removal policies per profile).
  - failure_cases: production autoDeleteObjects on protected data → assertion failure.
  - done_definition: Teardown lifecycle defined for clean `cdk destroy` (deferred to Phase 11).
  - provisional_policy_notes: none
  - aws_services_touched: AWS CDK / CloudFormation, S3, DynamoDB, Bedrock KB (IaC definition only)
  - security_or_iam_notes: Prevents residual billable resources; destroy gated by organizer confirmation (§25).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Per-profile removal policies + `autoDeleteObjects` (non-production) + KB/vector-store cleanup wiring so a later `cdk destroy` fully removes resources; NO destroy executed here; competition profile guarded until organizer confirmation (§25/§26).
  - demo_or_evidence_output: `cdk synth` assertion (profile-appropriate removal policies; no destroy run).

CHECKPOINT D (not a task): Ensure all Phase 3 `cdk synth` and IAM assertion tests pass (no deploy); ask the user if questions arise.

---

## Phase 4 — Injection & Workflow Lifecycle

> This phase implements the `InjectFn`/`WorkflowStatusFn`/`RecoveryGateFn` behaviors and the Express workflow lifecycle exactly per §10.11e, §12, §15.2, and Figures 6/7/8, including FIX-1 async 409 semantics, FIX-2 shared status ownership, and FIX-3 external fencing for stale reconciliation. No task lets an LLM compute any status/boolean truth.

- [ ] TASK-085 Implement IdempotencyTable repository (conditional Put/Update, ConsistentRead reads)
  - objective: Provide the deterministic data-access primitives for the lease/status state machine (conditional Put `attribute_not_exists`, conditional Update with fencing conditions, `ConsistentRead` GetItem) shared by InjectFn/WorkflowStatusFn/RecoveryGateFn (§10.11e).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §10.11e, §15.2
  - components: IdempotencyTable repository
  - files_or_modules_expected: `packages/backend/src/idempotency/idempotency_repo.ts`
  - dependencies: [TASK-003, TASK-005]
  - implementation_steps:
    1. Implement `conditionalPutNew(idempotency_key)` with `attribute_not_exists(idempotency_key)`.
    2. Implement `conditionalUpdate(key, condition, updates)` and `getConsistent(key)` (`ConsistentRead=true`).
    3. Encode the five `status` enum values and lease/attempt/recovery fields from §10.11e.
  - acceptance_criteria: Primitives enforce conditions; `getConsistent` uses `ConsistentRead=true`; status enum has exactly five values (no `accepted`).
  - tests_required: unit (with mocked DynamoDB) for conditional success/failure; feeds P33 (TASK-098).
  - failure_cases: `ConditionalCheckFailedException` surfaced (not swallowed) for apply-or-confirm handling.
  - done_definition: Idempotency repository primitives implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (client; table defined in TASK-061)
  - security_or_iam_notes: Callers constrained by their IAM roles; repo performs no cross-table writes.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Conditional Put/Update with `attribute_not_exists(idempotency_key)`; all reads `ConsistentRead=true` where recovery depends on them; lease state-machine primitives; DecisionFn zero-write enforced at the repository boundary (FIX 2).
  - demo_or_evidence_output: Repository unit tests (conditional Put/Update, ConsistentRead) feeding P33.

- [ ] TASK-086 Implement InjectFn POST /inject handler + idempotency_key derivation + first lease acquisition
  - objective: Handle `POST /incidents/{id}/inject`, derive `idempotency_key = event_id|event_timestamp|policy_version`, and acquire the start lease via first conditional Put (`status=starting`, `attempt_count=1`, `recovery_mode=NORMAL`) (§12, §15.2 step 1).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §12, §15.2 (step 1), §10.11e, Figure 6
  - components: InjectFn / IdempotencyGateFn
  - files_or_modules_expected: `packages/backend/src/inject/inject_fn.ts`, `packages/backend/src/inject/idempotency_key.ts`
  - dependencies: [TASK-085]
  - implementation_steps:
    1. Parse request, derive `idempotency_key` deterministically.
    2. Attempt first conditional Put; on success set lease fields and `decision_id`.
    3. Route existing-key requests to the re-request handler (TASK-088).
  - acceptance_criteria: Deterministic key derivation; first request acquires lease; duplicate keys never double-acquire.
  - tests_required: unit (first vs duplicate); feeds P33(a) (TASK-098).
  - failure_cases: malformed request → 4xx with structured error; no fabrication.
  - done_definition: Inject handler + key derivation + lease acquisition implemented.
  - provisional_policy_notes: `policy_version` in the key reflects the active provisional policy set; switching policy changes the key intentionally.
  - aws_services_touched: Amazon API Gateway HTTP API, AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: Cognito `admin` required (TASK-071); InjectFnRole (TASK-076) constrains actions.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `idempotency_key = event_id|event_timestamp|policy_version`; the first `attribute_not_exists` Put wins the lease (`status=starting`, `attempt_count=1`, `lease_owner`, `recovery_mode=NORMAL`); InjectFn NEVER writes `running` (that is MARK_RUNNING's job).
  - demo_or_evidence_output: Handler unit tests (key derivation, first-lease acquisition) feeding P33 (a).

- [ ] TASK-087 Implement InjectFn StartExecution (lease holder only) + 202 / 503 start_failed
  - objective: Have the lease holder call `StartExecution` (Express) passing `idempotency_key/decision_id/attempt_count/lease_owner/recovery_mode` as INPUT, return `202` on success (InjectFn does NOT write `running`), and on failure transition `starting→start_failed` and return `503 WORKFLOW_START_FAILED` (§12, §15.2 steps 2–3).
  - requirements_covered: REQ-004, R5
  - design_sections: §12 (status matrix), §15.2, §4.6, Figure 6/7
  - components: InjectFn (StartExecution)
  - files_or_modules_expected: `packages/backend/src/inject/start_execution.ts`
  - dependencies: [TASK-086, TASK-068]
  - implementation_steps:
    1. On lease acquired, call `StartExecution` with the workflow INPUT; on success return `202 {decision_id, trace_id}` without writing `running`.
    2. On failure, conditional Update `starting→start_failed` (write `last_error`, clear `lease_owner`, `lease_expires_at=now`, keep `attempt_count`); return `503` (`retryable=true`).
    3. Never create DecisionCore, push alerts, or invoke DecisionFn directly on start failure (no runtime lambda_direct).
  - acceptance_criteria: Success → 202 and no `running` write; failure → `start_failed` + 503 `WORKFLOW_START_FAILED`; key not wedged.
  - tests_required: unit + failure-injection (TASK-098); no runtime direct-call path exists.
  - failure_cases: StartExecution failure path per §21 (503, lease recovery-ready).
  - done_definition: StartExecution + 202/503 semantics implemented.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Step Functions Express, AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: `states:StartExecution` limited to the selected ARN (TASK-076).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Only the lease holder calls `StartExecution`; success → `202` (InjectFn does not write `running`); StartExecution failure → `starting → start_failed` + `503 WORKFLOW_START_FAILED` (never `202`); COMPETITION_AWS runtime NEVER falls back to a direct DecisionFn call.
  - demo_or_evidence_output: Unit/failure-injection tests: success 202 and StartExecution-failure 503 with lease cleared for recovery (P33 b).

- [ ] TASK-088 Implement InjectFn same-key re-request routing (200/202 branches)
  - objective: Route same-key re-requests by `status`/lease/`running_deadline_at`: `completed`→`200`, valid `running` (`>=now`)→`202`, `starting` (lease valid)→`202`, plus dispatch to recovery/stale/conflict handlers (§12, §15.2 step 4).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §12 (status matrix), §15.2 (step 4), §10.11e
  - components: InjectFn (re-request router)
  - files_or_modules_expected: `packages/backend/src/inject/rerequest_router.ts`
  - dependencies: [TASK-086, TASK-092, TASK-094, TASK-096]
  - implementation_steps:
    1. Read current record (consistent); branch on status/lease/deadline.
    2. `completed`→`200 {status:completed}`; valid `running`/`starting`→`202` in-progress (no StartExecution).
    3. Delegate `start_failed`/`processing_failed`/stale `running`/identity-conflict to their handlers.
  - acceptance_criteria: Completed and running map to distinct branches (200 vs 202); no StartExecution on duplicates.
  - tests_required: unit for each branch; feeds P33(a) (TASK-098).
  - failure_cases: never merge completed into the running 202 branch (§12).
  - done_definition: Re-request routing implemented per status matrix.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: Read via InjectFnRole; no writes beyond IdempotencyTable.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `completed` → `200 OK`; valid `running`/`starting` (lease unexpired) → `202` in-progress; no duplicate `StartExecution`; recovery ALWAYS transitions `status` back to `starting` first (never "new lease without status transition").
  - demo_or_evidence_output: Unit tests for each same-key branch (200/202/recovery) feeding P33 (a).

- [ ] TASK-089 Implement WorkflowStatusFn MARK_RUNNING (first state, $$.Execution.Id)
  - objective: Implement `MARK_RUNNING` as the workflow's first state that fences on `status=starting AND lease_owner AND attempt_count AND recovery_mode` and writes `running`, `workflow_execution_arn=$$.Execution.Id`, `running_started_at`, `running_deadline_at` — the only writer of `starting→running` (§10.11e, §15.2, PATCH 2).
  - requirements_covered: REQ-004, R5
  - design_sections: §10.11e, §15.2, §6, Figure 8
  - components: WorkflowStatusFn (MARK_RUNNING)
  - files_or_modules_expected: `packages/backend/src/workflow_status/mark_running.ts`
  - dependencies: [TASK-085]
  - implementation_steps:
    1. Read INPUT (`idempotency_key`/`lease_owner`/`attempt_count`/`recovery_mode`); take `$$.Execution.Id`.
    2. Conditional Update with the four-part condition → set running + arn + deadlines + `last_transition_*`.
    3. On `ConditionalCheckFailed` → `ConsistentRead` read → `ALREADY_APPLIED` (same exec+attempt) or `FENCED_STALE_EXECUTION`.
  - acceptance_criteria: `starting→running` only via MARK_RUNNING; registration race eliminated; workflow proceeds to DecisionFn/RecoveryGate only after success.
  - tests_required: integration (TASK-098) covering ALREADY_APPLIED / FENCED_STALE_EXECUTION.
  - failure_cases: stale/old execution fenced (does not proceed).
  - done_definition: MARK_RUNNING implemented with fencing + apply-or-confirm.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Step Functions, AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: WorkflowStatusFnRole writes IdempotencyTable only (TASK-079).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: SFN first state; conditional Update `status=starting AND lease_owner AND attempt_count AND recovery_mode` → `running` + `workflow_execution_arn=$$.Execution.Id` + `running_deadline_at`; only after success does DecisionFn/RecoveryGate run (eliminates the registration race).
  - demo_or_evidence_output: Integration test showing MARK_RUNNING registers running and gates entry to DecisionFn (P33 c2).

- [ ] TASK-090 Implement WorkflowStatusFn MARK_COMPLETED and MARK_PROCESSING_FAILED (fencing + apply-or-confirm)
  - objective: Implement the terminal status actions with full fencing (`workflow_execution_arn=$$.Execution.Id AND attempt_count=input.attempt_count`): `MARK_COMPLETED` (`running→completed`, write `completed_execution_arn`/`completed_attempt_count`, clear lease/deadline, `recovery_stage=NONE`) and `MARK_PROCESSING_FAILED` (`running→processing_failed`, clear lease, `lease_expires_at=now`, write `last_error`, set `recovery_stage` from RecoveryGate) (§10.11e, §15.2).
  - requirements_covered: REQ-004, R5
  - design_sections: §10.11e, §15.2, Figure 8
  - components: WorkflowStatusFn (MARK_COMPLETED / MARK_PROCESSING_FAILED)
  - files_or_modules_expected: `packages/backend/src/workflow_status/mark_completed.ts`, `packages/backend/src/workflow_status/mark_processing_failed.ts`
  - dependencies: [TASK-089, TASK-095]
  - implementation_steps:
    1. Implement both conditional Updates with the fencing condition.
    2. Apply-or-confirm on `ConditionalCheckFailed` (ALREADY_APPLIED via `completed_execution_arn`/attempt; else FENCED_STALE_EXECUTION).
    3. Set `retryable`/`recovery_stage` variants (incl. terminal CORE_IDENTITY_CONFLICT: `retryable=false`, `recovery_stage=NONE`).
  - acceptance_criteria: Terminal transitions fenced; ALREADY_APPLIED handles lost responses; CORE_IDENTITY_CONFLICT is terminal.
  - tests_required: integration (TASK-098); failure-injection.
  - failure_cases: old execution fenced; response-loss retry treated idempotently.
  - done_definition: Both terminal actions implemented with fencing + apply-or-confirm.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Step Functions, AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: WorkflowStatusFnRole only; no PostToConnection.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Both actions fence on `workflow_execution_arn=$$.Execution.Id AND attempt_count`; `ConditionalCheckFailed → ConsistentRead → ALREADY_APPLIED | FENCED_STALE_EXECUTION`; MARK_COMPLETED writes `completed_execution_arn`/`completed_attempt_count` and clears lease/running_deadline.
  - demo_or_evidence_output: Failure-injection tests (response loss, stale execution) proving ALREADY_APPLIED/FENCED_STALE_EXECUTION (P33 d/e).

- [ ] TASK-091 Implement WorkflowStatusFn RECONCILE_STALE_RUNNING (external fencing, FIX 3)
  - objective: Implement the stale-running action invoked by InjectFn (not inside the workflow), fenced by `expected_stale_execution_arn + expected_attempt + observed_running_deadline_at` (NOT the reconciler's own `$$.Execution.Id`), transitioning stale `running→processing_failed` with `last_error=STALE_RUNNING_EXECUTION`, `retryable=true`, and `recovery_stage` from `effective_core_committed` (§10.11e, §15.2, FIX 3).
  - requirements_covered: REQ-004, R5
  - design_sections: §10.11e, §15.2 (step E), Figure 6/8
  - components: WorkflowStatusFn (RECONCILE_STALE_RUNNING)
  - files_or_modules_expected: `packages/backend/src/workflow_status/reconcile_stale_running.ts`
  - dependencies: [TASK-085, TASK-093]
  - implementation_steps:
    1. Accept INPUT `expected_stale_execution_arn`/`expected_attempt`/`observed_running_deadline_at`/`core_exists`/`effective_core_committed` (from RecoveryGateFn).
    2. Conditional Update with the external-fencing condition (incl `running_deadline_at < now`).
    3. Apply-or-confirm: `ALREADY_APPLIED` (same expected arn+attempt) or `FENCED_STALE_EXECUTION`.
  - acceptance_criteria: Uses external fencing (never own execution id); stale running never reports in-progress forever.
  - tests_required: integration (TASK-098); failure-injection (stale running).
  - failure_cases: condition mismatch → consistent re-read → ALREADY_APPLIED/FENCED.
  - done_definition: RECONCILE_STALE_RUNNING implemented with external fencing.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: Invoked by InjectFn (exact ARN, TASK-076); WorkflowStatusFnRole writes Idempotency only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: EXTERNAL fencing via `expected_stale_execution_arn` + `expected_attempt` + `observed_running_deadline_at` (NOT the reconciler's own `$$.Execution.Id`, FIX 3); `running_deadline_at < now` → `processing_failed`, `last_error=STALE_RUNNING_EXECUTION`, `retryable=true`.
  - demo_or_evidence_output: Failure-injection test: a stale running is reconciled to processing_failed via external fencing (P33 g).

- [ ] TASK-092 Implement InjectFn stale-running orchestration (detect → RecoveryGate → RECONCILE)
  - objective: In InjectFn, when a same-key request finds `status=running AND running_deadline_at < now`, call read-only RecoveryGateFn then invoke `WorkflowStatusFn(RECONCILE_STALE_RUNNING)` with the external-fencing inputs, then proceed to staged recovery (§15.2 step E, PATCH 6).
  - requirements_covered: REQ-004, R5
  - design_sections: §15.2 (step E), §10.11e, Figure 6/7
  - components: InjectFn (stale orchestration)
  - files_or_modules_expected: `packages/backend/src/inject/stale_orchestration.ts`
  - dependencies: [TASK-091, TASK-093]
  - implementation_steps:
    1. Detect stale running; call RecoveryGateFn (read-only) for fencing outputs + core state.
    2. Invoke RECONCILE_STALE_RUNNING; then dispatch to staged recovery (TASK-094).
    3. Never mark stale via InjectFn's own writes beyond lease/recovery transitions.
  - acceptance_criteria: Stale running is reconciled then recovered; no infinite in-progress.
  - tests_required: integration (TASK-098); failure-injection.
  - failure_cases: reconcile fenced → handled idempotently.
  - done_definition: Stale-running orchestration implemented.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB, Step Functions (client)
  - security_or_iam_notes: InjectFn invokes RecoveryGateFn + WorkflowStatusFn by exact ARN only (TASK-076).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Detect stale (`running_deadline_at < now`) → call read-only RecoveryGateFn → WorkflowStatusFn(RECONCILE_STALE_RUNNING) → then staged recovery; a stuck `running` NEVER reports in-progress forever.
  - demo_or_evidence_output: Failure-injection test: stuck running is detected and recovered (no permanent in-progress) (P33 g).

- [ ] TASK-093 Implement RecoveryGateFn (read-only, strong-consistent judgment)
  - objective: Implement the read-only gate computing `core_exists`, `idempotency_core_committed`, `effective_core_committed = OR`, `existing/missing_narrative_types`, `recommended_recovery_mode`, and the stale-fencing outputs (`expected_stale_execution_arn`/`expected_attempt`/`observed_running_deadline_at`) via all-`ConsistentRead` reads on base tables only (§10.11e, §15.2, FIX 3).
  - requirements_covered: REQ-004, R5
  - design_sections: §10.11e, §15.2, §8, §18
  - components: RecoveryGateFn
  - files_or_modules_expected: `packages/backend/src/recovery/recovery_gate_fn.ts`
  - dependencies: [TASK-085]
  - implementation_steps:
    1. `GetItem` (ConsistentRead) IdempotencyTable + DecisionCoreTable; `Query` (ConsistentRead) DecisionNarrativeTable base table.
    2. Compute the outputs; never use an eventually-consistent GSI as recovery truth.
    3. Perform zero writes; no Bedrock/WebSocket/S3.
  - acceptance_criteria: Outputs computed from strong-consistent reads; zero writes; missing_narrative_types accurate.
  - tests_required: integration (TASK-098) verifying read-only + strong consistency.
  - failure_cases: none (read-only); surfaces `core_exists=false` for RECOVERY_CORE_MISSING handling.
  - done_definition: RecoveryGateFn implemented as read-only judgment.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: RecoveryGateFnRole is read-only strong-consistent (TASK-080).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: All reads `ConsistentRead=true`; `GetItem` Idempotency/Core + `Query` Narrative BASE table (never eventually-consistent GSI); outputs `core_exists`/`effective_core_committed`/`missing_narrative_types` + `expected_stale_execution_arn`/`expected_attempt`/`observed_running_deadline_at`; ZERO writes, no Bedrock/PostToConnection/S3.
  - demo_or_evidence_output: Unit/integration tests proving read-only strong-consistent outputs and zero side effects.

- [ ] TASK-094 Implement lease recovery transitions (start_failed/processing_failed/starting)
  - objective: Implement the atomic recovery transitions that always set `status` back to `starting` first — `start_failed→starting` (FULL_WORKFLOW), `processing_failed→starting` (FULL_WORKFLOW or ENRICHMENT_ONLY by `effective_core_committed`), and expired `starting→starting` — incrementing `attempt_count`, refreshing the lease, and removing the old `workflow_execution_arn` (§15.2 steps A–D, PATCH 3/4).
  - requirements_covered: REQ-004, R5
  - design_sections: §15.2 (A–D), §10.11e
  - components: InjectFn (recovery transitions)
  - files_or_modules_expected: `packages/backend/src/inject/recovery_transitions.ts`
  - dependencies: [TASK-085, TASK-093]
  - implementation_steps:
    1. Implement each transition as a single atomic conditional Update with single-owner guarantee.
    2. Set `recovery_mode` (FULL_WORKFLOW/ENRICHMENT_ONLY) from RecoveryGate's `effective_core_committed`.
    3. Always write `status=starting` (never "new lease without status transition"); then retry StartExecution.
  - acceptance_criteria: Recovery always routes through `starting`; single lease owner; staged (not blind full-rerun).
  - tests_required: integration (TASK-098); failure-injection (start_failed/processing_failed/expiry).
  - failure_cases: multiple owners prevented by conditional Update.
  - done_definition: Lease recovery transitions implemented (staged).
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB, Step Functions (client)
  - security_or_iam_notes: InjectFnRole only; no decision-table writes.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Recovery ALWAYS sets `status` back to `starting` first (`start_failed → starting` FULL_WORKFLOW; `processing_failed → starting` FULL/ENRICHMENT per `effective_core_committed`; expired `starting → starting`); `attempt_count += 1`; single owner; REMOVE stale `workflow_execution_arn`; ENRICHMENT_ONLY never reruns DecisionFn.
  - demo_or_evidence_output: Failure-injection tests for each staged-recovery transition (P33 b/c).

- [ ] TASK-095 Implement apply-or-confirm shared library (ALREADY_APPLIED / FENCED_STALE_EXECUTION)
  - objective: Provide the shared idempotent semantics used by all status actions: on `ConditionalCheckFailedException`, `ConsistentRead` re-read → `ALREADY_APPLIED` (same execution+attempt reached target) or `FENCED_STALE_EXECUTION` (different execution/attempt → old execution terminates immediately) (§10.11e, §15.2).
  - requirements_covered: REQ-004, R5
  - design_sections: §10.11e (apply-or-confirm), §15.2
  - components: WorkflowStatusFn (shared apply-or-confirm)
  - files_or_modules_expected: `packages/backend/src/workflow_status/apply_or_confirm.ts`
  - dependencies: [TASK-085]
  - implementation_steps:
    1. Implement the re-read + classification helper parameterized per action target.
    2. Ensure FENCED_STALE_EXECUTION causes immediate termination with no side effects (no writes/alerts/enrichment).
    3. Return `status_action_result` enum consumed by the workflow.
  - acceptance_criteria: Lost-response retry → ALREADY_APPLIED; old execution → FENCED_STALE_EXECUTION with zero side effects.
  - tests_required: integration (TASK-098) covering both outcomes for each action.
  - failure_cases: misclassifying same-exec retry as conflict → test failure.
  - done_definition: Apply-or-confirm library implemented and reused.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: Read via ConsistentRead; writes only within the caller's Idempotency scope.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `ConditionalCheckFailed → ConsistentRead → same-execution+same-attempt = ALREADY_APPLIED` (success, continue); else `FENCED_STALE_EXECUTION` (old execution terminates: no table write, no fast_path_ready, no enrichment, no public alert).
  - demo_or_evidence_output: Unit tests for both branches; reused by all fenced status actions (P33 d).

- [ ] TASK-096 Implement CORE_IDENTITY_CONFLICT terminal handling + async 409 on later same-key POST (FIX 1)
  - objective: Implement the terminal, non-recoverable identity-conflict path — set `processing_failed`/`last_error=CORE_IDENTITY_CONFLICT`/`retryable=false`/`recovery_stage=NONE`, push `processing.failed`, log a security alert — and return `409` ONLY to later same-key POSTs (the original `202` is never retroactively changed) (§12, §15.2, FIX 1).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §12 (async semantics), §15.2 (step 6), §21, FIX 1
  - components: InjectFn (409 branch), workflow conflict handling
  - files_or_modules_expected: `packages/backend/src/inject/conflict_409.ts`, `packages/backend/src/workflow_status/identity_conflict.ts`
  - dependencies: [TASK-090, TASK-101]
  - implementation_steps:
    1. On `core_write_status=CORE_IDENTITY_CONFLICT` in the workflow, MARK_PROCESSING_FAILED terminal variant + push `processing.failed` + security alert.
    2. In InjectFn re-request router, when reading `processing_failed AND last_error=CORE_IDENTITY_CONFLICT` → `409` (retryable=false); never recover.
    3. Ensure an already-issued `202` is never retroactively changed (async semantics).
  - acceptance_criteria: 409 only on later same-key POST; original 202 unchanged; terminal state not recoverable (no `processing_failed→starting`).
  - tests_required: async 409 timing contract/integration (TASK-098).
  - failure_cases: retroactively changing the original 202 → test failure; 500 instead of 409 → failure.
  - done_definition: Terminal identity-conflict + async 409 implemented.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB, WebSocket (client for processing.failed)
  - security_or_iam_notes: Security alert logged; fail-closed; DecisionCore never overwritten.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Identity mismatch → `CORE_IDENTITY_CONFLICT` terminal (`retryable=false`, `recovery_stage=NONE`), fail-closed, security alert, MARK_PROCESSING_FAILED, `processing.failed`; the original `202` is NEVER retro-changed; `409` returned ONLY to a later same-key POST reading `processing_failed`+`CORE_IDENTITY_CONFLICT` (async semantics, FIX 1).
  - demo_or_evidence_output: Contract/failure test proving async 409 timing (original 202 unchanged; later same-key POST → 409; execution summary reflects terminal state) (P33 h).

- [ ] TASK-097 Wire Step Functions status actions, Choice Gate, and recovery_mode branch
  - objective: Wire the ASL to call the status actions in order and branch on `recovery_mode` (NORMAL/FULL_WORKFLOW → DecisionFn; ENRICHMENT_ONLY → RecoveryGate then MARK_CORE_COMMITTED with `evidence_source=RECOVERY_GATE_CORE_EXISTS`), plus the DecisionFn Choice Gate (§15.2, Figure 8).
  - requirements_covered: REQ-004, REQ-005, R5
  - design_sections: §15.2, §6, Figure 8
  - components: Step Functions wiring (workflow logic)
  - files_or_modules_expected: `infra/statemachine/workflow.asl.json` (logic), `packages/backend/src/workflow/wiring.ts`
  - dependencies: [TASK-068, TASK-089, TASK-090, TASK-091, TASK-093, TASK-102]
  - implementation_steps:
    1. First state MARK_RUNNING → branch on `recovery_mode`.
    2. ENRICHMENT_ONLY: RecoveryGate confirms `core_exists=true` → MARK_CORE_COMMITTED (RECOVERY_GATE_CORE_EXISTS) → missing_narrative_types only; `core_exists=false` → MARK_PROCESSING_FAILED (RECOVERY_CORE_MISSING, FULL_WORKFLOW).
    3. NORMAL/FULL_WORKFLOW: DecisionFn → Choice Gate (COMMITTED/ALREADY_COMMITTED_SAME_DECISION/CORE_IDENTITY_CONFLICT).
  - acceptance_criteria: Branch logic matches Figure 8; ENRICHMENT_ONLY never reruns DecisionFn; normal execution never misclassified as recovery.
  - tests_required: integration (TASK-098) covering all branches.
  - failure_cases: normal execution treated as enrichment recovery → test failure.
  - done_definition: Workflow branching + Choice Gate wired.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Step Functions Express (definition + client)
  - security_or_iam_notes: OrchestratorRole invokes functions only (TASK-083).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Choice Gate has at least COMMITTED / ALREADY_COMMITTED_SAME_DECISION / CORE_IDENTITY_CONFLICT; recovery_mode branch (NORMAL/FULL_WORKFLOW → DecisionFn; ENRICHMENT_ONLY → RecoveryGate); MARK_CORE_COMMITTED gates `fast_path_ready`; a safe same-task retry is never routed to a leftover-running terminal.
  - demo_or_evidence_output: ASL wiring + integration test exercising all Choice-Gate branches and the recovery_mode split.

- [ ] TASK-098 Injection/workflow lifecycle integration & failure-injection tests (P33)
  - objective: Verify the full idempotency/recovery/fencing lifecycle (P33 a–i): dedup, MARK_RUNNING registration, internal fencing (current `$$.Execution.Id`), RECONCILE external fencing, apply-or-confirm, DecisionCore identity classification, async CORE_IDENTITY_CONFLICT 409 timing, start-failure/stale recovery, ENRICHMENT_ONLY core persistence.
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §22.1 (P33), §22.2 (Integration/Failure-injection/Async 409), §15.2, §10.11e
  - components: InjectFn, WorkflowStatusFn, RecoveryGateFn, Step Functions
  - files_or_modules_expected: `packages/backend/test/integration/injection_lifecycle.test.ts`, `.../failure_injection.test.ts`, `.../async_409_timing.test.ts`
  - dependencies: [TASK-086, TASK-087, TASK-088, TASK-089, TASK-090, TASK-091, TASK-092, TASK-093, TASK-094, TASK-095, TASK-096, TASK-097]
  - implementation_steps:
    1. Simulate duplicate injections, StartExecution failure, lease expiry, stale running, lost status responses, old/parallel executions.
    2. Assert P33 (a)–(i) hold; assert `409` only on later same-key POST after recorded conflict.
    3. Assert FENCED_STALE_EXECUTION terminates old executions with zero side effects.
  - acceptance_criteria: P33 verified end-to-end; async 409 timing correct; no duplicate alerts/enrichment.
  - tests_required: property P33 + failure-injection + async-409 contract/integration.
  - failure_cases: report any counterexample from the PBT library.
  - done_definition: Lifecycle + failure-injection suite green.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB, Step Functions, Lambda (LOCAL_MOCK harness where possible)
  - security_or_iam_notes: Includes fencing/fail-closed assertions.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P33 implemented as a single property (≥100 iterations, labeled) plus a failure-injection suite covering dedup, MARK_RUNNING registration, internal-action fencing, external RECONCILE fencing (FIX 3), apply-or-confirm, canonical-`core_hash` identity (FIX 4), async CORE_IDENTITY_CONFLICT 409 (FIX 1), stale-running, and ENRICHMENT_ONLY core persistence; proves at most one DecisionCore and no duplicate alerts under retries/failures. Release-blocking.
  - demo_or_evidence_output: Green P33 property run (≥100 iters, labeled) + failure-injection matrix results.

CHECKPOINT E (not a task): Ensure the injection/workflow lifecycle behaves per §15.2 and Figures 6/7/8; ask the user if questions arise.

---

## Phase 5 — Core Persistence & Fast Path

> This phase wires the deterministic domain core (Phase 1) into `DecisionFn`, persists the immutable `DecisionCore` via conditional Put with canonical-`core_hash` identity classification, and emits `decision.fast_path_ready` only after the `MARK_CORE_COMMITTED` checkpoint. Fast Path uses no Bedrock; the 5s TEAM_TARGET and 60s official deadline are instrumented via `LatencyTrace`.

- [ ] TASK-099 Implement DecisionFn handler (invoke deterministic core → DecisionCore payload)
  - objective: Wire `DecisionFn` to run the deterministic pipeline (ingestion → snapshot → rule engine → evacuation → ETE → evidence → DecisionCore assembly) and produce the `DecisionCore` payload with `core_hash` (§6, §8, Figure 7/8).
  - requirements_covered: REQ-011..REQ-022, R2..R16
  - design_sections: §6, §8, §9.4, §10.11a, Figure 8
  - components: DecisionFn (handler), deterministic domain core
  - files_or_modules_expected: `packages/backend/src/decision/decision_fn.ts`
  - dependencies: [TASK-035, TASK-019, TASK-020]
  - implementation_steps:
    1. Load verified sources (manifest gate) and select snapshots via Strategy A.
    2. Run rule engine (art.1–6) + ETE (art.7) + evacuation + evidence; assemble DecisionCore with `core_hash` and `source_manifest_hash`.
    3. Return the payload for conditional Put (TASK-100); DecisionFn performs zero writes to IdempotencyTable.
  - acceptance_criteria: DecisionFn produces a complete DecisionCore for ACC_001/EVT_002/EVT_003 with correct provisional flags; no IdempotencyTable write.
  - tests_required: integration (TASK-106); reuses Phase 2 golden assertions.
  - failure_cases: source unverified → STOP `insufficient_data` (no fabrication).
  - done_definition: DecisionFn computes and returns DecisionCore.
  - provisional_policy_notes: All Strategy A–F provisional outputs flagged `provisional=true`; DecisionFn never presents them as official.
  - aws_services_touched: AWS Lambda, S3 (read), DynamoDB (write via TASK-100)
  - security_or_iam_notes: DecisionFnRole reads S3 raw + writes DecisionCore only; explicit Deny on IdempotencyTable (TASK-077).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Invokes the deterministic core → DecisionCore payload; DecisionFn writes ONLY DecisionCoreTable (never IdempotencyTable); Bedrock is not called on the Fast Path; owns all numeric/boolean truth (§9).
  - demo_or_evidence_output: Handler unit/integration tests producing a DecisionCore from the 3 official events; fast-path has no Bedrock call.

- [ ] TASK-100 Implement DecisionCore immutable conditional Put (COMMITTED)
  - objective: Persist DecisionCore with `attribute_not_exists(decision_id)` conditional Put returning `core_write_status=COMMITTED` (execution-local) on success, enforcing immutability (§6, §10.11a, §15.2).
  - requirements_covered: REQ-011..REQ-022, R2..R16
  - design_sections: §10.11a, §15.2, §6
  - components: DecisionFn (core writer)
  - files_or_modules_expected: `packages/backend/src/decision/decision_core_writer.ts`
  - dependencies: [TASK-099, TASK-062]
  - implementation_steps:
    1. Conditional Put with `attribute_not_exists(decision_id)`.
    2. On success return `COMMITTED` (execution-local; not assumed stored in the table).
    3. On failure defer to identity classification (TASK-101).
  - acceptance_criteria: First write → COMMITTED; DecisionCore is immutable after commit.
  - tests_required: integration (TASK-106).
  - failure_cases: Put failure routed to identity comparison (not blanket duplicate).
  - done_definition: Immutable conditional Put implemented.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: DecisionFnRole is the sole writer (TASK-077).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `attribute_not_exists(decision_id)` conditional Put; success → `core_write_status=COMMITTED` (execution-local); `immutable_after_commit`; DecisionFn performs no IdempotencyTable write.
  - demo_or_evidence_output: Integration test showing a single COMMITTED write and immutability of the committed core.

- [ ] TASK-101 Implement DecisionCore Put-failure identity classification (canonical core_hash)
  - objective: On conditional-Put failure, `ConsistentRead` GetItem the existing core and compare `decision_id`/`idempotency_key`/`source_manifest_hash`/`core_hash` (canonical §10.11a-1)/`schema_version` → `ALREADY_COMMITTED_SAME_DECISION` (all match, safe retry) or `CORE_IDENTITY_CONFLICT` (mismatch, fail-closed) (§6, §15.2, FIX 4).
  - requirements_covered: REQ-011..REQ-022, R-supporting
  - design_sections: §6, §10.11a-1, §15.2, §21, FIX 4
  - components: DecisionFn (identity classifier)
  - files_or_modules_expected: `packages/backend/src/decision/identity_classifier.ts`
  - dependencies: [TASK-100, TASK-035]
  - implementation_steps:
    1. On Put failure, `ConsistentRead` GetItem existing core.
    2. Compare the five identity fields using the canonical `core_hash`.
    3. Return `ALREADY_COMMITTED_SAME_DECISION` (continue MARK_CORE_COMMITTED) or `CORE_IDENTITY_CONFLICT` (fail-closed).
  - acceptance_criteria: Same decision facts → ALREADY_COMMITTED_SAME_DECISION; any identity mismatch → CORE_IDENTITY_CONFLICT; no core overwrite.
  - tests_required: integration (TASK-106); ties to canonical core_hash tests (TASK-051) and P33(d′).
  - failure_cases: identity mismatch → conflict, security alert, no overwrite.
  - done_definition: Identity classification implemented (three-way).
  - provisional_policy_notes: none
  - aws_services_touched: AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: Fail-closed on conflict; DecisionCore never overwritten.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Put failure → `ConsistentRead` GetItem, compare `decision_id`/`idempotency_key`/`source_manifest_hash`/`core_hash`(§10.11a-1)/`schema_version` → all match = ALREADY_COMMITTED_SAME_DECISION (safe retry), mismatch = CORE_IDENTITY_CONFLICT (fail-closed); NEVER blanket-treat all Put failures as duplicates.
  - demo_or_evidence_output: Unit tests for both classifications using canonical core_hash fixtures (feeds P33 d′).

- [ ] TASK-102 Wire MARK_CORE_COMMITTED checkpoint (evidence_source=DECISIONFN_COMMITTED)
  - objective: After `COMMITTED`/`ALREADY_COMMITTED_SAME_DECISION`, have the workflow call `MARK_CORE_COMMITTED` (fenced) to set `core_committed=true` with `evidence_source=DECISIONFN_COMMITTED`; only after this (or ALREADY_APPLIED) may `decision.fast_path_ready` be pushed (§10.11e, §15.2).
  - requirements_covered: REQ-004, REQ-005, R5
  - design_sections: §10.11e, §15.2, §6, Figure 8
  - components: WorkflowStatusFn (MARK_CORE_COMMITTED), Step Functions wiring
  - files_or_modules_expected: `packages/backend/src/workflow_status/mark_core_committed.ts`
  - dependencies: [TASK-089, TASK-095, TASK-101]
  - implementation_steps:
    1. Conditional Update fenced by `status=running AND workflow_execution_arn=$$.Execution.Id AND attempt_count AND core_committed=false`.
    2. Set `core_committed=true`, `evidence_source=DECISIONFN_COMMITTED`; apply-or-confirm on failure.
    3. Gate `decision.fast_path_ready` on success/ALREADY_APPLIED.
  - acceptance_criteria: `core_committed` written only here; fast_path_ready gated on the checkpoint; sole writer is WorkflowStatusFn.
  - tests_required: integration (TASK-106, TASK-098).
  - failure_cases: FENCED_STALE_EXECUTION → old execution terminates; response-loss → ALREADY_APPLIED.
  - done_definition: MARK_CORE_COMMITTED checkpoint wired.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Step Functions, AWS Lambda, DynamoDB (client)
  - security_or_iam_notes: `core_committed` writer isolation (PATCH 2 / FIX 2).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: `core_committed` written ONLY here by WorkflowStatusFn (`evidence_source=DECISIONFN_COMMITTED`); `fast_path_ready` gated on this checkpoint; DecisionFn never writes `core_committed`.
  - demo_or_evidence_output: Integration test proving core_committed sole-writer and fast_path_ready gating (feeds P33 e).

- [ ] TASK-103 Implement decision.fast_path_ready emission (ready_event_id)
  - objective: Emit the `decision.fast_path_ready` WebSocket event (with `ready_event_id = decision_id|event_type|core_version_ref`) after the checkpoint, carrying the deterministic core summary, with a `GET /decisions/{id}` polling fallback (§13, §16.3).
  - requirements_covered: REQ-004, REQ-008, R4, R5, R6, R12
  - design_sections: §13, §16.3, Figure 7/8
  - components: RealtimePublisher (WsPushFn)
  - files_or_modules_expected: `packages/backend/src/realtime/fast_path_ready.ts`
  - dependencies: [TASK-102, TASK-070]
  - implementation_steps:
    1. Build payload with `ready_event_id`, `source_timestamps`, `policy_version`, `provisional`, `trace_id`, summary.
    2. Push via `PostToConnection`; define the polling fallback contract.
    3. Never write DecisionNarrative from the publisher.
  - acceptance_criteria: Event emitted post-checkpoint with `ready_event_id`; polling fallback documented; publisher performs no table writes.
  - tests_required: integration (TASK-106); dedup covered in Phase 7 (TASK-123).
  - failure_cases: WebSocket down → clients fall back to polling (§13).
  - done_definition: fast_path_ready emission implemented.
  - provisional_policy_notes: Summary marks provisional route/ETE.
  - aws_services_touched: Amazon API Gateway WebSocket, AWS Lambda (client)
  - security_or_iam_notes: Only Ws roles `PostToConnection` (TASK-083).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Emitted ONLY after MARK_CORE_COMMITTED; `ready_event_id = decision_id|event_type|core_version_ref`; publisher performs no table writes; `GET /decisions/{id}` polling fallback documented.
  - demo_or_evidence_output: Integration test: fast_path_ready fires post-checkpoint with ready_event_id; publisher writes nothing.

- [ ] TASK-104 Implement LatencyTrace instrumentation
  - objective: Instrument the pipeline stages to populate `LatencyTrace` (`fast_path_ms`, `end_to_end_ms`, `fast_path_target_met<=5000`, `official_deadline_met<=60000`) (§10.16, §20).
  - requirements_covered: REQ-004, R5
  - design_sections: §10.16, §20 (budget)
  - components: LatencyTrace
  - files_or_modules_expected: `packages/backend/src/latency/latency_trace.ts`
  - dependencies: [TASK-099, TASK-103]
  - implementation_steps:
    1. Record per-stage start/end and durations.
    2. Compute `fast_path_ms`/`end_to_end_ms` and the two boolean targets.
    3. Emit to CloudWatch metrics (Phase 10) best-effort.
  - acceptance_criteria: LatencyTrace captures stages and both target booleans.
  - tests_required: unit; latency test (TASK-107).
  - failure_cases: metric emit failure must not block the main path (best-effort).
  - done_definition: LatencyTrace implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon CloudWatch (client)
  - security_or_iam_notes: No credentials in trace logs.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Per-stage `LatencyTrace` (start/end/duration), `fast_path_ms`/`end_to_end_ms`; deterministic measurement feeding CloudWatch metrics.
  - demo_or_evidence_output: LatencyTrace unit tests + emitted stage timings for a full run.

- [ ] TASK-105 Wire Fast Path 5s team target and 60s official deadline measurement
  - objective: Connect `LatencyTrace` targets to the fast-path (≤5s TEAM_TARGET) and end-to-end (≤60s official) measurement points so both are observable per decision (§19, §20).
  - requirements_covered: REQ-004, R5
  - design_sections: §19, §20
  - components: LatencyTrace, CloudWatch wiring
  - files_or_modules_expected: `packages/backend/src/latency/deadline_wiring.ts`
  - dependencies: [TASK-104, TASK-075]
  - implementation_steps:
    1. Map fast-path completion to `FastPathLatencyMs`; end-to-end to `EndToEndLatencyMs`.
    2. Emit both metrics; wire the 60s alarm (defined TASK-075).
    3. Document that 5s is a team target (non-official) and 60s is official.
  - acceptance_criteria: Both metrics emitted; 60s alarm fed; 5s labeled team target.
  - tests_required: latency test (TASK-107).
  - failure_cases: metric failure non-blocking.
  - done_definition: Deadline measurement wired.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon CloudWatch (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: `FastPathLatencyMs` measured vs the 5s TEAM_TARGET (non-official) and `EndToEndLatencyMs` vs the 60s OFFICIAL hard deadline; both measured, not simulated.
  - demo_or_evidence_output: Metric wiring + a run showing FastPath and end-to-end timings against the two thresholds.

- [ ] TASK-106 DecisionCore persistence integration tests (COMMITTED/ALREADY_COMMITTED/CONFLICT)
  - objective: Verify the three-way conditional-Put outcomes, MARK_CORE_COMMITTED gating, and fast_path_ready emission against DecisionCore/IdempotencyTable.
  - requirements_covered: REQ-011..REQ-022, REQ-004, R2..R16
  - design_sections: §22.2 (Integration), §15.2, §10.11a
  - components: DecisionFn, DecisionCore writer, MARK_CORE_COMMITTED
  - files_or_modules_expected: `packages/backend/test/integration/core_persistence.test.ts`
  - dependencies: [TASK-100, TASK-101, TASK-102, TASK-103]
  - implementation_steps:
    1. Assert COMMITTED path → core_committed=true → fast_path_ready.
    2. Assert ALREADY_COMMITTED_SAME_DECISION continues idempotently (no rewrite).
    3. Assert CORE_IDENTITY_CONFLICT fails closed (no overwrite, security alert, MARK_PROCESSING_FAILED terminal).
  - acceptance_criteria: All three outcomes behave per §15.2.
  - tests_required: integration (COMMITTED/ALREADY_COMMITTED/CONFLICT).
  - failure_cases: any core overwrite on conflict → failure.
  - done_definition: Core persistence integration suite green.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB, Lambda, Step Functions (harness)
  - security_or_iam_notes: Verifies writer isolation and fail-closed conflict.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Integration tests for COMMITTED / ALREADY_COMMITTED_SAME_DECISION / CORE_IDENTITY_CONFLICT (1–3 representative cases each) verifying immutability + writer isolation (DecisionFn sole Core writer, no IdempotencyTable write). Release-blocking.
  - demo_or_evidence_output: Green persistence integration suite covering the three Put classifications.

- [ ] TASK-107 Fast-path latency tests
  - objective: Verify `FastPathLatencyMs`/`EndToEndLatencyMs` are measured and the target booleans compute correctly under representative loads.
  - requirements_covered: REQ-004, R5
  - design_sections: §22.2 (Latency), §20
  - components: LatencyTrace, deadline wiring
  - files_or_modules_expected: `packages/backend/test/latency/fast_path_latency.test.ts`
  - dependencies: [TASK-104, TASK-105]
  - implementation_steps:
    1. Measure fast-path stage durations in a harness.
    2. Assert `fast_path_target_met`/`official_deadline_met` compute against thresholds.
    3. Assert Bedrock is not on the fast path.
  - acceptance_criteria: Latency measured; targets computed; fast path Bedrock-free.
  - tests_required: latency tests.
  - failure_cases: Bedrock on fast path → failure.
  - done_definition: Latency tests green.
  - provisional_policy_notes: none
  - aws_services_touched: CloudWatch (harness)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Measured proof that the Fast Path meets the 5s TEAM_TARGET and end-to-end meets the 60s OFFICIAL deadline on the 3 official events; not example-only where latency varies with payload. Release-blocking (60s is the official hard indicator).
  - demo_or_evidence_output: Latency test report with FastPath and end-to-end measurements vs 5s/60s thresholds.

CHECKPOINT F (not a task): Ensure DecisionCore persistence + fast path meet §15.2/§20; ask the user if questions arise.

---

## Phase 6 — Bedrock & RAG (Enrichment Path)

> This phase implements the enrichment path: SOP retrieval (KB `Retrieve` + S3 fallback), the three narrative composers writing independent `narrative_type` items via `attribute_not_exists(decision_id)` conditional Put, the `SchemaValidator` that rejects any core-field overwrite, deterministic multilingual template fallback (never zh-only), and the `decision.enriched` gate. Bedrock writes text-only fields; it never computes numeric/boolean truth. Bedrock failure must not block the Fast Path.

- [ ] TASK-108 Implement SopRetriever (Bedrock KB Retrieve)
  - objective: Implement `SopRetriever` using Bedrock KB `Retrieve` to fetch SOP passages + verbatim citations (content, metadata, source location, score) for the deterministic `citation_article_set` (§4.2, §14.1, §14.2).
  - requirements_covered: REQ-005, REQ-007, REQ-008, R5, R15, R16
  - design_sections: §4.2, §14.1, §14.2, Figure 9
  - components: SopRetriever (KB Retrieve)
  - files_or_modules_expected: `packages/rag/src/sop_retriever.ts`
  - dependencies: [TASK-066, TASK-110]
  - implementation_steps:
    1. Query KB `Retrieve` with `citation_article_set` + facts.
    2. Preserve source location verbatim as citation; never let RAG overwrite rule-engine numbers.
    3. Parameterize KB ID / region via ConfigProvider.
  - acceptance_criteria: Retrieval returns passages + verbatim citations keyed to `citation_article_set`; no numeric mutation.
  - tests_required: RAG citation integration (TASK-120).
  - failure_cases: KB failure → S3 fallback (TASK-109).
  - done_definition: KB-based SopRetriever implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon Bedrock Knowledge Bases (client)
  - security_or_iam_notes: RendererFnRole gets KB `Retrieve` only (TASK-078).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: KB `Retrieve` returns content + source location + score; citation kept VERBATIM; Bedrock only explains, never changes numbers/level/route; requires KB ingestion COMPLETE (TASK-178) before RAG smoke.
  - demo_or_evidence_output: RAG citation integration test mapping a query to the correct article source location.

- [ ] TASK-109 Implement SopRetriever S3 article_no fallback
  - objective: Add the S3 direct-read fallback (by `article_no`) so citation remains available when KB is unavailable (§4.2, §14.1, §21).
  - requirements_covered: REQ-005, R5, R15
  - design_sections: §4.2, §14.1, §21.2 (KB retrieval failure)
  - components: SopRetriever (S3 fallback)
  - files_or_modules_expected: `packages/rag/src/sop_s3_fallback.ts`
  - dependencies: [TASK-108, TASK-017]
  - implementation_steps:
    1. On KB exception, read the SOP article text from S3 by `article_no` (from TASK-017 chunking).
    2. Return the same citation shape (source location by article).
    3. Increment `KbFallbackCount` metric (Phase 10).
  - acceptance_criteria: KB failure → S3 article read returns citations; behavior transparent to composers.
  - tests_required: failure-injection (TASK-120, TASK-163).
  - failure_cases: both KB and S3 fail → template text with recorded citation gap (§21).
  - done_definition: S3 fallback implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon S3 (read), Amazon Bedrock KB (client)
  - security_or_iam_notes: RendererFnRole S3 SOP read only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: KB failure → S3 read by `article_no`; citation source location still present; wording via template; no fabrication of SOP content.
  - demo_or_evidence_output: Failure-injection test: KB down → S3 article fallback still yields correct citation.

- [ ] TASK-110 Implement citation_article_set assembly (triggered ∪ applied_formula)
  - objective: Provide the deterministic `citation_article_set = triggered_articles ∪ applied_formula_articles` used to drive RAG queries and citation coverage (§14.2, P27).
  - requirements_covered: REQ-008, REQ-021, R13, R15
  - design_sections: §14.2, §9.5, §22.1 (P27)
  - components: RAG citation assembly
  - files_or_modules_expected: `packages/rag/src/citation_article_set.ts`
  - dependencies: [TASK-033]
  - implementation_steps:
    1. Compute the union from DecisionCore's `triggered_articles` and `applied_formula_articles`.
    2. Ensure art.7 (applied formula) is included when present.
    3. Expose the set to SopRetriever and composers.
  - acceptance_criteria: For ACC_001, `citation_article_set = {1,2,7}`; art.7 never dropped.
  - tests_required: unit + P27 (Phase 2 TASK-049); RAG citation (TASK-120).
  - failure_cases: citation missing applied-formula article → assertion failure.
  - done_definition: Citation set assembly implemented.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `citation_article_set = triggered ∪ applied_formula` (covers art.7 when applied, not only triggered); verbatim source location preserved.
  - demo_or_evidence_output: Feeds P27; citation set for ACC_001 = {1,2,7}.

- [ ] TASK-111 Implement SchemaValidator (text-only; reject core-field overwrite)
  - objective: Implement the deterministic `SchemaValidator` that accepts only allowed text fields from Bedrock output and rejects any attempt to overwrite core fields (e.g., `ete_minutes`, `classification`, `primary_evacuation`, `cms_core_text`), falling back to templates on rejection (§9.3, §10.11b, P37).
  - requirements_covered: REQ-015, REQ-021, REQ-022, R13, R14
  - design_sections: §9.3, §10.11b, §14.3, §22.1 (P37)
  - components: SchemaValidator
  - files_or_modules_expected: `packages/rag/src/schema_validator.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Whitelist text fields per `narrative_type` (`report_text`/`public_alert_text`/`explanation_text`/`cms_explanation_text`/`citations_presentation`).
    2. Reject any payload touching `LLM-prohibited` core fields (incl `cms_core_text`) → discard and use template.
    3. Return validated text-only payload.
  - acceptance_criteria: Core-overwrite attempts rejected; only text fields pass; template fallback on rejection.
  - tests_required: Bedrock schema-validation tests (TASK-120) + P37 (TASK-048).
  - failure_cases: injected core overwrite → rejected + template.
  - done_definition: SchemaValidator implemented (§9 boundary enforcement).
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Software-layer enforcement complementing IAM (TASK-078).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Validates LLM output fills ONLY allowed text fields; ANY attempt to overwrite a core field (`ete_minutes`/`classification`/`primary_evacuation`/`triggered_articles`/`cms_core_text`...) is rejected → template fallback; mechanical §9 enforcement.
  - demo_or_evidence_output: Unit tests: a crafted LLM core-overwrite is rejected and the template is used (core unchanged).

- [ ] TASK-112 Implement Bedrock adapter (InvokeModel/Converse) + Mock adapter + model fallbacks
  - objective: Provide a Bedrock adapter (InvokeModel/Converse) with client timeouts, `bedrock.model_id_fallbacks` handling, and a LOCAL_MOCK Mock adapter returning fixed text, so enrichment runs offline in CI (§4.1, §21, §23).
  - requirements_covered: REQ-013, REQ-014, REQ-015, R13, R14, R15
  - design_sections: §4.1, §21.2 (Bedrock/region failure), §23
  - components: Bedrock adapter, Mock adapter
  - files_or_modules_expected: `packages/rag/src/bedrock_adapter.ts`, `packages/rag/src/mock_bedrock_adapter.ts`
  - dependencies: [TASK-005, TASK-006]
  - implementation_steps:
    1. Implement `invoke(prompt, opts)` with client timeout (e.g., 30s) and model fallback list.
    2. Implement the Mock adapter for LOCAL_MOCK; select via ConfigProvider.
    3. On timeout/unsupported model → signal caller to use templates (never block Fast Path).
  - acceptance_criteria: Adapter honors timeout + fallbacks; Mock adapter used in LOCAL_MOCK; no AWS calls in CI.
  - tests_required: unit + failure-injection (TASK-163).
  - failure_cases: region lacks model → fallback list → templates (§21).
  - done_definition: Bedrock + Mock adapters implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon Bedrock (client; Mock in LOCAL_MOCK)
  - security_or_iam_notes: Model IDs/region from config; RendererFnRole gates Bedrock invoke.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `InvokeModel`/`Converse` via parameterized `model_id`/`region` + `model_id_fallbacks`; Mock adapter for LOCAL_MOCK (zero AWS); client timeout → template fallback; Bedrock never on the Fast Path.
  - demo_or_evidence_output: Adapter unit tests + LOCAL_MOCK run with the Mock adapter (no AWS calls).

- [ ] TASK-113 Implement ReportComposer (REPORT item conditional Put)
  - objective: Implement `ReportComposer` producing `report_text`/`cms_explanation_text`/`citations_presentation`, validated text-only, and writing the `REPORT` item via `attribute_not_exists(decision_id)` conditional Put (branch_already_completed on re-put) (§10.11b, §14.3).
  - requirements_covered: REQ-021, REQ-015, R13
  - design_sections: §10.11b, §14.3, Figure 8
  - components: ReportComposer (RendererFn branch)
  - files_or_modules_expected: `packages/rag/src/report_composer.ts`
  - dependencies: [TASK-108, TASK-111, TASK-112, TASK-116]
  - implementation_steps:
    1. Read core facts (read-only) + SOP citations; prompt Bedrock for report wording.
    2. Validate text-only via SchemaValidator; never touch `cms_core_text`.
    3. Conditional Put the `REPORT` item; on re-put → `branch_already_completed`; emit `report.ready`.
  - acceptance_criteria: REPORT item written once; core untouched; `report.ready` emitted; re-put → branch_already_completed.
  - tests_required: narrative concurrency integration (TASK-120).
  - failure_cases: Bedrock failure → template report (§21.3), core unchanged.
  - done_definition: ReportComposer implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon Bedrock, DynamoDB (client), WebSocket (report.ready)
  - security_or_iam_notes: RendererFnRole; DecisionCore read-only; Narrative conditional Put only (TASK-078).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Generates REPORT text from DECIDED facts; `attribute_not_exists(decision_id)` conditional Put of the REPORT item only (single-arg form); never overwrites another `narrative_type`; `cms_core_text` unchanged (LLM may write only `cms_explanation_text`).
  - demo_or_evidence_output: Integration test writing a REPORT item; re-Put returns branch_already_completed; cms_core_text untouched.

- [ ] TASK-114 Implement PublicAlertComposer (PUBLIC_ALERT item, multilingual)
  - objective: Implement `PublicAlertComposer` producing `public_alert_text` (zh/en/ja/ko per trigger + bonus), validated text-only, written to the `PUBLIC_ALERT` item via conditional Put (§10.11b, §14.4).
  - requirements_covered: REQ-022, REQ-010, REQ-019, R11, R14
  - design_sections: §10.11b, §14.4, Figure 8/11
  - components: PublicAlertComposer (RendererFn branch)
  - files_or_modules_expected: `packages/rag/src/public_alert_composer.ts`
  - dependencies: [TASK-111, TASK-112, TASK-116, TASK-030]
  - implementation_steps:
    1. Read `multilingual_required` + language set (deterministic, LLM-prohibited).
    2. Prompt Bedrock for the required languages in one response; validate text-only.
    3. Conditional Put `PUBLIC_ALERT` item; emit `public_alert.ready`.
  - acceptance_criteria: Language set matches deterministic trigger; alert written once; core/trigger untouched.
  - tests_required: narrative concurrency integration (TASK-120); language floor (TASK-117/TASK-050).
  - failure_cases: Bedrock failure → multilingual template (TASK-117), never zh-only.
  - done_definition: PublicAlertComposer implemented.
  - provisional_policy_notes: Station scope via Strategy F (config); trigger boolean deterministic.
  - aws_services_touched: Amazon Bedrock, DynamoDB (client), WebSocket (public_alert.ready)
  - security_or_iam_notes: RendererFnRole; text-only writes.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: `zh` always; `+en` on SOP-6 trigger; `+ja/ko` when the bonus is enabled; produced in the SAME response; conditional Put of the PUBLIC_ALERT item only; `sop6_triggered`/`languages` are LLM-prohibited (deterministic).
  - demo_or_evidence_output: Integration test producing multilingual alert text with the correct language set for the trigger state.

- [ ] TASK-115 Implement ExplanationComposer (EXPLANATION item from EvidenceTrace + citations)
  - objective: Implement `ExplanationComposer` (`RendererFn(mode=EXPLANATION)`) generating `explanation_text` from the deterministic `EvidenceTrace` + `citation_article_set`, validated text-only, written to the `EXPLANATION` item via conditional Put (no standalone `explanation.ready`) (§10.11b, §8).
  - requirements_covered: REQ-008, R15
  - design_sections: §10.11b, §8, §14.2, Figure 8
  - components: ExplanationComposer (RendererFn branch)
  - files_or_modules_expected: `packages/rag/src/explanation_composer.ts`
  - dependencies: [TASK-111, TASK-112, TASK-116, TASK-034, TASK-110]
  - implementation_steps:
    1. Read `EvidenceTrace` + `citation_article_set`; prompt Bedrock for explanation wording.
    2. Validate text-only; never alter numbers/paths.
    3. Conditional Put `EXPLANATION` item; readiness signaled via `decision.enriched`.
  - acceptance_criteria: EXPLANATION item written once from evidence + citations; no numeric mutation.
  - tests_required: narrative concurrency integration (TASK-120); RAG citation (TASK-120).
  - failure_cases: Bedrock failure → template explanation from evidence facts.
  - done_definition: ExplanationComposer implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Expose timing evidence, affected_road context, ETE road roles/inputs/formula/status, and `guidance_id` to report and read-model consumers.
  - aws_services_touched: Amazon Bedrock, DynamoDB (client)
  - security_or_iam_notes: RendererFnRole; text-only writes.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Generated from `EvidenceTrace` + `citation_article_set`; conditional Put of the EXPLANATION item only; no independent `explanation.ready` (readiness via `decision.enriched`); text-only, no numeric/route change.
  - demo_or_evidence_output: Integration test producing an EXPLANATION item citing the correct articles from EvidenceTrace.

- [ ] TASK-116 Implement DecisionNarrative writer (PK+SK conditional Put per branch)
  - objective: Provide the shared narrative writer that each composer uses to write its own `narrative_type` item with `attribute_not_exists(decision_id)` (PK+SK provided; single-arg condition; never the two-arg form), returning `branch_already_completed` on re-put and never overwriting another branch (§10.11b, §15.1).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R13, R14, R15
  - design_sections: §10.11b, §15.1, §8
  - components: DecisionNarrative writer
  - files_or_modules_expected: `packages/rag/src/narrative_writer.ts`
  - dependencies: [TASK-063, TASK-003]
  - implementation_steps:
    1. Implement `putNarrative(decision_id, narrative_type, payload)` with `attribute_not_exists(decision_id)` (PK+SK supplied).
    2. On `ConditionalCheckFailedException` → return `branch_already_completed`; never overwrite.
    3. Reject the two-argument `attribute_not_exists` form (invalid DynamoDB syntax).
  - acceptance_criteria: Each branch writes only its item; re-put → branch_already_completed; no cross-branch overwrite.
  - tests_required: narrative concurrency integration (TASK-120); P33(f) (TASK-098).
  - failure_cases: two parallel branches never overwrite the same item.
  - done_definition: Narrative writer implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon DynamoDB (client)
  - security_or_iam_notes: RendererFnRole conditional Put only; RealtimePublisher never writes this table (TASK-083).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Each branch writes its OWN `narrative_type` item via `attribute_not_exists(decision_id)` (PK+SK provided, single-arg form only); re-Put same `(decision_id, narrative_type)` → `branch_already_completed`; never overwrites another branch; RealtimePublisher never writes DecisionNarrativeTable.
  - demo_or_evidence_output: Concurrency integration test proving three branches never overwrite each other and the publisher performs no NARR write.

- [ ] TASK-117 Implement multilingual template fallback (never zh-only)
  - objective: Implement the deterministic approved multilingual templates (zh/en/ja/ko) that meet the language floor when Bedrock fails (triggered → zh+en; bonus → zh+en+ja+ko), inserting only deterministic facts (§14.4, §21.3, P36).
  - requirements_covered: REQ-010, REQ-019, REQ-031, R11, R17
  - design_sections: §14.4, §21.3, §22.1 (P36)
  - components: Multilingual TemplateRenderer
  - files_or_modules_expected: `packages/rag/src/multilingual_templates.ts`
  - dependencies: [TASK-030, TASK-114]
  - implementation_steps:
    1. Define approved templates per language inserting only `location`/`primary_evacuation`/`ete_minutes`/`timestamp_display`.
    2. On Bedrock failure, render the required language set from templates.
    3. Guarantee no degradation to zh-only when art.6 triggered.
  - acceptance_criteria: Language floor met via templates on Bedrock failure; deterministic facts only; never zh-only when triggered.
  - tests_required: P36 (TASK-050); failure-injection (TASK-163).
  - failure_cases: zh-only under triggered art.6 → failure.
  - done_definition: Multilingual template fallback implemented.
  - provisional_policy_notes: Scope via Strategy F (config); language floor deterministic.
  - aws_services_touched: none (pure domain templates)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: SOP-6 triggered but Bedrock fails → deterministic APPROVED templates (zh/en/ja/ko) inserting only deterministic facts; language floor preserved (trigger → zh+en; bonus → +ja/ko); NEVER degrades to zh-only.
  - demo_or_evidence_output: Feeds P36; Bedrock-down test shows multilingual template output, not zh-only.

- [ ] TASK-118 Implement missing_narrative_types recovery (ENRICHMENT_ONLY)
  - objective: In ENRICHMENT_ONLY recovery, use RecoveryGateFn's `missing_narrative_types` to retry only the missing `narrative_type` items (each conditional Put; branch_already_completed if present), never rerunning DecisionFn (§15.2 C, §10.11b).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R13, R14, R15
  - design_sections: §15.2 (staged recovery C), §10.11b
  - components: Enrichment recovery
  - files_or_modules_expected: `packages/backend/src/recovery/enrichment_recovery.ts`
  - dependencies: [TASK-093, TASK-113, TASK-114, TASK-115, TASK-116]
  - implementation_steps:
    1. Read `missing_narrative_types` from RecoveryGateFn.
    2. Re-run only the missing composers; each conditional Put (branch_already_completed if present).
    3. Never rerun DecisionFn / rewrite DecisionCore / re-push fast_path_ready.
  - acceptance_criteria: Only missing narratives retried; core untouched; each narrative at most one commit.
  - tests_required: integration (TASK-120, TASK-098).
  - failure_cases: `core_exists=false` → RECOVERY_CORE_MISSING → FULL_WORKFLOW (handled TASK-097).
  - done_definition: Enrichment-only recovery implemented.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB, Bedrock (client)
  - security_or_iam_notes: RendererFnRole; core read-only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: ENRICHMENT_ONLY recovers ONLY missing `narrative_type` items via `RecoveryGateFn.missing_narrative_types`; never reruns DecisionFn, never rewrites core, never re-emits `fast_path_ready`; each narrative item commits at most once.
  - demo_or_evidence_output: Failure-injection test: partial enrichment recovers only the missing item(s) (P33 e/f).

- [ ] TASK-119 Implement decision.enriched emission (after all 3 committed)
  - objective: Emit `decision.enriched` only after the required set {REPORT, PUBLIC_ALERT, EXPLANATION} are all `COMMITTED` or `branch_already_completed`, with `ready_event_id` for dedup and a polling fallback (§13, §10.11b, PATCH 5).
  - requirements_covered: REQ-021, REQ-008, R13, R15
  - design_sections: §13, §10.11b, Figure 8
  - components: RealtimePublisher (enriched gate)
  - files_or_modules_expected: `packages/backend/src/realtime/decision_enriched.ts`
  - dependencies: [TASK-113, TASK-114, TASK-115, TASK-070]
  - implementation_steps:
    1. Track completion of the three narrative items.
    2. Emit `decision.enriched` (also represents EXPLANATION readiness) only when all three are committed/branch_already_completed.
    3. Include `ready_event_id`; define polling fallback (poll until all three ready).
  - acceptance_criteria: `decision.enriched` gated on all three; `ready_event_id` present; fallback defined.
  - tests_required: narrative concurrency integration (TASK-120); dedup (TASK-123).
  - failure_cases: premature enriched before three items → failure.
  - done_definition: decision.enriched gate implemented.
  - provisional_policy_notes: none
  - aws_services_touched: WebSocket, Lambda (client)
  - security_or_iam_notes: Only Ws roles push (TASK-083).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: `decision.enriched` pushed ONLY after the required set {REPORT, PUBLIC_ALERT, EXPLANATION} are all COMMITTED/`branch_already_completed`; also represents EXPLANATION readiness; `ready_event_id` dedup (effectively-once presentation).
  - demo_or_evidence_output: Integration test proving enriched fires only after all three items and is deduped by ready_event_id.

- [ ] TASK-120 RAG citation + Bedrock schema-validation + narrative concurrency integration tests
  - objective: Verify verbatim citation coverage (KB + S3 fallback), SchemaValidator core-overwrite rejection, and the three-branch concurrent conditional Put (no overwrite; branch_already_completed; enriched gate) (§22.2).
  - requirements_covered: REQ-005, REQ-008, REQ-021, REQ-022, R5, R13, R14, R15
  - design_sections: §22.2 (RAG citation / Bedrock schema-validation / Integration)
  - components: SopRetriever, SchemaValidator, narrative writer, composers
  - files_or_modules_expected: `packages/rag/test/integration/rag_citation.test.ts`, `.../schema_validation.test.ts`, `.../narrative_concurrency.test.ts`
  - dependencies: [TASK-108, TASK-109, TASK-110, TASK-111, TASK-113, TASK-114, TASK-115, TASK-116, TASK-119]
  - implementation_steps:
    1. Assert citations map to `citation_article_set` (art.1–6 + art.7 example); KB failure → S3 fallback keeps citations.
    2. Assert a core-overwrite attempt is rejected and template used.
    3. Assert three concurrent branches never overwrite; re-put → branch_already_completed; enriched only after all three.
  - acceptance_criteria: All three integration areas pass; Bedrock via Mock adapter in CI.
  - tests_required: RAG citation + Bedrock schema-validation + narrative concurrency integration.
  - failure_cases: citation loss on fallback / core overwrite accepted / cross-branch overwrite → failure.
  - done_definition: Enrichment integration suite green.
  - provisional_policy_notes: none
  - aws_services_touched: Bedrock (Mock), DynamoDB, S3 (harness)
  - security_or_iam_notes: Verifies §9 boundary at runtime.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Integration tests (1–3 representative cases): RAG citation maps to the correct article (triggered + applied art.7), SchemaValidator rejects a core overwrite → template, narrative branches never overwrite each other, and `decision.enriched` is gated on all 3 items. Release-blocking.
  - demo_or_evidence_output: Green enrichment integration suite (citation fidelity, schema rejection, concurrency, enriched gating).

CHECKPOINT G (not a task): Ensure enrichment path + §9 boundary hold, and Bedrock failure never blocks Fast Path; ask the user if questions arise.

---

## Phase 7 — Dashboard & Realtime (React/TS SPA)

> This phase builds the React/TS SPA (§8, §16), consuming the read model and WebSocket events with a polling fallback and `ready_event_id` dedup. The dashboard renders deterministic truth only (A=red/B=yellow, routes, ETE, evidence chain); it never computes numeric/boolean truth. REQ-030 (visual design) and REQ-031 (ja/ko UI) are bonus.

- [ ] TASK-121 Scaffold React/TS SPA and inject endpoints via ConfigProvider
  - objective: Create the SPA skeleton (routing, state, API client) with `api.endpoint`/`ws.endpoint` injected at build-time, no hard-coded endpoints (§8, §16, §4.9).
  - requirements_covered: REQ-001, REQ-024, R4
  - design_sections: §8, §16, §4.9, §23.1
  - components: DashboardService (app shell)
  - files_or_modules_expected: `packages/frontend/src/app.tsx`, `packages/frontend/src/api/client.ts`, `packages/frontend/src/config/runtime_config.ts`
  - dependencies: [TASK-001, TASK-003]
  - implementation_steps:
    1. Scaffold the SPA (router + state store + typed API client using shared-schemas types).
    2. Inject endpoints from build-time env (from ConfigProvider outputs).
    3. Add a base layout with panels for timeline/roads/crowd/decision.
  - acceptance_criteria: SPA builds; endpoints injected (no literals); shared types imported.
  - tests_required: component smoke test (TASK-135).
  - failure_cases: hard-coded endpoint → lint/build failure.
  - done_definition: SPA scaffold with injected config.
  - provisional_policy_notes: none
  - aws_services_touched: AWS Amplify Hosting / S3+CloudFront (build target)
  - security_or_iam_notes: No secrets in frontend bundle; public read only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: SPA shell defines the global UX-state contract every panel honors — loading, empty, error, insufficient-data, stale-data indicator, WebSocket→polling degraded badge, provisional-policy badge, clear status hierarchy, keyboard accessibility, responsive baseline layout, and NO placeholder panels; endpoints injected via ConfigProvider (no hard-coded api/ws URLs).
  - demo_or_evidence_output: SPA builds; shell renders every UX state (snapshot/Storybook); endpoints resolved from config, not literals.

- [ ] TASK-122 Implement WebSocket client + connection state machine + polling fallback
  - objective: Implement the WebSocket client with `connected→polling→connected` state machine (configurable 2s interval) and per-event HTTP polling fallback, surfacing "realtime degraded to polling" (§13, §16.4).
  - requirements_covered: REQ-001, REQ-004, R4, R5
  - design_sections: §13, §16.4
  - components: RealtimePublisher client (frontend)
  - files_or_modules_expected: `packages/frontend/src/realtime/ws_client.ts`, `packages/frontend/src/realtime/polling_fallback.ts`
  - dependencies: [TASK-121]
  - implementation_steps:
    1. Connect WebSocket; on `onerror`/disconnect → switch to polling; on reconnect → stop polling.
    2. Map each event to its GET fallback (§13 table).
    3. Show the connection-mode indicator.
  - acceptance_criteria: Disconnect switches to polling; reconnect resumes push; UI shows mode.
  - tests_required: component test (TASK-135); mode-switch unit test.
  - failure_cases: WebSocket down → polling continues (no data loss).
  - done_definition: Realtime client + fallback implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon API Gateway WebSocket / HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: `connected → (drop/onerror) → polling` (configurable, default 2s) `→ reconnect → connected` (stop polling); UI shows the WebSocket→polling degraded indicator; live updates continue during degradation.
  - demo_or_evidence_output: State-machine tests + a demo step dropping the WebSocket showing the degraded badge while updates continue.

- [ ] TASK-123 Implement ready_event_id dedup (effectively-once presentation)
  - objective: Deduplicate incoming events by `ready_event_id` so WebSocket re-delivery never double-renders, treating DecisionNarrative + HTTP polling as authoritative (§13, PATCH 3/5).
  - requirements_covered: REQ-004, REQ-008, R4, R5
  - design_sections: §13 (effectively-once presentation)
  - components: Realtime dedup
  - files_or_modules_expected: `packages/frontend/src/realtime/dedup.ts`
  - dependencies: [TASK-122]
  - implementation_steps:
    1. Track seen `ready_event_id`s; drop duplicates.
    2. Reconcile push vs polling using authoritative state.
    3. Ensure idempotent UI updates.
  - acceptance_criteria: Duplicate events do not double-render; effectively-once presentation holds.
  - tests_required: component test (TASK-135); ties to P33(f).
  - failure_cases: duplicate render on re-delivery → failure.
  - done_definition: Dedup implemented.
  - provisional_policy_notes: none
  - aws_services_touched: none (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Dashboard dedups by `ready_event_id` (effectively-once presentation); a resent WebSocket event never double-renders; the narrative table + HTTP polling are the authoritative state.
  - demo_or_evidence_output: Test replaying a duplicate WebSocket event shows a single rendered update.

- [ ] TASK-124 Implement timeline playback UI (GET /timeline)
  - objective: Render the timeline playback control that advances through timestamps and requests corresponding traffic/crowd data, driven by `timeline.updated` with polling fallback (§16.1, R1.5/R4.1).
  - requirements_covered: REQ-001, R1, R4
  - design_sections: §16.1, Figure 5, §12 (/timeline)
  - components: DashboardService (timeline)
  - files_or_modules_expected: `packages/frontend/src/timeline/timeline_panel.tsx`
  - dependencies: [TASK-122]
  - implementation_steps:
    1. Fetch `/timeline`; render selectable timestamps + current position.
    2. Advance on `timeline.updated`; poll on fallback.
    3. Display times as `YYYY-MM-DD HH:MM`.
  - acceptance_criteria: Timeline advances and updates panels; time format correct.
  - tests_required: component test (TASK-135).
  - failure_cases: WebSocket down → polling advances timeline.
  - done_definition: Timeline playback implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Display event timestamp, decision cutoff, selected observation timestamp, and staleness during timeline playback.
  - aws_services_touched: HTTP/WebSocket API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, completeness
  - competition_quality_floor: Timeline playback from `GET /timeline`; loading/empty/error states; time axis; updates on `timeline.updated`; no placeholder panel.
  - demo_or_evidence_output: Playback advancing through timestamps in the demo; empty/error states rendered.

- [ ] TASK-125 Implement road/traffic visualization + A=red / B=yellow lights
  - objective: Render per-segment traffic + A/B light colors from the deterministic grading (A→red, B→yellow) via `GET /roads` (§16, R4.3, P7).
  - requirements_covered: REQ-001, REQ-011, R2, R4
  - design_sections: §16, §12 (/roads), §22.1 (P7)
  - components: DashboardService (road viz)
  - files_or_modules_expected: `packages/frontend/src/roads/road_panel.tsx`
  - dependencies: [TASK-124]
  - implementation_steps:
    1. Fetch `/roads`; render segments with saturation + level.
    2. Map A→red, B→yellow deterministically (no client recompute of thresholds).
    3. Update on timeline advance.
  - acceptance_criteria: Light colors match server-provided level; no client-side threshold logic.
  - tests_required: component/snapshot test (TASK-135).
  - failure_cases: client re-deriving level → rejected in review (truth is server-side).
  - done_definition: Road viz + lights implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Show selected snapshot provenance and stale/insufficient-data states on traffic panels.
  - aws_services_touched: HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, completeness
  - competition_quality_floor: A=red / B=yellow per backend classification for all 15 segments (client never recomputes level); loading/empty/insufficient-data states shown.
  - demo_or_evidence_output: Road panel showing correct red/yellow for the official events; insufficient-data state rendered.

- [x] TASK-126 Implement crowd/signaling visualization
  - objective: Render base-station crowd metrics + multilingual/dispersal flags via `GET /crowd` (§16, R8/R9/R11).
  - requirements_covered: REQ-001, REQ-010, REQ-016, REQ-017, R8, R9, R11
  - design_sections: §16, §12 (/crowd)
  - components: DashboardService (crowd viz)
  - files_or_modules_expected: `packages/frontend/src/crowd/crowd_panel.tsx`
  - dependencies: [TASK-124]
  - implementation_steps:
    1. Fetch `/crowd`; render User_Count/Growth_Rate/roaming + flags.
    2. Update on timeline advance.
  - acceptance_criteria: Crowd metrics + flags render from server data.
  - tests_required: component test (TASK-135).
  - failure_cases: none (display-only of server truth).
  - done_definition: Crowd viz implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Show base-station observation timestamps, staleness, and OQ-005 station-scope policy.
  - aws_services_touched: HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, completeness
  - competition_quality_floor: Crowd/roaming/dome flags visualized from backend truth (no client recompute); insufficient-data and stale-data indicators shown.
  - demo_or_evidence_output: Crowd panel reflecting BL17/DOME/roaming flags; stale indicator on old snapshot.

- [ ] TASK-127 Implement anomaly auto-popup (anomaly.detected)
  - objective: Render the automatic analysis-summary + warning popup on `anomaly.detected` (SOP threshold crossings), with polling fallback comparing thresholds (§16.2, R4.2, P6).
  - requirements_covered: REQ-002, R4
  - design_sections: §16.2, §13 (anomaly.detected), §22.1 (P6)
  - components: AlertMonitor (frontend surface)
  - files_or_modules_expected: `packages/frontend/src/alerts/anomaly_popup.tsx`
  - dependencies: [TASK-122, TASK-125, TASK-126]
  - implementation_steps:
    1. Subscribe to `anomaly.detected`; show summary popup automatically.
    2. Fallback: poll `/roads` + `/crowd` and compare thresholds (server-provided flags).
    3. No manual query required.
  - acceptance_criteria: Popup appears automatically at thresholds; fallback works.
  - tests_required: component test (TASK-135).
  - failure_cases: missed popup at threshold → failure.
  - done_definition: Anomaly popup implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Anomaly popups include the cutoff, source observation timestamp, and policy provenance.
  - aws_services_touched: WebSocket/HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: `anomaly.detected` → automatic popup with analysis summary (no manual query); below-threshold never pops; clear status hierarchy; dismiss/ack handled; no placeholder.
  - demo_or_evidence_output: Injecting a threshold-crossing event auto-pops the warning summary in the demo.

- [ ] TASK-128 Implement incident injection UI (POST /inject, admin)
  - objective: Build the admin injection UI that posts `live_incidents` events to `POST /incidents/{id}/inject` (Cognito admin), showing 202/200/503/409 outcomes (§16.3, §12, R5).
  - requirements_covered: REQ-003, R5
  - design_sections: §16.3, §12, Figure 6
  - components: DashboardService (injection UI)
  - files_or_modules_expected: `packages/frontend/src/inject/injection_panel.tsx`
  - dependencies: [TASK-121, TASK-133]
  - implementation_steps:
    1. Render an admin-only injection form (Cognito admin token).
    2. POST inject; render `202`/`200`/`503`/`409` states with retry guidance.
    3. Surface `decision_id`/`trace_id`.
  - acceptance_criteria: Injection posts with admin auth; all HTTP outcomes displayed correctly.
  - tests_required: component test (TASK-135).
  - failure_cases: 409 CORE_IDENTITY_CONFLICT shown as terminal (no auto-retry).
  - done_definition: Injection UI implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Incident details display BS-event affected_road as `DISPLAY_AND_CONTEXT_ONLY`.
  - aws_services_touched: HTTP API, Cognito (client)
  - security_or_iam_notes: Admin-only; token via Cognito; no secrets stored client-side.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, technical_feasibility, completeness
  - competition_quality_floor: Admin-only injection with an explicit command-confirmation step before POST; renders 202 / 503 (start_failed) / 409 (non-retryable CORE_IDENTITY_CONFLICT) outcomes distinctly; loading/error states; no placeholder.
  - demo_or_evidence_output: Injection flow with confirmation + correct outcome rendering for 202/503/409.

- [x] TASK-129 Implement explanation-chain display (EvidenceTrace + citations)
  - objective: Render the reasoning chain (classification reasoning + data points + exclusion reasons + SOP citations) from the read model (§16, R15, P26/P27).
  - requirements_covered: REQ-008, R15
  - design_sections: §16, §10.10, §22.1 (P26/P27)
  - components: DashboardService (evidence display)
  - files_or_modules_expected: `packages/frontend/src/decision/explanation_chain.tsx`
  - dependencies: [TASK-121, TASK-132]
  - implementation_steps:
    1. Fetch decision read model; render reasoning + data points.
    2. Render each excluded route with its reason; render `citation_article_set` citations.
    3. Show provisional markers where applicable.
  - acceptance_criteria: Reasoning + non-empty exclusion reasons + citations render.
  - tests_required: component test (TASK-135).
  - failure_cases: missing exclusion reason surfaced as data error (server guarantees non-empty).
  - done_definition: Explanation chain implemented.
  - provisional_policy_notes: Provisional facts labeled (route/anchor/ETE).
  - hg001_amendment:
    - Evidence panel displays observation selection, affected-set construction, exclusions, common timestamp, and formula substitution.
  - aws_services_touched: HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: EvidenceTrace viewing (grading reasoning + data points) AND SOP citation viewing (art.1/2/7 with source location) AND excluded-route reasons; empty/loading states; no placeholder panel.
  - demo_or_evidence_output: Reasoning panel for ACC_001 showing why A-level and why alternates excluded, with citations {1,2,7}.

- [x] TASK-130 Implement route display (primary/secondary/excluded reasons)
  - objective: Render primary/secondary evacuation and excluded candidates with reasons, marking provisional route facts (§16, R6/R13).
  - requirements_covered: REQ-013, REQ-014, R6, R13
  - design_sections: §16, §10.8, §10.12
  - components: DashboardService (route display)
  - files_or_modules_expected: `packages/frontend/src/decision/route_panel.tsx`
  - dependencies: [TASK-129]
  - implementation_steps:
    1. Render primary/secondary routes + congestion-maintain note when applicable.
    2. Render excluded candidates with exclusion reasons.
    3. Show `manual_confirmation_required` when anchor unresolved.
  - acceptance_criteria: Routes + reasons render; provisional/manual-confirmation surfaced.
  - tests_required: component test (TASK-135).
  - failure_cases: unresolved anchor → shows manual-confirmation, no fabricated primary.
  - done_definition: Route display implemented.
  - provisional_policy_notes: Route facts flagged provisional (Strategies A/C/D).
  - hg001_amendment:
    - ETE panel displays INCIDENT/PRIMARY/SECONDARY roles, per-road saturation, sum/count/average, base, penalty, result, and insufficient status.
  - aws_services_touched: HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, completeness
  - competition_quality_floor: Primary/secondary/excluded routes each with a non-empty exclusion reason; provisional badge where policy-dependent (Strategy D); `manual_confirmation_required` flow shown when the anchor is unresolved (no fabricated ranking).
  - demo_or_evidence_output: Route panel showing primary RD_TPE_004 / secondary RD_TPE_005 / excluded reasons + provisional badge (ACC_001).

- [x] TASK-131 Implement ETE display + provisional markers
  - objective: Render the ETE value, full calculation basis, timing and affected-set evidence, `formula_applicability`, and organizer-guidance provenance without presenting the selected policy as an OFFICIAL_SOP-mandated unique algorithm (§16, R12).
  - requirements_covered: REQ-009, REQ-020, R12
  - design_sections: §16, §10.9, §11.4
  - components: DashboardService (ETE display)
  - files_or_modules_expected: `packages/frontend/src/decision/ete_panel.tsx`
  - dependencies: [TASK-129]
  - implementation_steps:
    1. Render `ete_minutes`, calculation basis, and `formula_applicability`.
    2. Render event timestamp, decision cutoff, common ETE snapshot timestamp, affected road set and roles, and each road's Saturation_Score.
    3. Render sum, count, average, base clearance, congestion penalty, and final ETE with full formula substitution.
    4. Render organizer-guidance provenance and classify the selected policy as `ORGANIZER_GUIDED_TEAM_POLICY`, `NON_UNIQUE`, `CONFIGURABLE`, and `DETERMINISTIC_AND_REPRODUCIBLE`; state that the organizer did not mandate one unique algorithm.
    5. Show `INSUFFICIENT_COMMON_SNAPSHOT` and `lower_bound_only` states when applicable.
  - acceptance_criteria: ETE, complete basis, timing, road roles and inputs, formula substitution, and policy provenance render; the selected 78.6-minute result is never presented as an OFFICIAL_SOP-mandated unique Golden answer; insufficient-common-snapshot and lower-bound states are explicit.
  - tests_required: component test (TASK-135).
  - failure_cases: presenting the organizer-guided ETE as an official unique algorithm, omitting calculation provenance, or fabricating ETE when no common snapshot exists → review rejection.
  - done_definition: ETE display implemented with complete deterministic evidence, organizer-guidance provenance, and insufficient-data states.
  - provisional_policy_notes: Strategies A/C are `ORGANIZER_GUIDED_TEAM_POLICY`, `NON_UNIQUE`, `CONFIGURABLE`, and `DETERMINISTIC_AND_REPRODUCIBLE`; OQ-003 is resolved for implementation by HG-001 while OQ-011 remains open.
  - hg001_amendment:
    - Report view discloses event timestamp, decision cutoff, common ETE snapshot, affected-set roles, per-road saturation, sum/count/average/base/penalty/final ETE, assumptions, and `guidance_id=HG-001`.
  - aws_services_touched: HTTP API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: ETE value + complete calculation basis; event/cutoff/common-snapshot timing; affected road roles and inputs; full formula substitution; organizer-guidance provenance; explicit insufficient-common-snapshot/lower-bound display; selected policy never presented as the official/host-mandated unique answer.
  - demo_or_evidence_output: ETE panel for ACC_001 showing 78.6 minutes, 22:00 common ETE snapshot, RD_TPE_002/RD_TPE_004/RD_TPE_005 roles and saturation values, full formula substitution, and HG-001 organizer-guidance provenance.

- [x] TASK-132 Implement report + public-alert panels
  - objective: Render the command-center report and multilingual public alert from the read model (Core+Narrative), with template-text indication when narratives are not yet ready (§16, R13/R14).
  - requirements_covered: REQ-021, REQ-022, R13, R14
  - design_sections: §16, §10.11c, §10.12, §10.13
  - components: DashboardService (report/alert panels)
  - files_or_modules_expected: `packages/frontend/src/decision/report_panel.tsx`, `packages/frontend/src/decision/alert_panel.tsx`
  - dependencies: [TASK-121, TASK-149]
  - implementation_steps:
    1. Render `REPORT` and `PUBLIC_ALERT` narrative payloads; fall back to template text if not ready.
    2. Render CMS `cms_core_text` (deterministic) distinctly from `cms_explanation_text`.
    3. Update on `report.ready`/`public_alert.ready`/`decision.enriched`.
  - acceptance_criteria: Report + multilingual alert render; template indicated when narrative missing.
  - tests_required: component test (TASK-135).
  - failure_cases: narrative missing → template shown ("系統模板").
  - done_definition: Report + alert panels implemented.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Public-facing output never fabricates ETE when common snapshot is unavailable and never treats contextual affected_road as a route or trigger.
  - aws_services_touched: HTTP/WebSocket API (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: Report panel + multilingual public-alert panel (zh/en, +ja/ko when enabled) with citations; publish-confirmation flow; loading/empty/error states; no placeholder.
  - demo_or_evidence_output: Report + multilingual alert panels rendered for the official events with a publish-confirmation step.

- [x] TASK-133 Implement execution status/error display (execution summary + processing.failed)
  - objective: Render the read-only `execution` summary (`status`/`last_error`/`retryable`/`attempt_count`) and `processing.failed` events, including terminal CORE_IDENTITY_CONFLICT (§10.11c, §13, FIX 1).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §10.11c, §13, §12, FIX 1
  - components: DashboardService (execution status)
  - files_or_modules_expected: `packages/frontend/src/decision/execution_status.tsx`
  - dependencies: [TASK-122, TASK-149]
  - implementation_steps:
    1. Render `execution` summary from the read model.
    2. Handle `processing.failed` (show `error_code`/`retryable`).
    3. Show terminal CORE_IDENTITY_CONFLICT distinctly (non-recoverable).
  - acceptance_criteria: Execution status + failure events render; terminal conflict shown as non-recoverable.
  - tests_required: component test (TASK-135).
  - failure_cases: retryable=false shown without a retry affordance.
  - done_definition: Execution status display implemented.
  - provisional_policy_notes: none
  - aws_services_touched: HTTP/WebSocket API (client)
  - security_or_iam_notes: Do not expose sensitive internals; show error_code/trace_id only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, technical_feasibility, completeness
  - competition_quality_floor: Execution summary (`status`/`last_error`/`retryable`/`attempt_count`) + `processing.failed`; the non-retryable `CORE_IDENTITY_CONFLICT` shown distinctly (not a generic error); `manual_confirmation_required` flow; stale-data and degraded indicators; clear status hierarchy; no placeholder.
  - demo_or_evidence_output: Status panel showing a terminal non-retryable conflict distinctly and a manual-confirmation prompt.

- [ ] TASK-134 Implement responsive design (REQ-030 bonus) and ja/ko UI (REQ-031 bonus)
  - objective: Add responsive/visually-designed layout (REQ-030 bonus) and Japanese/Korean UI localization surfacing ja/ko alerts (REQ-031 bonus) (§8, §16, §14.4).
  - requirements_covered: REQ-030, REQ-031, R17
  - design_sections: §8, §16, §14.4, §21.3
  - components: DashboardService (bonus UI/i18n)
  - files_or_modules_expected: `packages/frontend/src/i18n/`, `packages/frontend/src/theme/responsive.ts`
  - dependencies: [TASK-121, TASK-132]
  - implementation_steps:
    1. Add responsive layout + design system (bonus).
    2. Add ja/ko UI locale bundles; surface ja/ko public-alert text.
    3. Keep language floor consistent with deterministic trigger.
  - acceptance_criteria: Responsive layout works; ja/ko UI + alert text render when applicable.
  - tests_required: snapshot/visual test (non-PBT) (TASK-135).
  - failure_cases: none (bonus).
  - done_definition: Responsive + ja/ko UI implemented.
  - provisional_policy_notes: none
  - aws_services_touched: none (client)
  - security_or_iam_notes: none
  - delivery_class: BONUS_OPTIONAL
  - judging_criteria_contribution: business_applicability, theme_alignment
  - competition_quality_floor: Bonus scope only: the +5% visual/intuitive design polish (REQ-030) and ja/ko UI localization (REQ-031). The baseline responsive layout and all UX states are already covered by core tasks TASK-121..133; this task adds ONLY the polish and ja/ko strings and is the sole genuinely skippable UI scope.
  - demo_or_evidence_output: Polished responsive layout + ja/ko UI toggle in the demo (bonus evidence; not required for a functional submission).
  - optional_marker: * (BONUS_OPTIONAL — genuinely skippable; +5% design/ja-ko polish only)

- [ ] TASK-135 Frontend component/snapshot tests
  - objective: Add component + snapshot tests for the dashboard panels, realtime dedup, polling fallback, and injection outcomes (UI appearance is non-PBT per §22.1).
  - requirements_covered: REQ-001, REQ-004, REQ-030, R4, R17
  - design_sections: §22.1 (UI non-PBT), §22.2 (component/snapshot)
  - components: DashboardService (tests)
  - files_or_modules_expected: `packages/frontend/test/`
  - dependencies: [TASK-124, TASK-125, TASK-126, TASK-127, TASK-128, TASK-129, TASK-130, TASK-131, TASK-132, TASK-133, TASK-123]
  - implementation_steps:
    1. Add component tests for panels and light-color mapping (server-provided level).
    2. Add tests for dedup + polling fallback + injection outcomes.
    3. Add snapshot tests for layout (incl responsive/ja-ko).
  - acceptance_criteria: Component + snapshot tests pass; light mapping uses server truth.
  - tests_required: component + snapshot (non-PBT).
  - failure_cases: client threshold recompute detected → failure.
  - done_definition: Frontend test suite green.
  - provisional_policy_notes: none
  - aws_services_touched: none (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Component/snapshot tests cover ALL UX states (loading/empty/error/insufficient-data/stale/degraded/provisional-badge/non-retryable-conflict/manual-confirmation/publish-confirmation); assert no placeholder panel ships; visual regression on key panels. Release-blocking.
  - demo_or_evidence_output: Green component/snapshot suite with a state matrix; visual-regression baselines for the core panels.

CHECKPOINT H (not a task): Ensure the dashboard renders deterministic truth with realtime + fallback; ask the user if questions arise.

---

## Phase 8 — What-if Advisory (4-stage)

> This phase implements the four-stage What-if flow (§14.5): Bedrock parses (stage 1) and explains (stage 4) only; deterministic code validates (stage 2) and recomputes (stage 3). `raw_question` is `UNTRUSTED_USER_INPUT`; Bedrock never decides any threshold/numeric truth; ambiguity yields `clarification_required` (no guessing); What-if never mutates decision state (OQ-009 stays configurable/PARTIALLY_DEFINED).

- [ ] TASK-136 Implement WhatIfFn: POST /what-if handler (dedicated Lambda) + Cognito operator auth + untrusted-input handling
  - objective: Implement the dedicated `WhatIfFn` runtime Lambda handler for `POST /what-if` (Cognito operator), treat `raw_question` as `UNTRUSTED_USER_INPUT`, and orchestrate the four stages returning `WhatIfResult` (§12, §14.5, §17). Hosted on the dedicated WhatIfFn (provisioned TASK-067, IAM WhatIfFnRole TASK-177) so What-if never runs inside RendererFn/ApiReadFn/DecisionFn; What-if writes NO decision/narrative/publish/idempotency table and never mutates state.
  - requirements_covered: REQ-006, REQ-007, R16
  - design_sections: §12, §14.5, §17, §10.14, §10.15, §6 圖2 (WhatIfFn host), §18
  - components: WhatIfFn handler (WhatIfEngine orchestration)
  - files_or_modules_expected: `packages/backend/src/whatif/whatif_fn.ts`
  - dependencies: [TASK-067, TASK-069, TASK-071, TASK-137, TASK-138, TASK-139, TASK-140, TASK-177]
  - implementation_steps:
    1. Authorize via Cognito operator; wrap `raw_question` as untrusted, never executed as instruction.
    2. Orchestrate stages 1→4: stage-1 Bedrock ScenarioParser → stage-2 Schema+Domain validation (short-circuit to `clarification_required` on ambiguity/invalid, no guessing) → stage-3 deterministic recompute → stage-4 Bedrock explanation with SOP citation.
    3. Return `WhatIfResult` with `does_not_mutate_state=true`; perform zero writes to any decision/narrative/publish/idempotency table.
  - acceptance_criteria: Operator-authorized; untrusted input framed; runs on dedicated WhatIfFn; returns WhatIfResult; no state mutation; ambiguity → clarification_required.
  - tests_required: integration (TASK-142); ambiguity (TASK-143).
  - failure_cases: prompt-injection content ignored as data (§17); Bedrock failure → clarification/explanation-template, never a fabricated numeric truth.
  - done_definition: WhatIfFn handler orchestrated on the dedicated Lambda with full 4-stage flow.
  - provisional_policy_notes: OQ-009 boundary (LLM vs deterministic) stays configurable; Bedrock never decides thresholds.
  - aws_services_touched: HTTP API, Cognito, Lambda (WhatIfFn), Amazon Bedrock (stages 1/4 via WhatIfFnRole), Bedrock KB (Retrieve, stage 4)
  - security_or_iam_notes: Operator scope; untrusted input isolation; bound to WhatIfFnRole (Bedrock/KB read + read-only source/DecisionCore; explicit Deny on all writes/StartExecution/PostToConnection).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: creativity, technical_feasibility, theme_alignment
  - competition_quality_floor: Full COMPETITION_AWS What-if path on the dedicated WhatIfFn (NL ScenarioParser → schema+domain validation → clarification_required → deterministic recompute → no-state-mutation → Bedrock explanation → SOP citation → frontend → error/fallback UX); never front-end-only/chat-only/hard-coded-options/no-validation/no-citation/no-IAM; writes no state table.
  - demo_or_evidence_output: Integration test (TASK-142) shows WhatIfResult with triggered/applied articles + SOP citations + `does_not_mutate_state=true`; ambiguity test (TASK-143) shows `clarification_required`.

- [ ] TASK-137 Implement ScenarioParser (stage 1, Bedrock) NL→structured assumptions
  - objective: Implement stage-1 `ScenarioParser` using Bedrock to convert the NL question into structured assumptions `{entity_id, field, operator, value}` only (no truth decision) (§14.5).
  - requirements_covered: REQ-006, R16
  - design_sections: §14.5 (stage 1), §10.14, Figure 10
  - components: ScenarioParser (Bedrock)
  - files_or_modules_expected: `packages/backend/src/whatif/scenario_parser.ts`
  - dependencies: [TASK-112]
  - implementation_steps:
    1. Prompt Bedrock to output structured assumptions only.
    2. Never allow Bedrock to compute triggers/thresholds/ETE.
    3. Pass assumptions to stage 2.
  - acceptance_criteria: Produces structured assumptions; no numeric/boolean decision by Bedrock.
  - tests_required: integration (TASK-142).
  - failure_cases: Bedrock failure → `clarification_required` (no guess).
  - done_definition: ScenarioParser implemented.
  - provisional_policy_notes: OQ-009: Bedrock limited to parsing.
  - aws_services_touched: Amazon Bedrock (client; Mock in LOCAL_MOCK)
  - security_or_iam_notes: Untrusted input framed; Bedrock access via WhatIfFnRole (TASK-177), parse/text only — no state writes.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: creativity, technical_feasibility, theme_alignment
  - competition_quality_floor: Stage-1 Bedrock outputs ONLY structured assumptions `{entity_id, field, operator, value}`; never computes triggers/thresholds/ETE; Bedrock failure → `clarification_required` (no guess); runs on WhatIfFn under WhatIfFnRole.
  - demo_or_evidence_output: Integration test: NL "BL17=40000" → structured assumption, with no numeric/boolean decision made by Bedrock.

- [ ] TASK-138 Implement SchemaValidator + DomainValidator (stage 2) + clarification_required
  - objective: Implement deterministic stage-2 validation (entity exists, field legal, type correct, value in range, ambiguity) returning `clarification_required` + `clarification_prompt` on any failure, never guessing (§14.5, P35).
  - requirements_covered: REQ-006, R16
  - design_sections: §14.5 (stage 2), §10.14, §22.1 (P35)
  - components: SchemaValidator + DomainValidator (What-if)
  - files_or_modules_expected: `packages/backend/src/whatif/validators.ts`
  - dependencies: [TASK-137, TASK-015, TASK-014]
  - implementation_steps:
    1. Validate entity/field/type/range against loaded data.
    2. Detect ambiguity; on any failure → `parse_status=clarification_required` + prompt.
    3. Only pass validated assumptions to stage 3.
  - acceptance_criteria: Invalid/ambiguous → clarification_required (no stage 3); valid → proceed.
  - tests_required: P35 (TASK-142); ambiguity (TASK-143).
  - failure_cases: never guess values (§14.5).
  - done_definition: Stage-2 validators implemented.
  - provisional_policy_notes: none
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Stage-2 deterministic Schema + Domain validation (entity/field/type/range/ambiguity); any invalid/ambiguous input → `clarification_required` + `clarification_prompt`, no guessing, no entry to stage 3.
  - demo_or_evidence_output: Unit tests: valid → proceed; invalid/ambiguous → clarification_required (feeds P35).

- [ ] TASK-139 Implement deterministic recompute (stage 3, does_not_mutate_state)
  - objective: Implement stage-3 deterministic recompute that reruns the Rule Engine on validated assumptions to produce `triggered_articles`/`applied_formula_articles`/`expected_actions`/`ete_preview` without mutating any real decision state (§14.5, P28).
  - requirements_covered: REQ-007, R16
  - design_sections: §14.5 (stage 3), §10.15, §22.1 (P28)
  - components: WhatIfEngine / RuleEngine (recompute)
  - files_or_modules_expected: `packages/backend/src/whatif/recompute.ts`
  - dependencies: [TASK-138, TASK-033, TASK-031]
  - implementation_steps:
    1. Rerun the Rule Engine with the hypothetical assumptions on a copy of inputs.
    2. Produce results equal to a real rule-engine run under those assumptions.
    3. Set `does_not_mutate_state=true`; never write DecisionCore.
  - acceptance_criteria: Results equal a rule-engine rerun; no state mutation.
  - tests_required: P28 (TASK-142).
  - failure_cases: any decision-state write → failure.
  - done_definition: Stage-3 recompute implemented.
  - provisional_policy_notes: Uses active provisional strategies (config); What-if reflects current policy.
  - aws_services_touched: none (pure domain)
  - security_or_iam_notes: Read-only; no persistence.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Stage-3 re-runs the deterministic Rule Engine on validated assumptions (triggered/applied/expected_actions/ete_preview); `does_not_mutate_state=true` — ZERO writes to any decision/narrative/publish/idempotency table.
  - demo_or_evidence_output: Feeds P28; integration test proving recompute equals a fresh Rule-Engine run with no state change.

- [ ] TASK-140 Implement Bedrock explanation (stage 4) + SOP citation
  - objective: Implement stage-4 Bedrock explanation grounded in stage-3 facts + RAG citations, producing `explanation_text` only (no threshold/number changes) (§14.5).
  - requirements_covered: REQ-007, R16
  - design_sections: §14.5 (stage 4), §14.2, Figure 10
  - components: WhatIf explanation (Bedrock) + SopRetriever
  - files_or_modules_expected: `packages/backend/src/whatif/explanation.ts`
  - dependencies: [TASK-139, TASK-108, TASK-110, TASK-111]
  - implementation_steps:
    1. Retrieve SOP citations for the recomputed article set.
    2. Prompt Bedrock to explain facts + citations only; validate text-only.
    3. Return `explanation_text` + `sop_citations`.
  - acceptance_criteria: Explanation cites SOP; no numeric/threshold change; text-only.
  - tests_required: integration (TASK-142); RAG citation reuse.
  - failure_cases: Bedrock failure → template explanation from facts.
  - done_definition: Stage-4 explanation implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon Bedrock, Bedrock KB (client)
  - security_or_iam_notes: text-only; SchemaValidator enforced.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: creativity, theme_alignment, completeness
  - competition_quality_floor: Stage-4 Bedrock explanation from stage-3 facts + RAG citation; explains ONLY (never changes numbers/thresholds/route); SOP citation attached; failure → explanation template (facts unchanged).
  - demo_or_evidence_output: Integration test: explanation cites the correct SOP articles and matches stage-3 facts verbatim.

- [ ] TASK-141 Implement What-if UI (dialog window)
  - objective: Build the dashboard What-if dialog that submits questions and renders `WhatIfResult` (triggered/applied articles, expected actions, ETE preview, citations, or clarification prompt) (§16, R16).
  - requirements_covered: REQ-006, REQ-007, R16
  - design_sections: §16, §14.5, §12
  - components: DashboardService (What-if UI)
  - files_or_modules_expected: `packages/frontend/src/whatif/whatif_dialog.tsx`
  - dependencies: [TASK-121, TASK-136]
  - implementation_steps:
    1. Render a dialog input (operator); POST `/what-if`.
    2. Render answered result (articles/actions/ETE preview/citations) or `clarification_required` prompt.
    3. Indicate `does_not_mutate_state`.
  - acceptance_criteria: Dialog submits and renders both answered and clarification outcomes with citations.
  - tests_required: component test (TASK-135); integration (TASK-142).
  - failure_cases: ambiguous → clarification prompt shown (no fabricated answer).
  - done_definition: What-if UI implemented.
  - provisional_policy_notes: none
  - aws_services_touched: HTTP API, Cognito (client)
  - security_or_iam_notes: Operator scope.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: creativity, theme_alignment, business_applicability
  - competition_quality_floor: What-if dialog with loading/empty/error states, the `clarification_required` prompt (no auto-guess), triggered-articles + expected-actions + SOP-citation viewing, an explicit "does not change live state" indication, command confirmation, keyboard accessibility, and responsive layout; no placeholder; never chat-only/hard-coded-options.
  - demo_or_evidence_output: Live "BL17=40000" query in the demo returns triggered articles + citations with a no-state-change indicator; an ambiguous query shows the clarification prompt.

- [ ] TASK-142 What-if 4-stage integration tests (P28, P35)
  - objective: Verify stage-2 clarification (no stage 3 on ambiguity), stage-3 equivalence to a rule-engine rerun, `does_not_mutate_state`, and stage-4 citation grounding.
  - requirements_covered: REQ-006, REQ-007, R16
  - design_sections: §22.1 (P28, P35), §14.5
  - components: WhatIfEngine (stages 1–4)
  - files_or_modules_expected: `packages/backend/test/integration/whatif_flow.test.ts`
  - dependencies: [TASK-137, TASK-138, TASK-139, TASK-140]
  - implementation_steps:
    1. P35: ambiguous input → clarification_required, no stage 3.
    2. P28: valid input → stage-3 equals a rule-engine rerun; `does_not_mutate_state`.
    3. Assert stage-4 cites SOP.
  - acceptance_criteria: P28 + P35 pass ≥100 iterations; no state mutation.
  - tests_required: property P28, P35 + integration.
  - failure_cases: state mutation or guessed answer → failure.
  - done_definition: What-if integration + P28/P35 green.
  - provisional_policy_notes: none
  - aws_services_touched: Bedrock (Mock), Lambda (harness)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: P28/P35 each a single property (≥100 iterations, labeled): the What-if result equals a deterministic Rule-Engine re-run with `does_not_mutate_state=true`; an ambiguous/invalid input yields `clarification_required` with no stage-3 compute. Release-blocking.
  - demo_or_evidence_output: Green ≥100-iteration P28/P35 runs with labels; a state-mutation or guess attempt is caught.

- [ ] TASK-143 What-if clarification/ambiguity failure tests
  - objective: Verify ambiguous/invalid/injection-style inputs never reach stage 3, never mutate state, and always yield a clarification prompt (§14.5, §17).
  - requirements_covered: REQ-006, R16
  - design_sections: §14.5, §17, §21
  - components: WhatIf validators
  - files_or_modules_expected: `packages/backend/test/integration/whatif_clarification.test.ts`
  - dependencies: [TASK-138, TASK-139]
  - implementation_steps:
    1. Feed ambiguous/invalid/injection strings.
    2. Assert clarification_required, no stage-3 compute, no state mutation.
    3. Assert prompt-injection content treated as data.
  - acceptance_criteria: All adversarial inputs handled safely with clarification.
  - tests_required: failure/ambiguity tests.
  - failure_cases: any state mutation or executed instruction → failure.
  - done_definition: What-if clarification suite green.
  - provisional_policy_notes: none
  - aws_services_touched: none (harness)
  - security_or_iam_notes: Prompt-injection defense verified.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Ambiguous/invalid/prompt-injection inputs → `clarification_required` / rejected as data; What-if never fabricates a numeric/boolean truth and never mutates state. Release-blocking.
  - demo_or_evidence_output: Green suite: a prompt-injection payload is treated as data; ambiguity → clarification; zero state writes verified.

CHECKPOINT I (not a task): Ensure What-if is deterministic-truth + does_not_mutate_state with clarification on ambiguity; ask the user if questions arise.

---

## Phase 9 — Publish & Audit + Read Model

> This phase implements one-click publish (`PublishFn` → `PublishRecordTable`, commander-authorized) with an audit trail, simulated CMS/SMS channels, and the `DecisionReadModel` that merges FOUR sources: DecisionCore + DecisionNarrative + PublishRecord + the read-only IdempotencyTable execution summary (§10.11c/d, §12, §13, §19). Publish state is never written back to immutable DecisionCore.

- [ ] TASK-144 Implement PublishFn handler + Cognito commander auth
  - objective: Handle `POST /decisions/{id}/publish` (Cognito commander), reading core+narrative read-only and writing publish state to `PublishRecordTable` (§12, §17, §10.11d).
  - requirements_covered: REQ-022, R11
  - design_sections: §12, §17, §10.11d, §10.17
  - components: PublishFn
  - files_or_modules_expected: `packages/backend/src/publish/publish_fn.ts`
  - dependencies: [TASK-064, TASK-071, TASK-082]
  - implementation_steps:
    1. Authorize via Cognito commander.
    2. Read DecisionCore/DecisionNarrative read-only; validate publishable.
    3. Delegate state transition to the publish state machine (TASK-145).
  - acceptance_criteria: Commander-authorized; core read-only; publish writes only PublishRecordTable.
  - tests_required: integration (TASK-152).
  - failure_cases: non-commander → fail-closed 403.
  - done_definition: PublishFn handler implemented.
  - provisional_policy_notes: none
  - aws_services_touched: HTTP API, Cognito, DynamoDB (client)
  - security_or_iam_notes: PublishFnRole; zero DecisionCore write (TASK-082).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: Commander-only (Cognito) publish; writes PublishRecordTable ONLY; never writes DecisionCore; `publish_state` never written back to the immutable Core.
  - demo_or_evidence_output: Publish handler test: commander scope enforced; PublishRecord written; Core untouched.

- [ ] TASK-145 Implement PublishRecord state machine (draft→approved→published/publish_failed)
  - objective: Implement the publish state transitions (`draft→approved→published`, or `publish_failed`) with optimistic-lock `version` on `PublishRecordTable` (§10.11d, §10.17).
  - requirements_covered: REQ-022, R11
  - design_sections: §10.11d, §10.17
  - components: PublishRecord state machine
  - files_or_modules_expected: `packages/backend/src/publish/publish_state_machine.ts`
  - dependencies: [TASK-144]
  - implementation_steps:
    1. Model states + legal transitions; enforce with conditional Update + `version`.
    2. Write `failure_reason` on `publish_failed`.
    3. Never write back to DecisionCore.
  - acceptance_criteria: Only legal transitions succeed; version enforced; core untouched.
  - tests_required: integration (TASK-152).
  - failure_cases: illegal transition → rejected.
  - done_definition: Publish state machine implemented.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB (client)
  - security_or_iam_notes: PublishRecordTable sole writer PublishFn.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: `draft → approved → published` (or `publish_failed`); every transition appends to `audit_trail`; optimistic-lock `version`; no illegal transitions.
  - demo_or_evidence_output: State-machine test covering all transitions + audit-trail entries.

- [ ] TASK-146 Implement simulated CMS/SMS channels + one-click copy/export
  - objective: Implement the demo publish channels (CMS/SMS mock, one-click copy, one-click export) — no real telecom gateway — surfacing published payload from the read model (§10.17, §12).
  - requirements_covered: REQ-022, R11
  - design_sections: §10.17, §10.11d
  - components: PublishFn (channels)
  - files_or_modules_expected: `packages/backend/src/publish/channels.ts`
  - dependencies: [TASK-145, TASK-149]
  - implementation_steps:
    1. Implement CMS/SMS mock channels + copy/export producing the published payload.
    2. Record `channels` on PublishRecord.
    3. No real SMS gateway; demo simulation only.
  - acceptance_criteria: Channels simulate publish + export; payload from read model; no external telecom call.
  - tests_required: integration (TASK-152).
  - failure_cases: channel failure → `publish_failed` with reason.
  - done_definition: Simulated channels implemented.
  - provisional_policy_notes: none
  - aws_services_touched: none external (simulation); DynamoDB (client)
  - security_or_iam_notes: No outbound third-party data transmission (§17).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: theme_alignment, business_applicability, completeness
  - competition_quality_floor: Demo-grade CMS/SMS simulation + one-click copy + one-click export; no real telco gateway required; the publish flow is operable end-to-end in the demo.
  - demo_or_evidence_output: One-click copy/export produces the published payload; simulated channels shown in the demo.

- [ ] TASK-147 Implement audit_trail + optimistic lock
  - objective: Record every publish transition into `audit_trail` (actor, action, from_state, to_state, at) with `approved_by`/`published_by` (Cognito), preserved via optimistic lock (§10.11d, §19).
  - requirements_covered: REQ-022, R11
  - design_sections: §10.11d, §19
  - components: PublishRecord audit
  - files_or_modules_expected: `packages/backend/src/publish/audit_trail.ts`
  - dependencies: [TASK-145]
  - implementation_steps:
    1. Append an audit entry per transition with actor + timestamps (`YYYY-MM-DD HH:MM`).
    2. Store `approved_by`/`published_by` from Cognito claims.
    3. Ensure the trail is immutable/append-only under version control.
  - acceptance_criteria: Every transition audited with actor + times; append-only.
  - tests_required: integration (TASK-152).
  - failure_cases: missing audit entry → failure.
  - done_definition: Audit trail implemented.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB (client)
  - security_or_iam_notes: Actor identity from Cognito; no credentials logged.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: Every state transition appends `{actor, action, from_state, to_state, at}` to `audit_trail`; optimistic lock prevents lost updates; audit trail is tamper-evident and complete.
  - demo_or_evidence_output: Test showing a concurrent update is rejected by optimistic lock and the audit trail is complete.

- [ ] TASK-148 Implement publish.status_changed event
  - objective: Emit the `publish.status_changed` WebSocket event on each transition (carrying `publish_state` + `audit_trail`) with a `GET /decisions/{id}` polling fallback (§13).
  - requirements_covered: REQ-022, R11
  - design_sections: §13, §10.11d
  - components: RealtimePublisher (publish event)
  - files_or_modules_expected: `packages/backend/src/realtime/publish_status_changed.ts`
  - dependencies: [TASK-145, TASK-070]
  - implementation_steps:
    1. Emit `publish.status_changed` on transitions.
    2. Include `publish_state` + audit trail; define polling fallback.
    3. Dedup by `ready_event_id` on the client.
  - acceptance_criteria: Event emitted per transition; fallback defined.
  - tests_required: integration (TASK-152).
  - failure_cases: WebSocket down → polling reflects publish state.
  - done_definition: Publish event implemented.
  - provisional_policy_notes: none
  - aws_services_touched: WebSocket (client)
  - security_or_iam_notes: Only Ws roles push.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Emits `publish.status_changed` with state + `audit_trail`; `GET /decisions/{id}` polling fallback carries `publish_state` + `audit_trail`.
  - demo_or_evidence_output: Event emitted on each transition; Dashboard reflects draft→approved→published in the demo.

- [ ] TASK-149 Implement DecisionReadModel merge (Core+Narrative+Publish+execution summary)
  - objective: Implement the `ApiReadFn` read model that merges DecisionCore (authoritative numbers) + DecisionNarrative (all narrative_type items) + PublishRecord (publish state) + the read-only IdempotencyTable `execution` summary (§10.11c, FIX 1).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R13, R14, R15
  - design_sections: §10.11c, §12, FIX 1
  - components: ApiReadFn (read model merge)
  - files_or_modules_expected: `packages/backend/src/read_model/decision_read_model.ts`
  - dependencies: [TASK-062, TASK-063, TASK-064, TASK-081]
  - implementation_steps:
    1. Read core + all narrative_type items + publish record; add read-only `execution` summary from IdempotencyTable.
    2. Fall back to template text when a narrative_type is not ready; `publish` absent/draft when not published.
    3. Align by `decision_id` + `version`/`core_version_ref`; numbers always from DecisionCore.
  - acceptance_criteria: Merged view returns core+narrative+publish+execution; numbers from core; execution read-only.
  - tests_required: integration (TASK-152).
  - failure_cases: narrative not ready → template; not published → draft/absent.
  - done_definition: Read model merge implemented (4 sources).
  - provisional_policy_notes: none
  - hg001_amendment:
    - Read model exposes all HG-001 deterministic fields without allowing narrative overwrite.
  - aws_services_touched: DynamoDB (client)
  - security_or_iam_notes: ApiReadFnRole read-only incl IdempotencyTable GetItem (TASK-081).
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Merges Core + Narrative (3 items) + Publish + a read-only `execution` summary from IdempotencyTable (FIX 1); core numbers come from the immutable Core; an unready narrative → core + template; not-published → `draft`/absent; three tables aligned by `decision_id`/`version`.
  - demo_or_evidence_output: Read-model test returning merged view incl. execution summary (status/last_error/retryable/attempt_count).

- [ ] TASK-150 Implement GET read handlers (/timeline,/roads,/crowd,/incidents,/decisions,/reports)
  - objective: Implement the public read-only GET handlers returning the §12 payloads (with `schema_version`/`trace_id`/`policy`/`provisional`), backed by ApiReadFn (§12).
  - requirements_covered: REQ-001, REQ-011, REQ-021, REQ-022, REQ-008, R1, R13, R14, R15
  - design_sections: §12 (route table)
  - components: ApiReadFn (GET handlers)
  - files_or_modules_expected: `packages/backend/src/read_model/get_handlers.ts`
  - dependencies: [TASK-149, TASK-019]
  - implementation_steps:
    1. Implement `/timeline`,`/roads`,`/crowd`,`/incidents`,`/decisions/{id}`,`/reports/{id}`.
    2. Include `schema_version`/`trace_id`/`policy`/`provisional` in responses.
    3. Insufficient data → `200` with `data_status=insufficient_data` (no fabrication).
  - acceptance_criteria: All GET routes return §12 shapes with required envelope fields.
  - tests_required: contract tests (TASK-152).
  - failure_cases: insufficient data surfaced (not fabricated).
  - done_definition: GET read handlers implemented.
  - provisional_policy_notes: Responses carry `policy`/`provisional` markers.
  - hg001_amendment:
    - API responses include cutoff/observation/common-snapshot/policy fields and deterministic affected_road context.
  - aws_services_touched: HTTP API, DynamoDB (client)
  - security_or_iam_notes: Public read-only; ApiReadFnRole.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: `GET /timeline,/roads,/crowd,/incidents,/decisions/{id},/reports/{id}` via ApiReadFn (read-only, incl. IdempotencyTable GetItem for the execution summary); every response carries `schema_version`/`trace_id`/`policy`/`provisional`.
  - demo_or_evidence_output: Contract test: each GET returns the §12 schema with required fields; no write side effects.

- [ ] TASK-151 Implement publish idempotency (no duplicate publish)
  - objective: Ensure publish dedup via `decision_id` + `publish_state` + optimistic `version`, so retries never re-emit `public_alert.ready` or re-trigger one-click publish (§15.2).
  - requirements_covered: REQ-022, R11
  - design_sections: §15.2 (no duplicate publish), §10.11d
  - components: PublishFn (idempotency)
  - files_or_modules_expected: `packages/backend/src/publish/publish_idempotency.ts`
  - dependencies: [TASK-145]
  - implementation_steps:
    1. Guard transitions with `version` + state checks.
    2. Retries return current state without duplicate side effects.
    3. Never re-emit alert readiness on retry.
  - acceptance_criteria: Publish retries are idempotent; no duplicate publish/alert.
  - tests_required: integration (TASK-152).
  - failure_cases: duplicate publish on retry → failure.
  - done_definition: Publish idempotency implemented.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Publish dedup by `decision_id` + `publish_state` + optimistic `version`; a retry NEVER re-emits `public_alert.ready` or re-triggers a publish.
  - demo_or_evidence_output: Test replaying a publish shows a single published state, no duplicate alert.

- [ ] TASK-152 Publish + read-model integration tests
  - objective: Verify the publish state machine, audit trail, idempotency, and the 4-source read model merge (incl execution summary + terminal conflict projection).
  - requirements_covered: REQ-021, REQ-022, REQ-008, R11, R13, R14, R15
  - design_sections: §22.2 (Integration/Contract), §10.11c/d
  - components: PublishFn, ApiReadFn
  - files_or_modules_expected: `packages/backend/test/integration/publish_read_model.test.ts`
  - dependencies: [TASK-145, TASK-147, TASK-149, TASK-150, TASK-151]
  - implementation_steps:
    1. Assert legal publish transitions + audit + idempotency.
    2. Assert read model merges 4 sources; numbers from core; execution read-only.
    3. Assert CORE_IDENTITY_CONFLICT terminal reflected in `execution` summary.
  - acceptance_criteria: Publish + read model behave per §10.11c/d; execution summary accurate.
  - tests_required: integration + contract.
  - failure_cases: publish state written to core / duplicate publish → failure.
  - done_definition: Publish + read-model suite green.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB, Lambda (harness)
  - security_or_iam_notes: Verifies writer isolation + read-only execution.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Integration tests for the publish state machine + audit trail + 4-source read-model merge + publish idempotency; verify isolation from the immutable Core (publish_state never written to Core). Release-blocking.
  - demo_or_evidence_output: Green publish + read-model integration suite proving Core isolation and no duplicate publish.

CHECKPOINT J (not a task): Ensure publish/audit + 4-source read model are correct and isolated from immutable core; ask the user if questions arise.

---

## Phase 10 — Observability, Resilience & Security

> This phase implements structured logging/metrics, the unified error model, throttling/backoff, the §21 failure fallbacks, the identity-conflict security alert, IAM-denial tests, secrets redaction, and Cognito fail-closed — all without weakening the §9 boundary or the FIX-1/2/3 contracts.

- [ ] TASK-153 Implement CloudWatch structured logging (trace_id/decision_id, no credentials)
  - objective: Add structured logging across Lambdas with `trace_id`/`decision_id`/stage timings and guaranteed no-credential output (§19, §17).
  - requirements_covered: REQ-004, REQ-032, R4, R5
  - design_sections: §19, §17
  - components: (logging across functions)
  - files_or_modules_expected: `packages/backend/src/observability/logger.ts`
  - dependencies: [TASK-075]
  - implementation_steps:
    1. Implement a structured logger stamping `trace_id`/`decision_id`/stage/duration.
    2. Redact credential-like values; reference secrets by key name only.
    3. Wire into all handlers.
  - acceptance_criteria: Logs are structured and credential-free; trace/decision IDs present.
  - tests_required: unit (redaction) + integration (TASK-164).
  - failure_cases: credential in log → redaction test failure.
  - done_definition: Structured logging implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon CloudWatch Logs (client)
  - security_or_iam_notes: No credentials/PII values in logs.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Structured logs with `trace_id`/`decision_id`/stage timings; NEVER contains credentials; secrets referenced by key name only.
  - demo_or_evidence_output: Log sample showing structured fields and redaction; a credential-in-log test fails the build.

- [ ] TASK-154 Implement custom latency metrics + alarms
  - objective: Emit `FastPathLatencyMs` and `EndToEndLatencyMs` and wire the 60s alarm (§19, §20).
  - requirements_covered: REQ-004, R5
  - design_sections: §19, §20, §10.16
  - components: Observability (latency metrics)
  - files_or_modules_expected: `packages/backend/src/observability/latency_metrics.ts`
  - dependencies: [TASK-104, TASK-075]
  - implementation_steps:
    1. Emit both latency metrics from LatencyTrace.
    2. Wire the `EndToEndLatencyMs > 60s` alarm.
    3. Best-effort emission (non-blocking).
  - acceptance_criteria: Metrics emitted; 60s alarm active.
  - tests_required: integration (TASK-164).
  - failure_cases: metric failure non-blocking.
  - done_definition: Latency metrics + alarm implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon CloudWatch (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `FastPathLatencyMs` (5s TEAM_TARGET) + `EndToEndLatencyMs` (60s OFFICIAL) metrics + alarm on 60s breach / high Bedrock failure; metric write is best-effort (failure never blocks the main flow).
  - demo_or_evidence_output: Metrics visible + a seeded 60s breach raises the alarm (competition smoke).

- [ ] TASK-155 Implement failure/fallback counters
  - objective: Emit `BedrockFailureCount`, `KbFallbackCount`, `SchemaValidationRejectCount`, `WsToPollingFallbackCount`, `InsufficientDataCount` (§19).
  - requirements_covered: REQ-032, R-supporting
  - design_sections: §19
  - components: Observability (counters)
  - files_or_modules_expected: `packages/backend/src/observability/failure_counters.ts`
  - dependencies: [TASK-075, TASK-109, TASK-111, TASK-122]
  - implementation_steps:
    1. Increment counters at each fallback/rejection point.
    2. Emit to the metric namespace.
    3. Wire from RAG/SchemaValidator/realtime/ingestion paths.
  - acceptance_criteria: All five counters emit at their trigger points.
  - tests_required: integration (TASK-164).
  - failure_cases: missing counter increment → test failure.
  - done_definition: Failure counters implemented.
  - provisional_policy_notes: none
  - aws_services_touched: Amazon CloudWatch (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `BedrockFailureCount`/`KbFallbackCount`/`SchemaValidationRejectCount`/`WsToPollingFallbackCount`/`InsufficientDataCount`; best-effort emission (never blocks the decision path).
  - demo_or_evidence_output: Counters increment under injected failures (feeds the failure-injection suite).

- [ ] TASK-156 Implement unified structured error model
  - objective: Implement the `{error_code, message, trace_id, retryable}` error model across API/events, with `429` (retryable) and insufficient-data (`200` + `data_status`) semantics (§12, §21).
  - requirements_covered: REQ-003, REQ-004, R5
  - design_sections: §12 (error model), §21
  - components: (error model)
  - files_or_modules_expected: `packages/backend/src/observability/error_model.ts`
  - dependencies: [TASK-003]
  - implementation_steps:
    1. Define the error envelope + codes (incl `WORKFLOW_START_FAILED`, `CORE_IDENTITY_CONFLICT`).
    2. Map throttling → `429 retryable=true`; insufficient data → `200` + `data_status`.
    3. Wire into handlers.
  - acceptance_criteria: Errors follow the envelope; codes/retryable correct.
  - tests_required: contract tests (TASK-164).
  - failure_cases: inconsistent error shape → failure.
  - done_definition: Error model implemented.
  - provisional_policy_notes: none
  - aws_services_touched: none (shared)
  - security_or_iam_notes: No sensitive detail in messages.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Unified `{error_code, message, trace_id, retryable}`; `429` retryable; insufficient-data → `200` + `data_status`; `CORE_IDENTITY_CONFLICT` → `409` (`retryable=false`), NEVER `500`; consistent across all handlers.
  - demo_or_evidence_output: Contract tests asserting the error envelope and the exact status codes per §12.

- [ ] TASK-157 Implement throttling + exponential backoff
  - objective: Implement exponential backoff/retry for API Gateway `429` and DynamoDB throttling, with reserved-concurrency awareness for Fast Path (§4.3, §21, §27).
  - requirements_covered: REQ-004, R5
  - design_sections: §21.2, §4.3, §27
  - components: (backoff/retry)
  - files_or_modules_expected: `packages/backend/src/resilience/backoff.ts`
  - dependencies: [TASK-085, TASK-156]
  - implementation_steps:
    1. Implement exponential backoff with jitter for transient errors.
    2. Apply to DynamoDB and downstream calls.
    3. Preserve DecisionFn Fast Path priority (reserved concurrency).
  - acceptance_criteria: Transient errors retried with backoff; Fast Path prioritized.
  - tests_required: failure-injection (TASK-163).
  - failure_cases: retry storm avoided via jitter/caps.
  - done_definition: Backoff/retry implemented.
  - provisional_policy_notes: none
  - aws_services_touched: DynamoDB, API Gateway (client)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Exponential backoff/retry on transient DynamoDB/API throttling (`429`); DecisionFn reserved concurrency preserves the Fast Path under load; retries bounded (no infinite loop).
  - demo_or_evidence_output: Failure-injection test: throttling is retried with backoff and Fast Path stays prioritized.

- [ ] TASK-158 Implement Bedrock/KB/DynamoDB/WebSocket failure handling + fallbacks
  - objective: Wire the §21 fallbacks: Bedrock timeout → template; KB failure → S3 article read; DynamoDB transient → backoff/degrade; WebSocket drop → polling — always deterministic-result-first (§21.2).
  - requirements_covered: REQ-004, REQ-005, R5
  - design_sections: §21.1, §21.2, Figure 12
  - components: (resilience wiring)
  - files_or_modules_expected: `packages/backend/src/resilience/fallbacks.ts`
  - dependencies: [TASK-109, TASK-112, TASK-117, TASK-122, TASK-157]
  - implementation_steps:
    1. Bedrock failure → templates (Fast Path unaffected); KB failure → S3 article read.
    2. DynamoDB transient → backoff; connection write failure → degrade to polling.
    3. Region-lacks-model → model fallbacks → templates.
  - acceptance_criteria: Each failure degrades per §21; core numbers unaffected.
  - tests_required: failure-injection (TASK-163).
  - failure_cases: fabrication on failure → forbidden (§21.1).
  - done_definition: Failure fallbacks wired.
  - provisional_policy_notes: none
  - aws_services_touched: Bedrock, KB, DynamoDB, WebSocket, S3 (client)
  - security_or_iam_notes: No third-party fallback; AWS-native only.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Bedrock timeout → template; KB failure → S3 article read; WebSocket drop → polling; DynamoDB transient → backoff; region-no-model → `model_id_fallbacks` → template; the Fast Path and core numbers are NEVER blocked by a Bedrock/KB failure (§20/§21).
  - demo_or_evidence_output: Failure-injection: each dependency failure engages its fallback; core decision unchanged.

- [ ] TASK-159 Implement stale-running + identity-conflict security alert
  - objective: Emit a security alert on `CORE_IDENTITY_CONFLICT` and structured signals on stale-running reconciliation, feeding CloudWatch (§15.2, §19, §21).
  - requirements_covered: REQ-004, R5
  - design_sections: §15.2, §19, §21.2
  - components: (security alerting)
  - files_or_modules_expected: `packages/backend/src/observability/security_alerts.ts`
  - dependencies: [TASK-096, TASK-091, TASK-153]
  - implementation_steps:
    1. On identity conflict, log a security alert (fail-closed, no core overwrite).
    2. On stale reconciliation, emit structured signal.
    3. Never expose secrets in alerts.
  - acceptance_criteria: Identity conflict + stale-running produce alerts/signals.
  - tests_required: integration (TASK-164).
  - failure_cases: missing security alert on conflict → failure.
  - done_definition: Security alerting implemented.
  - provisional_policy_notes: none
  - aws_services_touched: CloudWatch (client)
  - security_or_iam_notes: Fail-closed; alerts credential-free.
  - delivery_class: MANDATORY_IMPLEMENTATION
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: `STALE_RUNNING_EXECUTION` reconciliation and `CORE_IDENTITY_CONFLICT` are logged as security alerts; fail-closed; no silent downgrade of permissions or safety checks.
  - demo_or_evidence_output: Test asserting a security alert is logged on identity conflict and stale reconciliation.

- [ ] TASK-160 Implement IAM-denial tests (least-privilege enforcement)
  - objective: Verify each role's explicit denies actually block the forbidden actions (e.g., DecisionFn cannot write IdempotencyTable; RendererFn cannot write DecisionCore; WorkflowStatusFn/RecoveryGateFn cannot PostToConnection; InjectFn has no invoke wildcard) (§18).
  - requirements_covered: REQ-032, R-supporting (security)
  - design_sections: §18
  - components: IAM roles (all)
  - files_or_modules_expected: `infra/test/iam_denials.test.ts`
  - dependencies: [TASK-076, TASK-077, TASK-078, TASK-079, TASK-080, TASK-081, TASK-082, TASK-083, TASK-179]
  - implementation_steps:
    1. Assert synthesized policies contain the required `Deny` statements + narrow allows.
    2. Assert no wildcard invoke / no DynamoDB table write wildcard.
    3. Assert ApiReadFn IdempotencyTable is GetItem-only.
  - acceptance_criteria: All §18 denies present; no over-privilege.
  - tests_required: IAM policy assertion tests.
  - failure_cases: any missing deny / wildcard → failure.
  - done_definition: IAM-denial suite green.
  - provisional_policy_notes: none
  - aws_services_touched: AWS IAM (synth assertions)
  - security_or_iam_notes: Enforces the §9 boundary + FIX-1/2 isolation at IAM layer.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Per-role denial tests prove EVERY explicit DENY (DecisionFn no IdempotencyTable write; Renderer no Core write; WorkflowStatus/RecoveryGate/ApiRead scoped; WhatIfFn no writes/StartExecution/PostToConnection; Ingestion no raw write); no wildcard invoke or table-write. Release-blocking.
  - demo_or_evidence_output: Green IAM-denial suite: each role is rejected for every out-of-scope action.

- [ ] TASK-161 Implement secrets redaction + Cognito fail-closed tests
  - objective: Verify logs never contain secrets and that write paths fail closed when Cognito is unavailable while read paths remain available (§17).
  - requirements_covered: REQ-032, R-supporting (security)
  - design_sections: §17, §4.10
  - components: (security tests)
  - files_or_modules_expected: `packages/backend/test/security/secrets_and_authz.test.ts`
  - dependencies: [TASK-153, TASK-071]
  - implementation_steps:
    1. Assert redaction of credential-like values in logs.
    2. Simulate Cognito unavailable → write paths denied; read paths OK.
    3. Assert secrets referenced by name only.
  - acceptance_criteria: No secret leakage; write fail-closed; read unaffected.
  - tests_required: security tests.
  - failure_cases: write path open when Cognito down → failure.
  - done_definition: Security tests green.
  - provisional_policy_notes: none
  - aws_services_touched: Cognito, Secrets Manager (harness)
  - security_or_iam_notes: Fail-closed authorization verified.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, business_applicability, completeness
  - competition_quality_floor: Logs never contain secret values (redaction verified); Cognito unavailable → write paths fail-closed while reads remain available (§17). Release-blocking.
  - demo_or_evidence_output: Green tests: seeded secret is redacted in logs; a Cognito-down scenario rejects writes and allows reads.

- [ ] TASK-162 Wire optional X-Ray tracing
  - objective: Enable X-Ray tracing behind `observability.xray_enabled`, with CloudWatch segment metrics (`LatencyTrace`) as the fallback when disabled (§4.11, §19).
  - requirements_covered: REQ-004, R5
  - design_sections: §4.11, §19
  - components: (X-Ray optional)
  - files_or_modules_expected: `packages/backend/src/observability/xray.ts`
  - dependencies: [TASK-075, TASK-104]
  - implementation_steps:
    1. Enable X-Ray tracing on functions when toggled on.
    2. Fall back to CloudWatch segment metrics when off.
    3. Attribute latency across API GW → Lambda → Bedrock/DynamoDB.
  - acceptance_criteria: Tracing toggles cleanly; latency attribution available either way.
  - tests_required: integration (TASK-164).
  - failure_cases: X-Ray unavailable → CloudWatch segments used.
  - done_definition: Optional X-Ray wired.
  - provisional_policy_notes: none
  - aws_services_touched: AWS X-Ray, CloudWatch (client)
  - security_or_iam_notes: none
  - delivery_class: BONUS_OPTIONAL
  - judging_criteria_contribution: technical_feasibility
  - competition_quality_floor: Bonus/optional deep X-Ray tracing only; when disabled, CloudWatch segment metrics (`LatencyTrace`) provide latency attribution so delivery is NEVER blocked; core observability (TASK-153/154/155) is not part of this optional scope.
  - demo_or_evidence_output: X-Ray trace map across API GW→Lambda→Bedrock/DynamoDB when enabled (bonus evidence); CloudWatch segments when disabled.
  - optional_marker: * (BONUS_OPTIONAL — genuinely skippable; non-essential deep X-Ray only)

- [ ] TASK-163 Implement failure-injection suite (§21 matrix)
  - objective: Verify each §21.2 failure path (Bedrock timeout, KB failure, WS drop, DDB throttle, region-no-model, IAM denied, 429, StartExecution failure, MARK_RUNNING mismatch, lease expiry, stale running, MARK_CORE_COMMITTED failure, all-action fencing, DecisionCore identity classification, RECONCILE external fencing, staged recovery).
  - requirements_covered: REQ-004, REQ-005, R5
  - design_sections: §21.2, §22.2 (Failure-injection), §15.2
  - components: (all resilience paths)
  - files_or_modules_expected: `packages/backend/test/failure/failure_injection_matrix.test.ts`
  - dependencies: [TASK-098, TASK-158, TASK-118]
  - implementation_steps:
    1. Inject each failure and assert the §21 handling + user-visible outcome.
    2. Assert deterministic-result-first and no fabrication.
    3. Assert fencing/apply-or-confirm outcomes (ALREADY_APPLIED/FENCED_STALE_EXECUTION).
  - acceptance_criteria: All §21 rows behave as specified.
  - tests_required: failure-injection matrix.
  - failure_cases: fabrication or blocked Fast Path → failure.
  - done_definition: Failure-injection suite green.
  - provisional_policy_notes: none
  - aws_services_touched: Bedrock, KB, DynamoDB, WebSocket, Step Functions (harness/Mock)
  - security_or_iam_notes: Includes IAM-denied path.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Covers EVERY §21 failure path (Bedrock timeout, KB failure, WS drop, DDB throttle, region-no-model, IAM denied, 429, StartExecution failure→503, MARK_RUNNING fencing, stale-running, MARK_CORE_COMMITTED apply-or-confirm, DecisionCore identity classification, RECONCILE external fencing, staged recovery); no fabrication under any failure. Release-blocking.
  - demo_or_evidence_output: Green §21 failure-injection matrix; each row engages the documented fallback with no fabrication.

- [ ] TASK-164 Observability/resilience integration tests
  - objective: Verify logs/metrics/alarms/error-model/backoff/security-alert wiring end-to-end in LOCAL_MOCK.
  - requirements_covered: REQ-004, REQ-032, R5
  - design_sections: §19, §21, §22.2
  - components: Observability + resilience
  - files_or_modules_expected: `packages/backend/test/integration/observability.test.ts`
  - dependencies: [TASK-153, TASK-154, TASK-155, TASK-156, TASK-157, TASK-159]
  - implementation_steps:
    1. Assert metrics/counters emit; error model consistent; backoff engaged.
    2. Assert security alert on conflict; latency alarm wired.
    3. Assert no-credential logs.
  - acceptance_criteria: Observability + resilience behave per §19/§21.
  - tests_required: integration.
  - failure_cases: missing metric/alert → failure.
  - done_definition: Observability/resilience suite green.
  - provisional_policy_notes: none
  - aws_services_touched: CloudWatch (harness)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Integration tests: metrics/alarms fire, fallbacks engage, security alerts logged, and NO §9/FIX contract is weakened under failure (deterministic truth preserved, write-isolation intact). Release-blocking.
  - demo_or_evidence_output: Green observability/resilience integration suite proving controls hold under failure.

CHECKPOINT K (not a task): Ensure observability, resilience, and security controls hold without weakening §9/FIX contracts; ask the user if questions arise.

---

## Phase 11 — Competition Deployment & Evidence (runbooks/scripts only, NO deploy)

> Every Phase 11 task AUTHORS a runbook and/or automated helper script (a file-creation coding task); NONE executes a deployment, runs the app end-to-end manually, or performs `cdk destroy`. Actual deploy/teardown are operator actions gated by the runbooks and (for teardown) organizer confirmation (§25, §26). Smoke/latency helpers are automated scripts, not manual runs.

- [ ] TASK-165 Author LOCAL_MOCK rehearsal runbook + script
  - objective: Author the runbook/script to rehearse the full deterministic suite offline (LOCAL_MOCK, Mock Bedrock, no AWS) so the team validates correctness before any AWS use (§23, §22.3).
  - requirements_covered: REQ-025, REQ-032, R-supporting
  - design_sections: §23, §22.3
  - components: (deployment runbook)
  - files_or_modules_expected: `runbooks/00_local_mock_rehearsal.md`, `scripts/local_mock_rehearsal.sh`
  - dependencies: [TASK-011, TASK-057]
  - implementation_steps:
    1. Document the LOCAL_MOCK setup + Mock adapter selection.
    2. Script runs typecheck/lint/unit/property/golden/policy-switch offline.
    3. State exit criteria (all deterministic tests green, no AWS calls).
  - acceptance_criteria: Runbook + script author a repeatable offline rehearsal; no AWS calls.
  - tests_required: script dry-run in CI (no deploy).
  - failure_cases: any AWS call in LOCAL_MOCK → documented failure gate.
  - done_definition: LOCAL_MOCK rehearsal runbook/script authored.
  - provisional_policy_notes: none
  - aws_services_touched: none (LOCAL_MOCK)
  - security_or_iam_notes: No credentials required.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Offline rehearsal script runs the full deterministic suite + a Mock-Bedrock end-to-end walkthrough with ZERO AWS calls; reproducible from the GitHub repo. Release-blocking (proves correctness without AWS).
  - demo_or_evidence_output: Green offline rehearsal log (all deterministic tests + mock walkthrough) with no credentials.

- [ ] TASK-166 Author PERSONAL_AWS_DEV validation runbook
  - objective: Author the runbook to deploy-and-validate in the team's own low-cost account (1–3 integration/RAG-citation examples), independent from the competition account (§23, §22.3).
  - requirements_covered: REQ-024, REQ-032, R-supporting
  - design_sections: §23, §22.3, §25
  - components: (deployment runbook)
  - files_or_modules_expected: `runbooks/01_personal_aws_dev_validation.md`
  - dependencies: [TASK-059, TASK-165, TASK-180]
  - implementation_steps:
    1. Document `cdk deploy --context env=PERSONAL_AWS_DEV` steps (operator-run).
    2. Document 1–3 integration/RAG-citation checks + Bedrock call caps.
    3. Document quick teardown for the dev account.
  - acceptance_criteria: Runbook covers dev deploy + validation + teardown (operator-executed, not here).
  - tests_required: runbook review checklist (no deploy in this task).
  - failure_cases: none (authoring only).
  - done_definition: PERSONAL_AWS_DEV runbook authored.
  - provisional_policy_notes: none
  - aws_services_touched: (documented target: full stack) — no deploy performed here
  - security_or_iam_notes: Account/region via context; no credentials in repo.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Validation runbook exercising 1–3 integration / RAG-citation examples on the team account; verifies real Bedrock/KB/DynamoDB/WebSocket wiring and KB ingestion (TASK-178) completeness before RAG. Release-blocking pre-competition gate.
  - demo_or_evidence_output: PERSONAL_AWS_DEV validation report (integration + RAG citation) on the team account.

- [ ] TASK-167 Author COMPETITION_AWS deploy instructions runbook (P0a–P0d + step 1)
  - objective: Author the competition deploy runbook covering pre-deploy checks (account/region, Bedrock model access, KB support, Parameter Store seeding) and step 1 deploy + data/SOP upload + KB sync (§25 P0a–P0d, step 1).
  - requirements_covered: REQ-024, REQ-032, R-supporting
  - design_sections: §25 (P0a–P0d, step 1), §4
  - components: (deployment runbook)
  - files_or_modules_expected: `runbooks/02_competition_deploy.md`
  - dependencies: [TASK-073, TASK-166, TASK-180]
  - implementation_steps:
    1. Document P0a–P0d (identity, model access, KB support, SSM seeding).
    2. Document `cdk deploy --all --context env=COMPETITION_AWS` + upload 5 runtime files + SOP; run the deployment-time KB ingestion mechanism (TASK-178: StartIngestionJob + GetIngestionJob polling) and VERIFY ingestion COMPLETE before any RAG smoke (TASK-169); ingestion failure blocks release (STOP).
    3. Document endpoint write-back to Parameter Store.
  - acceptance_criteria: Runbook covers pre-deploy + deploy step 1 (operator-executed).
  - tests_required: runbook review checklist.
  - failure_cases: none (authoring only).
  - done_definition: Competition deploy runbook authored.
  - provisional_policy_notes: none
  - aws_services_touched: (documented target: full stack) — no deploy performed here
  - security_or_iam_notes: No credentials in repo; parameters via SSM.
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Complete COMPETITION_AWS deploy runbook: P0a–P0d (identity, Bedrock model access, KB support, SSM seeding) + step-1 `cdk deploy` + upload of the 5 runtime files + SOP + deployment-time KB ingestion (TASK-178) with completion VERIFIED before RAG smoke; operator-executed (no deploy run here); no simplified/placeholder deploy path.
  - demo_or_evidence_output: `runbooks/02_competition_deploy.md` covering pre-deploy + deploy step 1 + KB-ingestion completion gate (used to produce the live deployment URL deliverable).

- [ ] TASK-168 Author source-manifest gate runbook (step 2, 7 SHA-256 STOP)
  - objective: Author the runbook/script for step-2 source hash verification (7 official sources, §10.0b) that STOPs deployment on any mismatch (§25 step 2).
  - requirements_covered: REQ-032, R1
  - design_sections: §25 (step 2), §10.0b, §21
  - components: (deployment runbook + verifier script)
  - files_or_modules_expected: `runbooks/03_source_hash_gate.md`, `scripts/verify_sources.sh`
  - dependencies: [TASK-007, TASK-167]
  - implementation_steps:
    1. Script computes SHA-256 for the 7 sources and compares to §10.0b.
    2. STOP on any mismatch; report which source failed.
    3. Document the manual STOP decision.
  - acceptance_criteria: Script verifies 7 hashes and fails on mismatch; runbook documents STOP.
  - tests_required: script test against known-good/altered fixtures.
  - failure_cases: mismatch → STOP (no enablement).
  - done_definition: Source-hash gate runbook/script authored.
  - provisional_policy_notes: none
  - aws_services_touched: S3 (read, in operator run)
  - security_or_iam_notes: Read-only; no content logged.
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Step-2 script computes SHA-256 for all 7 official sources and STOPs deployment on ANY mismatch (never enable an unknown version); documents the manual STOP decision. Release-blocking source-integrity gate.
  - demo_or_evidence_output: `scripts/verify_sources.sh` passing on known-good and STOPping on an altered fixture; `runbooks/03_source_hash_gate.md`.

- [ ] TASK-169 Author smoke-test runbook + automated 3-event script
  - objective: Author the automated smoke-test script + runbook injecting ACC_001/EVT_002/EVT_003 and asserting decisions/reports/alerts + core numbers match the walkthrough (§25 step 3).
  - requirements_covered: REQ-032, R5, R6
  - design_sections: §25 (step 3), §9.5, §22.3
  - components: (smoke test harness)
  - files_or_modules_expected: `runbooks/04_smoke_test.md`, `scripts/smoke_test.ts`
  - dependencies: [TASK-098, TASK-106, TASK-120, TASK-167]
  - implementation_steps:
    1. Script injects the 3 official events and asserts core sets/routes/ETE (provisional flags).
    2. Assert report/alert produced; assert 60s deadline observable.
    3. Document expected outputs as the recording script basis.
  - acceptance_criteria: Automated smoke script covers 3 events with core-number assertions.
  - tests_required: smoke script (automated; runs against a target endpoint set by operator).
  - failure_cases: core mismatch → smoke failure.
  - done_definition: Smoke-test runbook/script authored.
  - provisional_policy_notes: Provisional flags asserted (never official).
  - aws_services_touched: HTTP/WebSocket API (in operator run)
  - security_or_iam_notes: Admin token for injection (operator-provided).
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, theme_alignment, completeness
  - competition_quality_floor: Automated 3-event smoke (ACC_001/EVT_002/EVT_003) asserting core sets/routes/ETE (provisional flags) + report/alert produced + 60s observable; runs ONLY after KB ingestion COMPLETE (TASK-178). Release-blocking.
  - demo_or_evidence_output: `scripts/smoke_test.ts` + `runbooks/04_smoke_test.md` with core-number assertions; doubles as the demo recording basis.

- [ ] TASK-170 Author latency-validation runbook + script (5s/60s + WS/polling)
  - objective: Author the runbook/script that validates `FastPathLatencyMs ≤ 5s` and `EndToEndLatencyMs ≤ 60s` and simulates WebSocket drop → polling (§25 step 4).
  - requirements_covered: REQ-004, REQ-032, R5
  - design_sections: §25 (step 4), §20, §16.4
  - components: (latency validation harness)
  - files_or_modules_expected: `runbooks/05_latency_validation.md`, `scripts/latency_check.ts`
  - dependencies: [TASK-107, TASK-169]
  - implementation_steps:
    1. Script reads the latency metrics and asserts thresholds.
    2. Simulate WS disconnect; assert polling fallback engages.
    3. Document pass/fail criteria.
  - acceptance_criteria: Script validates both latency targets + fallback.
  - tests_required: latency-check script (automated).
  - failure_cases: >60s → fail; no fallback → fail.
  - done_definition: Latency-validation runbook/script authored.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Release validation executes ACC_001=78.6, EVT_002 observation 22:15 with no 22:30 use, and EVT_003=41.0.
  - aws_services_touched: CloudWatch, WebSocket (in operator run)
  - security_or_iam_notes: none
  - delivery_class: MANDATORY_ACCEPTANCE_GATE
  - judging_criteria_contribution: technical_feasibility, completeness
  - competition_quality_floor: Validates `FastPathLatencyMs ≤ 5s` and `EndToEndLatencyMs ≤ 60s` and simulates WebSocket drop → polling fallback. Release-blocking (60s is the official hard indicator).
  - demo_or_evidence_output: `scripts/latency_check.ts` + `runbooks/05_latency_validation.md` with pass/fail on both thresholds + fallback proof.

- [ ] TASK-171 Author freeze-release + keep-Dashboard-URL runbook
  - objective: Author the runbook for step-5 freeze release (pin image/artifact/params + `source_manifest_hash`) and step-6 keeping the Dashboard URL accessible for judging (§25 steps 5–6).
  - requirements_covered: REQ-024, REQ-032, R-supporting
  - design_sections: §25 (steps 5–6)
  - components: (deployment runbook)
  - files_or_modules_expected: `runbooks/06_freeze_and_keep_url.md`
  - dependencies: [TASK-169, TASK-170]
  - implementation_steps:
    1. Document version pinning (image/artifact/params + manifest hash).
    2. Document keeping the Dashboard URL accessible.
    3. State no-change freeze policy.
  - acceptance_criteria: Runbook covers freeze + URL availability.
  - tests_required: runbook review checklist.
  - failure_cases: none (authoring only).
  - done_definition: Freeze/URL runbook authored.
  - provisional_policy_notes: none
  - aws_services_touched: Amplify/S3+CloudFront (in operator run)
  - security_or_iam_notes: none
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: theme_alignment, completeness
  - competition_quality_floor: Freeze the release (pin image/artifact/params + `source_manifest_hash`) and KEEP the Dashboard URL accessible for judging; maintain until judging + organizer confirmation ends (teardown is NOT done here). The preserved URL is the official "Dashboard Live Demo" deliverable (REQ-024).
  - demo_or_evidence_output: `runbooks/06_freeze_and_keep_url.md`; a pinned release + a reachable Dashboard URL held through judging.

- [ ] TASK-172 Author demo script + recorded-video plan
  - objective: Author the demo narrative/script and recorded-video plan (REQ-029) using the smoke/evidence flow as the recording basis (§25 steps 3/8, §25.1).
  - requirements_covered: REQ-029, REQ-032, R-supporting
  - design_sections: §25 (steps 3/8), §25.1
  - components: (deliverable runbook)
  - files_or_modules_expected: `runbooks/07_demo_and_video_plan.md`
  - dependencies: [TASK-169]
  - implementation_steps:
    1. Author the demo storyline (timeline → anomaly → injection → 60s response → report/alert → What-if → publish).
    2. Map each step to smoke/evidence outputs.
    3. Document the recording plan (REQ-029).
  - acceptance_criteria: Demo script + video plan authored, tied to smoke/evidence.
  - tests_required: runbook review checklist.
  - failure_cases: none (authoring only).
  - done_definition: Demo/video plan authored.
  - provisional_policy_notes: Demo surfaces provisional markers (never official).
  - hg001_amendment:
    - Demo evidence explicitly shows the three HG-001 policy decisions and complete calculation trail.
  - aws_services_touched: none (planning)
  - security_or_iam_notes: none
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: creativity, theme_alignment, completeness
  - competition_quality_floor: Demo script covering the FULL operable journey (inject → fast-path decision → route/ETE/evidence → report/alert/explanation → What-if → publish/audit → recovery/fallback) + a recorded-video plan; the recorded video is DELIVERY EVIDENCE, never a functional substitute for the operable system.
  - demo_or_evidence_output: `runbooks/07_demo_and_video.md` with a step-by-step operable demo + video shot list mapped to REQ-029.

- [ ] TASK-173 Author evidence-export runbook + script (metrics/logs/artifacts)
  - objective: Author the runbook/script for step-8 evidence export (CloudWatch metrics/logs, smoke results, report/alert artifacts) as judging evidence (§25 step 8).
  - requirements_covered: REQ-032, R-supporting
  - design_sections: §25 (step 8), §19
  - components: (evidence export)
  - files_or_modules_expected: `runbooks/08_evidence_export.md`, `scripts/export_evidence.ts`
  - dependencies: [TASK-164, TASK-169]
  - implementation_steps:
    1. Script exports metrics/logs/smoke results/artifacts to a local evidence folder.
    2. Redact credentials; include `source_manifest_hash` provenance.
    3. Document the evidence bundle contents.
  - acceptance_criteria: Script exports a credential-free evidence bundle.
  - tests_required: export script test (fixtures).
  - failure_cases: credential in export → redaction failure.
  - done_definition: Evidence-export runbook/script authored.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Architecture and source-provenance documents classify HG-001 as organizer guidance, not an eighth official source.
  - aws_services_touched: CloudWatch, S3 (read, in operator run)
  - security_or_iam_notes: Redaction enforced.
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: completeness, technical_feasibility
  - competition_quality_floor: Export architecture diagram + CloudWatch metrics/logs + smoke results + report/alert artifacts as submission evidence; auditable and complete (no missing artifact).
  - demo_or_evidence_output: `scripts/export_evidence.*` + `runbooks/08_evidence_export.md` producing the evidence bundle.

- [ ] TASK-174 Author architecture-diagram export + GitHub delivery runbook
  - objective: Author the runbook for exporting the AWS architecture diagram (REQ-023) and delivering the single GitHub repository (REQ-025) with reproducible-build notes (§25.1, §24).
  - requirements_covered: REQ-023, REQ-025, REQ-032, R-supporting
  - design_sections: §25.1, §24, §6 (Figure 2)
  - components: (deliverable runbook)
  - files_or_modules_expected: `runbooks/09_architecture_and_github.md`
  - dependencies: [TASK-173]
  - implementation_steps:
    1. Document exporting the architecture diagram (from §6 Figure 2) for the proposal.
    2. Document GitHub repository delivery (single repo, IaC + app) + reproducible build (LOCAL_MOCK).
    3. Map deliverables to REQ-023/025/032.
  - acceptance_criteria: Runbook covers diagram export + GitHub delivery.
  - tests_required: runbook review checklist.
  - failure_cases: none (authoring only).
  - done_definition: Architecture/GitHub runbook authored.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Operator documentation explains insufficient-data and manual-confirmation behavior.
  - aws_services_touched: none (delivery)
  - security_or_iam_notes: No secrets in repo (TASK-012).
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: completeness, technical_feasibility
  - competition_quality_floor: Export the AWS architecture diagram (REQ-023, official deliverable 1) and deliver the COMPLETE GitHub source (REQ-025) as a single reproducible repository; the diagram matches the frozen §6 圖2 architecture; no missing source.
  - demo_or_evidence_output: `runbooks/09_arch_and_github.md`; exported architecture diagram + a public/complete GitHub repository link.

- [ ] TASK-175 Author post-judging cleanup runbook (cdk destroy, organizer-gated)
  - objective: Author the runbook for step-9/10 POST-JUDGING CLEANUP — organizer confirmation → `cdk destroy --all` — explicitly NOT executed as a post-smoke step (§25 steps 9–10, §26).
  - requirements_covered: REQ-032, R-supporting
  - design_sections: §25 (steps 9–10), §26
  - components: (teardown runbook)
  - files_or_modules_expected: `runbooks/10_post_judging_cleanup.md`
  - dependencies: [TASK-084, TASK-171]
  - implementation_steps:
    1. Document waiting for organizer confirmation before any destroy.
    2. Document `cdk destroy --all --context env=COMPETITION_AWS` (operator-run) + S3 empty + KB/vector-store cleanup.
    3. State that destroy is never a post-smoke step.
  - acceptance_criteria: Runbook gates destroy on organizer confirmation.
  - tests_required: runbook review checklist.
  - failure_cases: premature teardown → documented prohibition.
  - done_definition: Post-judging cleanup runbook authored.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Final evidence package includes hashes, OQ status counts, Golden outputs, and no-mojibake verification.
  - aws_services_touched: (documented target: full stack destroy) — not executed here
  - security_or_iam_notes: Organizer-gated; no premature teardown.
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: completeness
  - competition_quality_floor: AUTHORING the organizer-gated cleanup runbook (`cdk destroy --all`) is COMPETITION_MUST_HAVE and required for submission completeness; the DESTROY EXECUTION is POST_JUDGING_ONLY and runs ONLY after organizer confirmation (§25 steps 9–10); the runbook must forbid teardown before judging + organizer confirmation.
  - demo_or_evidence_output: `runbooks/10_post_judging_cleanup.md` (authoring); the destroy step is explicitly marked organizer-gated / post-judging (not executed as part of this plan).

- [ ] TASK-176 Author residual-resource-check runbook + script
  - objective: Author the runbook/script for step-11 residual verification (`aws cloudformation list-stacks` + resource inventory) confirming no leftover billable resources after teardown (§25 step 11, §26).
  - requirements_covered: REQ-032, R-supporting
  - design_sections: §25 (step 11), §26
  - components: (residual check)
  - files_or_modules_expected: `runbooks/11_residual_check.md`, `scripts/residual_check.sh`
  - dependencies: [TASK-175]
  - implementation_steps:
    1. Script lists stacks + inventories resources post-destroy.
    2. Flag any residual/billing resource.
    3. Document the sign-off criteria (no residual).
  - acceptance_criteria: Script verifies no residual resources; runbook documents sign-off.
  - tests_required: residual-check script test (fixtures).
  - failure_cases: residual resource → flagged.
  - done_definition: Residual-check runbook/script authored.
  - provisional_policy_notes: none
  - hg001_amendment:
    - Final release gate requires independent read-only review of the amended requirements, design, and task plan before TASK-001 authorization.
  - aws_services_touched: CloudFormation (read, in operator run)
  - security_or_iam_notes: Read-only inventory.
  - delivery_class: COMPETITION_MUST_HAVE
  - judging_criteria_contribution: completeness
  - competition_quality_floor: AUTHORING the residual-resource-check runbook/script (`aws cloudformation list-stacks` + resource inventory → no residual, no ongoing cost) is COMPETITION_MUST_HAVE; the CHECK EXECUTION is POST_JUDGING_ONLY (runs after the organizer-gated destroy). No teardown/execution performed in this plan.
  - demo_or_evidence_output: `runbooks/11_residual_check.md` + `scripts/residual_check.*` (authoring); execution deferred to post-judging.

CHECKPOINT L (not a task): Ensure all deployment/evidence runbooks and helper scripts are authored (no deploy/teardown executed here); ask the user if questions arise.

---

## Notes

- Every task carries a `delivery_class` (see "Competition Quality Principles" and Section 8). `optional_marker` is retained ONLY on the two genuine `BONUS_OPTIONAL` tasks (TASK-134, TASK-162) and is never a general-purpose skip flag; no core, test, security, latency, source-integrity, or smoke work is ever waived. `MANDATORY_ACCEPTANCE_GATE` tasks (tests / IAM / security / latency / source-integrity / smoke) are release-blocking. Top-level phases are never optional. TASK-179 (final Lambda/IAM/Step-Functions binding) and TASK-180 (shared-stack final integration) are `MANDATORY_IMPLEMENTATION` and placed in Phase 3 immediately after TASK-178.
- HG-001 resolves OQ-001/002/003 for implementation and partially resolves OQ-005 time. OQ-004, OQ-006..OQ-011, and OQ-005 station-set remain OPEN / AWAITING_HOST_REPLY. All selected organizer-guided and unresolved policies stay configurable; no selected default is presented as a unique official rule.
- No task lets an LLM compute a numeric/boolean truth or guess an undefined official rule; such cases route to a Strategy/config knob plus `manual_confirmation_required`.
- Phase 11 tasks AUTHOR runbooks/scripts only; they never execute a deployment or `cdk destroy`. Actual deploy/teardown are operator actions gated by the runbooks (teardown additionally gated by organizer confirmation, §25/§26).
- `CHECKPOINT A..L` lines are not tasks and are excluded from the matrices and the dependency waves.
- Each property test is a single `fast-check` (TS) / `Hypothesis` (Py) test with ≥100 iterations and the label `Feature: city-response-commander, Property {n}: {text}` (§22.1/§22.2).

---

## Frozen Design Implementation Realization Record

- `logical_design_capability`:
  - POST `/what-if`
  - ScenarioParser
  - SchemaValidator
  - DomainValidator
  - WhatIfEngine
  - deterministic recomputation
  - SOP retrieval and citation
  - Bedrock explanation
  - no production-state mutation
- `deployment_realization`: Dedicated WhatIfFn Lambda
- `realization_class`: `IMPLEMENTATION_DEPLOYMENT_UNIT`
- `design_amendment`: `NO`
- `reason`: WhatIfFn is the AWS Lambda packaging and hosting unit for the already-approved POST `/what-if` and WhatIfEngine capability. It introduces no new business rule, API route, DynamoDB table, AWS service, decision authority, or user capability.
- `WhatIfFnRole classification`: `IMPLEMENTATION_DERIVED_LEAST_PRIVILEGE_ENFORCEMENT_ARTIFACT`

This record documents an implementation realization of the Frozen Design, not a design amendment.

---

## Matrix 1 — Cursor REQ-001..032 → Task coverage

| Cursor REQ | Title (short) | Covering tasks | Label |
| --- | --- | --- | --- |
| REQ-001 | Dashboard 車流/人流視覺化 | TASK-003, 013, 014, 019, 037, 124, 125, 126, 150 | must-have |
| REQ-002 | 異常自動彈窗預警 | TASK-040, 127 | must-have |
| REQ-003 | 事件注入介面 | TASK-016, 085, 086, 087, 088, 096, 128 | must-have |
| REQ-004 | 60 秒內路網重規劃 | TASK-020, 068, 089, 097, 102, 103, 104, 105, 107 | must-have |
| REQ-005 | 避開已飽和之路段 (OQ-008 partial) | TASK-025, 041, 056, 108, 178 | must-have |
| REQ-006 | What-if 對話式問答 | TASK-067, 136, 137, 141, 142, 143, 177 | must-have |
| REQ-007 | SOP 邏輯驗證 | TASK-108, 139, 140, 142, 178 | must-have |
| REQ-008 | 判定依據展示 | TASK-034, 049, 110, 129, 149, 178 | must-have |
| REQ-009 | ETE 公式運算 | TASK-031, 047, 053, 131 | must-have |
| REQ-010 | 多語化通報觸發 | TASK-014, 030, 046, 058, 114, 117 | must-have |
| REQ-011 | SOP-1 擁塞級別判定 | TASK-022, 023, 039, 052, 125 | must-have |
| REQ-012 | SOP-2 觸發條件 | TASK-024, 041, 053 | must-have |
| REQ-013 | SOP-2 主疏散路徑選擇 | TASK-024, 025, 026, 041, 043, 053, 130 | must-have |
| REQ-014 | SOP-2 主疏散壅塞處理 | TASK-025, 041, 053, 130 | must-have |
| REQ-015 | SOP-2 CMS 官方文字格式 | TASK-031, 048, 111, 113, 053 | must-have |
| REQ-016 | SOP-3 捷運與接駁分流 | TASK-027, 032, 044, 054 | must-have |
| REQ-017 | SOP-4 大巨蛋散場啟動 | TASK-028, 044, 058, 126 | must-have |
| REQ-018 | SOP-5 號誌故障應變 | TASK-029, 045, 055 | must-have |
| REQ-019 | SOP-6 數位通報與多語化 | TASK-014, 018, 030, 036, 046, 058, 114 | must-have |
| REQ-020 | SOP-7 ETE 公式 | TASK-031, 047, 053, 131 | must-have |
| REQ-021 | 交控中心建議書內容 | TASK-033, 048, 113, 132, 149, 150 | must-have |
| REQ-022 | 多語化民眾簡訊內容 | TASK-048, 114, 132, 144, 149 | must-have |
| REQ-023 | 提案簡報 AWS 架構圖 (deliverable) | TASK-174 | must-have (deliverable) |
| REQ-024 | Dashboard 部署網址 (deliverable) | TASK-072, 121, 166, 167, 171 | must-have (deliverable) |
| REQ-025 | GitHub 完整原始碼 (deliverable) | TASK-001, 002, 009, 011, 012, 174 | must-have (deliverable) |
| REQ-026 | 替代路徑單向性 | TASK-015, 021, 042 | must-have |
| REQ-027 | nearby_stations 空陣列為正常 | TASK-015, 021, 042 | must-have |
| REQ-028 | intersections 上下游排序 | TASK-015, 021, 026, 042, 043 | must-have |
| REQ-029 | 錄製展示影片 (deliverable) | TASK-172 | must-have (deliverable) |
| REQ-030 | Dashboard 外觀直觀性與設計性 | TASK-072, 134, 135 | **bonus** |
| REQ-031 | 多語化通報支援日韓 | TASK-050, 117, 134 | **bonus** |
| REQ-032 | 官方交付完整性 (deliverable) | TASK-007, 011, 167, 168, 173, 174 | must-have (deliverable) |

Coverage result: **32 / 32 REQ have ≥1 task (no gaps)**. REQ-005 remains PARTIALLY_COVERED at the requirement level pending OQ-008 (host reply), but has implementing tasks (config-switchable, not resolved).

---

## Matrix 2 — Design component → implementation task(s)

| Design component (§ ref) | Implementation task(s) |
| --- | --- |
| ConfigProvider / LocalFile / Ssm (§23.1) | TASK-004, 005, 006 |
| shared-schemas / data-model types (§10) | TASK-003 |
| OfficialSourceManifest + hash STOP gate (§10.0) | TASK-007 |
| DerivedArtifactManifest (§10.0c) | TASK-008 |
| DataIngestionService (§8, §15.1) | TASK-013, 014, 015, 016, 017, 018, 019 |
| PercentParser (§8) | TASK-014 |
| SnapshotSelector / TimeAlignmentStrategy A (§11.1) | TASK-020 |
| RoadNetworkModel (§10.3, §9.4) | TASK-015, 021 |
| ClassificationEngine (§9.4 art.1) | TASK-022 |
| RuleEngine art.1 (§9.4) | TASK-023 |
| RuleEngine art.2 (§9.4) | TASK-024 |
| EvacuationSelector (§9.4, §11.7) | TASK-025 |
| IncidentAnchorResolutionStrategy D (§11.5) | TASK-026 |
| RuleEngine art.3 (§9.4) | TASK-027 |
| RuleEngine art.4 (§9.4) | TASK-028 |
| RuleEngine art.5 + AffectedIntersectionScopeStrategy E (§9.4, §11.6) | TASK-029 |
| RuleEngine art.6 + MultilingualTrigger + MultilingualScopeStrategy F (§9.4, §11.8) | TASK-030 |
| ETECalculator + EteAffectedSetStrategy C (§9.4 art.7, §11.3) | TASK-031 |
| AffectedRoadStrategy B (§11.2) | TASK-032 |
| Article aggregation / citation_article_set (§9.5, §14.2) | TASK-033, 110 |
| EvidenceTraceBuilder (§10.10) | TASK-034 |
| CanonicalCoreHash + DecisionCore builder (§10.11a-1) | TASK-035 |
| IncidentOrchestrator / Step Functions Express (§4.6, §6) | TASK-068, 097 |
| InjectFn / IdempotencyGateFn (§8, §15.2) | TASK-086, 087, 088, 092, 094, 096 |
| IdempotencyTable repository (§10.11e) | TASK-085 |
| WorkflowStatusFn (5 actions) (§10.11e) | TASK-089, 090, 091, 095, 102 |
| RecoveryGateFn (§10.11e, §15.2) | TASK-093 |
| DecisionFn (§6, §9) | TASK-099, 100, 101 |
| RealtimePublisher / WsPushFn / ConnFn (§13, §16) | TASK-070, 103, 119, 122, 148 |
| LatencyTrace (§10.16, §20) | TASK-104, 105 |
| SopRetriever (KB + S3 fallback) (§14.1) | TASK-108, 109 |
| SchemaValidator (§9.3, §10.11b) | TASK-111 |
| Bedrock adapter / Mock (§4.1, §23) | TASK-112 |
| ReportComposer (§10.11b, §14.3) | TASK-113 |
| PublicAlertComposer (§10.11b, §14.4) | TASK-114 |
| ExplanationComposer (§10.11b) | TASK-115 |
| DecisionNarrative writer (PK+SK) (§10.11b) | TASK-116 |
| Multilingual TemplateRenderer (§14.4, §21.3) | TASK-117 |
| Enrichment recovery / missing_narrative_types (§15.2) | TASK-118 |
| AlertMonitor (§16.2) | TASK-040, 127 |
| DashboardService (SPA) (§8, §16) | TASK-121–134 |
| ScenarioParser / WhatIfEngine / WhatIfFn (§14.5, §6 圖2) | TASK-067, 136, 137, 138, 139, 140, 141, 177 |
| PublishFn / PublishRecord state machine (§10.11d) | TASK-144, 145, 146, 147, 148, 151 |
| DecisionReadModel merge + ApiReadFn (§10.11c) | TASK-149, 150 |
| DynamoDB tables (Idempotency/Core/Narrative/Publish/connections) (§10.11) | TASK-061, 062, 063, 064, 065 |
| S3 buckets (§4.8) | TASK-060 |
| Bedrock KB infra (§4.2) | TASK-066 |
| Deployment-time KB ingestion (StartIngestionJob, NOT a runtime Lambda) (§14.1, §25 step1) | TASK-178 |
| Lambda provisioning (10 runtime fns incl dedicated WhatIfFn; NO IngestionFn) (§6 圖2) | TASK-067 |
| WhatIfFn host + WhatIfFnRole (dedicated What-if runtime) (§6 圖2, §12, §14.5, §18) | TASK-067, 136, 177 |
| API GW HTTP / WebSocket / Cognito (§4.4/4.5/4.10) | TASK-069, 070, 071 |
| Frontend hosting (§4.9) | TASK-072 |
| SSM / Secrets / CloudWatch / X-Ray (§4.11/4.12) | TASK-073, 074, 075, 162 |
| IAM roles (§18 + WhatIfFnRole) | TASK-076, 077, 078, 079, 080, 081, 082, 083, 177 |
| IngestionRole owner = deployment-time ingestion (§18, §14.1) | TASK-083, 178 |
| CDK app + teardown lifecycle (§24, §26) | TASK-059, 084 |

Coverage result: **every design component has ≥1 implementation task**.

---

## Matrix 3 — Correctness Properties P1–P37 → test task

| Property | Test task | Property | Test task |
| --- | --- | --- | --- |
| P1 | TASK-036 | P20 | TASK-046 |
| P2 | TASK-037 | P21 | TASK-036 |
| P3 | TASK-038 | P22 | TASK-047 |
| P4 | TASK-039 | P23 | TASK-047 |
| P5 | TASK-039 | P24 | TASK-048 |
| P6 | TASK-040 | P25 | TASK-048 |
| P7 | TASK-039 | P26 | TASK-049 |
| P8 | TASK-041 | P27 | TASK-049 |
| P9 | TASK-041 | P28 | TASK-142 |
| P10 | TASK-041 | P29 | TASK-050 |
| P11 | TASK-041 | P30 | TASK-043 |
| P12 | TASK-041 | P31 | TASK-045 |
| P13 | TASK-042 | P32 | TASK-046 |
| P14 | TASK-042 | P33 | TASK-098 |
| P15 | TASK-042 | P34 | TASK-036 |
| P16 | TASK-044 | P35 | TASK-142 |
| P17 | TASK-044 | P36 | TASK-050 |
| P18 | TASK-045 | P37 | TASK-048 |
| P19 | TASK-045 | (canonical core_hash A/B/C) | TASK-051 |

Coverage result: **every property P1–P37 has ≥1 dedicated property/integration test task** (≥100 iterations, labeled). Note the design has a Correctness Properties section, so PBT sub-tasks are included per §22.

---

## Matrix 4 — OQ-001..011 → Strategy/config task mapping

| OQ | Topic | Implementation landing | Config / Test | Status |
| --- | --- | --- | --- | --- |
| OQ-001 | Event time alignment | TASK-020 Strategy A | TASK-006 / TASK-038 / TASK-057 | `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE` |
| OQ-002 | Event 2 affected_road | TASK-032 Strategy B | TASK-006 / TASK-054 / TASK-057 | `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE` |
| OQ-003 | ETE affected set and timestamp | TASK-031 Strategy C | TASK-006 / TASK-047 / TASK-053 / TASK-055 / TASK-057 | `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE` |
| OQ-004 | Incident anchor | TASK-026 Strategy D | TASK-043 / TASK-057 | `OPEN / AWAITING_HOST_REPLY` |
| OQ-005 | SOP6 time and station scope | TASK-030 Strategy F | TASK-046 / TASK-057 | `PARTIALLY_RESOLVED_BY_ORGANIZER_GUIDANCE`; station set open |
| OQ-006 | Intersection label without segment_id | TASK-021 | TASK-042 / TASK-057 | `OPEN / AWAITING_HOST_REPLY` |
| OQ-007 | No compliant alternative | TASK-025 | TASK-056 | `OPEN / AWAITING_HOST_REPLY` |
| OQ-008 | PDF/SOP saturation precedence | TASK-024 / TASK-025 | TASK-041 | `OPEN / AWAITING_HOST_REPLY` |
| OQ-009 | What-if LLM/deterministic boundary | TASK-136..TASK-139 | TASK-142 / TASK-143 | `OPEN / AWAITING_HOST_REPLY` |
| OQ-010 | SOP5 affected intersections | TASK-029 Strategy E | TASK-045 / TASK-057 | `OPEN / AWAITING_HOST_REPLY` |
| OQ-011 | SOP5 duration versus ETE | TASK-029 / TASK-031 | TASK-047 / TASK-055 | `OPEN / AWAITING_HOST_REPLY` |

Result: 3 resolved for implementation, 1 partially resolved, and 7 fully open. All selected and unresolved policies remain configurable. No task presents HG-001 as a unique official algorithm.
## Matrix 5 — REQUIRED AWS service → IaC task

| REQUIRED AWS service (§4.14) | IaC task(s) | Notes |
| --- | --- | --- |
| Amazon Bedrock (runtime FM) | TASK-066 (KB embedding/model), TASK-073 (model_id params), TASK-078 (invoke IAM) | model IDs/region parameterized; Mock adapter in LOCAL_MOCK (TASK-112) |
| Amazon Bedrock Knowledge Bases | TASK-066 (KB/data source/vector store), TASK-178 (deployment-time StartIngestionJob) | ingestion is deployment-time, not a runtime Lambda |
| AWS Lambda | TASK-067 | 10 runtime functions incl dedicated WhatIfFn (NO IngestionFn); reserved concurrency on DecisionFn |
| Amazon API Gateway HTTP API | TASK-069 | §12 routes + Cognito authorizer on POST |
| Amazon API Gateway WebSocket API | TASK-070 | $connect/$disconnect/$default + custom |
| AWS Step Functions Express | TASK-068 | MARK_RUNNING first state, Choice Gate, parallel enrichment |
| Amazon S3 | TASK-060 | raw / sop_source / artifact buckets |
| Amazon DynamoDB | TASK-061, 062, 063, 064, 065 | Idempotency / Core / Narrative(PK+SK) / Publish / connections |
| AWS Amplify Hosting | TASK-072 | (or S3+CloudFront alternative) via `frontend.hosting` |
| Amazon Cognito | TASK-071 | user pool + admin/operator/commander groups |
| Amazon CloudWatch | TASK-075 | log groups + metrics + alarms |
| AWS IAM | TASK-076, 077, 078, 079, 080, 081, 082, 083, 177 | least-privilege per §18 + dedicated WhatIfFnRole (TASK-177) |
| AWS Systems Manager Parameter Store | TASK-073 | non-secret config keys (§23.1) |
| AWS Secrets Manager | TASK-074 | secret placeholders (fail-closed) |
| AWS CDK | TASK-059, 084 | app bootstrap + teardown lifecycle |

Result: **every REQUIRED AWS service has ≥1 IaC task**. OPTIONAL services (EventBridge, CloudFront alone, X-Ray) are covered where applicable (X-Ray TASK-075/162; CloudFront as the alternative in TASK-072); they are not required.

---

## Matrix 6 — Full runtime-component closure matrix

> For EVERY runtime component: implementation task → files/modules → runtime resource → caller/trigger → IAM role → config → unit test → integration test → failure test → deployment validation → smoke evidence. Zero orphans by construction.

| Component | Impl task(s) | Files/modules | Runtime resource | Caller / trigger | IAM role | Config | Unit test | Integration test | Failure test | Deploy validation | Smoke evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| InjectFn/IdempotencyGateFn | 085,086,087,088,092,096 | packages/backend/src/inject/* | Lambda (067) | API GW POST /inject (069) | InjectFnRole (076) | 006,073 | 086,087,088 | 098 | 098,163 | 167 | 169 |
| WorkflowStatusFn | 089,090,091,097 | packages/backend/src/workflow/* | Lambda (067) | Step Functions (068) | WorkflowStatusFnRole (079) | 073 | 089,090,091 | 098 | 098,163 | 167 | 169 |
| RecoveryGateFn | 093 | packages/backend/src/recovery/* | Lambda (067) | SFN (068) / InjectFn (092) | RecoveryGateFnRole (080) | 073 | 093 | 098 | 098,163 | 167 | 169 |
| DecisionFn | 099,100,101,102 | packages/backend/src/decision/* | Lambda (067) | Step Functions (068) | DecisionFnRole (077) | 006,073 | 099,100,101 | 106 | 106,163 | 167 | 169 |
| RendererFn | 112,116 | packages/backend/src/render/* | Lambda (067) | SFN parallel (068) | RendererFnRole (078) | 073 | 111,112 | 120 | 120,158,163 | 167 | 169 |
| ReportComposer | 113 | .../render/report_composer.ts | RendererFn (067) | SFN REPORT branch (068) | RendererFnRole (078) | 073 | 113 | 120 | 117,163 | 167 | 169 |
| PublicAlertComposer | 114,117 | .../render/public_alert_composer.ts | RendererFn (067) | SFN PUBLIC_ALERT branch (068) | RendererFnRole (078) | 073 | 114 | 120 | 117,163 | 167 | 169 |
| ExplanationComposer | 115 | .../render/explanation_composer.ts | RendererFn (067) | SFN EXPLANATION branch (068) | RendererFnRole (078) | 073 | 115 | 120 | 163 | 167 | 169 |
| PublishFn | 144,145,146,147,148,151 | packages/backend/src/publish/* | Lambda (067) | API GW POST /publish (069) | PublishFnRole (082) | 073 | 144,145,146,147,148,151 | 152 | 152,163 | 167 | 169,172 |
| ApiReadFn | 149,150 | packages/backend/src/read/* | Lambda (067) | API GW GET routes (069) | ApiReadFnRole (081) | 073 | 150 | 152 | 163 | 167 | 169 |
| WsPushFn/RealtimePublisher | 103,119,122,148 | packages/backend/src/realtime/* | Lambda (067) | SFN/events (068) | WsConnFnRole (083) | 073 | 103,119 | 120 | 158,163 | 167 | 169 |
| ConnFn | 070,122 | packages/backend/src/ws/* | Lambda (067) | WS API $connect (070) | WsConnFnRole (083) | 073 | 122 | 120 | 158,163 | 167 | 169 |
| WhatIfFn | 136,137,138,139,140 | packages/backend/src/whatif/* | Lambda (067) | API GW POST /what-if (069) | WhatIfFnRole (177) | 073 | 137,138,139,140 | 142 | 143,163 | 167 | 169,172 |
| Ingestion process | 178 | infra/lib/constructs/kb_ingestion_provider.ts; infra/lib/constructs/kb_ingestion_custom_resource.ts | Deployment-time CDK Custom Resource Provider; physical support-Lambda count is `SYNTH_DERIVED` and excluded from the 10 application runtime Lambdas | cdk deploy step (167) | IngestionRole (083) | 073 | 178 | 167 | 178(STOP),168 | 167/180 synth enumeration | 169 (KB complete before RAG) |
| ConfigProvider | 004,005,006 | packages/config/src/* | Library (all Lambdas) | imported | per-role SSM read | 006,073 | 004,005,006 | 005 | 004,005 | 073 | 165 |
| SopRetriever | 108,109,110 | packages/rag/src/* | RendererFn/WhatIfFn (067) | RendererFn (068)/WhatIfFn (136) | RendererFnRole (078)/WhatIfFnRole (177) KB Retrieve | 073 | 108,110 | 120 | 109,158,163 | 167 | 169 |
| SchemaValidator | 111 | packages/backend/src/validate/* | Library (Renderer/WhatIf) (067) | renderer/what-if | (library; inherits caller role) | (n/a) | 111 | 120 | 120,163 | 167 | 169 |
| DataIngestionService | 013,014,015,016,017,018,019 | packages/domain/src/ingestion/* | Library in DecisionFn (067) | DecisionFn (099) | DecisionFnRole S3 read (077) | 073 | 013,014,015,016,017,018,019 | 106 | 056,163 | 167 | 169 |
| RuleEngine | 022,023,024,025,027,028,029,030,031,032,033 | packages/domain/src/rules/* | Library in DecisionFn (067) | DecisionFn (099) | (deterministic; no AWS) | 006 (strategies) | 022–033 | 106 | 056,163 | 167 | 169 (goldens 053–055,058) |
| DecisionReadModel | 149 | packages/backend/src/read/read_model.ts | ApiReadFn (067) | API GW GET (069) | ApiReadFnRole (081) | 073 | 149 | 152 | 163 | 167 | 169 |

**Closure invariants (all hold):** no impl-without-resource; no resource-without-impl; no handler-without-IAM; no IAM-without-handler (every role in Matrix 7 binds to a runtime handler or the deployment-time ingestion process); no API-route-without-integration-target (069 integrates every route to InjectFn/ApiReadFn/WhatIfFn/PublishFn); no SFN-state-without-Lambda (068 states map to WorkflowStatusFn/DecisionFn/RendererFn/RecoveryGateFn); no Lambda-without-tests; no service task without deployment validation (167); no frontend-without-backend-contract (Phase-7 panels bind to §12/§13 contracts); no backend-event-without-frontend-handling (every §13 event has a Phase-7 handler: `timeline.updated`→124, `anomaly.detected`→127, `decision.fast_path_ready`→130/131, `decision.enriched`/`report.ready`/`public_alert.ready`→132, `publish.status_changed`→132/133, `processing.failed`→133).

---

## Matrix 7 — IAM edge audit (exact permission per edge)

> Exact permission for every caller→target edge. No wildcard Lambda invoke / DynamoDB write / S3 write; no Bedrock for functions that don't need it; no write to read-only components; no role without a user; no caller without a role. Includes the What-if and Ingestion edges. Verified by TASK-160/161 denial tests.

| Caller role (user) | Target | Exact ALLOW | Explicit DENY | Task |
|---|---|---|---|---|
| InjectFnRole (InjectFn) | IdempotencyTable / SFN / RecoveryGateFn+WorkflowStatusFn | `GetItem`/`PutItem`/`UpdateItem` (IdempotencyTable), `states:StartExecution` (chosen ARN), `lambda:InvokeFunction` (RecoveryGateFn & WorkflowStatusFn EXACT ARNs), CloudWatch, SSM read | wildcard invoke; Core/Narrative/Publish writes; Bedrock; KB Retrieve; PostToConnection; S3 write; table wildcard | 076 |
| DecisionFnRole (DecisionFn) | DecisionCoreTable / S3 raw | read/write DecisionCoreTable (sole writer), S3 raw read, CloudWatch, SSM | ANY IdempotencyTable write (incl `core_committed`); Narrative/Publish writes; Bedrock | 077 |
| RendererFnRole (RendererFn) | Bedrock / KB / S3 SOP / Core / Narrative | Bedrock InvokeModel/Converse, KB Retrieve, S3 SOP read, DecisionCore read, `attribute_not_exists(decision_id)` conditional Put on Narrative item | DecisionCore write (Put/Update/Delete); Publish/Idempotency writes | 078 |
| WorkflowStatusFnRole (WorkflowStatusFn) | IdempotencyTable | `GetItem`(ConsistentRead)/`UpdateItem` (5 fenced actions) | any other table write; Bedrock; S3 raw write; PostToConnection | 079 |
| RecoveryGateFnRole (RecoveryGateFn) | IdempotencyTable/Core/Narrative | `GetItem`(ConsistentRead) Idempotency/Core, `Query`(ConsistentRead) Narrative base table | ALL DynamoDB writes; Bedrock; PostToConnection; S3 write | 080 |
| ApiReadFnRole (ApiReadFn) | Core/Narrative/Publish/Idempotency | read-only `GetItem`/`Query` (Core/Narrative/Publish) + `GetItem` (IdempotencyTable, execution summary), CloudWatch, SSM | ALL DynamoDB writes; Bedrock; StartExecution; PostToConnection; S3 write | 081 |
| PublishFnRole (PublishFn) | Publish / Core / Narrative | read-only Core/Narrative, write PublishRecordTable, publish-sim channels, CloudWatch | DecisionCore write | 082 |
| WsConnFnRole (WsPushFn/ConnFn) | connections | connections R/W, `PostToConnection` | raw read; DecisionCore write; DecisionNarrative write | 083 |
| OrchestratorRole (Step Functions; attached ONLY to Step Functions, binding by 179) | workflow Lambdas | `lambda:InvokeFunction` on ONLY DecisionFn/RendererFn/WorkflowStatusFn/RecoveryGateFn exact ARNs | direct data modification; invoking WhatIfFn/InjectFn/PublishFn/ApiReadFn/WsPushFn/ConnFn | 083,179 |
| IngestionRole (deployment-time CDK Custom Resource Provider handlers, TASK-178) | Bedrock ingestion API / S3 SOP source / SSM | `bedrock:StartIngestionJob`/`GetIngestionJob`/`GetKnowledgeBase`/`GetDataSource`, S3 SOP-source `s3:GetObject`+`s3:ListBucket`, config-prefix SSM read, provider log group | S3 write (read-only source); DecisionCore/Narrative/Publish/Idempotency writes; StartExecution; PostToConnection; Bedrock model invoke; wildcard invoke; wildcard DynamoDB write; attach to any runtime Lambda | 083,178,179 |
| WhatIfFnRole (WhatIfFn; binding by 179) | Bedrock / KB / S3 / Core | Bedrock InvokeModel/Converse, KB Retrieve, S3 read, DecisionCore READ, CloudWatch, SSM | ALL decision/narrative/publish/idempotency writes; StartExecution; PostToConnection; S3 write; wildcards | 177,179 |

**Edge invariants (all hold):** every runtime Lambda has exactly one dedicated role (its user) bound by TASK-179 with no CDK auto-generated runtime execution role, and every role binds to a runtime handler or the deployment-time ingestion provider (no role without a user, no caller without a role); Bedrock model invocation is granted ONLY to RendererFn and WhatIfFn (Inject/WorkflowStatus/RecoveryGate/ApiRead/Publish/WsConn/Ingestion have none; Ingestion has Bedrock ingestion-API actions only, not model invoke); read-only components (RecoveryGate, ApiRead) have zero writes; no wildcard invoke / table write / S3 write anywhere; InjectFn invokes only the two exact ARNs it needs; OrchestratorRole invokes only the four workflow Lambdas and is attached only to Step Functions; IngestionRole is attached to no application runtime Lambda. Final bindings + exact grants verified by TASK-179; full-stack composition verified by TASK-180.

---

## Shared File Ownership Matrix (Matrix 8 — full shared-file concurrency audit)

> This is the authoritative **Shared File Ownership Matrix** (supersedes the earlier extension-list form). Every file modified by 2+ tasks uses exactly one of three legal resolutions: (A) single owner + others build independent child modules; (B) enforced dependency chain (later task depends on earlier, single-writer); (C) a final integration owner composes independent construct modules. FORBIDDEN: "Agent should merge carefully" / "execute in Task ID order" / "resolve merge conflicts manually" / "contributors coordinate" / "implementation agent handles conflict". The DAG guarantees no two same-wave tasks touch the same shared file: multi-writer stack shells are composed only by their single integration owner (TASK-180) from independent construct modules, and all dependency-chain writers sit in strictly different waves.

| file_path | owner_task | contributor_tasks | integration_task | dependency_enforcement | same_wave_conflict | resolution | final_status |
|---|---|---|---|---|---|---|---|
| `infra/lib/data_stack.ts` | TASK-059 (initial shell) | (none rewrite the shell) — TASK-060/061/062/063/064/065/066/084 build independent construct modules (`buckets.ts`,`idempotency_table.ts`,`decision_core_table.ts`,`decision_narrative_table.ts`,`publish_record_table.ts`,`connections_table.ts`,`knowledge_base.ts`,`removal_policies.ts`) | TASK-180 (sole integration owner) | TASK-180 depends on 059,060–066,084 | none | (C) integration owner composes independent modules | resolved |
| `infra/lib/compute_stack.ts` | TASK-059 (initial shell) | TASK-067 (`lambda_specs.ts`), TASK-068 (state machine), TASK-179 (`runtime_bindings.ts`) as independent modules | TASK-180 | TASK-180 depends on 059,067,068,179; 179 dep 067/068 | none | (C) integration owner composes independent modules | resolved |
| `infra/lib/network_auth_stack.ts` | TASK-059 (initial shell) | TASK-071 (`cognito.ts`), TASK-069 (`http_api.ts`), TASK-070 (`ws_api.ts`) as independent modules | TASK-180 | TASK-180 depends on 059,069,070,071; 069 dep 071 | none | (C) integration owner composes independent modules | resolved |
| `infra/lib/frontend_stack.ts` | TASK-059 (initial shell) | TASK-072 (`frontend_hosting.ts`) as independent module | TASK-180 | TASK-180 depends on 059,072 | none | (C) integration owner composes independent modules | resolved |
| `infra/bin/app.ts` | TASK-059 (initial wiring) | (none) — final app wiring done by integration owner | TASK-180 | TASK-180 depends on 059 | none | (C) integration owner finalizes app wiring | resolved |
| `infra/statemachine/workflow.asl.json` | TASK-068 (ASL) | TASK-097 (wiring logic) | TASK-097 | 097 depends on 068 (068 wave 6, 097 wave 15) | none | (B) enforced dependency chain | resolved |
| `infra/lib/constructs/runtime_bindings.ts` | TASK-179 | (none) | TASK-179 | 179 depends on 067,068,076–083,177 | none | (A) single owner | resolved |
| `infra/lib/constructs/http_api.ts` | TASK-069 | (none) | TASK-069 | 069 depends on 067,071 | none | (A) single owner | resolved |
| `infra/lib/constructs/ws_api.ts` | TASK-070 | (none) | TASK-070 | 070 depends on 065,067 | none | (A) single owner | resolved |
| IAM policy aggregator files (`infra/lib/iam/*`, one file per role) | each role's own IAM task (076–083, 177) | (none — one file per role, no contention) | TASK-179 (composes bindings via `runtime_bindings.ts`) | each role file by its own deps; bindings by 179 | none | (A) single owner per file + (C) 179 composes bindings | resolved |
| `packages/shared-schemas/src/index.ts` | TASK-003 | (none — types defined once; dependents import, never edit) | TASK-003 | 003 before all importers | none | (A) single owner | resolved |
| `packages/config/src/config_schema.ts` | TASK-006 | (none) | TASK-006 | 006 depends on 004 | none | (A) single owner | resolved |
| `config/config.local.yaml` | TASK-004 (seed) | TASK-006 (populate keys) | TASK-006 | 006 depends on 004 (004 wave 1, 006 wave 2) | none | (B) enforced dependency chain | resolved |
| `packages/domain/src/road_network/road_network_model.ts` | TASK-015 (load path) | TASK-021 (query methods) | TASK-021 | 021 depends on 015 (015 wave 2, 021 wave 3) | none | (B) enforced dependency chain | resolved |
| `packages/config/src/*` (interface/providers) | TASK-004 (interface + LocalFile) | TASK-005 (`ssm_config_provider.ts`, own file) | TASK-006 | 005/006 depend on 004 | none | (A) single owner per file | resolved |
| `packages/frontend/src/app.tsx` (frontend route definitions) | TASK-121 | (none — panels are separate files, child modules) | TASK-121 | panels depend on 121 | none | (A) single owner + child modules | resolved |
| `packages/frontend/src/api/client.ts` (API client definitions) | TASK-121 | (none) | TASK-121 | 121 depends on 001,003 | none | (A) single owner | resolved |
| `vitest.config.ts` (test configuration) | TASK-010 | (none) | TASK-010 | 010 depends on 001,002 | none | (A) single owner | resolved |
| `tsconfig.base.json` | TASK-001 | (none) | TASK-001 | root; before all | none | (A) single owner | resolved |
| `package.json` (root workspaces) | TASK-001 | TASK-002 (conventions) | TASK-001 | 002 depends on 001 (001 wave 0, 002 wave 1) | none | (B) enforced dependency chain | resolved |
| `.github/workflows/ci.yml` | TASK-011 | (none) | TASK-011 | 011 depends on 009,010 | none | (A) single owner | resolved |

**Ownership discipline:** every shared file has a single legal resolution (A/B/C); no task "merges carefully", "executes in Task-ID order to reconcile", or "handles conflicts manually". Multi-writer stack shells are composed exclusively by the single integration owner (TASK-180) from independent construct modules; dependency-chain files place their writers in strictly different waves. Every task remains directly executable — handler host, IAM role, AWS resource, API target, schema owner, and shared-file owner/integration-owner are all explicit.

**Result:** `unresolved_shared_file_conflicts = 0`; `same_wave_shared_file_conflicts = 0`.

---

## Judging Criteria Coverage Matrix

> Official scoring per the Cursor FINAL baseline §4 is **four official weighted criteria (35% / 10% / 35% / 20%) plus two official bonus criteria (+5% / +5%)**. Team creativity/originality is retained and applied as a `TEAM_QUALITY_PRINCIPLE` (row A), NOT an official weighted item. Each row: capability + business value + technical proof + demo evidence + acceptance criterion + responsible Task IDs.

| Row | Criterion | Capability | Business value | Technical proof | Demo evidence | Acceptance criterion | Responsible Task IDs |
|---|---|---|---|---|---|---|---|
| A | Team creativity / originality principle (`TEAM_QUALITY_PRINCIPLE`, non-official weight) | Deterministic-truth/Bedrock-language split; Fast Path + async enrichment; deterministic What-if recomputation; explainable EvidenceTrace | Novel, trustworthy AI decisions judges can inspect | Differentiators 1/3/4/5; P26/P28/P35; fast-path latency | Live inspectable reasoning + What-if recompute in the demo | P26/P28/P35 green + Fast Path ≤5s | TASK-034,099,102,103,111,115,136,137,138,139,140 |
| B | Official — Technical feasibility / decision-logic accuracy (35%) | Exact SOP rule engine (art.1–7); canonical core_hash; idempotency/fencing/recovery; final IAM bindings | Correct, auditable decisions under retries/failures | P1–P37, boundary + goldens, P33; canonical core_hash A/B/C | Golden ACC_001/EVT_002/EVT_003 + failure-injection replay | All Phase-2 gates + TASK-098/106/120/152/163/164 green | TASK-022,023,024,025,027,028,029,030,031,032,033,035,041,042,043,044,045,046,047,048,049,051,052,053,054,055,056,057,058,085,086,087,088,089,090,091,092,093,094,095,096,097,099,100,101,178,179 |
| C | Official — Business applicability / i18n & humanization (10%) | Multilingual public alerts (zh/en,+ja/ko); one-click publish + audit; manual_confirmation flows | Usable by a real command center; reaches tourists/roamers | P20/P36; publish audit trail; multilingual panels | Publish flow draft→approved→published + multilingual alert | TASK-114/117/144–152/133 green | TASK-030,114,117,132,133,144,145,146,147,148,149,150,151,152 |
| D | Official — Theme alignment / dashboard & smart commander (35%) | Real-time Dashboard decision hub; anomaly popups; route/ETE/evidence; What-if advisor | Embodies the "smart commander" theme | Phase-7 UI states + What-if demo | Live dashboard with auto-sensing + What-if advisor | TASK-121–133,135,141,142 green | TASK-121,122,123,124,125,126,127,128,129,130,131,132,133,135,141,142 |
| E | Official — Completeness (20%) | 32 REQ + 7 SOP + 3 events + 3 profiles + full deploy lifecycle + final stack integration + 3 official deliverables | Full, submittable, reproducible system | Matrices 1–8 + Phase-11 runbooks + smoke/latency + TASK-179/180 integration | Deployed URL + evidence bundle + architecture diagram | Coverage matrices + TASK-167–174 + smoke/latency gates + TASK-179/180 synth | TASK-059,060,061,062,063,064,065,066,067,068,069,070,071,072,073,074,075,076,077,078,079,080,081,082,083,084,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180 |
| F | Official bonus — Dashboard 外觀直觀性與設計性 (+5%) | Dashboard visual/intuitive design (REQ-030) | Extra design points; more intuitive command UI | TASK-134 polish (snapshot/visual tests) | Polished responsive layout in the demo | TASK-134 delivered (bonus) | TASK-072,134,135 |
| G | Official bonus — 中英以外語言 日/韓 (+5%) | ja/ko UI + ja/ko public-alert language (REQ-031) | International-language reach (Japanese/Korean) | P29; ja/ko templates (§21.3) + ja/ko UI | ja/ko alert + ja/ko UI toggle in the demo | TASK-050/117/134 ja/ko delivered (bonus) | TASK-050,117,134 |

---

## Section 6 — Critical path and competition demo journey

This section separates two distinct things that must NOT be conflated:
- **(A) Dependency Critical Path** — the real longest path in the task DAG where every adjacent pair previous→next has a DIRECT dependency edge (all task weights = 1). This is a graph fact, not a narrative.
- **(B) Competition Demo Journey** — the user-facing demonstration flow (source verification → incident injection → fast decision → enrichment → dashboard → What-if → publish → evidence). It is a presentation ordering and is **NOT** a direct dependency chain and **MUST NOT** be called the "longest dependency chain". Teardown is explicitly OFF the delivery journey (post-judging only).

### (B) Competition Demo Journey (user-facing demonstration flow — NOT a dependency chain) → Task IDs

| # | Journey step | Task IDs |
|---|---|---|
| 1 | Repo + guardrails | TASK-001,002,003,009,010,011,012 |
| 2 | Official source verification (7 SHA-256) | TASK-007,008,168 |
| 3 | Deterministic ingestion (+ deployment-time KB ingestion) | TASK-013,014,015,016,017,018,019,178 |
| 4 | RuleEngine (art.1–7 + strategies) | TASK-020,021,022,023,024,025,026,027,028,029,030,031,032,033 |
| 5 | 3 official incidents (goldens) | TASK-053,054,055,058 |
| 6 | DecisionCore (canonical core_hash, immutable) | TASK-034,035,099,100,101 |
| 7 | Injection API | TASK-086,087,088,096 |
| 8 | Step Functions lifecycle | TASK-068,089,090,091,092,093,094,095,097 |
| 9 | Fast Path (≤5s / ≤60s) | TASK-102,103,104,105 |
| 10 | RAG enrichment | TASK-108,109,110,111,112 |
| 11 | Report | TASK-113,116,132 |
| 12 | Public alert (multilingual) | TASK-114,117,132 |
| 13 | Explanation | TASK-115,119,129 |
| 14 | Real-time Dashboard | TASK-121,122,123,124,125,126,127,128,130,131,133 |
| 15 | What-if (dedicated WhatIfFn) | TASK-136,137,138,139,140,141,142,177 |
| 16 | Publish / audit | TASK-144,145,146,147,148,149,150,151 |
| 17 | Cognito authz | TASK-071 |
| 18 | AWS IaC + final IAM binding + shared-stack integration | TASK-059,060,061,062,063,064,065,066,067,069,070,072,073,074,075,076,077,078,079,080,081,082,083,084,177,178,179,180 |
| 19 | COMPETITION_AWS deployment | TASK-167 |
| 20 | Source gate (STOP on mismatch) | TASK-168 |
| 21 | Smoke (after KB ingestion complete) | TASK-169 |
| 22 | Latency proof (5s/60s) | TASK-170 |
| 23 | Failure-recovery proof | TASK-098,120,152,163,164 |
| 24 | Demo script | TASK-172 |
| 25 | Recorded video (delivery evidence, not a substitute) | TASK-172 |
| 26 | Architecture diagram | TASK-174 |
| 27 | GitHub delivery | TASK-174 |
| 28 | Dashboard URL freeze / keep accessible | TASK-171 |
| 29 | Evidence export | TASK-173 |

### (A) Dependency Critical Path (real longest direct-edge chain in the DAG)

All task weights = 1. The chain below is the DAG's longest dependency path; every adjacent pair previous→next is a DIRECT dependency edge (the `next` task lists the `previous` task in its `dependencies:`). **Tie-breaking rule:** when multiple equal-length longest paths exist, the predecessor with the lexicographically smallest Task ID is chosen at each step. The unique sink at maximum depth is TASK-176 (wave 22); the unique source is TASK-001 (wave 0).

```
TASK-001 → TASK-003 → TASK-013 → TASK-018 → TASK-019 → TASK-020 → TASK-022 → TASK-023
 → TASK-033 → TASK-034 → TASK-035 → TASK-099 → TASK-100 → TASK-101 → TASK-102 → TASK-103
 → TASK-104 → TASK-105 → TASK-107 → TASK-170 → TASK-171 → TASK-175 → TASK-176
```

- `critical_path_task_ids` = the 23 IDs above; `critical_path_length` = 23 nodes (22 direct edges); `start_task` = TASK-001; `end_task` = TASK-176; `every_direct_edge_verified` = true.
- Direct-edge verification: 003←001, 013←003, 018←013, 019←018, 020←019, 022←020, 023←022, 033←023, 034←033, 035←034, 099←035, 100←099, 101←100, 102←101, 103←102, 104←103, 105←104, 107←105, 170←107, 171←170, 175←171, 176←175 — each `next` lists `previous` in its `dependencies:`.
- The chain length equals `wave_max + 1` (23 = 22 + 1), confirming it is a true longest path in the DAG.

### Parallel task groups (waves)

See "Section 7 — Parallelizable waves" for the full dependency-depth partition of all 180 leaf tasks into waves 0..22 (recomputed by the formula `wave(task) = 0 if dependencies empty else 1 + max(wave(dependency))`).

### Mandatory acceptance gates (release-blocking, 43)

TASK-010,011,012 (framework/CI/secret-scan); TASK-036–058 (all Phase-2 property/boundary/golden/policy-switch); TASK-098 (P33 lifecycle/failure-injection); TASK-106,107 (persistence/latency); TASK-120 (enrichment); TASK-135 (UI states); TASK-142,143 (What-if); TASK-152 (publish/read-model); TASK-160,161,163,164 (IAM/secrets/failure-injection/resilience); TASK-165,166,168,169,170 (rehearsal/validation/source-gate/smoke/latency).

### Bonus tasks (genuinely optional, +5% each)

TASK-134 (Dashboard visual/intuitive design REQ-030 + ja/ko UI REQ-031); TASK-162 (non-essential deep X-Ray).

### Post-judging-only

No coding task is POST_JUDGING_ONLY. The sole post-judging activity is the organizer-gated EXECUTION of `cdk destroy` + residual-resource check, documented (authoring = COMPETITION_MUST_HAVE) in TASK-175/176 and executed only after organizer confirmation (§25 steps 9–11). It is intentionally NOT on the delivery-critical path.

### Release-blocking gates (must pass before submission)

1. Source-hash STOP gate (TASK-007/168) — any of the 7 official-source hashes mismatched → STOP.
2. KB ingestion completion (TASK-178) — verified COMPLETE before RAG smoke.
3. All 43 MANDATORY_ACCEPTANCE_GATE tasks green (tests/IAM/security/latency/smoke).
4. Final IAM binding + shared-stack integration (TASK-179/180) — every runtime Lambda bound to its explicit role, zero auto-generated role, four stacks synthesize with no cyclic/cross-stack/shared-file conflict.
5. Latency proof (TASK-170) — 60s official deadline met.
6. Deliverables present (TASK-171 URL, TASK-172 demo/video, TASK-173 evidence, TASK-174 architecture diagram + GitHub).

---

## Section 7 — Parallelizable waves

> Waves are recomputed by the unique formula `wave(task) = 0 if dependencies empty else 1 + max(wave(dependency))` over all 180 leaf tasks (checkpoints excluded). Tasks within a wave are mutually independent and may run in parallel; every dependency sits in a strictly lower wave. TASK-177 is in wave 6; TASK-178 is in wave 8; TASK-179 is in wave 9; TASK-180 is in wave 10. Shared-file ownership guarantees that no two same-wave tasks touch the same shared file. `wave_count = 23`; `wave_min = 0`; `wave_max = 22`; `dependency_wave_violations = 0`.

```json
{
  "waves": [
    { "id": 0, "tasks": ["TASK-001"] },
    { "id": 1, "tasks": ["TASK-002","TASK-003","TASK-004","TASK-009","TASK-012"] },
    { "id": 2, "tasks": ["TASK-005","TASK-006","TASK-007","TASK-010","TASK-013","TASK-014","TASK-015","TASK-016","TASK-017","TASK-111","TASK-121","TASK-156"] },
    { "id": 3, "tasks": ["TASK-008","TASK-011","TASK-018","TASK-021","TASK-032","TASK-059","TASK-085","TASK-112","TASK-122"] },
    { "id": 4, "tasks": ["TASK-019","TASK-024","TASK-026","TASK-029","TASK-036","TASK-042","TASK-060","TASK-061","TASK-062","TASK-063","TASK-064","TASK-065","TASK-071","TASK-073","TASK-074","TASK-086","TASK-089","TASK-093","TASK-095","TASK-123","TASK-124","TASK-137","TASK-157"] },
    { "id": 5, "tasks": ["TASK-020","TASK-037","TASK-043","TASK-045","TASK-066","TASK-067","TASK-090","TASK-091","TASK-094","TASK-116","TASK-125","TASK-126","TASK-138"] },
    { "id": 6, "tasks": ["TASK-022","TASK-025","TASK-027","TASK-030","TASK-031","TASK-038","TASK-068","TASK-069","TASK-070","TASK-075","TASK-077","TASK-078","TASK-079","TASK-080","TASK-081","TASK-082","TASK-084","TASK-092","TASK-127","TASK-177"] },
    { "id": 7, "tasks": ["TASK-023","TASK-028","TASK-041","TASK-046","TASK-047","TASK-050","TASK-052","TASK-056","TASK-057","TASK-072","TASK-076","TASK-083","TASK-087","TASK-114","TASK-144","TASK-149","TASK-153"] },
    { "id": 8, "tasks": ["TASK-033","TASK-039","TASK-040","TASK-044","TASK-117","TASK-132","TASK-133","TASK-145","TASK-150","TASK-161","TASK-165","TASK-178"] },
    { "id": 9, "tasks": ["TASK-034","TASK-110","TASK-128","TASK-129","TASK-134","TASK-139","TASK-146","TASK-147","TASK-148","TASK-151","TASK-179"] },
    { "id": 10, "tasks": ["TASK-035","TASK-048","TASK-049","TASK-108","TASK-115","TASK-130","TASK-131","TASK-143","TASK-152","TASK-160","TASK-180"] },
    { "id": 11, "tasks": ["TASK-051","TASK-053","TASK-054","TASK-055","TASK-058","TASK-099","TASK-109","TASK-113","TASK-135","TASK-140","TASK-166"] },
    { "id": 12, "tasks": ["TASK-100","TASK-118","TASK-119","TASK-136","TASK-142","TASK-155","TASK-158","TASK-167"] },
    { "id": 13, "tasks": ["TASK-101","TASK-120","TASK-141","TASK-168"] },
    { "id": 14, "tasks": ["TASK-096","TASK-102"] },
    { "id": 15, "tasks": ["TASK-088","TASK-097","TASK-103","TASK-159"] },
    { "id": 16, "tasks": ["TASK-098","TASK-104","TASK-106"] },
    { "id": 17, "tasks": ["TASK-105","TASK-154","TASK-162","TASK-163","TASK-169"] },
    { "id": 18, "tasks": ["TASK-107","TASK-164","TASK-172"] },
    { "id": 19, "tasks": ["TASK-170","TASK-173"] },
    { "id": 20, "tasks": ["TASK-171","TASK-174"] },
    { "id": 21, "tasks": ["TASK-175"] },
    { "id": 22, "tasks": ["TASK-176"] }
  ]
}
```

All 180 leaf tasks appear in exactly one wave; wave IDs are contiguous 0..22; every dependency resolves to a strictly earlier wave. `tasks_per_wave` = [1, 5, 12, 9, 23, 13, 20, 17, 12, 11, 11, 11, 8, 4, 2, 4, 3, 5, 3, 2, 2, 1, 1] (sum = 180); `wave_membership_duplicates = 0`; `wave_missing_tasks = 0`.

---

## Section 8 — Delivery-class labels (must-have vs bonus)

Every task carries a `delivery_class`. There is NO "skippable for a faster MVP" scope other than the two genuine `BONUS_OPTIONAL` tasks below.

**Delivery-class distribution (180 tasks):**
- `MANDATORY_IMPLEMENTATION` — 128 (core system code + IaC + SPA panels; never skippable)
- `MANDATORY_ACCEPTANCE_GATE` — 43 (tests / IAM / security / latency / source-integrity / smoke; release-blocking)
- `COMPETITION_MUST_HAVE` — 7 (TASK-167 deploy runbook, TASK-171 freeze+URL, TASK-172 demo+video, TASK-173 evidence export, TASK-174 architecture+GitHub delivery, TASK-175 organizer-gated cleanup authoring, TASK-176 residual-check authoring)
- `BONUS_OPTIONAL` — 2 (TASK-134 Dashboard visual design REQ-030 + ja/ko UI REQ-031; TASK-162 non-essential deep X-Ray)
- `POST_JUDGING_ONLY` — 0 coding tasks (the only post-judging activity is the organizer-gated `cdk destroy` + residual-resource-check EXECUTION, documented in TASK-175/176; execution is not a coding task and is not on the delivery-critical path)

**Genuinely optional (BONUS_OPTIONAL, +5% each):** TASK-134 (REQ-030 visual/intuitive design + REQ-031 ja/ko UI) and TASK-162 (deep X-Ray). The zh/en multilingual floor (P36; TASK-050/117) and the baseline responsive layout + all UX states (TASK-121–133) are MANDATORY, not bonus.

**Official deliverables** (REQ-023 architecture diagram, REQ-024 deployment URL, REQ-025 GitHub, REQ-029 video, REQ-032 completeness) are `DELIVERABLE_ONLY` at the requirement level but are produced by `COMPETITION_MUST_HAVE` tasks (TASK-167,171,172,173,174) and are required for submission. Test / security / latency / source-integrity / smoke tasks are `MANDATORY_ACCEPTANCE_GATE` (release-blocking), NOT skippable. Top-level phases are never optional.

---

## Self-Check (plan validation)

| Check | Result |
| --- | --- |
| Task total | 180 |
| Task IDs | TASK-001..TASK-180, no missing or duplicates |
| Phase total | 12 |
| Dependency references | 499 edges, 140 distinct refs |
| Invalid dependencies | [] |
| Self dependencies | [] |
| Dependency cycles | [] |
| Topological sort | 180 / 180 |
| Wave count | 23, wave 0..22 |
| Tasks per wave | [1, 5, 12, 9, 23, 13, 20, 17, 12, 11, 11, 11, 8, 4, 2, 4, 3, 5, 3, 2, 2, 1, 1] |
| TASK-177 / 178 / 179 / 180 waves | 6 / 8 / 9 / 10 |
| Critical path | 23 nodes / 22 direct edges |
| Same-wave shared-file conflicts | [] |
| Delivery classes | 128 mandatory implementation / 43 mandatory acceptance gate / 7 competition must-have / 2 bonus optional |
| Optional markers | TASK-134, TASK-162 only |
| OQ status | 3 resolved for implementation / 1 partially resolved / 7 fully open |
| Application runtime Lambdas | 10 |
| Deployment-support Lambda count | SYNTH_DERIVED |
| Official source hashes changed | NO |
| Application code created by this plan repair | NO |
| AWS resources created | NO |
| Deployment executed | NO |
| TASK-001 executed | NO |
| Implementation authorization | `NOT_AUTHORIZED_PENDING_READ_ONLY_REVIEW` |

### Frozen Design Implementation Realization Record

| Field | Value |
| --- | --- |
| `logical_design_capability` | POST /what-if, ScenarioParser, SchemaValidator, DomainValidator, WhatIfEngine, deterministic recomputation, SOP retrieval/citation, Bedrock explanation, no production-state mutation |
| `deployment_realization` | Dedicated WhatIfFn Lambda |
| `realization_class` | IMPLEMENTATION_DEPLOYMENT_UNIT |
| `design_amendment` | NO |
| `WhatIfFnRole classification` | IMPLEMENTATION_DERIVED_LEAST_PRIVILEGE_ENFORCEMENT_ARTIFACT |

### Final Gate

Requirements Status: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
Design Status: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
Task Plan Status: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
Implementation Authorization: `NOT_AUTHORIZED_PENDING_READ_ONLY_REVIEW`
