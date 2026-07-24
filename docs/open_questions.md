# CHT 城市應變分析 AI Agent - Open Questions

**Document Version**: 2.2 (HG-001 AMENDMENT)
**Created**: 2026-07-20
**Source Authority**: OFFICIAL_DOC + OFFICIAL_DATA + OFFICIAL_SOP + ORGANIZER_GUIDANCE
**Baseline Status**: AMENDED_BY_HG-001

> **Note**: ORGANIZER_GUIDANCE (HG-001) is interpretive implementation guidance and is NOT a runtime official source. It does not modify SOP thresholds or A/B classification boundaries. The seven official source files and their hashes remain unchanged.

**Amended**: 2026-07-24 (HG-001)

---

## 1. Classification Definitions

| Classification | Definition | Indicator |
|---------------|------------|-----------|
| NOT_DEFINED | Official source provides NO specification | Official text does not contain definition |
| PARTIALLY_DEFINED | Official source provides PARTIAL specification | Some conditions defined, some not |
| DATA_FACT | Data observation, not rule definition | Data exists as-is |
| NOT_APPLICABLE | Field exists but does not participate in SOP logic | Field logically irrelevant to triggering |
| SOURCE_CONFLICT | Two official sources give MUTUALLY EXCLUSIVE rules | Only when explicit conflict exists |

---

## 2. Open Questions (11 Total)

### OQ-001: 事件 timestamp 與稀疏 CSV 時序資料如何對齊

| Field | Value |
|-------|-------|
| question_id | OQ-001 |
| status | RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE |
| resolution_authority | HG-001 |
| official_unique_rule | false |
| selected_team_policy | true |
| configurable | true |
| resolution_date | 2026-07-24 |
| guidance_id | HG-001 |
| selected_policy_class | ORGANIZER_GUIDED_TEAM_POLICY |
| policy_mode | GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY |
| organizer_guidance_summary | Use the most recent record at or before the event time, including an exact match; use one consistent logical cutoff throughout the system; display the timestamps used on the Dashboard. |
| exact_ambiguity | 如何把不同實體、不同採樣時間的資料組成同一次決策快照 |
| event_1_detail | Event 1 事件時間 22:10；RD_TPE_002 有 22:10 exact row；其他候選道路缺少 22:10 完整同步快照 |
| event_2_detail | Event 2 事件時間 22:20；BS_MRT_BL17 沒有 22:20 exact row；相鄰資料為 22:15 (User_Count=31000, Growth_Rate=0.08, Roaming=16%) 與 22:30 (User_Count=33000, Growth_Rate=0.06, Roaming=12%) |
| event_3_detail | Event 3 事件時間 22:30；交通與人流資料中存在 22:30 時間點；但仍需定義使用哪些道路與基地台資料 |
| evidence_from_sop | SOP 未定義事件時間戳與 CSV 時序的對齊方式 |
| evidence_from_docx | 「即時感知」與「動態決策」暗示即時性要求 |
| affected_requirement | REQ-001, REQ-002, REQ-004, REQ-009, REQ-013, REQ-016, REQ-017 |
| recommended_question | 當事件 timestamp 與 CSV 最近鄰時間戳不符時，應採用何種對齊策略（最近鄰、線性插值、或其他）？ |

---

### OQ-002: Event 2 affected_road 的用途

| Field | Value |
|-------|-------|
| question_id | OQ-002 |
| status | RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE |
| resolution_authority | HG-001 |
| official_unique_rule | false |
| selected_team_policy | true |
| configurable | true |
| resolution_date | 2026-07-24 |
| guidance_id | HG-001 |
| selected_policy_class | ORGANIZER_GUIDED_TEAM_POLICY |
| policy_role | DISPLAY_AND_CONTEXT_ONLY |
| organizer_guidance_summary | Display the affected road on the Dashboard; treat it as nearby-road impact and event context; local on-site handling may be mentioned, but local action is not mandatory. |
| exact_ambiguity | Event 2 包含 affected_road=RD_TPE_001，但 SOP 第 3 條僅提及 BS_MRT_BL17，未定義 affected_road 的正式用途 |
| evidence_from_json | Event 2: affected_segment=BS_MRT_BL17, affected_road=RD_TPE_001 |
| evidence_from_sop | 「BS_MRT_BL17 Growth_Rate > 0.30，或 User_Count > 25,000」僅提及 BS_MRT_BL17 |
| affected_requirement | REQ-016 |
| recommended_question | affected_road 欄位的正式用途為何？是否用於 SOP 第 3 條決策或 ETE 計算？ |

---

### OQ-003: ETE「受影響路段平均 Saturation_Score」的路段集合與平均方式

| Field | Value |
|-------|-------|
| question_id | OQ-003 |
| status | RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE |
| resolution_authority | HG-001 |
| official_unique_rule | false |
| selected_team_policy | true |
| configurable | true |
| resolution_date | 2026-07-24 |
| guidance_id | HG-001 |
| selected_policy_class | ORGANIZER_GUIDED_TEAM_POLICY |
| policy_affected_set | INCIDENT_PRIMARY_AND_SELECTED_SECONDARY |
| organizer_guidance_summary | Include the incident road, selected primary evacuation route, and selected secondary evacuation routes; average their Saturation_Score values at one common time point; show the road set, inputs, formula, and result. |
| exact_ambiguity | SOP 第 7 條提及「受影響路段平均 Saturation_Score」，但未定義：1) 受影響路段集合包含哪些路段；2) 時間點選取方式；3) 平均方式 |
| evidence_from_sop | 「受影響路段平均 Saturation_Score」 |
| affected_requirement | REQ-009, REQ-015, REQ-020, REQ-021, REQ-022 |
| recommended_question | 請定義：1) 受影響路段集合（事故路段自身？事故路段+替代路段？全部相鄰路段？）；2) 時間點選取方式；3) 平均方式 |

---

### OQ-004: Event 1 自然語言 location 如何轉換成事故 intersection anchor

| Field | Value |
|-------|-------|
| question_id | OQ-004 |
| status | NOT_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| exact_ambiguity | Event 1 location 為自然語言「光復南路與忠孝東路口南側」，但未定義如何解析為事故 anchor intersection 以判定「上游」 |
| evidence_from_json | Event 1 location: 「光復南路與忠孝東路口南側」 |
| evidence_from_geometry | RD_TPE_002 intersections=["市民大道四段","忠孝東路四段","仁愛路四段"] |
| evidence_from_docx | 「intersections：與該路段相交之路段，已按上游→下游排序」 |
| affected_requirement | REQ-008, REQ-013, REQ-028 |
| recommended_question | location 自然語言解析的責任歸屬（LLM？規則引擎？）及上游/下游判定標準？ |

---

### OQ-005: 多語觸發的「任一基地台」之站點範圍與時間範圍

| Field | Value |
|-------|-------|
| question_id | OQ-005 |
| status | PARTIALLY_RESOLVED_BY_ORGANIZER_GUIDANCE |
| resolution_authority | HG-001 (time dimension only) |
| resolved_dimension | time cutoff / current-state timing |
| remaining_open_dimension | the station set represented by “any base station” |
| remaining_status | OPEN / AWAITING_HOST_REPLY |
| configurable | true |
| resolution_date | 2026-07-24 |
| guidance_id | HG-001 |
| policy_mode | GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY (time dimension only) |
| exact_ambiguity | SOP 第 6 條提及「任一基地台 Roaming_User_Pct >= 30%」，但未定義：1)「任一基地台」的站點範圍；2) 時間範圍 |
| evidence_from_sop | 「任一基地台 Roaming_User_Pct >= 30%」 |
| evidence_from_csv | signaling_crowd_density.csv 包含多個時間戳的基地台資料 |
| affected_requirement | REQ-002, REQ-010, REQ-019, REQ-022 |
| recommended_question | 請定義「任一基地台」的站點範圍（全資料集/事件區域/時間快照）與時間範圍（整個事件週期/某個時間點）？ |

---

### OQ-006: intersections 中 label 沒有對應 segment_id 時的處理

| Field | Value |
|-------|-------|
| question_id | OQ-006 |
| status | NOT_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| exact_ambiguity | road_network_geometry.json 的 intersections 欄位包含 RD_TPE_009 有「正氣橋」，不在 15 路段 name 清單中 |
| evidence_from_geometry | RD_TPE_009 intersections=["忠孝東路四段","正氣橋"] |
| evidence_from_docx | 「intersections：與該路段相交之路段 (以路段全名表示，與 name 欄位一致)」 |
| affected_requirement | REQ-013, REQ-028 |
| recommended_question | 當 intersection label 沒有對應 segment_id 時，是否僅作為拓撲標籤使用，且不得作為 alternatives 候選或 Saturation 比較對象？ |

---

### OQ-007: alternatives 與直接相交條件若沒有任何交集時如何呈現

| Field | Value |
|-------|-------|
| question_id | OQ-007 |
| status | NOT_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| exact_ambiguity | SOP 第 2 條要求從 alternatives 中篩選與事故路段直接相交者，若無任何 alternatives 同時滿足所有條件，系統應如何回應 |
| evidence_from_sop | 「從事故路段的 alternatives 中篩選...與事故路段直接相交」 |
| evidence_from_docx | 「alternatives：事故時建議的分流方向，為單向建議」 |
| affected_requirement | REQ-013 |
| recommended_question | 當無任何 alternatives 同時滿足 (1) capacity_vph >= 1000、(2) 直接相交、(3) 上游位置三項篩選條件時，系統應如何回應？是否顯示「無可用疏散路徑」？ |

---

### OQ-008: PDF 避開已飽和路段與 SOP 壅塞主疏散仍維持的適用範圍差異

| Field | Value |
|-------|-------|
| question_id | OQ-008 |
| status | PARTIALLY_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| partial_definition | PDF 已定義應避開容量不足或已飽和路段；SOP 第 2 條已定義主疏散路線若 Saturation >= 0.85，仍維持並採長綠燈等措施 |
| undefined_area | 兩者的適用階段、適用範圍、優先關係未定義 |
| evidence_from_pdf | 「避開容量不足或已飽和之路段」 |
| evidence_from_sop | 「若主疏散路段已壅塞 (Saturation_Score >= 0.85)，仍維持該路徑並啟動長綠燈時制」 |
| affected_requirement | REQ-005, REQ-013, REQ-014 |
| recommended_question | PDF「避開已飽和路段」與 SOP「壅塞仍維持」的適用階段、適用範圍與優先關係？ |

---

### OQ-009: What-if 的 LLM 判斷與程式運算責任邊界

| Field | Value |
|-------|-------|
| question_id | OQ-009 |
| status | PARTIALLY_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| exact_ambiguity | 官方描述存在責任邊界差異：門檻判定→程式運算；路網重規劃→程式運算；導引文字→LLM 生成；ETE 結果→LLM 解釋；What-if 條件→LLM 判斷。當 LLM 判斷的 SOP 條款與程式運算結果不符時，誰的結論為準？ |
| evidence_from_docx | 「摘要由 LLM 生成，門檻判定由程式運算」、「路網重規劃為程式運算，導引文字由 LLM 生成」、「AI 須能依假設條件...立即檢索 SOP」 |
| partial_definition_note | 官方已定義部分責任歸屬，但未定義衝突時的處理方式 |
| affected_requirement | REQ-006, REQ-007, REQ-008 |
| recommended_question | What-if 場景中，若 LLM 判斷的 SOP 條款與程式運算結果不符，誰的結論為準？ |

---

### OQ-010: SOP 第 5 條「受影響路口」的集合如何決定

| Field | Value |
|-------|-------|
| question_id | OQ-010 |
| status | NOT_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| exact_ambiguity | 官方只規定每個受影響路口配置 2 人，未定義 affected_segment 的全部 intersections 是否均屬於受影響路口 |
| evidence_from_sop | 「警力人數每路口 2 人」 |
| affected_requirement | REQ-018, REQ-021 |
| recommended_question | 號誌故障事件中，哪些 intersections 應視為受影響路口，以及總警力應如何計算？ |

---

### OQ-011: SOP 第 5 條估計持續時間與 SOP 第 7 條 ETE 的關係

| Field | Value |
|-------|-------|
| question_id | OQ-011 |
| status | PARTIALLY_DEFINED |
| workflow_status | OPEN / AWAITING_HOST_REPLY |
| exact_ambiguity | SOP 第 5 條要求提供估計持續時間；SOP 第 7 條提供 ETE 公式；官方未明文說明兩者是否相同 |
| evidence_from_sop_5 | 「估計持續時間」 |
| evidence_from_sop_7 | 「ETE_minutes = base_clearance + congestion_penalty」 |
| affected_requirement | REQ-018, REQ-021 |
| recommended_question | 號誌故障的估計持續時間是否應直接使用 SOP 第 7 條 ETE？若是，受影響路段集合應如何定義？ |

---

## 3. Resolved Clarifications (1 Total)

### RC-001: Event 3 status=Caution 與 SOP 第 5 條的關係

| Field | Value |
|-------|-------|
| resolution_id | RC-001 |
| question | Event 3 status=Caution 是否與 SOP 第 5 條衝突？ |
| evidence_from_json | Event 3 status=Caution |
| evidence_from_sop | SOP 第 5 條觸發條件：「事件 type = 'Power_Failure'，或描述含『號誌失效/故障』」；SOP 第 5 條僅使用 type/description OR 條件，不使用 status |
| resolution | status=Caution 不參與 SOP 第 5 條邏輯，不構成衝突 |
| conclusion | NOT_APPLICABLE - SOP 第 5 條依 type 或 description 判定，status 欄位不參與第 5 條觸發決策 |
| organizer_confirmation_required | NO |
| organizer_confirmation_still_required | 7 fully open OQs plus the unresolved station-scope dimension of OQ-005 |

---

## 4. Summary

| ID | Question | Classification | Organizer Confirmation |
|----|----------|----------------|------------------------|
| OQ-001 | 事件 timestamp 與 CSV 對齊 | RESOLVED_BY_HG-001 | NO |
| OQ-002 | Event 2 affected_road 用途 | RESOLVED_BY_HG-001 | NO |
| OQ-003 | ETE 受影響路段定義 | RESOLVED_BY_HG-001 | NO |
| OQ-004 | Event 1 location 解析 | NOT_DEFINED / OPEN | YES |
| OQ-005 | 「任一基地台」範圍定義 | PARTIALLY_RESOLVED_BY_HG-001（時間面向） | YES，站點範圍仍待確認 |
| OQ-006 | intersections label 無對應 segment_id 處理 | NOT_DEFINED / OPEN | YES |
| OQ-007 | alternatives 無交集時處理 | NOT_DEFINED / OPEN | YES |
| OQ-008 | PDF vs SOP 壅塞處理範圍差異 | PARTIALLY_DEFINED / OPEN | YES |
| OQ-009 | LLM vs 程式運算責任邊界 | PARTIALLY_DEFINED / OPEN | YES |
| OQ-010 | 受影響路口集合定義 | NOT_DEFINED / OPEN | YES |
| OQ-011 | 估計持續時間與 ETE 關係 | PARTIALLY_DEFINED / OPEN | YES |
| RC-001 | Event 3 status=Caution 關係 | NOT_APPLICABLE | NO |

---

## 5. Statistics

| Metric | Value |
|--------|-------|
| question_total | 11 |
| resolved_for_implementation | 3（OQ-001、OQ-002、OQ-003） |
| partially_resolved | 1（OQ-005，僅時間面向） |
| still_fully_open | 7（OQ-004、OQ-006、OQ-007、OQ-008、OQ-009、OQ-010、OQ-011） |
| organizer_confirmation_still_required | 7 fully open OQs plus the unresolved station-scope dimension of OQ-005 |
| resolved_clarification_count | 1（RC-001） |

---

**Document Version**: 2.2 (HG-001 AMENDMENT)
**Created**: 2026-07-20
**Amended**: 2026-07-24 (HG-001)
**Source**: CHT Requirements Baseline Audit
