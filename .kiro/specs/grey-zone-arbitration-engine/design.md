# 技術設計文件 (Technical Design Document)

**Design Status**: `DRAFT_PENDING_REVIEW`
**對應需求**: 同目錄 `requirements.md`（R1–R5）
**Implementation Authorization**: `NOT_AUTHORIZED_PENDING_REVIEW`

## SOP 灰色地帶動態仲裁引擎 (Grey-Zone Arbitration Engine)

> 撰寫語言為繁體中文；型別名稱、欄位名稱、程式識別字保留英文。
> 本文件僅描述「如何設計」，不建立產品程式碼。實作順序見同目錄 `tasks.md`。

---

## 0. 與既有系統的關係（前提聲明）

GZAE 是既有 `runDeterministicDecision`（`packages/domain/src/rule_engine/decision_pipeline.ts`）的**後置仲裁層**，不是新的決策管線，也不是 [[unified-adaptive-reasoning-engine|UARE]] 的替代或延伸：

- 不修改 `classification_engine.ts`（0.85/0.95 門檻）、`article1.ts`～`article6.ts` 既有觸發條件與輸出結構。
- 不修改 `aggregateArticles`（`article_aggregation.ts`）之聯集邏輯與 `triggered_articles` 語意。
- R1（自我阻塞排除）是**唯一**修改既有輸出值的機制（`RouteCandidate.role`/`exclusion_reason`），且僅套用於既有 3-AND 判定「之後」的後置篩選，不改動 `determineRole`（`article2.ts:225-290`）既有分支。
- R2～R4 全數為**純標註**（additive-only）：新增獨立欄位，不得改寫任何既有 `DecisionCore` 欄位之值。
- 沿用並擴充既有 `LLM_PROHIBITED_FIELDS` 機制，不重建。

信任等級與既有系統一致：新增模組全部屬於「🟩 決定性程式碼」；若既有 `RecommendationGenerator`（Bedrock）之 prompt 需要引用 GZAE 標註文字，僅能原樣引用固定樣板字串，不得由 LLM 生成或改寫標註內容本身。

---

## 1. Executive Summary

`runDeterministicDecision`（`decision_pipeline.ts:187-477`）在既有 `aggregateArticles`（383-386 行）產出 `articles` 之後、組裝最終 `DecisionCore` 之前，插入一個新的仲裁階段 `runGreyZoneArbitration`：

1. **R1 候選自我阻塞排除**：對既有 `qualifyCandidates` 產出之 `RouteCandidate[]`，比對現行事件清單，將被其他事件封鎖之候選改判為 `excluded`。
2. **R2 趨勢預警**：對落於 `[0.80, 0.85)` 的路段，讀取 `groupTraffic` 既有分組保留之近 3 筆歷史，判定是否單調遞增，產出 `pre_warning_segments`。
3. **R3 訊號矛盾標註**：以 `nearby_stations` 建立路段↔基地台關聯，比對 art.1 分級與 art.3/4/6 觸發狀態，產出 `signal_conflicts`。
4. **R4 疊加風險偵測**：以 `intersections`/`alternatives` 建立 Adjacency_Graph，比對現行事件清單中未觸發 art.2 者是否路網相鄰，產出 `cascading_risk`。

四個子模組全部是純函式，輸入均為既有管線已經算好的中介值（`RouteCandidate[]`、`classifications`、`articles`、現行事件清單、`RoadNetworkModel`），不新增外部資料來源、不重新實作既有選取邏輯。

---

## 2. Requirements Mapping

| 需求 | 摘要                     | 主要元件                          | 執行主體 | 主要落點章節 |
| ---- | ------------------------ | ---------------------------------- | -------- | ------------ |
| R1   | 候選自我阻塞排除          | `excludeSelfBlockedCandidates`     | 決定性   | §3           |
| R2   | 門檻臨界趨勢預警          | `detectPreWarning`                 | 決定性   | §4           |
| R3   | 跨條款訊號矛盾標註        | `detectSignalConflicts`            | 決定性   | §5           |
| R4   | 鄰近微型事件疊加風險      | `detectCascadingRisk`              | 決定性   | §6           |
| R5   | DecisionCore/API/LLM 邊界 | `decision_core.ts`, `llm_boundary.ts`, `eslint-local-rules.cjs`, `schema_validator.ts` | 決定性 | §7 |

---

## 3. `excludeSelfBlockedCandidates`（Requirement 1）

新增 `packages/domain/src/rule_engine/grey_zone_arbitration.ts`（新檔案，四個子模組共用同一檔案，比照 `universal_defense.ts` 之單檔慣例）。

```ts
export function excludeSelfBlockedCandidates(
  candidates: readonly RouteCandidate[],
  currentIncidentEventId: string,
  otherActiveIncidents: readonly Incident[],
): readonly RouteCandidate[] {
  const blockedSegmentIds = new Map<string, Incident>();
  for (const incident of otherActiveIncidents) {
    if (incident.event_id === currentIncidentEventId) continue;
    if (!TRIGGER_STATUSES_FOR_BLOCKING.has(incident.status)) continue; // 沿用 article2.ts TRIGGER_STATUSES
    blockedSegmentIds.set(incident.affected_segment, incident);
  }

  return candidates.map((candidate) => {
    if (candidate.role === RouteCandidateRole.excluded) return candidate; // 既有排除原因優先，不覆寫
    const blocker = blockedSegmentIds.get(candidate.segment_id);
    if (!blocker) return candidate;
    return {
      ...candidate,
      role: RouteCandidateRole.excluded,
      exclusion_reason: `候選路段本身正被事件 ${blocker.event_id} 封鎖（status: ${blocker.status}）`,
    };
  });
}
```

呼叫點：`decision_pipeline.ts` 中，在既有 `qualifyCandidates(...)` 呼叫（RD_ 分支內，約 260-270 行一帶）取得 `candidates` 之後、傳入 `selectEvacuation`/`primary_evacuation`/`secondary_evacuation` 計算之前，插入 `excludeSelfBlockedCandidates` 呼叫，並將其輸出取代原本傳給下游的 `candidates`。這使得 `primary_evacuation`/`secondary_evacuation`/`excluded_candidates` 三個既有 `DecisionCore` 欄位自然反映排除結果，不需要新增輸出欄位——`self_blocked_exclusions`（R5 AC1）僅記錄「哪些 `segment_id` 是因本機制被排除」以供稽核區分於既有 3-AND 排除原因。

`TRIGGER_STATUSES_FOR_BLOCKING` 直接 import 並重用 `article2.ts` 既有匯出之 `TRIGGER_STATUSES`（若該常數尚未匯出，先補一行 `export`，不重新定義字面量集合）。

---

## 4. `detectPreWarning`（Requirement 2）

```ts
export const GREY_ZONE_LOWER_BOUND = 0.80; // classification_engine.ts 之 B 級門檻 0.85 下方固定 0.05

export function detectPreWarning(
  segmentId: string,
  currentSaturation: number,
  recentHistory: readonly { readonly saturation_score: number }[], // cutoff 前最近 3 筆，時間升冪
): boolean {
  const inGreyZone = currentSaturation >= GREY_ZONE_LOWER_BOUND && currentSaturation < 0.85;
  if (!inGreyZone) return false;
  if (recentHistory.length < 2) return false;

  for (let i = 1; i < recentHistory.length; i++) {
    if (recentHistory[i].saturation_score <= recentHistory[i - 1].saturation_score) return false;
  }
  return true;
}
```

資料來源：`decision_pipeline.ts:517-532` 的 `groupTraffic` 已將原始 `city_traffic_flow.csv` 依 `segment_id` 分組為陣列（供 `TimeAlignmentStrategy.select` 挑選單筆快照之前的中介結果）。本設計新增一個小函式 `recentHistoryBefore(cutoff, group, n=3)`，對同一個既有分組陣列依時間戳排序、篩出 `<= cutoff` 者、取最後 3 筆——**不新增資料讀取路徑**，只是多消費一次既有已在記憶體中的分組結果。呼叫點在既有 `classifySegments` 之後，逐一對 `classifications` 中 `level === null`（未達 B 級）且 `saturation_score` 落於灰色區間者呼叫 `detectPreWarning`，彙總為 `pre_warning_segments: readonly string[]`（僅記錄 `segment_id`，不重複既有 `classifications` 結構）。

---

## 5. `detectSignalConflicts`（Requirement 3）

```ts
export interface SignalConflict {
  readonly segment_id: string;
  readonly conflict_type: 'crowd_heavy_traffic_light' | 'traffic_heavy_crowd_light';
  readonly advisory_text: string; // 固定樣板，見需求 3 AC6
}

export function detectSignalConflicts(
  classifications: readonly SegmentClassification[],
  nearbyStationsOf: (segmentId: string) => readonly string[], // RoadNetworkModel 既有查表
  crowdTriggeredStationIds: ReadonlySet<string>, // art.3/art.4 已觸發之 BS_ station id 集合
): readonly SignalConflict[] {
  const conflicts: SignalConflict[] = [];
  for (const c of classifications) {
    const stations = nearbyStationsOf(c.segment_id);
    const anyStationTriggered = stations.some((s) => crowdTriggeredStationIds.has(s));
    const allStationsQuiet = stations.length > 0 && stations.every((s) => !crowdTriggeredStationIds.has(s));

    if (c.level === null && anyStationTriggered) {
      conflicts.push(makeConflict(c.segment_id, 'crowd_heavy_traffic_light'));
    } else if (c.level === 'A' && allStationsQuiet) {
      conflicts.push(makeConflict(c.segment_id, 'traffic_heavy_crowd_light'));
    }
  }
  return conflicts;
}
```

`nearbyStationsOf` 為 `RoadNetworkModel` 新增之查表方法，直接讀取既有 `road_network_geometry.json` 之 `nearby_stations` 欄位（例如 `RD_TPE_001` → `["BS_TPE_DOME","BS_MRT_BL17","BS_MRT_BL16","BS_MRT_BL18"]`），不新增資料檔案。`crowdTriggeredStationIds` 由呼叫端在既有 art.3（BL17）、art.4（大巨蛋）求值後（`decision_pipeline.ts:326-362`）以既有回傳結果組裝，不重新實作 art.3/4 判定。`makeConflict` 依 `conflict_type` 填入需求 3 AC6 之固定中文樣板字串（常數表，非樣板引擎）。

---

## 6. `detectCascadingRisk`（Requirement 4）

```ts
export interface CascadingRisk {
  readonly event_ids: readonly string[];
  readonly advisory_text: string;
}

export function buildAdjacencyGraph(segments: readonly RoadSegment[]): ReadonlyMap<string, ReadonlySet<string>> {
  // 兩路段互為 alternatives 成員，或彼此 intersections 名稱與對方 name 相符時，視為相鄰邊
  // 純函式：僅依賴 road_network_geometry.json 既有的 intersections/alternatives 欄位
}

export function detectCascadingRisk(
  activeIncidents: readonly Incident[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  isArticle2Triggered: (incident: Incident) => boolean, // 直接傳入 article2.ts 既有匯出函式
): CascadingRisk | null {
  const nonEscalated = activeIncidents.filter((i) => !isArticle2Triggered(i));
  const adjacentPairs = nonEscalated.filter((a) =>
    nonEscalated.some(
      (b) => b.event_id !== a.event_id && adjacency.get(a.affected_segment)?.has(b.affected_segment),
    ),
  );
  if (adjacentPairs.length < 2) return null;
  return {
    event_ids: adjacentPairs.map((i) => i.event_id),
    advisory_text: `偵測到 ${adjacentPairs.length} 起鄰近未達 SOP 第 2 條門檻之事件，建議依通用防禦性原則提升為區域協調應變等級，儘速人工複核`,
  };
}
```

`isArticle2Triggered` 直接複用 `article2.ts` 既有匯出函式（`article2.ts:71-83`），不重新實作 3-AND 判定。呼叫點在既有管線組裝完 `DecisionCore` 前，傳入當次決策可見之現行事件清單（若管線目前僅持有單一 `incident`，需在管線入口處額外傳入 `live_incidents.json` 全量清單作為「現行事件」上下文——此為唯一需要擴充管線輸入介面之處，詳見 `tasks.md` TASK-GZAE-04a）。

---

## 7. DecisionCore／API／LLM 邊界（Requirement 5）

### 7.1 `DecisionCore` 新增欄位

```ts
// packages/shared-schemas/src/decision_core.ts
pre_warning_segments: readonly string[];
signal_conflicts: readonly SignalConflict[];
cascading_risk: CascadingRisk | null;
self_blocked_exclusions: readonly string[];
```

四欄位均由 `runDeterministicDecision` 於既有 `aggregateArticles` 之後統一寫入，型別定義集中於新檔案 `packages/shared-schemas/src/grey_zone.ts`（`SignalConflict`、`CascadingRisk` 型別），`decision_core.ts` 僅 import 使用，不重複定義。

### 7.2 `LLM_PROHIBITED_FIELDS` 同步

比照 UARE 需求 8 之既有機制：

1. 於 `packages/shared-schemas/src/llm_boundary.ts` 之 `PROHIBITED_KEYS` 加入 `pre_warning_segments`、`signal_conflicts`、`cascading_risk`、`self_blocked_exclusions`。
2. 於根目錄 `eslint-local-rules.cjs` 之手動複本同步加入相同四個字串，保持逐字一致。
3. 既有 `eslint-local-rules/test/prohibited-fields-sync.test.ts` 為資料驅動測試（比對兩份清單集合相等），新增欄位後既有測試邏輯自動涵蓋，不需修改測試程式本身，僅需兩份清單皆更新。

### 7.3 Bedrock 輸出過濾

`packages/rag/src/schema_validator.ts`（或其等效驗證點）既有之欄位過濾路徑已對 `DecisionCore` 全體欄位生效（依既有機制以 `PROHIBITED_KEYS` 驅動，非逐欄位硬編），故完成 §7.2 後本節無需額外程式改動，僅需新增測試斷言覆蓋新欄位（見 `tasks.md` TASK-GZAE-08）。

---

## 8. 執行順序與插入點總覽

```
runDeterministicDecision():
  ...既有 233-379 行（art1/art2/art3/art4/art5/art6 各自求值，不變）...
  const articles = aggregateArticles(...)                         // 既有，383-386 行，不變
  + const candidates2 = excludeSelfBlockedCandidates(candidates, incident.event_id, allActiveIncidents)  // R1，取代原 candidates 供下游使用
  + const preWarningSegments = classifications.filter(...).map(c => detectPreWarning(...))               // R2
  + const signalConflicts = detectSignalConflicts(classifications, roadNetwork.nearbyStationsOf, crowdTriggeredStationIds)  // R3
  + const cascadingRisk = detectCascadingRisk(allActiveIncidents, adjacency, isArticle2Triggered)         // R4
  ...既有 DecisionCore 組裝，改用 candidates2 計算 primary/secondary/excluded；新增四欄位寫入...
```

四個新函式互不依賴，可平行實作與測試；共同前提是管線需能存取「當次事件之外的其他現行事件清單」（R1、R4 皆需要），此為本設計相對既有單事件管線的唯一介面擴充點。

---

## 9. 測試策略對應

見 `requirements.md` 需求 5（AC4～AC9）逐條列舉，測試檔案配置：

- `packages/domain/test/unit/grey_zone_arbitration.test.ts`：R1～R4 四個純函式之單元測試（含純函式性 property test）。
- `packages/domain/test/integration/grey_zone_arbitration_pipeline.test.ts`：三筆官方事件 no-regression 測試 + fixture 化的自我阻塞/疊加風險整合測試。
- `eslint-local-rules/test/prohibited-fields-sync.test.ts`：既有測試自動涵蓋新欄位（§7.2）。
