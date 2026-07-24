# CHT 城市應變分析 AI Agent - Data Audit Report

**Document Version**: 2.1 (HG-001 AMENDMENT ADDENDUM)
**Created**: 2026-07-20
**Amended**: 2026-07-24 (HG-001)
**Source Authority**: OFFICIAL_DOC + OFFICIAL_DATA + OFFICIAL_SOP + ORGANIZER_GUIDANCE
**Derivation Note**: docx_extracted.txt is a DERIVED_SEARCHABLE_MIRROR only; NOT_SOURCE_OF_TRUTH

---

## 1. Official Source File Inventory

### 1.1 Seven Official Source Files

| # | File Name | SHA-256 | Size (bytes) | Parsing Status |
|---|-----------|---------|--------------|----------------|
| 1 | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf | 706B44C94313AAE751434E29EE3CFF6BE1351DAA76077933C5D6DBE5171C15D7 | 381,329 | Parseable |
| 2 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx | 0BC38CA8B655308F0DB36E3CF02FAC1289E9509AD61C59C9673CF5A7505FF065 | 25,736 | Extractable |
| 3 | city_traffic_flow.csv | B31436B5280B95325DA7715E7F1D3059AE343CF6E69FB2C063A9C95A541D5F2A | 7,273 | Parseable |
| 4 | signaling_crowd_density.csv | BD9BC159083A6304C68FEF2DFC52E1C23251523882F9953A10928C26E9564073 | 2,491 | Parseable |
| 5 | road_network_geometry.json | 741D253538AAF2BB25C60DEC9D4A8E8DEFECC27112FA09C7A9F1512ADB286B18 | 4,422 | Parseable |
| 6 | emergency_traffic_sop.txt | 0C84F2F6F30E2EC18F56E9675AA1C1C6062EBEFAF14920D8CCAC732D41BCAF1D | 3,697 | Parseable |
| 7 | live_incidents.json | E90C8AE46AFD02A76C233F39CB0628254BE53555B9E48067C4EA3A48E41C0A63 | 1,194 | Parseable |

### 1.2 Derived File (NOT_SOURCE_OF_TRUTH)

| File Name | SHA-256 | Size (bytes) | Classification |
|-----------|---------|--------------|----------------|
| docx_extracted.txt | 85A185EDC63DD35C9A0CC8320C7FF0A1F87886FEF4E23FBF63A46EA8C8AB448F | 5,562 | DERIVED_SEARCHABLE_MIRROR |

**Derivation Note**: docx_extracted.txt was extracted from DOCX file #2. It is used for search purposes only. All source traceability must reference DOCX as the authoritative source.

---

## 2. CSV Parsing Results

### 2.1 city_traffic_flow.csv

| Metric | Value | Verified |
|--------|-------|----------|
| physical_line_count_including_header | 113 | YES |
| header_count | 1 | YES |
| data_record_count | 112 | YES |
| column_count | 7 | YES |
| unique_segment_count | 15 | YES |
| unique_timestamp_count | 15 | YES |
| minimum_timestamp | 2026-05-20 17:00 | YES |
| maximum_timestamp | 2026-05-20 23:15 | YES |
| has_timestamp_22:10 | TRUE | YES |
| 22:10_record_count | 1 | YES |

**Column Names**: Timestamp, Segment_ID, Road_Name, Avg_Speed, Vehicle_Count, Saturation_Score, Lane_Status

**Complete Unique Timestamp List (15 timestamps)**:
- 2026-05-20 17:00
- 2026-05-20 18:00
- 2026-05-20 19:00
- 2026-05-20 20:00
- 2026-05-20 21:00
- 2026-05-20 21:15
- 2026-05-20 21:30
- 2026-05-20 21:45
- 2026-05-20 22:00
- 2026-05-20 22:10
- 2026-05-20 22:15
- 2026-05-20 22:30
- 2026-05-20 22:45
- 2026-05-20 23:00
- 2026-05-20 23:15

**22:10 Specific Data**:
- RD_TPE_002, 光復南路, Saturation_Score = 1, Lane_Status = Accident_Impact
- Other candidate roads do NOT have 22:10 records (only RD_TPE_002 has a record at this timestamp)

### 2.2 signaling_crowd_density.csv

| Metric | Value | Verified |
|--------|-------|----------|
| physical_line_count_including_header | 37 | YES |
| header_count | 1 | YES |
| data_record_count | 36 | YES |
| column_count | 7 | YES |
| unique_bs_count | 9 | YES |
| unique_timestamp_count | 18 | YES |
| minimum_timestamp | 2026-05-20 17:00 | YES |
| maximum_timestamp | 2026-05-20 23:30 | YES |
| has_timestamp_23:15 | TRUE | YES |

**Column Names**: Timestamp, BS_ID, Location_Name, User_Count, Stay_Time_Avg, Growth_Rate, Roaming_User_Pct

**Complete Unique Timestamp List (18 timestamps)**:
- 2026-05-20 17:00
- 2026-05-20 17:30
- 2026-05-20 18:00
- 2026-05-20 18:30
- 2026-05-20 19:00
- 2026-05-20 19:30
- 2026-05-20 20:00
- 2026-05-20 21:00
- 2026-05-20 21:15
- 2026-05-20 21:30
- 2026-05-20 21:45
- 2026-05-20 22:00
- 2026-05-20 22:15
- 2026-05-20 22:30
- 2026-05-20 22:45
- 2026-05-20 23:00
- 2026-05-20 23:15
- 2026-05-20 23:30

**BS_MRT_BL17 Near Event 2 Timestamp (22:20)**:
- BS_MRT_BL17 has NO exact 22:20 row
- Nearest data:
  - 22:15: User_Count=31000, Growth_Rate=0.08, Roaming_User_Pct=16%
  - 22:30: User_Count=33000, Growth_Rate=0.06, Roaming_User_Pct=12%

---

## 3. JSON Parsing Results

### 3.1 road_network_geometry.json

| Metric | Value | Verified |
|--------|-------|----------|
| total_segments | 15 | YES |
| unique_segment_ids | 15 | YES |
| segment_id_prefix | RD_TPE_001 to RD_TPE_015 | YES |

**Segment List**:
- RD_TPE_001: 忠孝東路四段
- RD_TPE_002: 光復南路
- RD_TPE_003: 基隆路一段
- RD_TPE_004: 市民大道四段
- RD_TPE_005: 仁愛路四段
- RD_TPE_006: 敦化南路一段
- RD_TPE_007: 松高路
- RD_TPE_008: 延吉街
- RD_TPE_009: 基隆路地下道
- RD_TPE_010: 市府路
- RD_TPE_011: 松壽路
- RD_TPE_012: 敦化南路二段
- RD_TPE_013: 信義路五段
- RD_TPE_014: 松智路
- RD_TPE_015: 復興南路一段

### 3.2 live_incidents.json

| Metric | Value | Verified |
|--------|-------|----------|
| total_events | 3 | YES |
| event_ids | TPE_2026_ACC_001, TPE_2026_EVT_002, TPE_2026_EVT_003 | YES |

---

## 4. Cross-Reference Validity

### 4.1 CSV Segment Reference (city_traffic_flow.csv -> road_network_geometry.json)

| Segment_ID | In CSV | In JSON | Valid |
|------------|--------|---------|-------|
| RD_TPE_001 | YES | YES | VALID |
| RD_TPE_002 | YES | YES | VALID |
| RD_TPE_003 | YES | YES | VALID |
| RD_TPE_004 | YES | YES | VALID |
| RD_TPE_005 | YES | YES | VALID |
| RD_TPE_006 | YES | YES | VALID |
| RD_TPE_007 | YES | YES | VALID |
| RD_TPE_008 | YES | YES | VALID |
| RD_TPE_009 | YES | YES | VALID |
| RD_TPE_010 | YES | YES | VALID |
| RD_TPE_011 | YES | YES | VALID |
| RD_TPE_012 | YES | YES | VALID |
| RD_TPE_013 | YES | YES | VALID |
| RD_TPE_014 | YES | YES | VALID |
| RD_TPE_015 | YES | YES | VALID |

**Result**: ALL 15 segments cross-referenced VALID

### 4.2 Alternatives Reference (road_network_geometry.json)

All segment IDs referenced in alternatives arrays exist in the road_network_geometry.json segment list.

| Segment | Alternatives | All Valid |
|---------|--------------|-----------|
| RD_TPE_001 | RD_TPE_004, RD_TPE_005, RD_TPE_007 | VALID |
| RD_TPE_002 | RD_TPE_004, RD_TPE_005, RD_TPE_006, RD_TPE_008 | VALID |
| RD_TPE_003 | RD_TPE_006, RD_TPE_009 | VALID |
| RD_TPE_004 | RD_TPE_001, RD_TPE_006 | VALID |
| RD_TPE_005 | RD_TPE_001, RD_TPE_010 | VALID |
| RD_TPE_006 | RD_TPE_002, RD_TPE_004, RD_TPE_008 | VALID |
| RD_TPE_007 | RD_TPE_011 | VALID |
| RD_TPE_008 | RD_TPE_002 | VALID |
| RD_TPE_009 | RD_TPE_003 | VALID |
| RD_TPE_010 | RD_TPE_003, RD_TPE_011 | VALID |
| RD_TPE_011 | RD_TPE_007, RD_TPE_010 | VALID |
| RD_TPE_012 | RD_TPE_006 | VALID |
| RD_TPE_013 | RD_TPE_005 | VALID |
| RD_TPE_014 | RD_TPE_010 | VALID |
| RD_TPE_015 | RD_TPE_006 | VALID |

**Result**: ALL alternatives references VALID

### 4.3 Base Station Cross-Reference (signaling_crowd_density.csv -> road_network_geometry.json)

| BS_ID | In CSV | In JSON nearby_stations | Valid |
|-------|--------|-------------------------|-------|
| BS_TPE_DOME | YES | YES | VALID |
| BS_MRT_BL17 | YES | YES | VALID |
| BS_MRT_BL16 | YES | YES | VALID |
| BS_MRT_BL18 | YES | YES | VALID |
| BS_BUS_TERM | YES | YES | VALID |
| BS_XY_VIESHOW | YES | YES | VALID |
| BS_XY_ATT | YES | YES | VALID |
| BS_SS_PARK | YES | YES | VALID |
| BS_TPE_101 | YES | YES | VALID |

**Result**: ALL 9 base stations VALID

### 4. Event Cross-Reference (live_incidents.json)

#### A. Road affected_segment validation

| Event | affected_segment | In Road Segment IDs | Valid |
|-------|-----------------|-------------------|-------|
| TPE_2026_ACC_001 | RD_TPE_002 | YES | VALID |
| TPE_2026_EVT_003 | RD_TPE_007 | YES | VALID |

#### B. Base-station affected_segment validation

| Event | affected_segment | In Signaling CSV BS_ID | In nearby_stations | Valid |
|-------|-----------------|--------------------|-------------------|-------|
| TPE_2026_EVT_002 | BS_MRT_BL17 | YES | YES | VALID |

#### C. affected_road validation

| Event | affected_road | In Road Segment IDs | Valid |
|-------|--------------|-------------------|-------|
| TPE_2026_EVT_002 | RD_TPE_001 | YES | VALID |

**Result**: ALL event cross-references VALID

**Note**: BS_MRT_BL17 is a base station ID (BS_ prefix), not a road segment ID (RD_ prefix). BS_MRT_BL17 exists in signaling_crowd_density.csv BS_ID list and road_network_geometry.json nearby_stations arrays.

---

## 5. Intersections Order Validation

Per DOCX specification: intersections are sorted from upstream to downstream.

### RD_TPE_001 (忠孝東路四段)
```
["延吉街", "光復南路", "基隆路一段"]
Upstream ────────────────────────────────────────> Downstream
```
**Status**: VALID

### RD_TPE_011 (松壽路)
```
["基隆路一段", "市府路", "松智路"]
Upstream ────────────────────────────────────────> Downstream
```
**Status**: VALID

### RD_TPE_013 (信義路五段)
```
["基隆路一段", "市府路", "松智路"]
Upstream ────────────────────────────────────────> Downstream
```
**Status**: VALID

---

## 6. Event Timestamp Alignment

### Event 1 (TPE_2026_ACC_001)
- Event timestamp: 2026-05-20 22:10
- city_traffic_flow.csv has EXACT 22:10 record: YES
- 22:10 record count: 1 (RD_TPE_002 only)
- RD_TPE_002 Saturation_Score at 22:10: 1.00
- RD_TPE_002 Lane_Status at 22:10: Accident_Impact
- Note: Other candidate roads do NOT have 22:10 records

### Event 2 (TPE_2026_EVT_002)
- Event timestamp: 2026-05-20 22:20
- signaling_crowd_density.csv has EXACT 22:20 record: NO
- BS_MRT_BL17 nearest data:
  - 22:15: User_Count=31000, Growth_Rate=0.08, Roaming_User_Pct=16%
  - 22:30: User_Count=33000, Growth_Rate=0.06, Roaming_User_Pct=12%

### Event 3 (TPE_2026_EVT_003)
- Event timestamp: 2026-05-20 22:30
- Both city and crowd CSV have 22:30 records: YES
- Note: Definition of which roads and stations to use is NOT_DEFINED

---

## 7. Data Facts Classification

### 7.1 DATA_FACT Classification (Not Errors)

| Observation | Classification | Official Definition |
|-------------|----------------|---------------------|
| Event 1: 22:10 exact row for RD_TPE_002 only | DATA_FACT | See Event Timestamp table in Section 6 |
| RD_TPE_009 intersections include "正氣橋" (not in 15-segment name list) | DATA_FACT + OQ-006 | DOCX says intersections should match segment names; label has no corresponding segment_id; listed in OQ-006; not described as data error or road history speculation |
| Several segments have empty nearby_stations arrays | DATA_FACT | Per DOCX: "空陣列為正常 (周邊無收錄基地台)，非缺漏，不可自行補填" |
| alternatives is directional (A->B does not imply B->A) | DATA_FACT | Per DOCX: "alternatives：事故時建議的分流方向，為單向建議；不可假設對稱" |
| Roaming_User_Pct stored as percentage strings ("5%", "8%") | DATA_FACT | Not a data defect; values are valid |
| Event 2 has both affected_segment and affected_road | DATA_FACT + OQ-002 | Purpose of affected_road is NOT_DEFINED in official sources |
| Timestamp format uses slash (2026/5/20) vs dash (2026-05-20) | DATA_FACT | Both formats equivalent after normalization |

### 7.2 OPEN_QUESTION Classification

See open_questions.md for the complete list of 11 open questions.

---

## 8. Summary

| Audit Item | Result |
|------------|--------|
| All 7 official files parseable | PASS |
| SHA-256 computed for all files | PASS |
| city_traffic_flow.csv data_record_count = 112 | PASS |
| city_traffic_flow.csv unique_timestamp_count = 15 | PASS |
| city_traffic_flow.csv has 22:10 | PASS |
| city_traffic_flow.csv 22:10_record_count = 1 | PASS |
| signaling_crowd_density.csv data_record_count = 36 | PASS |
| signaling_crowd_density.csv unique_timestamp_count = 18 | PASS |
| signaling_crowd_density.csv has 23:15 | PASS |
| 15 unique segment IDs | PASS |
| All alternatives references valid | PASS |
| All base stations valid | PASS |
| All event affected identifiers valid | PASS |
| RD_TPE_001 intersections order correct | PASS |
| RD_TPE_011 intersections order correct | PASS |
| RD_TPE_013 intersections order correct | PASS |
| Event 1 has 22:10 exact row (RD_TPE_002 only) | PASS |
| Event 2 has NO 22:20 exact row for BS_MRT_BL17 | PASS |
| Event 3 has 22:30 records in both CSVs | PASS |

**Overall**: ALL AUDIT ITEMS PASSED

## 9. HG-001 Organizer Guidance Impact

> This section records the impact of organizer guidance HG-001 on data observations. The original verified data facts in §1–§8 are preserved unchanged. No official source file was modified, and no official source hash changed.

### 9.1 Data Observation Status

**ACC_001（22:10，RD_TPE_002）**

- The official `city_traffic_flow.csv` contains an exact 22:10 record only for RD_TPE_002, with `Saturation_Score = 1.00`.
- Other relevant roads may require earlier observations under the as-of decision cutoff.
- HG-001 permits the latest observation at or before the event cutoff. Future rows and interpolation are not used.
- For the ETE road average, the amended policy requires one common exact timestamp across the final ETE road set.

**EVT_002（BS_MRT_BL17，event timestamp 22:20）**

- The latest BL17 observation at or before 22:20 is 22:15: `User_Count = 31000`, `Growth_Rate = 0.08`, `Roaming_User_Pct = 16%`.
- The 22:30 record is after the event and is not used.
- `affected_road = RD_TPE_001` is contextual information under `DISPLAY_AND_CONTEXT_ONLY`.

**EVT_003（signal outage event，event timestamp 22:30）**

- The event is evaluated under the same as-of cutoff rules.
- SOP article 5 trigger semantics remain unchanged.

### 9.2 Compliance with HG-001

- Sparse observations remain valid data facts and are not labeled data defects.
- No interpolation and no future-row reads.
- No fabricated road, ETE, or Golden Scenario answer.
- `ORGANIZER_GUIDANCE` is interpretive implementation guidance, not an official source-file correction.
- The seven official source-file hashes remain unchanged.

### 9.3 Golden Recalculation Audit

| Event | Field | Pre-HG-001 value | HG-001 value | Evidence |
|-------|-------|------------------|--------------|----------|
| ACC_001 | ETE_minutes | 90（provisional） | **78.6** | Common ETE timestamp 22:00; RD_TPE_002=1.00, RD_TPE_004=0.78, RD_TPE_005=0.65; average=0.81; Critical base=60; penalty=18.6 |
| ACC_001 | policy_mode | provisional walkthrough | `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY` | HG-001 |
| EVT_002 | BL17 observation timestamp | unresolved | **22:15**（latest timestamp ≤ 22:20） | signaling_crowd_density.csv |
| EVT_002 | affected_road role | ambiguous | `DISPLAY_AND_CONTEXT_ONLY` | HG-001 |
| EVT_002 | article_2 trigger from affected_road | ambiguous | **not triggered** | HG-001 |
| EVT_003 | ETE_minutes | not previously computed | **41.0** | Common ETE timestamp 22:30; RD_TPE_007=0.85, RD_TPE_011=0.85; Medium base=20; penalty=21.0 |
| EVT_003 | policy_mode | not previously selected | `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY` | HG-001 |

### 9.4 Golden Calculation Details

#### ACC_001

- Event timestamp and decision cutoff: 2026-05-20 22:10.
- ETE affected set: incident RD_TPE_002, selected primary RD_TPE_004, selected secondary RD_TPE_005.
- Latest common exact traffic timestamp at or before the event: 22:00.
- Saturation sum: `1.00 + 0.78 + 0.65 = 2.43`.
- Average: `2.43 / 3 = 0.81`.
- Congestion penalty: `max(0, (0.81 - 0.5) × 60) = 18.6`.
- Base clearance for Critical: `60`.
- Final ETE: `60 + 18.6 = 78.6 minutes`.

#### EVT_002

- Event timestamp and decision cutoff: 2026-05-20 22:20.
- Selected BL17 observation: 22:15.
- `User_Count = 31000 > 25000`, so SOP article 3 triggers.
- 22:30 is a future observation and is not used.
- ETE is not applicable to this BS_ event under the selected policy.

#### EVT_003

- Event timestamp and decision cutoff: 2026-05-20 22:30.
- ETE affected set: incident RD_TPE_007 and selected primary RD_TPE_011.
- Both roads have exact 22:30 records.
- Saturation average: `(0.85 + 0.85) / 2 = 0.85`.
- Congestion penalty: `max(0, (0.85 - 0.5) × 60) = 21.0`.
- Base clearance for Medium: `20`.
- Final ETE: `20 + 21.0 = 41.0 minutes`.

### 9.5 Source Hash Integrity

| File | SHA-256（unchanged） |
|------|----------------------|
| 官方命題 PDF | 706B44C94313AAE751434E29EE3CFF6BE1351DAA76077933C5D6DBE5171C15D7 |
| 官方命題解說 DOCX | 0BC38CA8B655308F0DB36E3CF02FAC1289E9509AD61C59C9673CF5A7505FF065 |
| city_traffic_flow.csv | B31436B5280B95325DA7715E7F1D3059AE343CF6E69FB2C063A9C95A541D5F2A |
| signaling_crowd_density.csv | BD9BC159083A6304C68FEF2DFC52E1C23251523882F9953A10928C26E9564073 |
| road_network_geometry.json | 741D253538AAF2BB25C60DEC9D4A8E8DEFECC27112FA09C7A9F1512ADB286B18 |
| emergency_traffic_sop.txt | 0C84F2F6F30E2EC18F56E9675AA1C1C6062EBEFAF14920D8CCAC732D41BCAF1D |
| live_incidents.json | E90C8AE46AFD02A76C233F39CB0628254BE53555B9E48067C4EA3A48E41C0A63 |

### 9.6 HG-001 Reference

`cursor_spec/references/organizer_guidance_2026-07-24.md`

- Sender: Ivan Su, 中華電信企業客戶分公司數據產品處.
- Date: 2026-07-24.
- Classification: `ORGANIZER_GUIDANCE`（NON_UNIQUE, configurable, not a SOP amendment, and not an eighth official runtime source）.
