# 需求文件 (Requirements Document)

**Requirements Status**: `DRAFT_PENDING_REVIEW`
**Feature**: 統一自適應推理引擎 (Unified Adaptive Reasoning Engine, 以下簡稱 **UARE**)
**Implementation Authorization**: `NOT_AUTHORIZED_PENDING_REVIEW`

## 簡介 (Introduction)

本規格處理既有系統一個已核實存在的缺口：當注入事件之 `type` / `status` / `severity` 組合**未觸發** `emergency_traffic_sop.txt` 任何一條官方規則時（即 `triggered_articles` 為空集合），目前 `packages/ai-generator/src/recommendation-generator.ts` 的 `buildRecommendationPrompt` 會將「觸發 SOP 條款」欄位填為 `無`，並同時指示 AI「所有判定依據必須引用上述 SOP 條款…不得補造缺失資訊」。這兩個條件同時成立時，AI 沒有可引用的依據，卻被要求引用依據——會導致拒答（「無法判斷」）或幻覺（捏造依據）兩種失敗模式之一，兩者皆不可接受。

UARE 是這個縫隙的決定性修補層，遵循全案既有不變量：**決定性程式碼擁有一切數值、道路 ID 與判定結果；AI 僅負責文字措辭**。UARE 不新增任何官方 SOP 規則，也不重新定義 `article1.ts`～`article6.ts` 既有的觸發條件；它只在既有規則引擎判定「本次無條款觸發」之後，接手產出一份可稽核、有真實資料佐證、且與官方 SOP 明確區隔標示的通用防衛建議。

### 範圍界定（重要）

UARE 處理「事件**類型**在官方 SOP 查無對應條款」（Type Coverage Gap）。UARE **不**處理「事件**地點**不在路網資料涵蓋範圍內」（Location Coverage Gap，例如 `affected_segment`/`affected_road` 皆不存在於 `road_network_geometry.json` 15 筆路段）——後者是另一個已有草案（`feature/boundary-snapping-containment` 分支、`.kiro/specs/boundary-snapping-containment/`）處理的正交問題。兩者可能同時發生；UARE 假設地點解析（`affected_segment` 或其 `alternatives`）本身是合法、可查表的路網資料，僅類型/規則層面查無依據。若 Location Coverage Gap 的機制先行合併，UARE 應以其輸出的合法路段集合為準（見需求 8）；若尚未合併，UARE 在地點也無法解析時依需求 6 明確回報，不臆測。

### 來源標註說明 (Source Tag Legend)

- **[VERIFIED_GAP]** — 經閱讀現行程式碼（`recommendation-generator.ts`、`decision_pipeline.ts`、`article2.ts` 等）核實存在之行為缺口，非假設。
- **[EXISTING_BEHAVIOR]** — 描述現行系統已具備、UARE 需重用而非重建之機制。
- **[NEW_RULE]** — UARE 新增之通用防衛邏輯，明確標示為系統自訂原則，非官方 SOP。
- **[DERIVED_FOR_TESTABILITY]** — 僅將上述規則重述為可驗證之驗收條件。

## 詞彙表 (Glossary)

- **Sop_Match_Status**：布林判定，`triggered_articles.length > 0` 時為 `true`（`OFFICIAL_SOP_MATCHED`），否則為 `false`（`UNKNOWN_TYPE_UNIVERSAL_SOP`）。
- **Universal_Defense_Principles**：UARE 定義的三項通用交通防衛原則（上游截流、周邊引導、資訊通報），為 `[NEW_RULE]`，非官方 SOP 條文。
- **Universal_Grounding_Selector**：決定性函式，從 `Road_Whitelist` 中依即時 `Saturation_Score` 選出可用於「周邊引導」建議的真實路段候選。
- **Road_Whitelist**：`road_network_geometry.json` 全部 15 筆路段之 `segment_id` 集合，是系統唯一允許出現在決策輸出中的道路識別碼來源。
- **Grounding_Candidate**：Universal_Grounding_Selector 挑出的候選路段，含 `segment_id`、`road_name`、`saturation_score`、`capacity_vph`、`status_text`。
- **sop_authority**：API 輸出欄位，值為 `OFFICIAL_SOP` 或 `SYSTEM_DEFAULT_PRINCIPLE`，用以區隔官方條文引用與 UARE 通用原則引用。
- **Safe_Context**：送入 Bedrock 的受限 prompt context，是 `buildRecommendationPrompt` 現行機制的擴充，非新的呼叫路徑。
- **DecisionCore**：`packages/shared-schemas/src/decision_core.ts` 既有之不可變決策核心型別，UARE 於此新增欄位（見需求 5）。
- **LLM_PROHIBITED_FIELDS**：`packages/shared-schemas/src/llm_boundary.ts` 既有之 LLM 不可寫入欄位清單。

## 需求 (Requirements)

### 需求 1：SOP 覆蓋狀態的顯式判定

**User Story:** 作為交控中心指揮官，我想要系統明確告訴我「這次建議有沒有官方 SOP 條文依據」，以便我知道該用哪種信任程度看待這份建議。

#### 驗收條件 (Acceptance Criteria)

1. WHEN `runDeterministicDecision` 完成既有 `article1`～`article6` 之全部觸發判定後，THE SYSTEM SHALL 以 `articles.triggered_articles`（既有輸出，`decision_pipeline.ts:401` 一帶）為唯一依據計算 `sop_matched: boolean`。
2. WHEN `triggered_articles` 非空，THE SYSTEM SHALL 將 `sop_matched` 設為 `true` 且 `sop_authority` 設為 `OFFICIAL_SOP`。
3. WHEN `triggered_articles` 為空，THE SYSTEM SHALL 將 `sop_matched` 設為 `false` 且 `sop_authority` 設為 `SYSTEM_DEFAULT_PRINCIPLE`。
4. THE SYSTEM SHALL NOT 新增或修改 `article1.ts`～`article6.ts` 既有之觸發條件判定邏輯。
5. THE SYSTEM SHALL 將 `sop_matched` 判定實作為純函式，對相同 `triggered_articles` 輸入回傳相同輸出。

#### 備註 (Notes)

- [VERIFIED_GAP] 現行 `recommendation-generator.ts:38` 僅以 `core.triggered_articles.join(', ') || '無'` 呈現，無明確布林旗標可供 prompt 分支或 API 消費端判斷。
- [EXISTING_BEHAVIOR] `triggered_articles` 由既有 `aggregateArticles`（`article_aggregation.ts`）產出，UARE 不改變其計算方式。

### 需求 2：通用防衛原則的內容與資料結構

**User Story:** 作為系統設計者，我想要「查無 SOP 時的處置原則」是一份決定性、版本固定的清單，而不是每次由 LLM 即興生成，以便同一個未知事件類型永遠得到一致的處置骨架。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 定義常數 `UNIVERSAL_DEFENSE_PRINCIPLES`，內含且僅含三項原則：`UPSTREAM_CONTAINMENT`（上游截流）、`PERIMETER_GUIDANCE`（周邊引導）、`PUBLIC_NOTIFICATION`（資訊通報）。
2. THE SYSTEM SHALL 為 `UNIVERSAL_DEFENSE_PRINCIPLES` 之每一項原則提供決定性中文說明文字，該文字 SHALL NOT 由 Bedrock 生成。
3. THE SYSTEM SHALL 將 `UNIVERSAL_DEFENSE_PRINCIPLES` 定義於 `packages/domain` 內之純函式模組，不 import 任何 `packages/ai-generator` 或 `packages/rag` 符號。
4. WHEN `sop_matched` 為 `false`，THE SYSTEM SHALL 將 `UNIVERSAL_DEFENSE_PRINCIPLES` 全數掛載至該次決策輸出。
5. WHEN `sop_matched` 為 `true`，THE SYSTEM SHALL NOT 掛載 `UNIVERSAL_DEFENSE_PRINCIPLES` 至該次決策輸出。

#### 備註 (Notes)

- [NEW_RULE] 三項原則之編號與命名沿用主辦方命題解說之通用交通控制常識（上游截流、周邊引導、資訊通報），非既有 7 條 SOP 之延伸條文。

### 需求 3：周邊引導路段之即時壅塞分級與零幻覺篩選

**User Story:** 作為交控中心指揮官，我想要「周邊引導」建議指向的道路百分之百是路網資料庫中真實存在、且當下真的比較不塞的路段，以便我下達的每一條改道指令都經得起稽核。

#### 驗收條件 (Acceptance Criteria)

1. WHEN `incident.affected_segment` 屬於 Road_Whitelist，THE Universal_Grounding_Selector SHALL 以該路段之 `alternatives`（`road_network_geometry.json` 既有欄位）作為候選路段來源。
2. WHERE `incident.affected_segment` 不屬於 Road_Whitelist 且 `incident.affected_road` 屬於 Road_Whitelist，THE Universal_Grounding_Selector SHALL 改以 `affected_road` 之 `alternatives` 作為候選路段來源。
3. THE Universal_Grounding_Selector SHALL 僅保留候選來源中 `capacity_vph >= 1000` 且本身屬於 Road_Whitelist 之路段（沿用既有 `article2.ts` 之 `CAPACITY_THRESHOLD` 常數，不重新定義新門檻）。
4. THE Universal_Grounding_Selector SHALL NOT 要求候選路段與事故路段之 `intersections` 有上游相交關係（此為 SOP-2 專屬之空間規則，見備註）。
5. THE Universal_Grounding_Selector SHALL 依決策 cutoff 當下之 `Saturation_Score`（依既有 `TimeAlignmentStrategy` 選取，見需求 7）由低到高排序候選路段，並保留前 3 名；不足 3 名時保留全部。
6. THE Universal_Grounding_Selector SHALL 為每一保留之候選路段回傳 `segment_id`、`road_name`、`saturation_score`、`capacity_vph` 與依 SOP 第 1 條既有門檻（B 級 0.85、A 級 0.95）計算之 `status_text`（暢通／注意／壅塞）。
7. IF 候選來源為空集合（該路段無 `alternatives` 或 `alternatives` 內無成員屬於 Road_Whitelist）, THEN THE Universal_Grounding_Selector SHALL 回傳空陣列並記錄原因 `no_grounding_candidate_available`，且 THE SYSTEM SHALL NOT 以任何非 Road_Whitelist 字串填補建議路段。
8. THE Universal_Grounding_Selector SHALL 以純函式形式實作，對相同輸入（候選來源、`Saturation_Score` 快照）回傳相同排序結果。

#### 備註 (Notes)

- [EXISTING_BEHAVIOR] SOP-2（`article2.ts`）既有的候選篩選為 3-AND（容量 + 直接相交 + 上游），UARE 之 Universal_Grounding_Selector 刻意省略「上游相交」限制——因為該限制的正當性來自 SOP-2 條文本身（車禍路障之上游分流邏輯），對「查無條款」的未知事件類型沒有官方依據可以援引同一限制，過度套用會構成 UARE 自行新增規則、逾越需求 2 之「不新增官方條文」界線。故僅保留容量與白名單兩項不需要 SOP 依據即成立的物理常識性篩選。
- [DERIVED_FOR_TESTABILITY] 驗收條件 5 之「前 3 名」數量僅將命題解說「2~3 條實體備用道路」重述為可測固定值。

### 需求 4：Safe_Context 與 Prompt 之通用防衛模式分支

**User Story:** 作為系統，我需要在 `sop_matched` 為 `false` 時給 AI 一套不同的措辭指令，明確要求「必須給建議、只能用白名單內道路、不得聲稱這是官方 SOP」，以便 AI 產出的文字既不拒答也不冒充官方依據。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 擴充 `buildRecommendationPrompt`（`packages/ai-generator/src/recommendation-generator.ts`），使其依 `core.sop_matched` 分支組裝 prompt 內容，且不改變 `sop_matched: true` 分支既有之輸出文字內容。
2. WHEN `sop_matched` 為 `false`，THE SYSTEM SHALL 在 prompt 中明確陳述「本事件之類型未於 emergency_traffic_sop.txt 查得對應條款，請依通用防禦性交通處置原則進行應變推理」，取代既有「觸發 SOP 條款: 無」之呈現方式。
3. WHEN `sop_matched` 為 `false`，THE SYSTEM SHALL 在 prompt 中列出 `UNIVERSAL_DEFENSE_PRINCIPLES` 之三項原則文字與 `Universal_Grounding_Selector` 產出之候選路段清單（含 `road_name` 與 `status_text`）。
4. WHEN `sop_matched` 為 `false`，THE SYSTEM SHALL 在 prompt 中明示：AI 僅得從所列候選路段清單中選用道路名稱，禁止提及清單以外之任何路名或地點。
5. WHEN `sop_matched` 為 `false`，THE SYSTEM SHALL 在 prompt 中明示：AI 不得回覆「無法判斷」、「查無資料」、「無法處理」或語意相近之拒答語句，必須產出處置建議。
6. WHEN `sop_matched` 為 `false`，THE SYSTEM SHALL 在 prompt 中要求 AI 於說明文字中載明「本事件無預設 SOP 條款，已啟動動態通用防衛模式，依據即時車流分析完成調度」或語意相近之揭露句。
7. THE SYSTEM SHALL 使 `sop_matched` 為 `true` 時之 prompt 分支維持 §29-74 行既有邏輯與既有測試逐字通過（no-regression）。

#### 備註 (Notes)

- [VERIFIED_GAP] 現行 `recommendation-generator.ts:67` 之收尾指令「所有判定依據必須引用上述 SOP 條款與資料證據，不得補造缺失資訊」在 `無` 條款情境下沒有給 AI 任何合法出路，是本規格要修補的直接原因。

### 需求 5：DecisionCore 與 API 之顯式標示欄位

**User Story:** 作為 Dashboard 開發者與評審，我想要 API 回應以獨立欄位標示這份建議是官方依據還是通用原則推導，以便畫面能直接呈現「系統知道自己在推斷什麼」。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 於 `packages/shared-schemas/src/decision_core.ts` 之 `DecisionCore` 新增欄位 `sop_matched: boolean`、`sop_authority: 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE'`、`universal_principles: readonly UniversalPrinciple[]`、`grounding_candidates: readonly GroundingCandidate[]`。
2. WHEN `sop_matched` 為 `true`，THE SYSTEM SHALL 將 `universal_principles` 與 `grounding_candidates` 設為空陣列。
3. THE SYSTEM SHALL 在 API 回應中提供 `sop_clauses_cited` 欄位：`sop_matched` 為 `true` 時內容為既有 `sop_citations`（`SopCitation[]`）之條號清單；為 `false` 時內容為固定字串陣列 `["通用防禦性交通處置原則 (SOP 範圍外動態推演)"]`。
4. THE SYSTEM SHALL 在 API 回應中提供 `recommended_routes` 欄位，其 `primary`／`secondary`／`excluded` 子欄位之 `road_name` 與 `status_text` 均取自 `grounding_candidates`（`sop_matched: false` 時）或既有 `primary_evacuation`／`secondary_evacuation`／`excluded_candidates`（`sop_matched: true` 時），不得由 Bedrock 另行生成道路名稱。
5. THE SYSTEM SHALL 使 `sop_matched`、`sop_authority`、`universal_principles`、`grounding_candidates` 為決定性程式碼寫入之唯讀欄位，語意上與既有 `DecisionCore` 其餘欄位同等級（不可變、由 `DecisionFn` 產生）。

#### 備註 (Notes)

- [EXISTING_BEHAVIOR] `recommended_routes.primary/secondary/excluded` 之欄位命名與既有 API 慣例（`primary_evacuation`/`secondary_evacuation`/`excluded_candidates`）語意對齊，僅新增外層包裝，不改變既有欄位。

### 需求 6：地點亦無法解析時的明確降級（不臆測）

**User Story:** 作為交控中心指揮官，我想要當系統連候選道路都選不出來時被清楚告知，而不是收到一份看起來完整卻是空殼的建議。

#### 驗收條件 (Acceptance Criteria)

1. WHEN `sop_matched` 為 `false` 且 Universal_Grounding_Selector 回傳空陣列（需求 3 AC7）, THE SYSTEM SHALL 將 `recommended_routes` 全部子欄位設為 `null`，並在 prompt 中禁止 AI 提及任何具體道路名稱。
2. WHEN 需求 6 AC1 之情形發生，THE SYSTEM SHALL 於 prompt 中要求 AI 僅產出不依賴具體道路之通用處置建議（如周界管制、資訊通報），並在說明文字中載明「本事件地點資料亦無法定位可用替代路段，建議應變依通用原則執行並儘速人工確認」。
3. THE SYSTEM SHALL NOT 因需求 6 AC1 之情形而回傳 `insufficient_data`（該狀態依既有規則僅由 `DataIngestionService` manifest STOP gate 觸發，UARE 不擴大其觸發條件）。

#### 備註 (Notes)

- [DERIVED_FOR_TESTABILITY] 本需求防止「路段清單為空卻仍讓 AI 自由發揮補路名」這個退化情境，是零幻覺不變量在邊界情況下的延伸重述。

### 需求 7：資料時間對齊之重用（不重建）

**User Story:** 作為系統維護者，我想要 UARE 使用的即時壅塞數值跟既有 Dashboard 上看到的數值是同一套時間對齊邏輯算出來的，以便不會出現「同一時刻兩個數字」的不一致。

#### 驗收條件 (Acceptance Criteria)

1. THE Universal_Grounding_Selector SHALL 透過既有 `TimeAlignmentStrategy`（`decision_pipeline.ts` 既有之 `bundle.timeAlignment.select`）取得候選路段之 `Saturation_Score`，不得另行實作資料選取邏輯。
2. THE Universal_Grounding_Selector SHALL 使用與該次決策相同之 `decision_cutoff_timestamp`。
3. IF 某候選路段在 cutoff 之前無合法觀測記錄, THEN THE Universal_Grounding_Selector SHALL 將該路段排除於候選之外，且 SHALL NOT 以 `0` 或其他預設值替代缺失之 `Saturation_Score`。

#### 備註 (Notes)

- [EXISTING_BEHAVIOR] 對齊 `decision_pipeline.ts:236-239` 既有處理 `alternatives` saturation 之寫法（唯一差異：既有寫法在查無記錄時填 `0`，UARE 依需求 7 AC3 改為直接排除，因為既有 `0` 是「SOP-2 排序用途下的保守預設」，若原封不動套用到 UARE 會讓查無資料的路段看似「最不塞」而被誤選為首選，等同以假數值冒充真數值）。

### 需求 8：與 LLM_PROHIBITED_FIELDS 之同步

**User Story:** 作為系統維運者，我想要新增的顯式標示欄位被既有的 LLM 寫入防護機制涵蓋，以便這些欄位跟其他 `DecisionCore` 欄位受到同等程度的稽核保護。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 將 `sop_matched`、`sop_authority`、`universal_principles`、`grounding_candidates` 加入 `packages/shared-schemas/src/llm_boundary.ts` 之 `PROHIBITED_KEYS`。
2. THE SYSTEM SHALL 同步更新 repo 根目錄 `eslint-local-rules.cjs` 內對應之手動複本，使其與 `PROHIBITED_KEYS` 逐字一致。
3. THE SYSTEM SHALL 使既有 `eslint-local-rules/test/prohibited-fields-sync.test.ts` 涵蓋新增之四個欄位。
4. THE SYSTEM SHALL 使 `packages/rag/src/schema_validator.ts`（或其等效驗證點）對 Bedrock 輸出套用與既有 `DecisionCore` 欄位相同之過濾路徑，禁止生成文字覆寫 `sop_matched`、`sop_authority`、`universal_principles`、`grounding_candidates`、`recommended_routes` 之值。

### 需求 9：測試涵蓋要求

**User Story:** 作為專案維護者，我想要 UARE 的判定與篩選邏輯有屬性測試與整合測試把關，以便規則變更時能立刻發現破壞。

#### 驗收條件 (Acceptance Criteria)

1. THE SYSTEM SHALL 具備測試證明：`live_incidents.json` 三筆官方事件皆觸發至少一條 SOP 條款（`sop_matched: true`），作為既有行為之回歸基準。
2. THE SYSTEM SHALL 具備至少 3 個未知事件類型（例如「無人機墜落橋樑」、「未知氣體外洩」）之整合測試案例，驗證 `sop_matched: false`、`sop_authority: SYSTEM_DEFAULT_PRINCIPLE`、且 `recommended_routes` 內道路 ID 均屬於 Road_Whitelist。
3. THE Universal_Grounding_Selector SHALL 具備以 fast-check 執行、至少 100 次迭代之屬性測試，驗證「回傳候選路段之 `segment_id` 必屬於 Road_Whitelist」。
4. THE Universal_Grounding_Selector SHALL 具備屬性測試，驗證「相同輸入重複執行兩次得到相同輸出」（純函式性）。
5. THE SYSTEM SHALL 具備整合測試，驗證需求 6 描述之「地點亦無法解析」情境不會觸發 `insufficient_data`，且 `recommended_routes` 全數為 `null`。
6. THE SYSTEM SHALL 具備 no-regression 測試，證明 `sop_matched: true` 事件之既有 `recommendation-generator.ts` prompt 輸出於導入 UARE 前後逐字相同。
7. THE SYSTEM SHALL 具備需求 8 之 `prohibited-fields-sync.test.ts` 擴充測試與 `schema_validator.ts` 覆寫防護測試。
