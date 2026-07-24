# CHT 城市應變分析 AI Agent - Source Traceability Matrix

**Document Version**: 2.1 (HG-001 AMENDMENT)
**Created**: 2026-07-20
**Amended**: 2026-07-24 (HG-001)
**Source Authority**: OFFICIAL_DOC + OFFICIAL_DATA + OFFICIAL_SOP + ORGANIZER_GUIDANCE
**Derivation Note**: docx_extracted.txt is a DERIVED_SEARCHABLE_MIRROR only; NOT_SOURCE_OF_TRUTH

---

## 1. Source Type Definitions

| Source Type | Description | Authority Level |
|-------------|-------------|----------------|
| OFFICIAL_DOC | PDF 或 DOCX 文件 | HIGH |
| OFFICIAL_DATA | CSV 或 JSON 資料檔案 | HIGH |
| OFFICIAL_SOP | emergency_traffic_sop.txt | HIGH |
| DERIVED_SEARCHABLE_MIRROR | docx_extracted.txt（從 DOCX 提取，NOT_SOURCE_OF_TRUTH） | NONE |
| ORGANIZER_GUIDANCE | 主辦單位書面實作指引；非 runtime official source、非第八份官方來源、非 SOP 修訂；NON_UNIQUE 且可配置 | HIGH_FOR_IMPLEMENTATION_INTERPRETATION |

---

## 2. Source Traceability Entries (REQ-001 to REQ-032)

### REQ-001: Dashboard 即時車流人流視覺化

| Field | Value |
|-------|-------|
| requirement_id | REQ-001 |
| title | Dashboard 即時車流人流視覺化 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 1：動態時序監測儀表板 |
| evidence | 「系統需依時間軸自動讀取並展示車流與人流數據」 |
| transformation | Direct citation |
| confidence | HIGH |
| derived_mirror_used | NO (docx_extracted.txt used only for search, DOCX is authoritative) |

---

### REQ-002: 異常自動彈窗預警

| Field | Value |
|-------|-------|
| requirement_id | REQ-002 |
| title | 異常自動彈窗預警 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 1：動態時序監測儀表板 |
| evidence | 「當數據達到 SOP 預警門檻時，Dashboard 須自動跳出分析摘要與預警提示，無需人工查詢」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-003: 事件注入介面

| Field | Value |
|-------|-------|
| requirement_id | REQ-003 |
| title | 事件注入介面 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 2：突發事件注入與處置 |
| evidence | 「提供功能讓管理員將 live_incidents.json 注入系統」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-004: 60 秒內路網重規劃

| Field | Value |
|-------|-------|
| requirement_id | REQ-004 |
| title | 60 秒內路網重規劃 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 2：突發事件注入與處置 |
| evidence | 「系統接收事故資訊後，須於 60 秒內完成路網重規劃」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-005: 避開已飽和之路段

| Field | Value |
|-------|-------|
| requirement_id | REQ-005 |
| title | 避開已飽和之路段 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 2：突發事件注入與處置 |
| evidence | 「避開容量不足或已飽和之路段」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-006: What-if 對話式問答

| Field | Value |
|-------|-------|
| requirement_id | REQ-006 |
| title | What-if 對話式問答 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 3：對話式策略諮詢顧問 |
| evidence | 「允許指揮官輸入模擬指令或假設性問題 (What-if)」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-007: SOP 邏輯驗證

| Field | Value |
|-------|-------|
| requirement_id | REQ-007 |
| title | SOP 邏輯驗證 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 3：對話式策略諮詢顧問 |
| evidence | 「AI 須能依假設條件...立即檢索 SOP，回答應觸發的條款與預期動作」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-008: 判定依據展示

| Field | Value |
|-------|-------|
| requirement_id | REQ-008 |
| title | 判定依據展示 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 模組 4：AI 決策推理與解釋鏈 |
| evidence | 「在 Dashboard 上清楚展示 AI 的推理過程，解釋為何判定為 A 級及為何排除特定替代道路」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-009: ETE 公式運算

| Field | Value |
|-------|-------|
| requirement_id | REQ-009 |
| title | ETE 公式運算 |
| source_type | OFFICIAL_DOC + OFFICIAL_SOP |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | emergency_traffic_sop.txt |
| section | 模組 4 / 第 7 條 |
| evidence_docx | 「自動解析事故嚴重度並依 SOP 公式即時計算及顯示 ETE」 |
| evidence_sop | 「ETE_minutes、base_clearance、congestion_penalty 正式公式」 |
| transformation | Split citation: DOCX describes requirement, SOP provides formal formula |
| confidence | HIGH |

---

### REQ-010: 多語化通報觸發

| Field | Value |
|-------|-------|
| requirement_id | REQ-010 |
| title | 多語化通報觸發 |
| source_type | OFFICIAL_DOC + OFFICIAL_SOP |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | emergency_traffic_sop.txt |
| section | 模組 5 / 第 6 條 |
| evidence_docx | 「當任一站點漫遊率 >= 30% 時，自動產出多語文的告警文字」 |
| evidence_sop | 「任一基地台 Roaming_User_Pct >= 30%」 |
| transformation | Combined from DOCX and SOP |
| confidence | HIGH |

---

### REQ-011: SOP-1 交通擁塞級別判定

| Field | Value |
|-------|-------|
| requirement_id | REQ-011 |
| title | SOP-1 交通擁塞級別判定 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 1 條 |
| evidence | 「分級 (適用全 15 路段)：B 級 0.85 <= Saturation_Score < 0.95；A 級 Saturation_Score >= 0.95。城市應變觸發路段：忠孝東路 (RD_TPE_001)、光復南路 (RD_TPE_002)。任一觸發路段達 B 級：通報交控中心啟動長綠燈時制，將其替代道路綠燈配時 +25%，並調度警力淨空路口。達 A 級：同步觸發替代路徑引導。」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-012: SOP-2 觸發條件

| Field | Value |
|-------|-------|
| requirement_id | REQ-012 |
| title | SOP-2 觸發條件 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 2 條 |
| evidence | 「事件同時符合三項：(1) status 屬於 {Closed, Blocked, Restricted} (2) severity 屬於 {High, Critical} (3) affected_segment 以 RD_ 開頭」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-013: SOP-2 主疏散路徑選擇

| Field | Value |
|-------|-------|
| requirement_id | REQ-013 |
| title | SOP-2 主疏散路徑選擇 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 2 條 |
| evidence | 「從事故路段的 alternatives 中，篩選同時滿足者：(1) capacity_vph >= 1000；(2) 與事故路段直接相交 (出現在其 intersections 中)；(3) 相交路口位於事故點上游。取通過篩選且 Saturation_Score 最低者為主疏散；位於下游之相交幹道僅列次要疏散。」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-014: SOP-2 主疏散壅塞處理

| Field | Value |
|-------|-------|
| requirement_id | REQ-014 |
| title | SOP-2 主疏散壅塞處理 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 2 條 |
| evidence | 「若主疏散路段已壅塞 (Saturation_Score >= 0.85)，仍維持該路徑並啟動長綠燈時制，於報告註明壅塞並建議併行大眾運輸」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-015: SOP-2 CMS 官方文字格式

| Field | Value |
|-------|-------|
| requirement_id | REQ-015 |
| title | SOP-2 CMS 官方文字格式 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 2 條 |
| evidence | 「產出 CMS 文字：<事故路段>封閉，請改道 <主疏散路段>，預計延誤 <ETE> 分鐘」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-016: SOP-3 捷運與接駁分流

| Field | Value |
|-------|-------|
| requirement_id | REQ-016 |
| title | SOP-3 捷運與接駁分流 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 3 條 |
| evidence | 「觸發 (任一成立)：BS_MRT_BL17 Growth_Rate > 0.30，或 User_Count > 25,000。處置：建議北捷過站不停、通知公車處調度接駁專車、引導群眾步行至 BS_MRT_BL18」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-017: SOP-4 大巨蛋散場啟動

| Field | Value |
|-------|-------|
| requirement_id | REQ-017 |
| title | SOP-4 大巨蛋散場啟動 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 4 條 |
| evidence | 「BS_TPE_DOME User_Count 歷史峰值曾達 >= 30,000，且當前 Growth_Rate <= -0.20。處置：標記散場啟動，並提前連動第 3 條接駁機制」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-018: SOP-5 號誌故障應變

| Field | Value |
|-------|-------|
| requirement_id | REQ-018 |
| title | SOP-5 號誌故障應變 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 5 條 |
| evidence | 「事件 type = Power_Failure，或描述含號誌失效/故障。處置：產出人工指揮派遣建議 (受影響路段、警力人數每路口 2 人、估計持續時間)；CMS 加註<路段> 號誌故障，請依現場指揮通行」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-019: SOP-6 數位通報與多語化

| Field | Value |
|-------|-------|
| requirement_id | REQ-019 |
| title | SOP-6 數位通報與多語化 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 6 條 |
| evidence | 「任一基地台 Roaming_User_Pct >= 30%。該區域之簡訊與看板訊息須同時含多國語言，並於同一回應產出。時間格式統一為 YYYY-MM-DD HH:MM」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-020: SOP-7 ETE 公式

| Field | Value |
|-------|-------|
| requirement_id | REQ-020 |
| title | SOP-7 ETE 公式 |
| source_type | OFFICIAL_SOP |
| source_file | emergency_traffic_sop.txt |
| section | 第 7 條 |
| evidence | 「ETE_minutes = base_clearance + congestion_penalty。base_clearance：Critical = 60、High = 40、Medium = 20 (分鐘)。congestion_penalty = (受影響路段平均 Saturation_Score - 0.5) * 60，小於 0 以 0 計。報告須註明 ETE 數值與計算依據」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-021: 交控中心建議書內容

| Field | Value |
|-------|-------|
| requirement_id | REQ-021 |
| title | 交控中心建議書內容 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 報告內容方向 |
| evidence | 「事件辨識、交通分級判定、替代路徑建議、號誌調整建議、跨系統聯動」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-022: 多語化民眾簡訊內容

| Field | Value |
|-------|-------|
| requirement_id | REQ-022 |
| title | 多語化民眾簡訊內容 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 報告內容方向 |
| evidence | 「觸發判定、訊息要點 (事故位置、改道指引、預計延誤時間)、可讀性」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-023: 提案簡報 AWS 架構圖

| Field | Value |
|-------|-------|
| requirement_id | REQ-023 |
| title | 提案簡報 AWS 架構圖 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |
| section | 交付內容 |
| evidence | 「提案簡報需涵蓋解題方向、AI 技術應用、數據資料應用、使用者流程、AWS 架構圖」 |
| transformation | Direct citation from PDF |
| confidence | HIGH |

---

### REQ-024: Dashboard 部署網址

| Field | Value |
|-------|-------|
| requirement_id | REQ-024 |
| title | Dashboard 部署網址 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |
| section | 交付內容 |
| evidence | 「可存取的部署網址」 |
| transformation | Direct citation from PDF |
| confidence | HIGH |

---

### REQ-025: GitHub 完整原始碼

| Field | Value |
|-------|-------|
| requirement_id | REQ-025 |
| title | GitHub 完整原始碼 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |
| section | 交付內容 |
| evidence | 「GitHub 完整原始碼」 |
| transformation | Direct citation from PDF |
| confidence | HIGH |

---

### REQ-026: 替代路徑單向性

| Field | Value |
|-------|-------|
| requirement_id | REQ-026 |
| title | 替代路徑單向性 |
| source_type | OFFICIAL_DOC + OFFICIAL_DATA |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | road_network_geometry.json |
| section | 資料欄位說明 / alternatives |
| evidence_docx | DOCX: 「alternatives：事故時建議的分流方向，為單向建議；不可假設對稱」 |
| evidence_data | road_network_geometry.json: concrete alternatives values per segment |
| transformation | Field semantics from DOCX, concrete field values from road_network_geometry.json |
| confidence | HIGH |

---

### REQ-027: nearby_stations 空陣列為正常

| Field | Value |
|-------|-------|
| requirement_id | REQ-027 |
| title | nearby_stations 空陣列為正常 |
| source_type | OFFICIAL_DOC + OFFICIAL_DATA |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | road_network_geometry.json |
| section | 資料欄位說明 / nearby_stations |
| evidence_docx | DOCX: 「空陣列為正常 (周邊無收錄基地台)，非缺漏，不可自行補填」 |
| evidence_data | road_network_geometry.json: concrete nearby_stations values per segment |
| transformation | Field semantics from DOCX, concrete field values from road_network_geometry.json |
| confidence | HIGH |

---

### REQ-028: intersections 上游下游排序

| Field | Value |
|-------|-------|
| requirement_id | REQ-028 |
| title | intersections 上游下游排序 |
| source_type | OFFICIAL_DOC + OFFICIAL_DATA |
| source_file_1 | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| source_file_2 | road_network_geometry.json |
| section | 資料欄位說明 / intersections |
| evidence_docx | DOCX: 「intersections：與該路段相交之路段，已按車流上游 → 下游排序」 |
| evidence_data | road_network_geometry.json: concrete intersections values per segment |
| transformation | Field semantics from DOCX, concrete field values from road_network_geometry.json |
| confidence | HIGH |

---

### REQ-029: 錄製展示影片

| Field | Value |
|-------|-------|
| requirement_id | REQ-029 |
| title | 錄製展示影片 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |
| section | 交付內容 |
| evidence | 「錄製展示影片」 |
| transformation | Direct citation from PDF |
| confidence | HIGH |

---

### REQ-030: Dashboard 外觀直觀性與設計性 (加分)

| Field | Value |
|-------|-------|
| requirement_id | REQ-030 |
| title | Dashboard 外觀直觀性與設計性 (加分) |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 加分項目 |
| evidence | 「Dashboard 外觀設計具直觀性與設計性」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-031: 多語化通報支援日韓等語言 (加分)

| Field | Value |
|-------|-------|
| requirement_id | REQ-031 |
| title | 多語化通報支援日韓等語言 (加分) |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx |
| section | 加分項目 |
| evidence | 「多語化通報支援中、英以外語言 (如日文、韓文)」 |
| transformation | Direct citation |
| confidence | HIGH |

---

### REQ-032: 官方交付完整性

| Field | Value |
|-------|-------|
| requirement_id | REQ-032 |
| title | 官方交付完整性 |
| source_type | OFFICIAL_DOC |
| source_file | (中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf |
| section | 交付內容 |
| evidence | 「提案簡報」、「Dashboard Live Demo (含部署網址與錄製影片)」、「GitHub 完整原始碼」 |
| transformation | Combined from PDF delivery requirements |
| confidence | HIGH |

---

## 3. Cross-Reference Validity

### 3.1 CSV -> JSON Segment Reference

All Segment_ID in city_traffic_flow.csv exist in road_network_geometry.json:
- RD_TPE_001, RD_TPE_002, RD_TPE_003, RD_TPE_004, RD_TPE_005, RD_TPE_006, RD_TPE_007, RD_TPE_008, RD_TPE_009, RD_TPE_010, RD_TPE_011, RD_TPE_012, RD_TPE_013, RD_TPE_014, RD_TPE_015

### 3.2 JSON alternatives Reference

All segment IDs referenced in alternatives arrays exist in the road_network_geometry.json segment list.

### 3.3 BS_ Station Reference

All BS_ID in signaling_crowd_density.csv exist in road_network_geometry.json nearby_stations arrays:
- BS_TPE_DOME, BS_MRT_BL17, BS_MRT_BL16, BS_MRT_BL18, BS_BUS_TERM, BS_XY_VIESHOW, BS_XY_ATT, BS_SS_PARK, BS_TPE_101

---

## 4. docx_extracted.txt Classification

| Field | Value |
|-------|-------|
| file | docx_extracted.txt |
| classification | DERIVED_SEARCHABLE_MIRROR |
| source_of_truth | NO |
| purpose | Search optimization only |
| sha-256 | 85A185EDC63DD35C9A0CC8320C7FF0A1F87886FEF4E23FBF63A46EA8C8AB448F |

All source traceability entries reference the authoritative DOCX file, not docx_extracted.txt.

---

## 5. HG-001 Organizer Guidance Implementation Interpretation Entries

> The following entries extend the Source Traceability Matrix with organizer-guided implementation interpretations. Original OFFICIAL_DOC, OFFICIAL_DATA, and OFFICIAL_SOP citations remain authoritative and are not replaced. HG-001 is not part of the seven-source runtime hash gate.

| Requirement | Official Source Citation | HG-001 Implementation Interpretation |
|-------------|--------------------------|----------------------------------------|
| REQ-001 | OFFICIAL_DOC / DOCX / 模組 1 | `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY`; `decision_cutoff_timestamp = event.timestamp`; latest-prior per entity; no future row; same-row fields per entity; Dashboard discloses observation timestamps and HG-001. |
| REQ-002 | OFFICIAL_DOC / DOCX / 模組 1 | Automatic warnings use the same decision cutoff; all comparisons use latest-prior observations at or before that cutoff. |
| REQ-004 | OFFICIAL_DOC / DOCX / 模組 2 | The 60-second replanning uses the same decision cutoff and the same as-of observation policy. |
| REQ-008 | OFFICIAL_DOC / DOCX / 模組 4 | Reasoning display includes selected-record timestamps, staleness, selection mode, and `guidance_id = HG-001`. |
| REQ-009 | OFFICIAL_DOC / DOCX / 模組 4; OFFICIAL_SOP / article 7 | ETE road set is incident + selected primary + selected secondary; use one common exact ETE timestamp; no mixed-timestamp average; define `INSUFFICIENT_COMMON_SNAPSHOT`. |
| REQ-010 | OFFICIAL_DOC / DOCX / 模組 5; OFFICIAL_SOP / article 6 | HG-001 resolves the time dimension using the decision cutoff; the station-set scope remains open. |
| REQ-013 | OFFICIAL_SOP / article 2; OFFICIAL_DATA / road_network_geometry.json | Route comparison uses latest-prior as-of observations per road at the same decision cutoff. |
| REQ-015 | OFFICIAL_SOP / article 2 | CMS must not fabricate ETE when the common snapshot is insufficient; show the lower-bound base clearance and confirmation-required note. |
| REQ-016 | OFFICIAL_SOP / article 3; OFFICIAL_DATA / signaling_crowd_density.csv | For the 22:20 BS_ event, use BL17 at 22:15 and never the future 22:30 row; `affected_road` is `DISPLAY_AND_CONTEXT_ONLY`. |
| REQ-017 | OFFICIAL_SOP / article 4; OFFICIAL_DATA / signaling_crowd_density.csv | Historical peak evaluation uses records at or before the same decision cutoff. |
| REQ-019 | OFFICIAL_SOP / article 6; OFFICIAL_DATA / signaling_crowd_density.csv | Current-state time dimension uses latest-prior per station; station-set scope remains open. |
| REQ-020 | OFFICIAL_SOP / article 7 | ETE road set is incident + selected primary + selected secondary; use one common exact timestamp; BS-event contextual `affected_road` is excluded. |
| REQ-021 | OFFICIAL_DOC / report content requirements | Report discloses event/cutoff/observation timestamps, ETE common timestamp, road set, per-road saturation, formula inputs, policy mode, and HG-001. |
| REQ-022 | OFFICIAL_DOC / public-message requirements | Use deterministic ETE only when available; otherwise show the lower-bound base clearance and confirmation-required note. |

### 5.1 HG-001 Authority Record

| Field | Value |
|-------|-------|
| guidance_id | HG-001 |
| authority_class | ORGANIZER_WRITTEN_GUIDANCE |
| implementation_uniqueness | NON_UNIQUE |
| runtime_official_source | NO |
| official_sop_amendment | NO |
| seven_source_manifest_member | NO |
| configurable | YES |
| evidence_record | `cursor_spec/references/organizer_guidance_2026-07-24.md` |

---

**Document Version**: 2.1 (HG-001 AMENDMENT)
**Created**: 2026-07-20
**Amended**: 2026-07-24 (HG-001)
**Source**: CHT Requirements Baseline Audit
