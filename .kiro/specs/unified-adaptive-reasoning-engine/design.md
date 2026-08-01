# 技術設計文件 (Technical Design Document)

**Design Status**: `DRAFT_PENDING_REVIEW`
**對應需求**: 同目錄 `requirements.md`（R1–R9）
**Implementation Authorization**: `NOT_AUTHORIZED_PENDING_REVIEW`

## 統一自適應推理引擎 (Unified Adaptive Reasoning Engine)

> 撰寫語言為繁體中文；型別名稱、欄位名稱、程式識別字保留英文。
> 本文件僅描述「如何設計」，不建立產品程式碼。實作順序見同目錄 `tasks.md`。

---

## 0. 與既有系統的關係（前提聲明）

UARE 是既有 `runDeterministicDecision`（`packages/domain/src/rule_engine/decision_pipeline.ts`）與 `RecommendationGenerator`（`packages/ai-generator/src/recommendation-generator.ts`）之間的**銜接補丁**，不是新的決策管線：

- 不修改 `article1.ts`～`article6.ts` 既有觸發條件。
- 不修改 `DataIngestionService` 的 `insufficient_data` / `stop_reason` 語意。
- 不修改 SOP-2 既有的 `qualifyCandidates`/`selectEvacuation`（RD_ 事件仍照既有邏輯算 `primary_evacuation`）——UARE 的 `Universal_Grounding_Selector` 只在 `sop_matched === false` 時才被 `Containment` 呼叫端使用其結果覆寫 API 的 `recommended_routes` 呈現層，不覆寫 `DecisionCore.primary_evacuation` 本身（`primary_evacuation` 語意維持「SOP-2 疏散路徑」，即便該事件 `sop_matched=false` 且未觸發 SOP-2，其值也自然為 `null`，見 §4）。
- 沿用並擴充既有 `LLM_PROHIBITED_FIELDS` 機制，不重建。

信任等級與既有系統一致：新增模組全部屬於「🟩 決定性程式碼」，`RecommendationGenerator`/`TextGenerator`（Bedrock）維持「🟪 LLM」等級，只產出文字。

---

## 1. Executive Summary

當 `triggered_articles` 為空（無官方 SOP 條款觸發）時：

1. `Sop_Match_Resolver`（純函式，非新模組——就是對既有 `triggered_articles` 做一次布林投影）判定 `sop_matched = triggered_articles.length > 0`。
2. `Universal_Grounding_Selector`（`packages/domain`）從事故路段的 `alternatives` 中，用既有 `TimeAlignmentStrategy` 取即時 `Saturation_Score`，篩出容量達標、有真實 `segment_id` 的候選路段，依壅塞度排序取前 3。
3. `buildRecommendationPrompt`（`packages/ai-generator`）依 `sop_matched` 分支：`true` 走既有邏輯；`false` 走新的「通用防衛模式」措辭指令，附上 `UNIVERSAL_DEFENSE_PRINCIPLES` 與候選路段清單，並明示「禁止拒答、禁止提及清單外道路」。
4. `DecisionCore` 新增四個唯讀欄位揭露上述判定，並比照既有機制加入 `LLM_PROHIBITED_FIELDS`。

不變量與既有系統一致：**決定性程式碼擁有一切數值與識別碼真值；Bedrock 只能填寫文字欄位**。

---

## 2. Requirements Mapping

| 需求 | 摘要                             | 主要元件                                    | 執行主體 | 主要落點章節 |
| ---- | -------------------------------- | -------------------------------------------- | -------- | ------------ |
| R1   | SOP 覆蓋狀態顯式判定             | `resolveSopMatch`                            | 決定性   | §3           |
| R2   | 通用防衛原則資料結構             | `UNIVERSAL_DEFENSE_PRINCIPLES`               | 決定性   | §4           |
| R3   | 周邊引導路段篩選                 | `selectGroundingCandidates`                  | 決定性   | §5           |
| R4   | Safe_Context / Prompt 分支       | `buildRecommendationPrompt`                  | 決定性組裝，LLM 僅措辭 | §6 |
| R5   | DecisionCore / API 顯式標示欄位  | `decision_core.ts`, `decision_pipeline.ts`   | 決定性   | §7           |
| R6   | 地點亦無法解析之降級             | `selectGroundingCandidates` 空集合路徑       | 決定性   | §5.3, §6.3   |
| R7   | 時間對齊重用                     | 既有 `TimeAlignmentStrategy`                 | 決定性   | §5.2         |
| R8   | `LLM_PROHIBITED_FIELDS` 同步     | `llm_boundary.ts`, `eslint-local-rules.cjs`, `schema_validator.ts` | 決定性 | §8 |
| R9   | 測試涵蓋                         | 全部模組                                     | 決定性   | §9           |

---

## 3. `resolveSopMatch`（Requirement 1）

新增 `packages/domain/src/rule_engine/universal_defense.ts`（新檔案）。

```ts
export interface SopMatchResult {
  readonly sop_matched: boolean;
  readonly sop_authority: 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE';
}

export function resolveSopMatch(triggeredArticles: readonly number[]): SopMatchResult {
  const matched = triggeredArticles.length > 0;
  return {
    sop_matched: matched,
    sop_authority: matched ? 'OFFICIAL_SOP' : 'SYSTEM_DEFAULT_PRINCIPLE',
  };
}
```

呼叫點：`decision_pipeline.ts` 在既有 `const articles = aggregateArticles(...)`（§358-363）之後、組裝 `facts: DeterministicDecisionFacts` 之前，呼叫 `resolveSopMatch(articles.triggered_articles)`。純函式、零副作用、不需要新的輸入資料，屬於本設計中風險最低的一步。

---

## 4. 通用防衛原則（Requirement 2）

同一檔案 `universal_defense.ts`：

```ts
export type UniversalPrincipleId =
  | 'UPSTREAM_CONTAINMENT'
  | 'PERIMETER_GUIDANCE'
  | 'PUBLIC_NOTIFICATION';

export interface UniversalPrinciple {
  readonly principle_id: UniversalPrincipleId;
  readonly title: string;
  readonly description: string;
}

export const UNIVERSAL_DEFENSE_PRINCIPLES: readonly UniversalPrinciple[] = [
  {
    principle_id: 'UPSTREAM_CONTAINMENT',
    title: '上游截流',
    description: '於事故點前 1～2 個路口縮減車道或限制車輛進入，避免車流持續匯入事故路段',
  },
  {
    principle_id: 'PERIMETER_GUIDANCE',
    title: '周邊引導',
    description: '將車流引導至當前實測壅塞度最低之實體備用道路，不引導至未經驗證之路段',
  },
  {
    principle_id: 'PUBLIC_NOTIFICATION',
    title: '資訊通報',
    description: '透過 CMS 看板與多語廣播即時通報事故與改道資訊',
  },
] as const;
```

`resolveSopMatch` 回傳 `sop_matched: false` 時，呼叫端掛載 `UNIVERSAL_DEFENSE_PRINCIPLES` 全部三項（不做子集篩選——三項原則描述的是同一次應變的三個並行動作面向，不是互斥選項，R2 AC1 因此要求「僅含三項」且一次性全部掛載）。

---

## 5. `selectGroundingCandidates`（Requirement 3、6、7）

同一檔案 `universal_defense.ts`。

```ts
export interface GroundingCandidate {
  readonly segment_id: string;   // 屬於 Road_Whitelist
  readonly road_name: string;
  readonly saturation_score: number;
  readonly capacity_vph: number;
  readonly status_text: '暢通' | '注意' | '壅塞';
}

export interface GroundingResult {
  readonly candidates: readonly GroundingCandidate[]; // 最多 3 筆，依 saturation 升冪排序
  readonly reason: string | null; // 空集合時填 'no_grounding_candidate_available'
}

export function selectGroundingCandidates(
  anchorSegmentId: string,
  roadNetwork: RoadNetworkModel,
  saturationOf: (segmentId: string) => number | null, // 呼叫端綁定既有 TimeAlignmentStrategy.select
): GroundingResult;
```

### 5.1 篩選邏輯（R3）

```
source = roadNetwork.alternativesOf(anchorSegmentId)   // 既有 API，SOP-2 亦使用同一方法
filtered = source
  .filter(id => roadNetwork.getSegment(id) !== undefined)      // 屬於 Road_Whitelist
  .filter(id => roadNetwork.getSegment(id).capacity_vph >= 1000) // 沿用 article2.ts 的 CAPACITY_THRESHOLD
  .map(id => ({ id, saturation: saturationOf(id) }))
  .filter(({ saturation }) => saturation !== null)              // R7 AC3：查無記錄即排除，不補 0
  .sort((a, b) => a.saturation - b.saturation)
  .slice(0, 3)
```

`CAPACITY_THRESHOLD`（1000）從 `article2.ts` 匯出重用，不在 `universal_defense.ts` 內重新宣告常數值，避免兩處門檻各自維護後產生分岔（比照 boundary-snapping 草案 §4.5 對 `intersectionAppearsInLocation` 的處理方式：共用而非複製）。

`status_text` 依既有 SOP 第 1 條門檻（`classification_engine.ts` 的 A/B 級邊界，0.85／0.95）換算：`< 0.85` → 暢通；`0.85–0.95`（不含 0.95）→ 注意；`>= 0.95` → 壅塞。呼叫既有分級函式取代重寫門檻常數。

錨點來源（`anchorSegmentId`）依需求 3 AC1/AC2：`incident.affected_segment` 屬於 Road_Whitelist 則用它；否則若 `incident.affected_road` 屬於 Road_Whitelist 則改用它；兩者皆非，見 §5.3。

### 5.2 時間對齊重用（R7）

`saturationOf` 由呼叫端（`decision_pipeline.ts`）以既有 `bundle.timeAlignment.select(segmentId, eventDate, records)` 綁定傳入，函式本身不重新實作資料選取。與既有 §237-239 行「SOP-2 alternatives saturation 查詢」使用同一組 `trafficByStation`/`eventDate`，只是查無記錄時的預設值不同（既有填 `0`，UARE 排除，理由見 requirements.md R7 備註）。

### 5.3 地點亦無法解析（R6）

若 `incident.affected_segment` 與 `incident.affected_road` 皆不屬於 Road_Whitelist，呼叫端不呼叫 `selectGroundingCandidates`（沒有合法 `anchorSegmentId` 可傳入），直接產出 `GroundingResult { candidates: [], reason: 'no_anchor_available' }` 的等效空結果。若 `anchorSegmentId` 合法但 `alternativesOf` 為空或篩選後為空，`selectGroundingCandidates` 內部回傳 `reason: 'no_grounding_candidate_available'`。兩種空結果在 §6、§7 的下游處理完全一致（`recommended_routes` 全部設 `null`），差異只在 `reason` 字串，供除錯與稽核使用。

---

## 6. Prompt 分支（Requirement 4）

`packages/ai-generator/src/recommendation-generator.ts` 的 `buildRecommendationPrompt` 改為：

```ts
export function buildRecommendationPrompt(core: DecisionCore): string {
  const facts = core.event_facts;
  // ... 既有 ete / evidenceTimestamps 計算不變 ...

  const sopSection = core.sop_matched
    ? `- 觸發 SOP 條款: ${core.triggered_articles.join(', ')}`
    : buildUniversalDefenseSection(core); // 新增分支函式

  return `你是一位交通指揮中心的 AI 助手。只能依下列不可變的 DecisionCore 事實撰寫文字，不得重算或更改級別、SOP、道路、ETE、CMS 核心文字或任何數值。

## 事件資訊
...（既有欄位不變）...
${sopSection}
...（既有其餘章節不變）...`;
}

function buildUniversalDefenseSection(core: DecisionCore): string {
  const principles = core.universal_principles
    .map((p) => `  - ${p.title}：${p.description}`)
    .join('\n');
  // R6 AC1/AC2 修正（code review 後補正）：grounding_candidates 為空陣列時
  // （需求 3 AC7 所指之情形），不得沿用「候選路段清單」框架的措辭，必須改為
  // 需求 6 AC2 規定的固定揭露句，而非泛用的「無可用替代路段」文字。
  const routesSection = core.grounding_candidates.length > 0
    ? `- 僅得使用下列候選路段之名稱，禁止提及清單以外之任何路名或地點：\n` +
      core.grounding_candidates
        .map((c) => `  - ${c.road_name}（${c.status_text}，容量剩餘依即時壅塞度 ${c.saturation_score}）`)
        .join('\n')
    : `- 無任何可用之真實候選路段資料，僅得產出不依賴具體道路之通用處置建議，禁止提及任何具體道路名稱\n` +
      `- 請於說明文字中載明：「本事件地點資料亦無法定位可用替代路段，建議應變依通用原則執行並儘速人工確認」`;

  return `- 本事件類型未於 emergency_traffic_sop.txt 查得對應條款（sop_matched: false）
- 請依下列通用防禦性交通處置原則進行應變推理，不得回覆「無法判斷」、「查無資料」或語意相近之拒答語句：
${principles}
${routesSection}
- 請於【判定依據】段落載明：「本事件無預設 SOP 條款，已啟動動態通用防衛模式，依據即時車流分析完成調度」`;
}
```

`sop_matched: true` 分支的字串輸出與既有實作逐字相同（R4 AC7 no-regression）；差異僅限新增的 `sopSection` 三元判斷取代原本固定的一行字串樣板。

Prompt 收尾既有段落「所有判定依據必須引用上述 SOP 條款與資料證據，不得補造缺失資訊」保留不動——`sop_matched: false` 時 `sopSection` 已經提供了「依據」（通用原則 + 候選路段），因此這句既有指令在兩種分支下都成立，不需要改寫，這正是本設計修補 requirements.md 所述 `[VERIFIED_GAP]` 的方式：不是移除「不得補造」這條防線，而是讓「有依據可引用」在兩種情境下都為真。

---

## 7. `DecisionCore` 與 API 欄位（Requirement 5）

`packages/shared-schemas/src/decision_core.ts` 新增：

```ts
export interface DecisionCore {
  // ...既有欄位不變...
  readonly sop_matched: boolean;
  readonly sop_authority: 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE';
  readonly universal_principles: readonly UniversalPrinciple[]; // sop_matched=true 時為 []
  readonly grounding_candidates: readonly GroundingCandidate[]; // sop_matched=true 時為 []
}
```

API 回應組裝層（既有 backend 序列化路徑，不新增 endpoint）新增衍生欄位：

```json
{
  "decision_meta": {
    "sop_matched": false,
    "sop_authority": "SYSTEM_DEFAULT_PRINCIPLE",
    "sop_clauses_cited": ["通用防禦性交通處置原則 (SOP 範圍外動態推演)"]
  },
  "recommended_routes": {
    "primary": { "road_name": "市民大道四段", "status_text": "暢通", "segment_id": "RD_TPE_004" },
    "secondary": { "road_name": "基隆路一段", "status_text": "注意", "segment_id": "RD_TPE_003" },
    "excluded": null
  },
  "traffic_control_advice": "（Bedrock 生成文字，經既有 schema_validator.ts 稽核）",
  "universal_principles": [
    { "principle_id": "UPSTREAM_CONTAINMENT", "title": "上游截流", "description": "..." },
    { "principle_id": "PERIMETER_GUIDANCE", "title": "周邊引導", "description": "..." },
    { "principle_id": "PUBLIC_NOTIFICATION", "title": "資訊通報", "description": "..." }
  ]
}
```

`sop_clauses_cited` 為既有 API 若尚未有對應欄位，則新增；`sop_matched: true` 時內容取自既有 `sop_citations`（`article_no` 清單），不重新設計呈現格式。

`recommended_routes` 的 `primary`/`secondary`/`excluded` 由 `grounding_candidates`（`sop_matched: false`）依排序後陣列的第 0/1/2 個元素映射；`sop_matched: true` 時沿用既有 `primary_evacuation`/`secondary_evacuation`/`excluded_candidates` 映射邏輯，非本設計新增行為。

---

## 8. `LLM_PROHIBITED_FIELDS` 同步（Requirement 8）

`packages/shared-schemas/src/llm_boundary.ts`：

```ts
const PROHIBITED_KEYS: readonly (keyof DecisionCore)[] = [
  // ...既有 26 個欄位不變...
  'sop_matched',
  'sop_authority',
  'universal_principles',
  'grounding_candidates',
];
```

因 `PROHIBITED_KEYS` 已 `Typed against keyof DecisionCore`，新增欄位到 `DecisionCore` 而漏加此陣列會在型別層面仍然編譯成功（陣列型別容許子集），因此**不能只靠型別把關**——必須靠 §9 的測試斷言陣列內容完整涵蓋新欄位。`eslint-local-rules.cjs` 的手動複本同步新增這 4 個字串，`prohibited-fields-sync.test.ts` 擴充比對。

`packages/rag/src/schema_validator.ts` 既有針對 `LLM_PROHIBITED_FIELDS` 的過濾路徑無需新增分支——因為新欄位已併入 `DecisionCore` 本身（不像 boundary-snapping 草案的 `ContainmentDisclosure` 是獨立型別），沿用同一驗證函式即可自動涵蓋，這是本設計刻意選擇「併入 `DecisionCore`」而非另立型別的理由：新欄位的資料來源（`runDeterministicDecision` 內部）與既有欄位相同，沒有 boundary-snapping 草案 §7 所述「兩條不同管線」的問題。

---

## 9. 測試策略（對映 Requirement 9）

| 測試                                                                 | 對映需求 | 位置                                                                    |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 官方 3 筆 `live_incidents.json` 事件皆 `sop_matched: true`（回歸基準） | R9.1     | `packages/domain/test/golden/dome_and_sop6.golden.test.ts`（擴充既有 golden） |
| ≥3 個未知事件類型整合測試，`sop_matched: false` 且路段皆屬白名單       | R9.2     | `packages/domain/test/unit/universal_defense.test.ts`（新檔）            |
| P-U1: `selectGroundingCandidates` 回傳 `segment_id` 必屬 Road_Whitelist | R9.3     | `packages/domain/test/property/p_universal_grounding.test.ts`（新檔）    |
| P-U2: 相同輸入兩次執行結果相同（純函式性）                             | R9.4     | 同上                                                                      |
| 地點亦無法解析 → `recommended_routes` 全 `null`、非 `insufficient_data` | R9.5     | `packages/backend/test/decision/universal_defense_integration.test.ts`（新檔） |
| No-regression：`sop_matched:true` 時 prompt 輸出逐字不變               | R9.6     | `packages/ai-generator/test/recommendation-generator.test.ts`（擴充既有） |
| `prohibited-fields-sync.test.ts` 擴充 + `schema_validator.ts` 覆寫防護  | R9.7     | `eslint-local-rules/test/prohibited-fields-sync.test.ts`、`packages/rag/test/schema_validator.test.ts` |

---

## 10. Non-Goals / 明確排除範圍

- 不處理事件**地點**超出路網涵蓋範圍（Location Coverage Gap）——見 requirements.md「範圍界定」，該問題屬於另一份草案（`.kiro/specs/boundary-snapping-containment/`）。若該草案先合併，UARE 的 `anchorSegmentId` 來源可直接改接其 `Perimeter_Anchor`，介面相容（皆為「一個屬於 Road_Whitelist 的 `segment_id`」）。
- 不新增官方 SOP 條文，不修改 `emergency_traffic_sop.txt` 或既有 7 條官方雜湊來源。
- 不改變既有 `article1`～`article6` 的觸發判定、`primary_evacuation`（SOP-2）欄位的計算邏輯。
- `UNIVERSAL_DEFENSE_PRINCIPLES` 的文字內容為固定中文常數，不支援多語系版本（既有 SOP-6 多語通報機制不受本規格影響，因其觸發條件為 `BS_` 站點資料，與 `sop_matched` 無關）。
