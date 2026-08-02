# 需求文件 (Requirements Document)

**Requirements Status**: `DRAFT_PENDING_REVIEW`
**Feature**: SOP 灰色地帶動態仲裁引擎 (Grey-Zone Arbitration Engine, 以下簡稱 **GZAE**)
**Implementation Authorization**: `NOT_AUTHORIZED_PENDING_REVIEW`

## 簡介 (Introduction)

本規格處理既有規則引擎（`packages/domain/src/rule_engine/`）四個已核實存在的行為缺口。這四者與 [[unified-adaptive-reasoning-engine|UARE]] 正交：UARE 處理「事件類型查無任何 SOP 條款」（`triggered_articles` 為空集合）；GZAE 處理的是「條款有觸發、但觸發判定本身落在數值臨界、跨條款訊號互相矛盾、多起微型事件疊加、或候選疏散路段自身亦被封鎖」四種 SOP 文字未明確涵蓋的情境。兩者可能同時發生於同一次決策，互不取代。

`runDeterministicDecision`（`packages/domain/src/rule_engine/decision_pipeline.ts:187-477`）目前將 article 1、2、3/BL17、4/大巨蛋、5、6 各自獨立求值（233-379 行），僅在最後以 `aggregateArticles`（383-386 行）做觸發條款的**聯集**，彼此之間沒有任何一致性檢查、時間趨勢、鄰近事件關聯、或候選路段自我阻塞的交叉驗證。`TimeAlignmentStrategy.select`（`strategies/time_alignment_strategy.ts:92-142`）對每個實體只回傳單一筆快照，捨棄全部歷史，因此系統目前**沒有任何**變化率/趨勢計算能力。

GZAE 遵循全案既有不變量：**決定性程式碼擁有一切數值、道路 ID 與判定結果；AI 僅負責文字措辭**。GZAE 不修改 SOP 第 1～7 條既有觸發門檻與判定邏輯（`classification_engine.ts`、`article1.ts`～`article6.ts` 之既有輸出必須逐字不變），僅在既有判定「之上」新增決定性的仲裁/預警/排除層。

### 範圍界定（重要）

GZAE 處理下列四種情境，皆為官方 SOP 文字未明確涵蓋（無條款可直接引用）者：

1. **門檻臨界趨勢**（需求 1）：`Saturation_Score` 尚未達 B 級門檻但呈上升趨勢。
2. **跨條款訊號矛盾**（需求 2）：同一路段/鄰近區域，車流訊號（art.1）與人流訊號（art.3/4/6）呈現矛盾態勢。
3. **鄰近微型事件疊加**（需求 3）：多起個別未觸發 art.2 之低嚴重度事件，在路網拓樸上相鄰。
4. **候選路段自我阻塞**（需求 4）：art.2 選出的疏散候選路段，其本身正是另一起現行事件的 `affected_segment` 且處於封閉/阻斷狀態。

GZAE **不**新增第 8 條或任何編號 SOP 條款；四項機制皆以 `[NEW_RULE]` 標示於既有 7 條 SOP 之外的系統自訂原則，其中僅需求 4（候選自我阻塞排除）屬於既有 art.2 候選資格判定的**物理現實修正**（見需求 4 備註），其餘三項為純粹的輔助標註/預警，**不得**覆寫或替換既有 `triggered_articles`、`classifications`、`art1_measures` 之既有輸出值。

GZAE 假設事件之 `affected_segment`/`affected_road` 本身可於 `road_network_geometry.json` 查得（Location Coverage Gap 屬 `boundary-snapping-containment` 之正交問題，同 UARE 之範圍界定）。

### 來源標註說明 (Source Tag Legend)

- **[VERIFIED_GAP]** — 經閱讀現行程式碼（`decision_pipeline.ts`、`article1.ts`～`article6.ts`、`classification_engine.ts`、`time_alignment_strategy.ts`）核實存在之行為缺口，非假設。
- **[EXISTING_BEHAVIOR]** — 描述現行系統已具備、GZAE 需重用而非重建之機制。
- **[NEW_RULE]** — GZAE 新增之通用防衛/仲裁邏輯，明確標示為系統自訂原則，非官方 SOP 條文。
- **[DERIVED_FOR_TESTABILITY]** — 僅將上述規則重述為可驗證之驗收條件。

## 詞彙表 (Glossary)

- **Grey_Zone_Band**：`[NEW_RULE]` 常數，B 級門檻（0.85）下方一段固定寬度區間，用以判定「臨界但未達標」。
- **Rising_Trend**：`[NEW_RULE]` 判定，依同一 `segment_id` 在 cutoff 前最近 N 筆歷史 `saturation_score` 之線性差分是否持續為正。
- **Pre_Warning_Flag**：GZAE 產出之布林標註，`true` 表示該路段落於 Grey_Zone_Band 且呈 Rising_Trend，**不**等同於 B 級分類。
- **Area_Key**：由 `road_network_geometry.json` 之 `nearby_stations` 欄位建立的路段↔基地台關聯鍵，用以比對同一區域之車流與人流訊號。
- **Signal_Conflict_Flag**：GZAE 產出之標註，描述 Area_Key 內車流分級與人流條款觸發狀態互相矛盾之情形。
- **Adjacency_Graph**：由 `road_network_geometry.json` 之 `intersections` 與 `alternatives` 兩欄位建立之路段鄰接關係，作為「鄰近」之路網拓樸代理（本資料集無經緯度）。
- **Cascading_Risk_Flag**：GZAE 產出之標註，描述多起未觸發 art.2 之事件在 Adjacency_Graph 上相鄰時之疊加風險。
- **Self_Blocked_Candidate**：art.2 `qualifyCandidates`（`article2.ts:117-141`）產出之候選路段中，其 `segment_id` 亦為另一筆現行事件之 `affected_segment` 且該事件 `status` 屬於 `{Closed, Blocked, Restricted}` 者。
- **Road_Whitelist**：`road_network_geometry.json` 全部路段之 `segment_id` 集合（沿用 UARE 定義）。
- **DecisionCore**：`packages/shared-schemas/src/decision_core.ts` 既有之不可變決策核心型別。
- **LLM_PROHIBITED_FIELDS**：`packages/shared-schemas/src/llm_boundary.ts` 既有之 `PROHIBITED_KEYS` 清單。

## 需求 (Requirements)

### 需求 1：候選路段自我阻塞排除（規則衝突仲裁）

**User Story:** 作為交控中心指揮官，我想要系統推薦的疏散路段本身保證沒有被另一起事件封閉，以便我不會被引導到一條看似合格、實際上也堵死的路。

#### 驗收條件 (Acceptance Criteria)

1. WHEN `qualifyCandidates`（`article2.ts:117-141`）已依既有 3-AND 條件（capacity_vph、is_direct_intersection、upstream_or_downstream）評估出一候選路段的 `role`，THE SYSTEM SHALL 額外檢查該候選 `segment_id` 是否等於決策當下其他任一現行事件（`incidents` 清單中，非本次觸發事件本身）之 `affected_segment`。
2. IF 候選路段之 `segment_id` 為另一現行事件之 `affected_segment`，AND 該事件 `status` 屬於 `{Closed, Blocked, Restricted}`（沿用 art.2 既有 `TRIGGER_STATUSES` 常數，`article2.ts:36-40`）, THEN THE SYSTEM SHALL 將該候選之 `role` 覆寫為 `excluded`，並將 `exclusion_reason` 設為 `候選路段本身正被事件 <event_id> 封鎖（status: <status>）`。
3. THE SYSTEM SHALL 在既有 3-AND 判定（capacity/intersection/upstream）**之後**才套用本檢查，即本檢查不得使原本 3-AND 不合格的候選改判為合格。
4. THE SYSTEM SHALL NOT 修改 art.2 既有 3-AND 判定邏輯本身（`determineRole` 函式既有分支，`article2.ts:225-290`），本檢查以獨立的後置篩選函式實作。
5. THE SYSTEM SHALL 將本檢查實作為純函式，輸入為既有 `RouteCandidate[]` 與現行事件清單，對相同輸入回傳相同輸出。
6. WHERE 本次觸發事件自身即為封鎖候選路段之來源（例如同一事件同時列於 `affected_segment` 與間接影響其 `alternatives`）, THE SYSTEM SHALL 排除本次觸發事件自身，僅比對「其他」現行事件，避免事件與自己比對造成誤排除。

#### 備註 (Notes)

- [VERIFIED_GAP] `evaluateSingleCandidate`（`article2.ts:146-217`）與 `qualifyCandidates` 僅讀取 `roadNetwork.alternativesOf(...)` 之靜態幾何資料（capacity/intersection/upstream），從未交叉比對 `live_incidents.json` 現行事件清單，候選路段本身正被封鎖時仍可能被判定為 `primary`。
- 本需求是四項中唯一**修正**（而非僅標註）既有候選判定結果的機制，理由：候選路段是否物理上可通行是既有 3-AND 條件本應隱含、但目前程式碼未實作的物理現實，屬於既有 art.2 候選資格判定邏輯的必要補完，而非新增 SOP 規則本身。

### 需求 2：門檻臨界趨勢預警（不改變官方分級）

**User Story:** 作為交控中心指揮官，我想要在飽和度尚未達到 B 級門檻、但正快速上升時提早收到預警，以便有時間預先準備，而不是等硬門檻跳動的瞬間才反應。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 定義常數 `GREY_ZONE_LOWER_BOUND = 0.80`（B 級門檻 0.85 下方固定 0.05 寬度），構成 Grey_Zone_Band = `[0.80, 0.85)`。
2. WHEN 一路段之當前（cutoff 對齊）`saturation_score` 落於 Grey_Zone_Band, THE SYSTEM SHALL 額外取得該路段在 cutoff 之前、既有原始資料序列中最近 3 筆歷史觀測值（沿用 `groupTraffic` 既有分組結果，`decision_pipeline.ts:517-532`，僅新增取用其時間序列而不改變其產出結構）。
3. WHEN 需求 2 AC2 之 3 筆歷史觀測值數量足夠 (>= 2 筆), THE SYSTEM SHALL 判定 Rising_Trend：後一筆相對前一筆之差值連續為正（單調遞增）。
4. IF 路段落於 Grey_Zone_Band 且 Rising_Trend 為真, THEN THE SYSTEM SHALL 將該路段之 `pre_warning` 標註設為 `true`；否則為 `false`。
5. THE SYSTEM SHALL NOT 因 `pre_warning: true` 而改變 `classifySegments`（`classification_engine.ts`）既有輸出之 `level` 欄位（沿用既有 0.85/0.95 判定，逐字不變）。
6. THE SYSTEM SHALL NOT 因 `pre_warning: true` 而將該路段計入 `triggered_articles`；art.1 觸發與否僅依既有 `classification.level` 判定（`article1.ts:76-79`）。
7. IF 歷史觀測值不足 2 筆（含無歷史資料）, THEN THE SYSTEM SHALL 將 `pre_warning` 設為 `false`，SHALL NOT 以插值或預設值推斷缺失歷史。
8. THE SYSTEM SHALL 將本判定實作為純函式，對相同輸入序列回傳相同輸出。

#### 備註 (Notes)

- [VERIFIED_GAP] `TimeAlignmentStrategy.select`（`time_alignment_strategy.ts:92-142`）僅回傳單一對齊快照，`classification_engine.ts:52-57` 僅對單一數值做門檻比較，全案無任何處讀取或保留歷史序列以計算趨勢。
- [NEW_RULE] Grey_Zone_Band 寬度（0.05）與「連續 3 筆單調遞增」為系統自訂啟發式，非官方 SOP 條文；`sop_authority` 欄位須標示為 `SYSTEM_DEFAULT_PRINCIPLE`（沿用 UARE 既有列舉值，不新增列舉成員）。
- [DERIVED_FOR_TESTABILITY] 「3 筆歷史、連續遞增」為可測固定值，取代開放式「趨勢預測」的模糊描述。

### 需求 3：跨條款訊號矛盾標註（車流 vs 人流）

**User Story:** 作為交控中心指揮官，我想要當某區域「車流順暢」但「人潮條款已觸發」（或反之）時被明確提示矛盾存在，以便我知道不能只看單一條款就下達單一處置。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 以 `road_network_geometry.json` 既有 `nearby_stations` 欄位建立 Area_Key：每個路段 `segment_id` 對應其 `nearby_stations` 內之基地台 `segment_id` 集合。
2. WHEN 一路段之 art.1 分類結果為 `level: null`（未達 B 級，即暢通）, AND 其 Area_Key 內任一基地台觸發 art.3（`article3.ts` 既有 Growth_Rate > 0.30 或 User_Count > 25000 判定）或 art.4（`article4.ts` 既有大巨蛋散場判定）, THEN THE SYSTEM SHALL 將該路段之 `signal_conflict` 標註設為 `true`，類型記為 `crowd_heavy_traffic_light`。
3. WHEN 一路段之 art.1 分類結果為 `level: 'A'`, AND 其 Area_Key 內全部基地台皆未觸發 art.3/art.4/art.6（人流與漫遊條款均未觸發）, THEN THE SYSTEM SHALL 將該路段之 `signal_conflict` 標註設為 `true`，類型記為 `traffic_heavy_crowd_light`。
4. IF 需求 3 AC2、AC3 之條件皆不成立, THEN THE SYSTEM SHALL 將 `signal_conflict` 設為 `false`。
5. THE SYSTEM SHALL NOT 因 `signal_conflict: true` 而改變 art.1、art.3、art.4、art.6 既有各自獨立之觸發判定（`decision_pipeline.ts:233-379` 既有分支邏輯不變）。
6. WHEN `signal_conflict: true`，THE SYSTEM SHALL 產出一則決定性文字建議：`crowd_heavy_traffic_light` 類型建議「車道彈性縮減並限速，優先保障行人通行」；`traffic_heavy_crowd_light` 類型建議「維持既有車流疏導措施，暫緩人流相關資源調度」，該文字為固定樣板，不由 Bedrock 生成。
7. THE SYSTEM SHALL 將本判定實作為純函式，對相同 art.1/art.3/art.4/art.6 既有輸出組合回傳相同標註。

#### 備註 (Notes)

- [VERIFIED_GAP] `decision_pipeline.ts:233-379` 中 art.1（車流）與 art.3/4/6（人流/漫遊）分支彼此獨立求值，僅由 `aggregateArticles`（383-386 行）做觸發條款聯集，無任何跨條款一致性檢查；`nearby_stations` 欄位（`road_network_geometry.json` 例如 9、18 行）目前未被規則引擎讀取，僅存在於資料檔案中。
- [NEW_RULE] 需求 6 之固定樣板文字與門檻對應為系統自訂原則，非官方 SOP 條文，`sop_authority` 標示為 `SYSTEM_DEFAULT_PRINCIPLE`。

### 需求 4：鄰近微型事件疊加風險偵測

**User Story:** 作為交控中心指揮官，我想要當兩起個別看似輕微、未觸發全網應變的事件發生在路網相鄰位置時被提醒疊加風險，以便我能提早介入而不是等回堵擴大才發現。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 以 `road_network_geometry.json` 既有 `intersections` 與 `alternatives` 兩欄位建立 Adjacency_Graph：兩路段 `segment_id` 若彼此互為 `alternatives` 成員，或其 `intersections`（路口名稱字串）與對方 `road_network_geometry.json` 之 `name` 相符，視為相鄰。
2. WHEN 決策當下現行事件清單中存在至少兩筆事件，其 `affected_segment` 均未觸發 art.2（即 `isArticle2Triggered`，`article2.ts:71-83` 回傳 `false`，例如 severity 為 Medium/Low 或 status 不在 `{Closed, Blocked, Restricted}`）, AND 兩者之 `affected_segment` 在 Adjacency_Graph 上相鄰（含相同路段）, THEN THE SYSTEM SHALL 產出 `cascading_risk` 標註 `true`，並列出涉及之 `event_id` 清單（至少 2 筆）。
3. IF 涉及事件中任一已觸發 art.2, THEN THE SYSTEM SHALL NOT 將其計入本判定（該事件已由既有 art.2 流程處理，不重複標註）。
4. THE SYSTEM SHALL NOT 因 `cascading_risk: true` 而將任何未觸發 art.2 之事件之 `triggered_articles` 改為包含 2（art.2 觸發與否僅依既有 `isArticle2Triggered` 判定）。
5. WHEN `cascading_risk: true`, THE SYSTEM SHALL 於決策輸出中記錄一則決定性建議文字：「偵測到 <N> 起鄰近未達 SOP 第 2 條門檻之事件，建議依通用防禦性原則提升為區域協調應變等級，儘速人工複核」，該文字為固定樣板，不由 Bedrock 生成。
6. THE SYSTEM SHALL 將本判定實作為純函式，對相同現行事件清單與 Adjacency_Graph 回傳相同標註結果。

#### 備註 (Notes)

- [VERIFIED_GAP] `resolveIncident`（`decision_pipeline.ts:481-493`）與整條 `runDeterministicDecision` pipeline 僅處理單一事件，無任何跨事件聚合、路網拓樸鄰近性判定（repo 內對 `proximity`/`distance` 之搜尋為零筆命中）；`live_incidents.json` 亦無經緯度欄位，僅有 `affected_segment` 與自由文字 `location`，故本需求以 Adjacency_Graph（既有 `intersections`/`alternatives` 欄位）作為路網拓樸鄰近之代理，而非真實地理距離。
- [NEW_RULE] Adjacency_Graph 定義與 AC5 建議樣板皆為系統自訂原則，非官方 SOP 條文；`sop_authority` 標示為 `SYSTEM_DEFAULT_PRINCIPLE`。

### 需求 5：DecisionCore／API／LLM 邊界之同步與測試涵蓋

**User Story:** 作為系統維運者與 Dashboard 開發者，我想要 GZAE 新增的四種標註都是決定性程式碼寫入之唯讀欄位，並受既有 LLM 寫入防護與測試涵蓋，以便新增的仲裁結果不會被 AI 覆寫，也不會在規則變更時無聲失效。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 於 `packages/shared-schemas/src/decision_core.ts` 之 `DecisionCore` 新增唯讀欄位：`pre_warning_segments: readonly string[]`（需求 2）、`signal_conflicts: readonly SignalConflict[]`（需求 3）、`cascading_risk: CascadingRisk | null`（需求 4）、`self_blocked_exclusions: readonly string[]`（需求 1，記錄被本機制排除之候選 `segment_id`）。
2. THE SYSTEM SHALL 將需求 5 AC1 新增之四個欄位加入 `packages/shared-schemas/src/llm_boundary.ts` 之 `PROHIBITED_KEYS`，並同步更新 repo 根目錄 `eslint-local-rules.cjs` 內對應手動複本，使其逐字一致（沿用 UARE 需求 8 之既有機制與 `eslint-local-rules/test/prohibited-fields-sync.test.ts`）。
3. THE SYSTEM SHALL 使 `packages/rag/src/schema_validator.ts`（或其等效驗證點）對 Bedrock 輸出套用與既有 `DecisionCore` 欄位相同之過濾路徑，禁止生成文字覆寫需求 5 AC1 新增之四個欄位。
4. THE SYSTEM SHALL 具備測試證明：`live_incidents.json` 三筆官方事件（`TPE_2026_ACC_001`、`TPE_2026_EVT_002`、`TPE_2026_EVT_003`）逐一送入決策管線後，需求 1～4 之四項機制均不改變既有 `triggered_articles`、`classifications`、`primary_evacuation`、`secondary_evacuation` 之既有輸出值（no-regression 基準）。
5. THE SYSTEM SHALL 針對需求 1（自我阻塞排除）具備至少 1 個整合測試案例：以 fixture 構造第二起事件封鎖 `TPE_2026_ACC_001` 的合格候選路段之一（例如 `RD_TPE_004`），驗證該候選之 `role` 被改判為 `excluded` 且原 3-AND 合格之其餘候選不受影響。
6. THE SYSTEM SHALL 針對需求 2（趨勢預警）具備至少 3 個單元測試案例，涵蓋：(a) 落於 Grey_Zone_Band 且單調遞增 → `pre_warning: true`；(b) 落於 Grey_Zone_Band 但非單調遞增 → `false`；(c) 已達 B 級（不落於 Grey_Zone_Band）→ `false`。
7. THE SYSTEM SHALL 針對需求 3（訊號矛盾）具備至少 2 個整合測試案例，分別覆蓋 `crowd_heavy_traffic_light` 與 `traffic_heavy_crowd_light` 兩種類型。
8. THE SYSTEM SHALL 針對需求 4（疊加風險）具備至少 1 個整合測試案例：以 fixture 構造兩起均未觸發 art.2 之事件，其 `affected_segment` 於 Adjacency_Graph 上相鄰，驗證 `cascading_risk: true` 且不影響任一事件之 `triggered_articles`。
9. THE SYSTEM SHALL 使需求 1～4 各判定函式具備純函式性質之單元測試（相同輸入重複執行兩次得到相同輸出）。

#### 備註 (Notes)

- [EXISTING_BEHAVIOR] 本需求之測試涵蓋要求與同步機制沿用 UARE 需求 8、9 之既有模式（`prohibited-fields-sync.test.ts`、`schema_validator.ts` 過濾路徑），不重新設計新的防護機制。
