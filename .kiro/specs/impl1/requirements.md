# 需求文件 (Requirements Document)

**Requirements Status**: `RECOVERED_AND_AMENDED_BY_HG-001_PENDING_READ_ONLY_REVIEW`  
**Amendment**: `HG-001` (2026-07-24, `ORGANIZER_WRITTEN_GUIDANCE`, `NON_UNIQUE`)  
**Implementation Authorization**: `NOT_AUTHORIZED_PENDING_READ_ONLY_REVIEW`

## 簡介 (Introduction)

本規格描述一套「智慧交通指揮系統」(以下於 EARS 條件式中統一以 **THE SYSTEM** 表示)。依命題解說，本系統是一個同時具備「自動感知」與「互動決策」能力的 Dashboard 決策中樞，而非對話機器人。系統須能隨時間推移自動偵測交通與人流異常，並在接收突發事件注入後立即產出專業指揮建議。[OFFICIAL_DOC]

本系統之範疇涵蓋命題解說所列之四項核心任務與五大功能模組，並以 emergency_traffic_sop.txt 之 7 條明文化規則作為判定與推理依據，資料則取自命題所提供之五項官方檔案。本文件僅描述系統「應做什麼」、使用者「應看到什麼」、官方規則「如何決定結果」以及產出「須涵蓋哪些內容」，不預先選定實作技術與架構。

### 來源標註說明 (Source Tag Legend)

本文件每一需求之「備註」僅使用下列五種來源標註；當需求橫跨多個來源時得合併標註：

- **[OFFICIAL_DOC]** — 出自命題解說 (中華電信命題說明) 之內容。
- **[OFFICIAL_SOP]** — 出自 emergency_traffic_sop.txt 之 7 條規則。
- **[OFFICIAL_DATA]** — 直接取自 CSV / JSON 檔案之資料事實。
- **[DERIVED_FOR_TESTABILITY]** — 僅將官方規則重述為可驗證之驗收條件，未新增任何商業規則。
- **[OPEN_QUESTION]** — 官方來源不足以唯一決定，載明缺少之資訊並指出不足或衝突之來源。
- **[ORGANIZER_GUIDANCE]** — 主辦方書面實作指引。非官方 SOP 修訂、非第八個 Runtime 來源；團隊可選擇可重現且可配置的決定性政策。

## 詞彙表 (Glossary)

- **THE SYSTEM (智慧交通指揮系統)**：本規格所建構之交通指揮 Dashboard 決策中樞。
- **SOP**：emergency_traffic_sop.txt 內之 7 條官方交通應變標準程序。
- **知識庫檢索 (RAG)**：命題解說所要求之機制，用以自 SOP 檢索對應條款供推理引用。
- **Saturation_Score**：車流飽和度分數，city_traffic_flow.csv 之欄位。
- **Avg_Speed / Vehicle_Count**：city_traffic_flow.csv 之路段平均時速與車輛數。
- **User_Count**：基地台電信用戶數，signaling_crowd_density.csv 之欄位。
- **Growth_Rate**：人群成長率，signaling_crowd_density.csv 之欄位。
- **Roaming_User_Pct**：漫遊用戶比率，signaling_crowd_density.csv 之欄位，以百分比字串表示 (例如 "30%")。
- **A 級 (紅燈)**：Saturation_Score >= 0.95 之癱瘓級別。
- **B 級 (黃燈)**：0.85 <= Saturation_Score < 0.95 之壅擠級別。
- **flow_direction**：road_network_geometry.json 中路段之車流方向。
- **intersections**：road_network_geometry.json 中與該路段相交之路段全名清單，已依車流「上游 → 下游」排序。
- **capacity_vph**：road_network_geometry.json 中路段之每小時承載容量。
- **alternatives**：road_network_geometry.json 中事故時建議之單向分流方向清單。
- **nearby_stations**：road_network_geometry.json 中該路段周邊、本資料集涵蓋之基地台清單。
- **affected_segment / affected_road / status / severity / type**：live_incidents.json 之事件欄位。
- **ETE**：預計交通恢復時間 (分鐘)，依 SOP 第 7 條公式計算。
- **CMS**：道路電子看板 (可變資訊標誌)。
- **事件注入**：管理員將 live_incidents.json 事件輸入系統之動作。
- **城市應變觸發路段**：SOP 第 1 條指定之 RD_TPE_001 (忠孝東路) 與 RD_TPE_002 (光復南路)。
- **交控中心建議書**：命題要求產出之專業指揮建議報告。
- **多語化民眾簡訊**：命題要求產出之對外公眾通報訊息。

## 需求 (Requirements)

### 需求 1：多源數據整合與唯讀存取

**User Story:** 作為交控中心指揮官，我想要系統整合並持續讀取官方提供之車流與電信信令數據，以便掌握全市即時交通與人流狀態。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 讀取 city_traffic_flow.csv、signaling_crowd_density.csv、road_network_geometry.json、emergency_traffic_sop.txt 與 live_incidents.json 五項官方數據檔案。
2. THE SYSTEM SHALL 依 road_network_geometry.json 之欄位定義解讀 flow_direction、intersections、capacity_vph、alternatives 與 nearby_stations。
3. WHEN 讀取 Roaming_User_Pct 欄位時, THE SYSTEM SHALL 將其視為百分比字串解析 (例如 "30%" 代表 30%)。
4. THE SYSTEM SHALL 將該五項官方數據檔案視為唯讀來源並維持其內容不變。
5. WHILE 沿時間軸推進, THE SYSTEM SHALL 依 Timestamp 讀取對應之車流與人流數據。
6. WHEN 處理事件, THE SYSTEM SHALL 將 `decision_cutoff_timestamp` 設為事件 timestamp。
7. FOR EACH 必要路段或基地台, THE SYSTEM SHALL 選取 timestamp 小於或等於事件 timestamp 的最新一筆觀測，並以 `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY` 記錄選取模式。
8. THE SYSTEM SHALL NOT 使用未來資料、最近未來資料、插值資料或虛構資料，且同一 entity 的所有欄位 SHALL 來自同一筆資料列。
9. WHEN 任一必要 entity 在事件 cutoff 以前不存在觀測, THE SYSTEM SHALL 回傳 `INSUFFICIENT_DATA` 並設定 `manual_confirmation_required = true`，不得向未來資料回退。
10. THE SYSTEM SHALL 保存 `entity_id`、`decision_cutoff_timestamp`、`observation_timestamp`、`staleness_minutes`、`exact_match`、`selection_mode` 與 `guidance_id = HG-001`。

#### 備註 (Notes)

- [OFFICIAL_DOC] 五項檔案之檔名與欄位定義以命題解說為準。
- [OFFICIAL_DATA] Roaming_User_Pct 於 signaling_crowd_density.csv 以百分比字串呈現。
- [DERIVED_FOR_TESTABILITY] 「唯讀」為將官方數據作為權威輸入之可測重述。
- [ORGANIZER_GUIDANCE] OQ-001 已依 HG-001 解決供實作。主辦方未指定唯一演算法，本團隊採用可重現、可配置的 latest-prior per entity 政策。
### 需求 2：交通擁塞級別判定 (SOP 第 1 條分級)

**User Story:** 作為交控中心指揮官，我想要系統依 SOP 第 1 條門檻自動判定每個路段之壅塞級別，以便決定 Dashboard 之紅黃燈顯示。

#### 驗收條件 (Acceptance Criteria)

1. WHEN 某路段之 Saturation_Score 大於或等於 0.85 且小於 0.95, THE SYSTEM SHALL 將該路段判定為 B 級 (黃燈)。
2. WHEN 某路段之 Saturation_Score 大於或等於 0.95, THE SYSTEM SHALL 將該路段判定為 A 級 (紅燈)。
3. WHEN 某路段之 Saturation_Score 等於 0.85, THE SYSTEM SHALL 將該路段判定為 B 級。
4. WHEN 某路段之 Saturation_Score 等於 0.95, THE SYSTEM SHALL 將該路段判定為 A 級。
5. THE SYSTEM SHALL 對全部 15 個核心路段套用相同之級別判定規則。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 1 條分級門檻：B 級為 0.85 <= Saturation_Score < 0.95；A 級為 Saturation_Score >= 0.95；適用全 15 路段。
- [DERIVED_FOR_TESTABILITY] 驗收條件 3、4 之精確邊界僅將 SOP 邊界值寫為可測條件，未新增規則。

### 需求 3：城市應變觸發路段處置 (SOP 第 1 條觸發路段)

**User Story:** 作為交控中心指揮官，我想要系統對忠孝東路 (RD_TPE_001) 與光復南路 (RD_TPE_002) 之級別變化採取城市應變措施，以便及早啟動號誌與警力調度。

#### 驗收條件 (Acceptance Criteria)

1. WHEN RD_TPE_001 或 RD_TPE_002 任一達到 B 級, THE SYSTEM SHALL 通報交控中心啟動長綠燈時制、將該路段 alternatives 之綠燈配時增加 25%，並調度警力淨空路口。
2. WHEN RD_TPE_001 或 RD_TPE_002 任一達到 A 級, THE SYSTEM SHALL 於前述措施外，同步觸發 SOP 第 2 條之替代路徑引導。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 1 條城市應變觸發路段 (RD_TPE_001、RD_TPE_002) 及其 B 級與 A 級處置。
- [OFFICIAL_DATA] RD_TPE_001 於資料中路名為忠孝東路四段、RD_TPE_002 為光復南路。

### 需求 4：動態時序監測儀表板 (模組 1)

**User Story:** 作為交控中心指揮官，我想要儀表板依時間軸自動呈現車流與人流狀態並於異常時自動示警，以便無需人工查詢即可掌握趨勢異常。

#### 驗收條件 (Acceptance Criteria)

1. WHILE 沿時間軸推進, THE SYSTEM SHALL 於儀表板呈現各路段車流與各基地台人流之即時狀態。
2. WHEN 任一路段或基地台數據達到 SOP 預警門檻, THE SYSTEM SHALL 於儀表板自動跳出分析摘要與預警提示。
3. THE SYSTEM SHALL 於儀表板以紅燈標示 A 級路段、以黃燈標示 B 級路段。
4. THE SYSTEM SHALL 顯示事件 timestamp、decision cutoff、每一重要觀測之 timestamp、最大 staleness、資料狀態、所選政策與 `guidance_id`。
5. WHEN ETE 適用, THE SYSTEM SHALL 顯示 ETE common snapshot timestamp、路段角色、每路段 Saturation_Score、平均值、公式與結果。

#### 備註 (Notes)

- [OFFICIAL_DOC] 模組 1：即時狀態視覺化與趨勢異常自動彈窗。
- [OFFICIAL_SOP] 紅燈 / 黃燈對應 A 級 / B 級。
- [ORGANIZER_GUIDANCE] HG-001 要求時間、路段集合、輸入、公式及假設可揭露並可重現。
### 需求 5：突發事件注入與 60 秒即時方案重規劃 (模組 2、核心任務 2)

**User Story:** 作為系統管理員，我想要將 live_incidents.json 事件注入系統並於短時間內取得更新後之導引，以便快速回應突發災情。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 提供介面讓管理員注入 live_incidents.json 事件 (如路面塌陷、號誌故障)。
2. WHEN 事件注入發生時, THE SYSTEM SHALL 透過知識庫檢索 (RAG) 取得對應之 SOP 條款。
3. WHEN 事件注入發生時, THE SYSTEM SHALL 於 60 秒內完成路網重規劃並於畫面更新導引建議。
4. WHEN 進行路網重規劃時, THE SYSTEM SHALL 依 SOP 第 2 條規則選擇替代路徑，並避開容量不足與已飽和之路段。

#### 備註 (Notes)

- [OFFICIAL_DOC] 模組 2：事件注入介面；60 秒內完成路網重規劃並更新導引；避開容量不足或已飽和之路段。核心任務 2：透過知識庫 (RAG) 檢索 SOP。
- [OFFICIAL_SOP] 第 2 條替代路徑規則為重規劃之依據。
- [DERIVED_FOR_TESTABILITY] 主疏散路段本身壅塞之例外，依 SOP 第 2 條處理 (見需求 6)，未新增規則。

### 需求 6：車禍與路障主疏散路徑推理 (SOP 第 2 條)

**User Story:** 作為交控中心指揮官，我想要系統依 SOP 第 2 條計算主疏散與次要替代路徑，以便在道路封閉時提供合規之改道指引。

#### 驗收條件 (Acceptance Criteria)

1. WHEN 事件同時符合 status 屬於 {Closed, Blocked, Restricted}、severity 屬於 {High, Critical}、且 affected_segment 以 "RD_" 開頭, THE SYSTEM SHALL 啟動 SOP 第 2 條車禍與路障應變。
2. WHEN 事件之 affected_segment 以 "BS_" 開頭, THE SYSTEM SHALL 改由 SOP 第 3 條處理而非第 2 條。
3. WHEN 執行第 2 條主疏散篩選時, THE SYSTEM SHALL 僅保留同時滿足下列三項之 alternatives 候選：capacity_vph 大於或等於 1000、候選路段名稱出現於事故路段之 intersections、且該相交路口依 flow_direction 與 intersections 之上游至下游排序位於事故點上游。
4. WHEN 存在多個通過篩選之候選, THE SYSTEM SHALL 選擇 Saturation_Score 最低者作為主疏散路徑。
5. WHERE 相交路口位於事故點下游, THE SYSTEM SHALL 將該相交幹道僅列為次要疏散。
6. IF 選定之主疏散路段 Saturation_Score 大於或等於 0.85, THEN THE SYSTEM SHALL 維持該路徑、啟動長綠燈時制、於報告註明壅塞並建議併行大眾運輸。
7. WHEN 產生對外文字時, THE SYSTEM SHALL 產出 CMS 文字「<事故路段>封閉，請改道 <主疏散路段>，預計延誤 <ETE> 分鐘」，其中 ETE 依 SOP 第 7 條計算。
8. IF 無任何候選通過篩選, THEN THE SYSTEM SHALL 於報告載明查無合規替代路段。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 2 條：觸發三要件、主疏散三項篩選、取最低 Saturation_Score、下游僅列次要、壅塞主疏散仍維持並啟動長綠燈、CMS 文字模板、ETE 引用第 7 條。
- [DERIVED_FOR_TESTABILITY] 驗收條件 2 將「BS_ 人流類事件改由第 3 條」寫為可測條件；驗收條件 8 將「不可虛構路段」以正面可測方式重述為「載明查無合規替代路段」，未新增規則。
- [OFFICIAL_DATA] 事件 TPE_2026_ACC_001 (affected_segment RD_TPE_002、status Closed、severity Critical) 符合第 2 條觸發條件。

#### HG-001 實作補充

9. WHEN 比較 alternatives 之 Saturation_Score, THE SYSTEM SHALL 對每一候選使用同一事件 cutoff 下的 latest-prior observation，並保存各候選的 observation timestamp 與 staleness。
10. THE SYSTEM SHALL 保存選定之 primary 與 selected secondary routes，供 ETE affected set 建構使用。
11. IF ETE 無 common exact timestamp, THEN CMS SHALL NOT 虛構 ETE；系統 SHALL 顯示 `ete_lower_bound_minutes = base_clearance` 與人工確認提示。

- [ORGANIZER_GUIDANCE] OQ-001 與 OQ-003 已依 HG-001 解決供實作；政策仍可配置。
### 需求 7：路網幾何語意之正確運用

**User Story:** 作為系統設計者，我想要系統正確解讀 road_network_geometry.json 之語意，以便替代路徑判定符合官方資料定義。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 將 alternatives 視為單向建議，並僅依各路段自身列出之 alternatives 清單判定分流方向 (不假設對稱、不進行對稱性圖搜索)。
2. WHEN 某路段之 nearby_stations 為空陣列, THE SYSTEM SHALL 視其為周邊無收錄基地台之正常情形並維持為空集合。
3. THE SYSTEM SHALL 依 intersections 之上游至下游排序搭配 flow_direction，判定某相交路口位於事故點之上游或下游。

#### 備註 (Notes)

- [OFFICIAL_DOC] 資料欄位說明：alternatives 為單向建議、不可假設對稱、不可據此做對稱性圖搜索；nearby_stations 空陣列為正常 (非缺漏) 且不可自行補填；intersections 以路段全名表示並依上游 → 下游排序，搭配 flow_direction 判定上下游。
- [OFFICIAL_DATA] intersections 排序範例：RD_TPE_001 = [延吉街, 光復南路, 基隆路一段]；RD_TPE_011 = [基隆路一段, 市府路, 松智路]；RD_TPE_013 = [基隆路一段, 市府路, 松智路]。

### 需求 8：捷運與接駁分流 (SOP 第 3 條)

**User Story:** 作為交控中心指揮官，我想要系統依 SOP 第 3 條偵測捷運人流並提出接駁分流，以便疏導 BL17 站之人潮。

#### 驗收條件 (Acceptance Criteria)

1. WHEN BS_MRT_BL17 之 Growth_Rate 大於 0.30, THE SYSTEM SHALL 啟動 SOP 第 3 條捷運與接駁分流。
2. WHEN BS_MRT_BL17 之 User_Count 大於 25,000, THE SYSTEM SHALL 啟動 SOP 第 3 條捷運與接駁分流。
3. WHEN BS_MRT_BL17 之 User_Count 等於 25,000, THE SYSTEM SHALL 就 User_Count 條件判定為未達第 3 條觸發門檻。
4. WHEN BS_MRT_BL17 之 User_Count 等於 25,001, THE SYSTEM SHALL 依 User_Count 條件啟動第 3 條。
5. WHEN BS_MRT_BL17 之 Growth_Rate 等於 0.30, THE SYSTEM SHALL 就 Growth_Rate 條件判定為未達第 3 條觸發門檻。
6. WHEN 啟動 SOP 第 3 條, THE SYSTEM SHALL 建議北捷過站不停、通知公車處調度接駁專車、並引導群眾步行至 BS_MRT_BL18。
7. WHEN BS_ 事件包含 affected_road, THE SYSTEM SHALL 保留並於 Dashboard、事件細節與報告顯示，且標記 `affected_road_role = DISPLAY_AND_CONTEXT_ONLY`、`affected_road_mandatory_action = false`、`affected_road_guidance_id = HG-001`。
8. THE SYSTEM SHALL NOT 以 BS_ 事件之 affected_road 觸發 SOP 第 1 或第 2 條、改變 A/B 分級、自動成為 primary/secondary、進入 ETE affected set 或產生強制處置。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 3 條觸發與處置。
- [OFFICIAL_DATA] TPE_2026_EVT_002 event timestamp 為 22:20；依 HG-001 latest-prior 政策選用 BL17 22:15 觀測，User_Count = 31,000，因此觸發 SOP 第 3 條；22:30 不得使用。
- [ORGANIZER_GUIDANCE] OQ-002 已依 HG-001 解決供實作，affected_road 僅為顯示與背景脈絡。
### 需求 9：大巨蛋散場啟動 (SOP 第 4 條)

**User Story:** 作為交控中心指揮官，我想要系統偵測大巨蛋散場並提前連動接駁，以便因應散場人潮。

#### 驗收條件 (Acceptance Criteria)

1. WHEN BS_TPE_DOME 之 User_Count 歷史峰值曾達大於或等於 30,000 且當前 Growth_Rate 小於或等於 -0.20, THE SYSTEM SHALL 標記散場啟動。
2. WHEN 標記散場啟動, THE SYSTEM SHALL 提前連動 SOP 第 3 條接駁機制。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 4 條觸發 (BS_TPE_DOME 歷史峰值 >= 30,000 且當前 Growth_Rate <= -0.20) 與處置 (標記散場啟動、提前連動第 3 條)。
- [OFFICIAL_DATA] BS_TPE_DOME 於 19:00 User_Count 達 40,000 (歷史峰值 >= 30,000)；於 22:00 Growth_Rate 為 -0.31 (<= -0.20)。

### 需求 10：號誌故障應變 (SOP 第 5 條)

**User Story:** 作為交控中心指揮官，我想要系統於號誌故障時提出人工指揮派遣建議，以便維持路口通行。

#### 驗收條件 (Acceptance Criteria)

1. WHEN 事件 type 等於 "Power_Failure", THE SYSTEM SHALL 啟動 SOP 第 5 條號誌故障應變。
2. WHEN 事件描述含「號誌失效」或「故障」, THE SYSTEM SHALL 啟動 SOP 第 5 條號誌故障應變。
3. WHEN 啟動 SOP 第 5 條, THE SYSTEM SHALL 產出人工指揮派遣建議，內容涵蓋受影響路段、每路口 2 人之警力人數與估計持續時間。
4. WHEN 啟動 SOP 第 5 條, THE SYSTEM SHALL 於 CMS 加註「<路段> 號誌故障，請依現場指揮通行」。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 5 條觸發 (type = "Power_Failure"，或描述含號誌失效 / 故障) 與處置 (人工指揮派遣建議含受影響路段、每路口 2 人警力、估計持續時間；CMS 加註)。
- [OFFICIAL_DATA] 事件 TPE_2026_EVT_003 (type Power_Failure、affected_segment RD_TPE_007) 對應第 5 條。

### 需求 11：數位通報與多語化觸發 (SOP 第 6 條、模組 5)

**User Story:** 作為交控中心指揮官，我想要系統於漫遊比率偏高時自動產出多語告警並供一鍵發布，以便通報含外籍人士之群眾。

#### 驗收條件 (Acceptance Criteria)

1. WHEN 任一基地台之 Roaming_User_Pct 大於或等於 30%, THE SYSTEM SHALL 觸發 SOP 第 6 條多語化通報。
2. WHEN 任一基地台之 Roaming_User_Pct 等於 30%, THE SYSTEM SHALL 觸發 SOP 第 6 條多語化通報。
3. WHILE SOP 第 6 條為觸發狀態, THE SYSTEM SHALL 於同一回應中使該區域之簡訊與看板訊息同時包含多國語言。
4. IF SOP 第 6 條未觸發, THEN THE SYSTEM SHALL 僅產出中文訊息。
5. THE SYSTEM SHALL 以 YYYY-MM-DD HH:MM 格式統一呈現時間。
6. WHEN 任一站點之 Roaming_User_Pct 大於或等於 30%, THE SYSTEM SHALL 自動產出多語告警文字並提供指揮官一鍵發布。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 6 條觸發 (任一基地台 Roaming_User_Pct >= 30%)、多國語言於同一回應產出、時間格式統一為 YYYY-MM-DD HH:MM。
- [OFFICIAL_DOC] 模組 5：漫遊比率自動偵測、自動產出多語告警文字、供指揮官一鍵發布；未觸發僅中文、觸發須多國語言。
- [DERIVED_FOR_TESTABILITY] 驗收條件 2 之精確邊界 (= 30% 觸發) 僅將 SOP 邊界寫為可測條件，未新增規則。
- [OFFICIAL_DATA] BS_TPE_101 於 20:00 Roaming_User_Pct 為 40%、22:15 為 45%；BS_XY_ATT 於 21:45 為 30%、22:30 為 35%。

#### HG-001 實作補充

7. THE SYSTEM SHALL 以事件 `decision_cutoff_timestamp` 評估 SOP 第 6 條的 current-state 時間維度，並對每個納入評估的基地台使用 latest-prior observation。
8. THE SYSTEM SHALL 顯示基地台 observation timestamp 與 staleness。
9. THE SYSTEM SHALL 將「任一基地台」的 station-set 範圍維持為可配置政策，因該維度仍為 OPEN / AWAITING_HOST_REPLY。

- [ORGANIZER_GUIDANCE] OQ-005 僅解決時間維度；station-set 範圍仍未解決。
### 需求 12：預計恢復時間 ETE 計算 (SOP 第 7 條、模組 4)

**User Story:** 作為交控中心指揮官，我想要系統依 SOP 第 7 條公式計算 ETE 並標示預計恢復時間，以便掌握恢復時程。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 依公式 `ETE_minutes = base_clearance + congestion_penalty` 計算預計恢復時間。
2. THE SYSTEM SHALL 依 severity 決定 base_clearance：Critical 為 60 分鐘、High 為 40 分鐘、Medium 為 20 分鐘。
3. THE SYSTEM SHALL 以 `congestion_penalty = max(0, (avg_saturation - 0.5) * 60)` 計算壅塞加乘值。
4. WHEN ETE 適用於 RD_ 事件, THE SYSTEM SHALL 以 `stable_unique([incident affected_segment, selected primary route, selected secondary routes])` 建立 affected set，語意順序為 INCIDENT、PRIMARY、SECONDARY。
5. THE SYSTEM SHALL NOT 將所有 raw alternatives、被排除候選、capacity 不足候選、非直接相交候選、未排序候選、無關路段、虛構路段或 BS_ 事件的 contextual affected_road 納入 ETE。
6. THE SYSTEM SHALL 選取小於或等於事件 timestamp 且 affected set 每一路段均有 exact traffic record 的最新共同 timestamp，作為 `ete_snapshot_timestamp`。
7. THE SYSTEM SHALL NOT 混用路段 timestamp、使用未來資料、插值或只平均可取得的子集合。
8. IF 不存在 common exact timestamp, THEN THE SYSTEM SHALL 設定 `ete_calculation_status = INSUFFICIENT_COMMON_SNAPSHOT`、`ete_minutes = null`、`ete_lower_bound_minutes = base_clearance`、`congestion_penalty = null` 與 `manual_confirmation_required = true`。
9. WHEN ETE 可計算, THE SYSTEM SHALL 保存並揭露 affected set、路段角色、每路段 Saturation_Score、sum、count、average、severity、base、penalty expression/result、ETE expression/result、policy mode 與 `guidance_id = HG-001`。

#### 備註 (Notes)

- [OFFICIAL_SOP] 第 7 條提供 ETE 公式與 base_clearance。
- [ORGANIZER_GUIDANCE] OQ-003 已依 HG-001 解決供實作。主辦方未指定唯一演算法，本團隊採 `INCIDENT_PRIMARY_AND_SELECTED_SECONDARY` 與 `COMMON_EXACT_TIMESTAMP`。
### 需求 13：交控中心建議書內容 (核心任務 3)

**User Story:** 作為交控中心指揮官，我想要系統產出涵蓋完整決策要點之交控中心建議書，以便據以下達交通指令。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 於交控中心建議書載明事件辨識，含 event_id 或事件描述及對應之 SOP 條款編號。
2. THE SYSTEM SHALL 於交控中心建議書載明交通分級判定 (A 級 / B 級 / 其他) 及其依據，並引用車流與飽和度數值。
3. THE SYSTEM SHALL 於交控中心建議書載明主要疏散路徑、次要替代路徑，並說明排除其他候選路段之理由。
4. THE SYSTEM SHALL 於交控中心建議書載明受影響路段之號誌配時調整 (例如綠燈增加 25%) 與調整時段。
5. WHEN 事件觸發 SOP 第 3 條或第 5 條, THE SYSTEM SHALL 於交控中心建議書載明對北捷、公車處與警力之請求。
6. THE SYSTEM SHALL 於交控中心建議書載明 ETE 數值與預計恢復時間。
7. THE SYSTEM SHALL 產出交控中心建議書，其呈現格式不受限制 (JSON、HTML 報表、Markdown、語音播報等皆可)。

#### 備註 (Notes)

- [OFFICIAL_DOC] 交控中心建議書應涵蓋內容：事件辨識、交通分級判定、替代路徑建議、號誌調整建議 (例：仁愛路四段綠燈 +25%)、跨系統聯動 (觸發第 3 或第 5 條時列出對北捷 / 公車處 / 警力之請求)；報告呈現格式不拘。ETE / 預計恢復時間對應核心任務 4 與模組 4。

#### HG-001 實作補充

8. THE SYSTEM SHALL 於報告揭露 event timestamp、decision cutoff、重要 observation timestamps、最大 staleness、ETE common timestamp、ETE road set、每路段 Saturation_Score、公式輸入與結果、policy mode、假設及 `guidance_id = HG-001`。
9. WHEN ETE 狀態為 `INSUFFICIENT_COMMON_SNAPSHOT`, THE SYSTEM SHALL 註明 lower bound、缺少共同快照、`manual_confirmation_required`，不得顯示虛構 ETE。
### 需求 14：多語化民眾簡訊內容 (核心任務 3)

**User Story:** 作為交控中心指揮官，我想要系統產出適合對外發布之多語化民眾簡訊，以便即時通知民眾改道與避險。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 於多語化民眾簡訊載明本次是否觸發 SOP 第 6 條 (任一基地台 Roaming_User_Pct >= 30%)。
2. IF SOP 第 6 條未觸發, THEN THE SYSTEM SHALL 僅以中文產出民眾簡訊。
3. WHILE SOP 第 6 條為觸發狀態, THE SYSTEM SHALL 以多國語言 (至少中文與英文) 產出民眾簡訊。
4. THE SYSTEM SHALL 於民眾簡訊載明事故位置、改道指引、預計延誤時間與求援或避開提醒。
5. THE SYSTEM SHALL 產出長度適合 CMS 電子看板與手機簡訊呈現、且避免冗長技術術語之民眾簡訊。
6. THE SYSTEM SHALL 產出多語化民眾簡訊，其呈現格式不受限制。

#### 備註 (Notes)

- [OFFICIAL_DOC] 多語化民眾簡訊應涵蓋內容：觸發判定、訊息要點 (事故位置、改道指引、預計延誤時間、求援或避開提醒)、可讀性 (適合 CMS 與手機簡訊、避免冗長技術術語)；核心任務 3 要求中、英雙語；報告呈現格式不拘。
- [OFFICIAL_SOP] 第 6 條觸發與多語言要求。

### 需求 15：AI 決策推理與解釋鏈 (模組 4)

**User Story:** 作為評審與指揮官，我想要在儀表板看到 AI 之推理過程，以便理解判定與排除之理由。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 於儀表板展示級別判定之推理過程，並提供對應之車流與飽和度數據佐證。
2. WHEN 系統排除某替代道路, THE SYSTEM SHALL 於儀表板說明排除該道路之理由。
3. THE SYSTEM SHALL 於儀表板引用作為判定依據之 SOP 條款。

#### 備註 (Notes)

- [OFFICIAL_DOC] 模組 4 判定依據展示：展示推理過程、解釋為何判定為 A 級 (數據佐證)、為何排除特定替代道路。
- [DERIVED_FOR_TESTABILITY] 驗收條件 3 引用 SOP 條款作為判定依據，為將解釋鏈寫為可測條件 (呼應核心任務 4「精準引用 SOP 條款」)，未新增規則。

#### HG-001 實作補充

4. THE SYSTEM SHALL 於 EvidenceTrace 記錄 observation 選取、cutoff、staleness、affected-set 建構、路段排除理由、公式代入與 HG-001 policy provenance。
5. Bedrock SHALL 僅解釋已由決定性程式產生的事實，不得修改任何數值或布林真值。
### 需求 16：對話式策略諮詢顧問 What-if (模組 3)

**User Story:** 作為指揮官，我想要在儀表板旁之對話視窗輸入假設性問題，以便驗證 SOP 邏輯與預期動作。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 於儀表板提供對話視窗，接受指揮官輸入模擬指令或假設性問題。
2. WHEN 指揮官輸入假設性條件 (例如「BL17 人數增至 40,000」), THE SYSTEM SHALL 立即檢索 SOP 並回答應觸發之條款與預期動作。
3. THE SYSTEM SHALL 於 What-if 回答中引用對應之 SOP 條款。

#### 備註 (Notes)

- [OFFICIAL_DOC] 模組 3：互動式問答介面 (指揮官輸入模擬指令或假設性問題)；SOP 邏輯驗證 (依假設條件即時檢索 SOP，回答應觸發條款與預期動作)。核心任務 4：於儀表板回答 What-if 並精準引用 SOP 條款與預期動作。

### 需求 17：加分項目 (選配)

**User Story:** 作為參賽團隊，我想要提供直觀之儀表板設計與更多語言支援，以便取得加分。

#### 驗收條件 (Acceptance Criteria)

1. WHERE 實作加分項目, THE SYSTEM SHALL 提供具直觀性與設計性之 Dashboard 外觀。
2. WHERE 實作加分項目, THE SYSTEM SHALL 於多語化通報支援中文與英文以外之語言 (例如日文、韓文)。

#### 備註 (Notes)

- [OFFICIAL_DOC] 加分項目：Dashboard 外觀設計具直觀性與設計性；多語化通報支援中、英以外語言 (如日文、韓文)。本需求為官方明列之選配加分項目。

## 開放問題彙整 (Open Questions Summary)

HG-001 為主辦方書面實作指引，分類為 `ORGANIZER_WRITTEN_GUIDANCE`、`NON_UNIQUE`。它不是新的 SOP 條文、不是第八個 Runtime 官方來源，也不改變七份官方來源之雜湊。

| OQ | 狀態 | 實作處理 |
|---|---|---|
| OQ-001 | `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE` | `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY` |
| OQ-002 | `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE` | `DISPLAY_AND_CONTEXT_ONLY` |
| OQ-003 | `RESOLVED_FOR_IMPLEMENTATION_BY_ORGANIZER_GUIDANCE` | `INCIDENT_PRIMARY_AND_SELECTED_SECONDARY` + `COMMON_EXACT_TIMESTAMP` |
| OQ-005 | `PARTIALLY_RESOLVED_BY_ORGANIZER_GUIDANCE` | 時間 cutoff 已解決；station-set 範圍仍 OPEN |
| OQ-004 | `OPEN / AWAITING_HOST_REPLY` | 事故自然語言 location 與 intersection anchor |
| OQ-006 | `OPEN / AWAITING_HOST_REPLY` | intersection label 無 segment_id |
| OQ-007 | `OPEN / AWAITING_HOST_REPLY` | 無合規 alternatives 時的呈現 |
| OQ-008 | `OPEN / AWAITING_HOST_REPLY` | PDF 與 SOP 飽和路段優先序 |
| OQ-009 | `OPEN / AWAITING_HOST_REPLY` | What-if 邊界 |
| OQ-010 | `OPEN / AWAITING_HOST_REPLY` | affected intersections 範圍 |
| OQ-011 | `OPEN / AWAITING_HOST_REPLY` | SOP 第 5 條 duration 與 ETE 關係 |

**統計**: 11 total, 3 resolved for implementation, 1 partially resolved, 7 fully open.

### Golden Scenario 驗收

- `ACC_001`: affected set = RD_TPE_002 (INCIDENT), RD_TPE_004 (PRIMARY), RD_TPE_005 (SECONDARY)；22:00 common snapshot；平均 0.81；Critical base 60；penalty 18.6；ETE = **78.6 minutes**。
- `EVT_002`: event 22:20；選用 BL17 22:15 observation；User_Count = 31,000；觸發 SOP 第 3 條；22:30 絕不可使用；affected_road = RD_TPE_001 僅為 `DISPLAY_AND_CONTEXT_ONLY`；ETE 不適用。
- `EVT_003`: affected set = RD_TPE_007 (INCIDENT), RD_TPE_011 (PRIMARY)；22:30 common snapshot；平均 0.85；Medium base 20；penalty 21.0；ETE = **41.0 minutes**。

---

**Document Version**: 2.2 (HG-001 RECOVERED CANDIDATE)  
**Review Gate**: READ_ONLY_VERIFICATION_REQUIRED
