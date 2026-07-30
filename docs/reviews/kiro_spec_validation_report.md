# HG-001 Kiro UTF-8 Repair and Read-Only Validation Report

**Date**: 2026-07-24  
**Operation**: Inspect the Cursor/Kiro recovery output, reject corrupted targets, rebuild from authenticated clean bases, reapply HG-001, and validate without running implementation.

## 1. Verdict on the agent output

The reported task did **not** complete cleanly.

A strict UTF-8 decode and `U+FFFD = 0` are not sufficient proof of readable text. Mojibake can be valid UTF-8. The three latest uploaded outputs still contained visible encoding corruption:

| File | SHA-256 | Bytes | Lines | PUA | `?` | `€` | First line |
|---|---|---:|---:|---:|---:|---:|---|
| design(13).md | F69D4E696E26E43F64B2D70F50AFA1AD068E6E882E340F022E6A8781B61A7117 | 402706 | 2877 | 3238 | 5334 | 1736 | `[historical mojibake sample omitted]` |
| requirements(13).md | 758602046E406F3E500B6D45A3FFFA9EF05FEFC22A2EF63E2C1D899810936317 | 42692 | 307 | 418 | 492 | 248 | `[historical mojibake sample omitted]` |
| tasks(9).md | 2CAF81FB1EE989CBB7D1565B73395C598A654C0150B4B509C9450A0327DB9BD8 | 428773 | 4934 | 1 | 2 | 1 | `[historical PUA-containing title omitted]` |

The current `tasks(9).md` also retained stale active semantics in key task blocks, including the old Strategy A/B/C defaults and an all-OQs-open matrix. Therefore it was not accepted as the textual repair base.

## 2. Authenticated clean bases used

| Artifact | Clean base | SHA-256 |
|---|---|---|
| Requirements | `requirements(1).md` | `F21510C156C783793AD5A351D94F73BD4BACB2B8A6A0A3B009AAB621BC56109D` |
| Design | `design(10).md` | `D3FD300E1BCB681CCCFA16C5ADA250EF46D63FF4EF207208F2FE119D48F0B7B6` |
| Tasks | `tasks_final_ready_for_cursor_review.md` | `9605874AB9CC186006164FD390959E2A4ACA3342570CA10338E3CE3B1BC4D1E8` |

The corrupted files were not reverse-decoded because replacement characters and lossy substitutions had already destroyed byte-level information. The repair uses clean readable baselines and reapplies HG-001 deterministically.

## 3. HG-001 policies applied

```text
policy.time_alignment.mode = GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY
policy.affected_road.role = DISPLAY_AND_CONTEXT_ONLY
policy.ete.affected_set = INCIDENT_PRIMARY_AND_SELECTED_SECONDARY
policy.ete.snapshot_mode = COMMON_EXACT_TIMESTAMP
```

OQ status:
- OQ-001, OQ-002, OQ-003: `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE`
- OQ-005: `PARTIALLY_RESOLVED_BY_ORGANIZER_GUIDANCE`, time only
- OQ-004, OQ-006..OQ-011: `OPEN / AWAITING_HOST_REPLY`

Golden scenarios:
- ACC_001 ETE = **78.6 minutes**
- EVT_002 event 22:20 selects BL17 observation **22:15**; 22:30 is never used; ETE not applicable
- EVT_003 ETE = **41.0 minutes**

## 4. Repaired outputs

`logical_line_count` is the number of entries returned by splitting strictly decoded text with universal newline semantics (`CRLF`, `LF`, or `CR`). `final_newline` records whether the decoded text ends with a newline sequence; no LF-byte-count shortcut is used.

| File | Bytes | Logical lines | Final newline | SHA-256 | Strict UTF-8 | U+FFFD | PUA | Known mojibake runs | BOM |
|---|---:|---:|---|---|---|---:|---:|---:|---|
| requirements_KIRO_HG001_UTF8_FIXED.md | 30761 | 395 | YES | `4843DAC865873DED793847834D519836675EC94779EDECCADC16BF9FC7999F09` | PASS | 0 | 0 | 0 | NO |
| design_KIRO_HG001_UTF8_FIXED.md | 329211 | 2881 | YES | `6AF579AD37933F1F0D5EA2599200A9A99AEAD568B0135C04E6770FED1C808B4A` | PASS | 0 | 0 | 0 | NO |
| tasks_KIRO_HG001_UTF8_FIXED.md | 428144 | 4895 | YES | `8294C63D1A8C5C85A73868A40379ABBECFAE32DF1F3663B51EFFB551C2B93277` | PASS | 0 | 0 | 0 | NO |
| HG001_KIRO_UTF8_REPAIR_VALIDATION_REPORT.md | Measured after final write | Measured after final write | YES | Returned in final chat after final write | PASS | 0 | 0 | 0 | NO |

The report's own full-file SHA-256 and byte count cannot be embedded into that same file without changing them. They are therefore recalculated after this report's final write and returned in the final chat response. This is a self-reference constraint, not an omitted validation.

All four final `fix_uft8` artifacts:
- pass strict UTF-8 decoding
- are UTF-8 without BOM
- use readable Traditional Chinese and readable Markdown
- have zero known mojibake signatures
- have zero private-use Unicode characters
- have zero replacement characters

## 5. Structural validation

The first repaired draft still contained four active stale OQ-status claims in Design and two active ACC_001 ETE=90 claims across Design and TASK-131. These were identified by the independent read-only cross-verification and surgically corrected in this revision.

Final post-repair semantic validation is recorded below from independent checks of the actual repaired files.

Requirements:
- unchanged byte-for-byte
- R1..R17 retained exactly once
- status and authorization unchanged

Design:
- active stale OQ-status claims: 0
- active ACC_001 ETE=90 claims: 0
- authoritative OQ distribution: 3 resolved for implementation / 1 partially resolved / 7 fully open
- active ACC_001 ETE: 78.6 minutes under the selected HG-001 policy
- 31 numbered sections retained
- 14 Mermaid blocks retained
- P1..P37 retained exactly once
- deterministic/Bedrock boundary retained
- official seven-source manifest unchanged
- HG-001 data models, Strategy A/B/C/F, properties, OQ matrix, and Golden scenarios integrated

Tasks:
- active ACC_001 ETE=90 claims: 0
- TASK-131 renders 78.6 minutes with complete timing, affected-set, formula, and HG-001 provenance evidence
- 180 tasks
- TASK-001..TASK-180 unique and complete
- 12 phases
- 499 dependency edges
- 140 distinct dependency references
- zero invalid dependency references
- zero cycles
- topological sort 180/180
- 23 waves, wave 0..22
- tasks per wave: `[1, 5, 12, 9, 23, 13, 20, 17, 12, 11, 11, 11, 8, 4, 2, 4, 3, 5, 3, 2, 2, 1, 1]`
- TASK-177/178/179/180 waves: 6/8/9/10
- critical path: 23 nodes / 22 direct edges
- delivery classes: 128 / 43 / 7 / 2
- optional markers: TASK-134 and TASK-162 only
- TASK-001 was not executed

Critical path:

```text
TASK-001 -> TASK-003 -> TASK-013 -> TASK-018 -> TASK-019 -> TASK-020 -> TASK-022 -> TASK-023 -> TASK-033 -> TASK-034 -> TASK-035 -> TASK-099 -> TASK-100 -> TASK-101 -> TASK-102 -> TASK-103 -> TASK-104 -> TASK-105 -> TASK-107 -> TASK-170 -> TASK-171 -> TASK-175 -> TASK-176
```

## 6. Authorization

Requirements Status: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
Design Status: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
Task Plan Status: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
Implementation Authorization: `NOT_AUTHORIZED_PENDING_READ_ONLY_REVIEW`

No application code was created.  
No AWS resource was created.  
No deployment was executed.  
