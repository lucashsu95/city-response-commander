# CHT 城市應變分析 AI Agent - Requirements Baseline

**Document Version**: 2.2 (HG-001 AMENDMENT CANDIDATE)
**Created**: 2026-07-20
**Source Authority**: OFFICIAL_DOC + OFFICIAL_DATA + OFFICIAL_SOP + ORGANIZER_GUIDANCE
**Derivation Note**: docx_extracted.txt is a DERIVED_SEARCHABLE_MIRROR only; NOT_SOURCE_OF_TRUTH
**Baseline Status**: AMENDED_BY_HG-001_PENDING_INDEPENDENT_REVIEW

> **Note**: ORGANIZER_GUIDANCE is interpretive implementation guidance and is NOT a runtime official source. The seven official source files and their hashes remain unchanged. Guidance ID HG-001 is preserved verbatim in `cursor_spec/references/organizer_guidance_2026-07-24.md`.

**Amended**: 2026-07-24 (HG-001)

---

## 1. Introduction

**Project Name**: 中華電信「城市應變分析 AI Agent」
**Competition**: 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽

**Source Authority**: All requirements are derived exclusively from the seven official contest documents. No external sources shall be consulted.

**Purpose**: Establish a Requirements Baseline for independent audit of official requirements against team deliverables.

---

## 2. Glossary

| Term | Definition | Source |
|------|------------|--------|
| ETE | 預計交通恢復時間，單位為分鐘。官方文件未提供 ETE 的英文全名，因此不得自行展開縮寫。 | emergency_traffic_sop.txt 第 7 條 |
| Saturation_Score | 路段車流飽和度，數值範圍 0.0-1.0 | city_traffic_flow.csv |
| B 級 (Yellow) | 0.85 <= Saturation_Score < 0.95 | emergency_traffic_sop.txt 第 1 條 |
| A 級 (Red) | Saturation_Score >= 0.95 | emergency_traffic_sop.txt 第 1 條 |
| BS_ | 前綴，代表人流/基地台事件 (非道路事件) | live_incidents.json |
| RD_ | 前綴，代表道路事件 | live_incidents.json |
| Roaming_User_Pct | 漫遊用戶比率 (百分比字串，如 "30%") | signaling_crowd_density.csv |
| intersection | 與該路段相交之路段，已按上游至下游排序 | road_network_geometry.json |
| alternatives | 事故時建議的分流方向，單向建議，不可假設對稱 | road_network_geometry.json |
| nearby_stations | 該路段周邊、本資料集涵蓋之基地台清單 | road_network_geometry.json |

---

## 3. Official Deliverables

### 3.1 Official Deliverable 1: 提案簡報

必須涵蓋：
- 解題方向
- AI 技術應用
- 數據資料應用
- 使用者流程
- AWS 架構圖

### 3.2 Official Deliverable 2: Dashboard Live Demo

- 可存取的部署網址
- 錄製影片連結

### 3.3 Official Deliverable 3: GitHub 連結

- 完整原始碼

### 3.4 Team Deliverable (NOT Official)

- AWS 部署方案說明 (標記為 TEAM_DELIVERABLE，非第四項官方交付)

---

## 4. Official Scoring Criteria

| 項目 | 比重 |
|------|------|
| 技術可行性／決策邏輯準確性 | 35% |
| 商業應用性／國際化與人性化 | 10% |
| 主題切合度／儀表板與智慧指揮官 | 35% |
| 完成度 | 20% |
| +5% Dashboard 外觀直觀性與設計性 | 加分 |
| +5% 中英以外語言，如日文、韓文 | 加分 |

---

## 5. Functional Requirements (REQ-001 to REQ-032)

### REQ-001: Dashboard 即時車流人流視覺化

| Field | Value |
|-------|-------|
| requirement_id | REQ-001 |
| title | Dashboard 即時車流人流視覺化 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
系統需依時間軸自動讀取並展示車流與人流數據。

**EARS Acceptance Criteria**:
```
WHEN dashboard is active
THEN system SHALL display city_traffic_flow.csv data on a timeline
AND system SHALL display signaling_crowd_density.csv data on the same timeline
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 1

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- `decision_cutoff_timestamp = event.timestamp`.
- For each required entity, select the latest observation whose timestamp is less than or equal to the decision cutoff; do not use future rows or interpolation.
- All fields for one entity come from the same selected row.
- Dashboard disclosure includes the event timestamp, decision cutoff, every material input's observation timestamp, maximum staleness, selected policy mode, and HG-001.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001, ORGANIZER_GUIDANCE)

**Verification Method**: Dashboard displays real-time or near-real-time data visualization with time-axis

---

### REQ-002: 異常自動彈窗預警

| Field | Value |
|-------|-------|
| requirement_id | REQ-002 |
| title | 異常自動彈窗預警 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
當數據達到 SOP 預警門檻時，Dashboard 須自動跳出分析摘要與預警提示，無需人工查詢。

**EARS Acceptance Criteria**:
```
WHEN any road has Saturation_Score >= 0.85
THEN system SHALL automatically display warning popup

WHEN BS_MRT_BL17 Growth_Rate > 0.30
OR BS_MRT_BL17 User_Count > 25000
THEN system SHALL automatically display warning popup

WHEN BS_TPE_DOME historical User_Count peak >= 30000
AND current Growth_Rate <= -0.20
THEN system SHALL automatically display warning popup

WHEN any in-scope base station has Roaming_User_Pct >= 30%
THEN system SHALL automatically display warning popup
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 1

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- Automatic warnings use the same `decision_cutoff_timestamp` as the rest of the system.
- All comparisons use each entity’s latest observation at or before the event cutoff.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001, ORGANIZER_GUIDANCE), OQ-005 (PARTIALLY RESOLVED via HG-001 — time dimension; station scope still OPEN)

**Verification Method**: Automatic popup appears when SOP thresholds are met

---

### REQ-003: 事件注入介面

| Field | Value |
|-------|-------|
| requirement_id | REQ-003 |
| title | 事件注入介面 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
提供功能讓管理員將 live_incidents.json (如路面塌陷、號誌故障) 注入系統。

**EARS Acceptance Criteria**:
```
WHEN administrator provides live_incidents.json
THEN system SHALL accept and process the incident data
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 2

**Open Question Dependencies**: None

**Verification Method**: Admin can inject live_incidents.json into system

---

### REQ-004: 60 秒內路網重規劃

| Field | Value |
|-------|-------|
| requirement_id | REQ-004 |
| title | 60 秒內路網重規劃 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
系統接收事故資訊後，須於 60 秒內完成路網重規劃，並在畫面上更新導引建議。

**EARS Acceptance Criteria**:
```
WHEN incident is received
THEN system SHALL complete route replanning within 60 seconds
AND system SHALL update guidance on display
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 2

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The 60-second replanning uses the same `decision_cutoff_timestamp`; selected primary and secondary routes use latest-prior observations at that logical cutoff.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001, ORGANIZER_GUIDANCE)

**Verification Method**: Route replanning completes within 60 seconds

---

### REQ-005: 避開已飽和之路段

| Field | Value |
|-------|-------|
| requirement_id | REQ-005 |
| title | 避開已飽和之路段 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
避開容量不足或已飽和之路段。

**EARS Acceptance Criteria**:
```
WHEN rerouting is required
THEN system SHALL evaluate route capacity and saturation
AND system SHALL apply the confirmed precedence between
    the general avoidance objective and SOP-2 candidate-selection rules
AND system SHALL disclose any selected route whose
    Saturation_Score indicates congestion
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 2

**Open Question Dependencies**: OQ-008

**Verification Method**: Rerouted paths evaluated for capacity and saturation, precedence disclosed

---

### REQ-006: What-if 對話式問答

| Field | Value |
|-------|-------|
| requirement_id | REQ-006 |
| title | What-if 對話式問答 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
在 Dashboard 旁設對話視窗，允許指揮官輸入模擬指令或假設性問題 (What-if)。

**EARS Acceptance Criteria**:
```
WHEN commander inputs a What-if question
THEN system SHALL provide response based on SOP rules
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 3

**Open Question Dependencies**: OQ-009

**Verification Method**: Commander can input What-if questions and receive SOP-based responses

---

### REQ-007: SOP 邏輯驗證

| Field | Value |
|-------|-------|
| requirement_id | REQ-007 |
| title | SOP 邏輯驗證 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
AI 須能依假設條件 (例：若 BL17 人數增至 40,000) 立即檢索 SOP，回答應觸發的條款與預期動作。

**EARS Acceptance Criteria**:
```
WHEN hypothetical condition is provided (e.g., BL17 count = 40000)
THEN system SHALL identify triggered SOP clauses
AND system SHALL describe expected actions
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 3

**Open Question Dependencies**: OQ-009

**Verification Method**: System correctly identifies SOP clauses for hypothetical conditions

---

### REQ-008: 判定依據展示

| Field | Value |
|-------|-------|
| requirement_id | REQ-008 |
| title | 判定依據展示 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |

**Requirement Statement**:
在 Dashboard 上清楚展示 AI 的推理過程，解釋為何判定為 A 級及為何排除特定替代道路。

**EARS Acceptance Criteria**:
```
WHEN classification decision is made
THEN system SHALL display reasoning process
AND system SHALL cite data evidence
AND system SHALL explain why alternative routes were excluded
```

**Source Tag**: OFFICIAL_DOC / DOCX / 模組 4

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The reasoning display includes selected-record metadata for every material input: `entity_id`, `observation_timestamp`, `staleness_minutes`, `exact_match`, `selection_mode`, and `guidance_id = HG-001`.

**Open Question Dependencies**: OQ-004 (OPEN), OQ-009 (OPEN)

**Verification Method**: Dashboard shows reasoning chain for all decisions

---

### REQ-009: ETE 公式運算

| Field | Value |
|-------|-------|
| requirement_id | REQ-009 |
| title | ETE 公式運算 |
| authority | OFFICIAL_DOC + OFFICIAL_SOP |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / emergency_traffic_sop.txt 第 7 條 |

**Requirement Statement**:
自動解析事故嚴重度，依 SOP 內嵌公式即時計算並顯示預計交通恢復時間 (ETE)。

**EARS Acceptance Criteria**:
```
WHEN ETE calculation is requested
THEN system SHALL compute ETE_minutes = base_clearance + congestion_penalty
WHERE base_clearance: Critical=60, High=40, Medium=20
AND congestion_penalty = max(0, (avg_saturation - 0.5) * 60)
```

**Source Tag**:
- OFFICIAL_DOC / DOCX / 模組 4：「自動解析事故嚴重度並依 SOP 公式即時計算及顯示 ETE」
- OFFICIAL_SOP / emergency_traffic_sop.txt / 第 7 條：「ETE_minutes、base_clearance、congestion_penalty 正式公式」

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- `ete_affected_set = stable_unique(incident.affected_segment, selected_primary_evacuation_route, selected_secondary_evacuation_routes)` in deterministic order: INCIDENT, PRIMARY, SECONDARY.
- `ete_snapshot_timestamp` is the latest timestamp less than or equal to the event timestamp for which every road in `ete_affected_set` has an exact traffic record.
- All ETE `Saturation_Score` values come from that exact timestamp. Mixed-timestamp averaging, interpolation, and future rows are prohibited.
- If no common exact timestamp exists: `ete_calculation_status = INSUFFICIENT_COMMON_SNAPSHOT`, `ete_minutes = null`, `ete_lower_bound_minutes = base_clearance`, and `manual_confirmation_required = true`.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001), OQ-003 (RESOLVED via HG-001)

**Verification Method**: ETE formula produces correct results per SOP specification

---

### REQ-010: 多語化通報觸發

| Field | Value |
|-------|-------|
| requirement_id | REQ-010 |
| title | 多語化通報觸發 |
| authority | OFFICIAL_DOC + OFFICIAL_SOP |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / emergency_traffic_sop.txt 第 6 條 |

**Requirement Statement**:
系統自動分析基地台信令，當任一站點漫遊率 >= 30% 時，自動產出多語文的告警文字。

**EARS Acceptance Criteria**:
```
WHEN ANY base station Roaming_User_Pct >= 30%
THEN system SHALL produce multilingual alert in the same response
```

**Source Tag**: OFFICIAL_DOC + OFFICIAL_SOP / DOCX 模組 5 / SOP 第 6 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The time dimension of SOP 6 uses the same `decision_cutoff_timestamp`, with latest-prior `Roaming_User_Pct` per station.
- The station set represented by “any base station” remains configurable; HG-001 does not resolve that scope.

**Open Question Dependencies**: OQ-005 (PARTIALLY RESOLVED via HG-001 — time cutoff resolved; station scope still OPEN)

**Verification Method**: Multilingual alert produced when Roaming >= 30%

---

### REQ-011: SOP-1 交通擁塞級別判定

| Field | Value |
|-------|-------|
| requirement_id | REQ-011 |
| title | SOP-1 交通擁塞級別判定 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 1 條 |

**Requirement Statement**:
分級 (適用全 15 路段，決定 Dashboard 紅黃燈顯示)：
- B 級 (壅擠 / 黃燈)：0.85 <= Saturation_Score < 0.95
- A 級 (癱瘓 / 紅燈)：Saturation_Score >= 0.95

城市應變觸發路段：忠孝東路 (RD_TPE_001)、光復南路 (RD_TPE_002)。

**EARS Acceptance Criteria**:
```
WHEN 0.85 <= Saturation_Score < 0.95
THEN system SHALL classify as B 級 (Yellow)

WHEN Saturation_Score >= 0.95
THEN system SHALL classify as A 級 (Red)

WHEN RD_TPE_001 OR RD_TPE_002 reaches B 級
THEN system SHALL notify traffic control center
AND system SHALL initiate "長綠燈時制"
AND system SHALL add 25% green time to alternative roads
AND system SHALL dispatch police to clear intersections

WHEN RD_TPE_001 OR RD_TPE_002 reaches A 級
THEN system SHALL additionally invoke
    the alternative-route-guidance procedure described in SOP 第 2 條
```

**Clarification**:
此處代表依第 2 條的路徑程序產生替代路徑引導，不表示 SOP 第 2 條獨立的事故事件三項觸發條件已因 A 級本身而成立。

不得改動官方：
- A 級門檻 (Saturation_Score >= 0.95)
- B 級措施
- +25% 綠燈配時
- 警力淨空
- 替代路徑引導要求

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 1 條

**Open Question Dependencies**: None

**Verification Method**: All 15 segments display correct traffic light status per boundary conditions

---

### REQ-012: SOP-2 車禍與路障應變觸發條件

| Field | Value |
|-------|-------|
| requirement_id | REQ-012 |
| title | SOP-2 觸發條件 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 2 條 |

**Requirement Statement**:
觸發條件：事件同時符合三項：
(1) status 屬於 {Closed, Blocked, Restricted}
(2) severity 屬於 {High, Critical}
(3) affected_segment 以 RD_ 開頭

**EARS Acceptance Criteria**:
```
WHEN event.status IN {Closed, Blocked, Restricted}
  AND event.severity IN {High, Critical}
  AND event.affected_segment STARTS WITH "RD_"
THEN system SHALL trigger SOP-2
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 2 條

**Open Question Dependencies**: None

**Verification Method**: SOP-2 triggered only when all three conditions are met (AND logic)

---

### REQ-013: SOP-2 主疏散路徑選擇

| Field | Value |
|-------|-------|
| requirement_id | REQ-013 |
| title | SOP-2 主疏散路徑選擇 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 2 條 |

**Requirement Statement**:
主疏散路徑：從事故路段的 alternatives 中，篩選同時滿足者：
(1) capacity_vph >= 1000
(2) 與事故路段直接相交 (出現在其 intersections 中)
(3) 相交路口位於事故點上游 (依 flow_direction 與 intersections 之上游至下游排序判定)
取通過篩選且 Saturation_Score 最低者為主疏散；位於下游之相交幹道僅列次要疏散。

**EARS Acceptance Criteria**:
```
WHEN SOP-2 is triggered
THEN candidate routes SHALL only come from incident road's alternatives list

WHEN evaluating candidate route
  AND capacity_vph >= 1000
  AND candidate name appears in incident road's intersections
  AND candidate intersection is upstream of incident point
THEN route SHALL be primary evacuation candidate

WHEN multiple routes pass all filters
THEN system SHALL select the route with lowest Saturation_Score as primary

WHEN candidate intersection is downstream
THEN candidate SHALL be listed as secondary evacuation only
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 2 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- Route comparison uses latest-prior as-of observations per road under the same `decision_cutoff_timestamp`.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001), OQ-004 (OPEN), OQ-006 (OPEN), OQ-007 (OPEN), OQ-008 (OPEN)

**Verification Method**: Primary route selected per SOP-2 criteria

---

### REQ-014: SOP-2 主疏散壅塞處理

| Field | Value |
|-------|-------|
| requirement_id | REQ-014 |
| title | SOP-2 主疏散壅塞處理 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 2 條 |

**Requirement Statement**:
若主疏散路段已壅塞 (Saturation_Score >= 0.85)，仍維持該路徑並啟動「長綠燈時制」，於報告註明壅塞並建議併行大眾運輸。

**EARS Acceptance Criteria**:
```
WHEN primary evacuation route has Saturation_Score >= 0.85
THEN system SHALL maintain the route
AND system SHALL initiate "長綠燈時制"
AND system SHALL note congestion in report
AND system SHALL recommend public transportation
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 2 條

**Open Question Dependencies**: OQ-008

**Verification Method**: Congested primary route maintained with green light extension

---

### REQ-015: SOP-2 CMS 官方文字格式

| Field | Value |
|-------|-------|
| requirement_id | REQ-015 |
| title | SOP-2 CMS 官方文字格式 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 2 條 |

**Requirement Statement**:
產出 CMS 文字：「<事故路段>封閉，請改道 <主疏散路段>，預計延誤 <ETE> 分鐘」

**EARS Acceptance Criteria**:
```
WHEN SOP-2 CMS message is required
THEN message SHALL follow format: "<incident_road>封閉，請改道 <primary_evacuation>，預計延誤 <ETE> 分鐘"
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 2 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- CMS output must not fabricate ETE when the calculation status is `INSUFFICIENT_COMMON_SNAPSHOT`. When ETE is unavailable, show the lower-bound `base_clearance` and a confirmation-required note.

**Open Question Dependencies**: OQ-003 (RESOLVED via HG-001)

**Verification Method**: CMS message matches exact template format

---

### REQ-016: SOP-3 捷運與接駁分流

| Field | Value |
|-------|-------|
| requirement_id | REQ-016 |
| title | SOP-3 捷運與接駁分流 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 3 條 |

**Requirement Statement**:
觸發 (任一成立)：BS_MRT_BL17 Growth_Rate > 0.30，或 User_Count > 25,000。
處置：建議北捷「過站不停」、通知公車處調度接駁專車、引導群眾步行至 BS_MRT_BL18。

**EARS Acceptance Criteria**:
```
WHEN BS_MRT_BL17 Growth_Rate > 0.30 OR User_Count > 25000
THEN system SHALL trigger SOP-3
AND system SHALL recommend MRT express skip-stop
AND system SHALL notify bus authority to dispatch shuttle buses
AND system SHALL guide crowd to walk to BS_MRT_BL18

WHEN Growth_Rate = 0.30
THEN system SHALL NOT trigger SOP-3

WHEN User_Count = 25000
THEN system SHALL NOT trigger SOP-3
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 3 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- For BS_ events, use the BL17 latest-prior observation at or before the event cutoff. For the 22:20 event, this is 22:15; the 22:30 future row is never used.
- `affected_road` is `DISPLAY_AND_CONTEXT_ONLY`: it does not trigger SOP article 2, convert a BS_ event into an RD_ event, enter the ETE set automatically, or create a mandatory local action.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001), OQ-002 (RESOLVED via HG-001)

**Verification Method**: SOP-3 triggered per OR conditions, boundary tests verified

---

### REQ-017: SOP-4 大巨蛋散場啟動

| Field | Value |
|-------|-------|
| requirement_id | REQ-017 |
| title | SOP-4 大巨蛋散場啟動 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 4 條 |

**Requirement Statement**:
觸發：BS_TPE_DOME User_Count 歷史峰值曾達 >= 30,000，且當前 Growth_Rate <= -0.20。
處置：標記「散場啟動」，並提前連動第 3 條接駁機制。

**EARS Acceptance Criteria**:
```
WHEN BS_TPE_DOME historical peak >= 30000
  AND BS_TPE_DOME current Growth_Rate <= -0.20
THEN system SHALL mark "散場啟動"
AND system SHALL proactively trigger SOP-3 shuttle mechanism
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 4 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The SOP-4 historical peak is computed only from records at or before the same `decision_cutoff_timestamp`; future records are never used.

**Open Question Dependencies**: OQ-001 (RESOLVED via HG-001)

**Verification Method**: Both conditions must be met (AND logic)

---

### REQ-018: SOP-5 號誌故障應變

| Field | Value |
|-------|-------|
| requirement_id | REQ-018 |
| title | SOP-5 號誌故障應變 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 5 條 |

**Requirement Statement**:
觸發：事件 type = "Power_Failure"，或描述含「號誌失效 / 故障」。
處置：產出人工指揮派遣建議 (受影響路段、警力人數每路口 2 人、估計持續時間)；
CMS 加註「<路段> 號誌故障，請依現場指揮通行」。

**EARS Acceptance Criteria**:
```
WHEN event.type = "Power_Failure"
THEN system SHALL trigger SOP-5

WHEN event.description CONTAINS "號誌失效"
OR event.description CONTAINS "故障"
THEN system SHALL trigger SOP-5

WHEN SOP-5 is triggered
THEN system SHALL recommend 2 police officers
    per confirmed affected intersection
AND system SHALL include estimated duration in report
AND system SHALL produce CMS message: "<road> 號誌故障，請依現場指揮通行"
```

**Clarification**:
- Affected intersection scope is subject to OQ-010.
- Before OQ-010 is resolved, total police force SHALL NOT be directly derived.
- Affected segment's intersections are NOT assumed to be all affected intersections.

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 5 條

**Open Question Dependencies**: OQ-010, OQ-011

**Verification Method**: SOP-5 triggered per OR conditions, CMS message matches template

---

### REQ-019: SOP-6 數位通報與多語化

| Field | Value |
|-------|-------|
| requirement_id | REQ-019 |
| title | SOP-6 數位通報與多語化 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 6 條 |

**Requirement Statement**:
觸發：任一基地台 Roaming_User_Pct >= 30%。
處置：該區域之簡訊與看板訊息須同時含多國語言，並於同一回應產出。
時間格式統一為 YYYY-MM-DD HH:MM。

**EARS Acceptance Criteria**:
```
WHEN ANY base station Roaming_User_Pct >= 30%
THEN system SHALL produce SMS and signboard messages in multiple languages
AND system SHALL produce all languages in the same response

WHEN Roaming_User_Pct = 29.99%
THEN system SHALL NOT trigger multilingual

WHEN Roaming_User_Pct = 30%
THEN system SHALL trigger multilingual

WHEN displaying timestamps
THEN format SHALL be YYYY-MM-DD HH:MM
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 6 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The current-state time dimension uses the same `decision_cutoff_timestamp`, with latest-prior `Roaming_User_Pct` per station.
- The station-set scope represented by “any base station” remains configurable and unresolved by HG-001.

**Open Question Dependencies**: OQ-005 (PARTIALLY RESOLVED via HG-001 — time cutoff resolved; station scope still OPEN)

**Verification Method**: Multilingual message produced, boundary test verified

---

### REQ-020: SOP-7 ETE 公式完整定義

| Field | Value |
|-------|-------|
| requirement_id | REQ-020 |
| title | SOP-7 ETE 公式 |
| authority | OFFICIAL_SOP |
| source | emergency_traffic_sop.txt 第 7 條 |

**Requirement Statement**:
ETE_minutes = base_clearance + congestion_penalty
- base_clearance：Critical = 60、High = 40、Medium = 20 (分鐘)
- congestion_penalty = (受影響路段平均 Saturation_Score - 0.5) * 60，小於 0 以 0 計
報告須註明 ETE 數值與計算依據

**EARS Acceptance Criteria**:
```
WHEN ETE calculation is required
THEN ETE_minutes = base_clearance + congestion_penalty
WHERE base_clearance = 60 IF severity = Critical
                   = 40 IF severity = High
                   = 20 IF severity = Medium
AND congestion_penalty = max(0, (avg_saturation - 0.5) * 60)
AND report SHALL include ETE value and calculation basis
```

**Source Tag**: OFFICIAL_SOP / emergency_traffic_sop.txt / 第 7 條

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The ETE road set is the incident road plus the selected primary route and selected secondary routes.
- ETE uses one common exact timestamp across the full road set. Partial-set averaging is prohibited.
- If a common snapshot is unavailable, the report discloses the insufficient-data status, `ete_lower_bound_minutes = base_clearance`, `congestion_penalty = null`, and `manual_confirmation_required = true`.
- A BS-event contextual `affected_road` is never included in the ETE set.

**Open Question Dependencies**: OQ-003 (RESOLVED via HG-001)

**Verification Method**: ETE formula correctly implemented, report includes all required information

---

### REQ-021: 交控中心建議書內容

| Field | Value |
|-------|-------|
| requirement_id | REQ-021 |
| title | 交控中心建議書內容 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 報告內容方向 |

**Requirement Statement**:
交控中心建議書 — 應涵蓋內容：
- 事件辨識：列出觸發事件 (event_id 或事件描述) 及對應之 SOP 條款編號
- 交通分級判定：說明該事件被判定為 A 級 / B 級 / 其他之依據
- 替代路徑建議：明確列出主要疏散路徑、次要替代，並說明排除其他候選路段之理由
- 號誌調整建議：列出受影響路段之配時調整 (例：仁愛路四段綠燈 +25%) 與調整時段
- 跨系統聯動：若觸發第 3 條 (人流) 或第 5 條 (號誌故障)，須一併列出對北捷、公車處、警力之請求

**EARS Acceptance Criteria**:
```
WHEN control center report is required
THEN report SHALL include event identification with SOP clause references
AND report SHALL include traffic classification basis
AND report SHALL include alternative route recommendations with exclusion reasons
AND report SHALL include signal timing adjustment recommendations
AND report SHALL include cross-system coordination requests when applicable
AND report SHALL include ETE value and calculation basis when ETE is applicable
```

**Source Tag**: OFFICIAL_DOC / DOCX / 報告內容方向

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- The command-center report discloses the event timestamp, decision cutoff, each material input's observation timestamp, ETE common timestamp, ETE road set, per-road saturation values, formula inputs, ETE result, policy mode, and `guidance_id = HG-001`.
- When ETE is `INSUFFICIENT_COMMON_SNAPSHOT`, the report states the lower bound, missing-common-snapshot condition, and `manual_confirmation_required` status.

**Open Question Dependencies**: OQ-003 (RESOLVED via HG-001), OQ-010 (OPEN), OQ-011 (OPEN)

**Verification Method**: Report contains all required sections

---

### REQ-022: 多語化民眾簡訊內容

| Field | Value |
|-------|-------|
| requirement_id | REQ-022 |
| title | 多語化民眾簡訊內容 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 報告內容方向 |

**Requirement Statement**:
多語化民眾簡訊 — 應涵蓋內容：
- 觸發判定：說明本次是否觸發 SOP 第 6 條 (任一基地台 Roaming >= 30%)
- 訊息要點：事故位置、改道指引、預計延誤時間、求援或避開提醒
- 可讀性：訊息長度適合 CMS 電子看板與手機簡訊呈現

**EARS Acceptance Criteria**:
```
WHEN public SMS is required
THEN system SHALL indicate if SOP-6 is triggered
AND message SHALL include incident location
AND message SHALL include reroute guidance
AND message SHALL include estimated delay
AND message SHALL include emergency-help or avoidance reminder
AND message SHALL be suitable for CMS and SMS display
```

**Source Tag**: OFFICIAL_DOC / DOCX / 報告內容方向

**HG-001 Implementation Interpretation** (ORGANIZER_GUIDANCE, NON_UNIQUE):
- Public messages use a deterministic ETE only when the ETE calculation is available. When unavailable, the CMS shows the lower-bound `base_clearance` and a confirmation-required note.
- HG-001 resolves the time dimension of OQ-005; the station-set scope remains configurable.

**Open Question Dependencies**: OQ-003 (RESOLVED via HG-001), OQ-005 (PARTIALLY RESOLVED via HG-001)

**Verification Method**: SMS contains all required elements

---

### REQ-023: 提案簡報 AWS 架構圖

| Field | Value |
|-------|-------|
| requirement_id | REQ-023 |
| title | 提案簡報 AWS 架構圖 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |

**Requirement Statement**:
提案簡報需涵蓋解題方向、AI 技術應用、數據資料應用、使用者流程、AWS 架構圖。

**EARS Acceptance Criteria**:
```
WHEN proposal presentation is submitted
THEN presentation SHALL include solution approach
AND presentation SHALL include AI technology applications
AND presentation SHALL include data utilization
AND presentation SHALL include user flow
AND presentation SHALL include AWS architecture diagram
```

**Source Tag**: OFFICIAL_DOC / PDF

**Open Question Dependencies**: None

**Verification Method**: Presentation includes AWS architecture diagram

---

### REQ-024: Dashboard 部署網址

| Field | Value |
|-------|-------|
| requirement_id | REQ-024 |
| title | Dashboard 部署網址 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |

**Requirement Statement**:
提供可存取的部署網址。

**EARS Acceptance Criteria**:
```
WHEN contest submission is made
THEN system SHALL provide accessible deployment URL
```

**Source Tag**: OFFICIAL_DOC / PDF

**Open Question Dependencies**: None

**Verification Method**: Accessible URL provided

---

### REQ-025: GitHub 完整原始碼

| Field | Value |
|-------|-------|
| requirement_id | REQ-025 |
| title | GitHub 完整原始碼 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |

**Requirement Statement**:
提供 GitHub 完整原始碼。

**EARS Acceptance Criteria**:
```
WHEN contest submission is made
THEN team SHALL provide GitHub link with complete source code
```

**Source Tag**: OFFICIAL_DOC / PDF

**Open Question Dependencies**: None

**Verification Method**: GitHub repository link provided

---

### REQ-026: 替代路徑單向性

| Field | Value |
|-------|-------|
| requirement_id | REQ-026 |
| title | 替代路徑單向性 |
| authority | OFFICIAL_DOC + OFFICIAL_DATA |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 資料欄位說明 |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | road_network_geometry.json |

**Requirement Statement**:
alternatives：事故時建議的分流方向，為單向建議；不可假設對稱 (A 列出 B，不代表 B 會列出 A)，亦不可據此做對稱性圖搜索。

**EARS Acceptance Criteria**:
```
WHEN A lists B in alternatives
THEN system SHALL NOT assume B lists A
AND system SHALL NOT perform symmetric graph search
```

**Source Tag**: OFFICIAL_DOC + OFFICIAL_DATA / DOCX 資料欄位說明 / road_network_geometry.json

**Open Question Dependencies**: None

**Verification Method**: Routing algorithm respects directional alternatives

---

### REQ-027: nearby_stations 空陣列為正常

| Field | Value |
|-------|-------|
| requirement_id | REQ-027 |
| title | nearby_stations 空陣列為正常 |
| authority | OFFICIAL_DOC + OFFICIAL_DATA |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 資料欄位說明 |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | road_network_geometry.json |

**Requirement Statement**:
空陣列為正常 (周邊無收錄基地台)，非缺漏，不可自行補填。

**EARS Acceptance Criteria**:
```
WHEN nearby_stations is empty array
THEN system SHALL treat as normal (no nearby recorded stations)
AND system SHALL NOT fill with additional stations
```

**Source Tag**: OFFICIAL_DOC + OFFICIAL_DATA / DOCX 資料欄位說明 / road_network_geometry.json

**Open Question Dependencies**: None

**Verification Method**: Empty nearby_stations not treated as missing data

---

### REQ-028: intersections 上游下游排序

| Field | Value |
|-------|-------|
| requirement_id | REQ-028 |
| title | intersections 上游下游排序 |
| authority | OFFICIAL_DOC + OFFICIAL_DATA |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 資料欄位說明 |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | road_network_geometry.json |

**Requirement Statement**:
intersections：與該路段相交之路段 (以路段全名表示，與 name 欄位一致)，已按車流「上游 → 下游」排序

**EARS Acceptance Criteria**:
```
WHEN determining upstream/downstream
THEN system SHALL use intersections order (first = most upstream)
```

**Source Tag**: OFFICIAL_DOC + OFFICIAL_DATA / DOCX 資料欄位說明 / road_network_geometry.json

**Open Question Dependencies**: OQ-004, OQ-006

**Verification Method**: Upstream/downstream determined by intersections array order

---

### REQ-029: 錄製展示影片

| Field | Value |
|-------|-------|
| requirement_id | REQ-029 |
| title | 錄製展示影片 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |

**Requirement Statement**:
錄製展示影片。

**EARS Acceptance Criteria**:
```
WHEN contest submission is made
THEN team SHALL provide recorded demonstration video
```

**Source Tag**: OFFICIAL_DOC / PDF

**Open Question Dependencies**: None

**Verification Method**: Video recording provided

---

### REQ-030: Dashboard 外觀直觀性與設計性

| Field | Value |
|-------|-------|
| requirement_id | REQ-030 |
| title | Dashboard 外觀直觀性與設計性 (加分) |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 加分項目 |

**Requirement Statement**:
Dashboard 外觀設計具直觀性與設計性。

**EARS Acceptance Criteria**:
```
WHEN dashboard is designed
THEN design SHALL prioritize intuitiveness
AND design SHALL demonstrate visual design quality
```

**Source Tag**: OFFICIAL_DOC / DOCX / 加分項目

**Open Question Dependencies**: None

**Verification Method**: Dashboard demonstrates intuitive and well-designed UI

---

### REQ-031: 多語化通報支援中英以外語言 (加分)

| Field | Value |
|-------|-------|
| requirement_id | REQ-031 |
| title | 多語化通報支援日韓等語言 (加分) |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx / 加分項目 |

**Requirement Statement**:
多語化通報支援中、英以外語言 (如日文、韓文)。

**EARS Acceptance Criteria**:
```
WHEN multilingual alert is triggered
THEN system SHOULD support languages beyond Chinese and English
AND system SHOULD include Japanese and Korean when applicable
```

**Source Tag**: OFFICIAL_DOC / DOCX / 加分項目

**Open Question Dependencies**: None

**Verification Method**: System supports Japanese, Korean, or other non-Chinese/English languages

---

### REQ-032: 官方交付完整性

| Field | Value |
|-------|-------|
| requirement_id | REQ-032 |
| title | 官方交付完整性 |
| authority | OFFICIAL_DOC |
| source | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |

**Requirement Statement**:
完整官方交付包含：
1. 提案簡報 (含 AWS 架構圖)
2. Dashboard Live Demo (含部署網址與錄製影片)
3. GitHub 完整原始碼

**EARS Acceptance Criteria**:
```
WHEN contest submission is complete
THEN all three official deliverables SHALL be provided
AND AWS architecture diagram SHALL be included
AND accessible deployment URL SHALL be provided
AND recorded demonstration video SHALL be provided
AND GitHub repository link SHALL be provided
```

**Source Tag**: OFFICIAL_DOC / PDF

**Open Question Dependencies**: None

**Verification Method**: All three official deliverables submitted

---

## 6. Derived Boundary Test Matrix

| classification | DERIVED_FOR_TESTABILITY |
|---------------|------------------------|
| authority | 不新增業務規則，只將官方不等式轉為明確測試 |

### 6.1 Saturation Score Boundaries

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| TC-SAT-001 | Saturation_Score = 0.8499 | NOT B 級 |
| TC-SAT-002 | Saturation_Score = 0.85 | B 級 |
| TC-SAT-003 | Saturation_Score = 0.9499 | B 級 |
| TC-SAT-004 | Saturation_Score = 0.95 | A 級 |

### 6.2 SOP-3 Trigger Boundaries

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| TC-SOP3-001 | User_Count = 25000 | NOT triggered by User_Count condition |
| TC-SOP3-002 | User_Count = 25001 | Triggers SOP-3 |
| TC-SOP3-003 | Growth_Rate = 0.30 | NOT triggered by Growth_Rate condition |
| TC-SOP3-004 | Growth_Rate = 0.3001 | Triggers SOP-3 |

### 6.3 SOP-6 Trigger Boundaries

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| TC-SOP6-001 | Roaming_User_Pct = 29.99% | NOT triggers SOP-6 |
| TC-SOP6-002 | Roaming_User_Pct = 30% | Triggers SOP-6 |

### 6.4 SOP-2 Capacity Boundaries

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| TC-SOP2-001 | capacity_vph = 999 | Does NOT satisfy SOP-2 capacity condition |
| TC-SOP2-002 | capacity_vph = 1000 | Satisfies SOP-2 capacity condition |

---

## 7. Out of Scope

The following are explicitly OUT OF SCOPE for the Requirements phase:

1. 不指定具體 AWS 服務 (Lambda、DynamoDB、Bedrock、Step Functions 等)
2. 不建立產品程式碼 (src、frontend、backend 目錄)
3. 不建立 AWS 資源或 IaC
4. 不使用外部網路搜尋資料
5. 不產生 design.md 或 tasks.md

AWS 為官方指定的正式競賽 Runtime/Deployment 必要條件，須提供 AWS 架構圖。具體 AWS 服務選型留至 Technical Design 階段。

---

## 8. Summary

| REQ Count | Description |
|-----------|-------------|
| REQ-001 to REQ-010 | 系統功能需求 (Dashboard, 事件注入, What-if, ETE, 多語) |
| REQ-011 | SOP-1 交通擁塞級別判定 |
| REQ-012 to REQ-015 | SOP-2 車禍與路障應變 |
| REQ-016 | SOP-3 捷運與接駁分流 |
| REQ-017 | SOP-4 大巨蛋散場啟動 |
| REQ-018 | SOP-5 號誌故障應變 |
| REQ-019 | SOP-6 數位通報與多語化 |
| REQ-020 | SOP-7 ETE 公式 |
| REQ-021 to REQ-022 | 報告內容需求 |
| REQ-023 to REQ-025, REQ-029 | 交付物需求 |
| REQ-026 to REQ-028 | 資料欄位定義 |
| REQ-030 to REQ-031 | 加分項目 |
| REQ-032 | 交付完整性 |

**Total Requirements**: 32

---

**Document Version**: 2.2 (HG-001 AMENDMENT CANDIDATE)
**Created**: 2026-07-20
**Source Authority**: OFFICIAL_DOC + OFFICIAL_DATA + OFFICIAL_SOP + ORGANIZER_GUIDANCE
