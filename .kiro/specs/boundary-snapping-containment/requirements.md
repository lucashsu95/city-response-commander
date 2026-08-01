# Requirements Document

## Introduction

本功能為「城市交通應變 AI 指揮台」在 Bedrock 呼叫之前新增一層決定性的前置關卡：**空間鎖定與邊界接管機制 (Boundary Snapping & Containment Protocol)**。

目的是解決「注入事件超出資料涵蓋範圍」時的兩種失敗模式：LLM 拒答（無法給出任何指揮建議），或 LLM 幻覺（憑空生成不存在的路名與座標）。做法是在事件進入 LLM 之前，由決定性程式碼完成三件事：

1. **空間吸附 (Spatial Snapping)** — 事件地點若無法對應到路網涵蓋範圍，改以決定性演算法對齊到路網上最近的實體周界節點 (Perimeter Anchor)，並將此「已對齊」事實明示於送入 LLM 的 context。
2. **通用應變接管 (Universal Containment)** — 事件類型若在官方 `emergency_traffic_sop.txt` 查無對應條款，掛載 `DEFAULT_UNIVERSAL_SOP`（上游減量、周邊擴散、周界管制），使系統仍能給出指揮建議而非拒答。
3. **API 顯式標示** — 回應中以獨立欄位揭露涵蓋範圍狀態、吸附錨點、改道路段、周界管制動作與 AI 說明，讓指揮官與評審能區分「官方 SOP 依據」與「通用原則推導」。

### 與既有 `insufficient_data` 立場的關係（重要）

本功能**不取代**專案既有的「沒有合法資料就不編造」立場，而是與之共存。兩者處理的是**不同類型的缺失**：

| 缺失類型 | 例子 | 行為 |
|---|---|---|
| **事實數值缺失 (Fact_Gap)** | 找不到事件時間點之前的合法 `Saturation_Score` snapshot | 維持既有行為：回報 `data_status: insufficient_data` 與停止原因，**不得**以通用原則填補或掩蓋 |
| **涵蓋範圍缺失 (Coverage_Gap)** | 事件地點在路網涵蓋範圍外；事件類型在官方 SOP 查無條款 | 啟動吸附與通用接管，仍產出指揮建議 |

兩者可同時發生；同時發生時的行為由需求 7 定義。

### 資料現況（已核實，直接影響需求）

實作前必須知道以下已核實的資料事實，需求已據此設計：

- `road_network_geometry.json` 內的 15 筆路段**完全不含任何座標欄位**（無經緯度、無投影座標、無 geometry 陣列）。可用的空間資訊只有 `segment_id`、`name`、`flow_direction`、`intersections`（中文路口名稱字串）、`capacity_vph`、`alternatives`、`nearby_stations`。
- `live_incidents.json` 的三筆事件**不含座標**，地點以中文自然語言 `location` 加上 `affected_segment` / `affected_road` 之 ID 表示。
- 因此「以座標判定界內外並計算最近距離」在現有官方資料上**無法直接成立**。需求 2 定義以實體集合 (Entity_Scope) 為主的判定路徑，需求 3 定義座標路徑僅在外部提供 `Anchor_Gazetteer` 時才啟用。
- 官方資料中**不存在** `ROAD_BORDER_01` 這類邊界節點 ID。周界錨點必須由路網拓樸決定性推導（需求 4），且推導出的錨點識別碼必須可回溯到真實 `segment_id` 與真實 `intersections` 名稱。

## Glossary

- **Boundary_Snapper**: `packages/domain` (Layer 1) 內的決定性模組，負責涵蓋範圍判定與空間吸附，不呼叫任何外部 API。
- **Sop_Coverage_Resolver**: `packages/domain` (Layer 1) 內的決定性模組，負責以事件 `type` 查詢官方 SOP 條款對應表，查無時回傳通用接管指示。
- **Whitelist_Guard**: `packages/domain` (Layer 1) 內的決定性模組，負責以路網白名單過濾與稽核任何 road id 集合。
- **Containment_Assembler**: `packages/backend` (Layer 2) 內的組裝器，負責把 Boundary_Snapper、Sop_Coverage_Resolver、Whitelist_Guard 的決定性輸出組成 Safe_Context 與 API 回應。
- **Road_Network**: 由 `road_network_geometry.json` 解析而得的路段集合，共 15 筆，每筆有唯一 `segment_id`。
- **Road_Whitelist**: Road_Network 中所有 `segment_id` 的集合，是系統唯一允許出現在決策輸出中的道路識別碼來源。
- **Intersection_Whitelist**: Road_Network 中所有 `intersections` 名稱字串的集合。
- **Entity_Scope_Check**: 以事件的 `affected_segment`、`affected_road` 與 `location` 文字比對 Road_Whitelist 與 Intersection_Whitelist，判定事件是否落在涵蓋範圍內的決定性程序。
- **Coverage_Gap**: 事件的地點或類型無法對應到既有資料涵蓋範圍的狀態。
- **Fact_Gap**: 事件所需的數值事實（例如合法 saturation snapshot）不存在的狀態。
- **Perimeter_Anchor**: 由 Road_Network 拓樸決定性推導出的周界錨點，代表「轄區對外的管制門」。每個 Perimeter_Anchor 必然對應一個真實 `segment_id` 與一個真實 `intersections` 名稱。
- **Perimeter_Gateway_Intersection**: 出現在某路段 `intersections` 中，但不對應 Road_Network 任何路段 `name` 的路口名稱，代表路網對外的開口。
- **Anchor_Gazetteer**: 選用的外部座標對照表，將 Perimeter_Anchor 或路口名稱對應到 WGS84 經緯度。由 ConfigProvider 提供，不隨官方資料集提供。
- **Max_Snap_Distance_Meters**: 允許吸附的最大地面距離上限，由 ConfigProvider 提供。
- **DEFAULT_UNIVERSAL_SOP**: 系統自訂的通用交通防衛原則集合（上游減量、周邊擴散、周界管制、緩衝區建立），**不是**官方 `emergency_traffic_sop.txt` 的條文。
- **Safe_Context**: 送入 Bedrock 的受限 prompt context，內含已驗證的事實、Road_Whitelist 動作空間、以及適用的官方條款或 DEFAULT_UNIVERSAL_SOP 原則。
- **Data_Scope_Status**: API 回應中揭露涵蓋範圍判定結果的列舉欄位。
- **Perimeter_Control**: 針對 Perimeter_Anchor 的周界管制決策，含動作、目標門與理由。
- **Bedrock_Composer**: `packages/ai-generator` (Layer 1) 內負責措辭生成的元件，只產出自然語言文字。
- **ConfigProvider**: `packages/config` (Layer 1) 的設定讀取介面。

## Requirements

### Requirement 1: 決定性前置關卡的執行順序與職責邊界

**User Story:** 作為交通指揮官，我想要所有涵蓋範圍判定與吸附計算都由決定性程式碼完成，AI 只負責措辭，以便我能稽核每一個判斷的依據。

#### Acceptance Criteria

1. WHEN 系統收到注入事件，THE Containment_Assembler SHALL 在呼叫 Bedrock_Composer 之前依序執行 Entity_Scope_Check、空間吸附、SOP 覆蓋解析、Safe_Context 組裝四個步驟
2. THE Boundary_Snapper SHALL 以純函式形式提供涵蓋範圍判定與吸附計算，對相同輸入回傳相同輸出
3. THE Boundary_Snapper SHALL 僅 import `packages/shared-schemas` 與 `packages/config` 的型別與設定介面
4. THE Sop_Coverage_Resolver SHALL 以決定性查表方式判定事件 `type` 是否對應官方 SOP 條款，並在查無時回傳掛載 DEFAULT_UNIVERSAL_SOP 的指示
5. THE Whitelist_Guard SHALL 對任一 road id 集合回傳「集合內屬於 Road_Whitelist 的成員」與「集合內不屬於 Road_Whitelist 的成員」兩個子集合
6. THE Bedrock_Composer SHALL 僅產出自然語言措辭與解釋文字
7. THE Containment_Assembler SHALL 以 Boundary_Snapper、Sop_Coverage_Resolver、Whitelist_Guard 的輸出作為 API 回應中所有識別碼與數值的唯一來源
8. THE Boundary_Snapper、Sop_Coverage_Resolver、Whitelist_Guard SHALL 全部以 TypeScript strict mode 撰寫，且不使用 `as any`、`@ts-ignore`、`@ts-expect-error`

### Requirement 2: 以實體集合判定事件是否落在涵蓋範圍內

**User Story:** 作為系統，我需要在沒有座標資料的情況下也能判定事件是否落在路網涵蓋範圍內，以便在現有官方資料上就能運作。

#### Acceptance Criteria

1. WHEN 事件的 `affected_segment` 屬於 Road_Whitelist，THE Boundary_Snapper SHALL 判定該事件的地點涵蓋狀態為 `IN_SCOPE`，並以該 `affected_segment` 作為決策錨點
2. WHERE 事件提供 `affected_road` 欄位，WHEN 事件的 `affected_segment` 不屬於 Road_Whitelist 且 `affected_road` 屬於 Road_Whitelist，THE Boundary_Snapper SHALL 判定地點涵蓋狀態為 `IN_SCOPE`，並以 `affected_road` 作為決策錨點
3. WHEN 事件的 `affected_segment` 與 `affected_road` 均不屬於 Road_Whitelist 且事件 `location` 文字包含 Intersection_Whitelist 中至少一個路口名稱，THE Boundary_Snapper SHALL 判定地點涵蓋狀態為 `IN_SCOPE_BY_INTERSECTION`，並以包含該路口名稱之路段中 `segment_id` 字典序最小者作為決策錨點
4. WHEN 事件的 `affected_segment` 與 `affected_road` 均不屬於 Road_Whitelist 且事件 `location` 文字未包含 Intersection_Whitelist 中任何路口名稱，THE Boundary_Snapper SHALL 判定地點涵蓋狀態為 `OUT_OF_BOUNDS` 並進入需求 4 的吸附程序
5. WHEN 事件 `location` 文字包含 Intersection_Whitelist 中多於一個路口名稱，THE Boundary_Snapper SHALL 選擇字元長度最長的路口名稱作為比對結果，並在比對長度相同時選擇字典序最小者
6. THE Boundary_Snapper SHALL 將 Entity_Scope_Check 所比對到的欄位名稱與字串值記錄為吸附證據

### Requirement 3: 座標路徑與距離計算的正確性

**User Story:** 作為系統維運者，我想要當外部系統（例如 Dashboard 地圖點選）提供座標時，距離計算在經緯度上仍然正確，以便吸附結果不會因為座標系統誤用而失真。

#### Acceptance Criteria

1. WHERE ConfigProvider 提供 Anchor_Gazetteer，WHEN 事件輸入包含 WGS84 經緯度座標，THE Boundary_Snapper SHALL 以 Anchor_Gazetteer 中的座標計算候選錨點與事件座標之間的距離
2. WHERE 座標路徑啟用，THE Boundary_Snapper SHALL 以大圓距離公式（haversine）計算地面距離並以公尺為單位回傳
3. WHERE ConfigProvider 未提供 Anchor_Gazetteer，WHEN 事件輸入包含座標，THE Boundary_Snapper SHALL 忽略該座標、改用需求 2 的 Entity_Scope_Check，並在吸附證據中記錄 `gazetteer_unavailable`
4. IF 事件輸入的緯度不在 -90 至 90 之間或經度不在 -180 至 180 之間，THEN THE Boundary_Snapper SHALL 將該座標判定為無效、改用需求 2 的 Entity_Scope_Check，並在吸附證據中記錄 `invalid_coordinate`
5. THE Boundary_Snapper SHALL 將座標路徑的計算距離以整數公尺記入 API 回應
6. WHERE 座標路徑未啟用，THE Boundary_Snapper SHALL 在 API 回應中將吸附距離欄位設為 `null`，而非回傳推測數值

### Requirement 4: 周界錨點的決定性推導與空間吸附

**User Story:** 作為交通指揮官，我想要界外事件被對齊到路網上真實存在的周界管制門，以便我下的每一道封鎖指令都指向實際存在的道路。

#### Acceptance Criteria

1. THE Boundary_Snapper SHALL 將 Road_Network 中「`intersections` 內含至少一個 Perimeter_Gateway_Intersection」的路段判定為周界路段
2. THE Boundary_Snapper SHALL 為每一組（周界路段, Perimeter_Gateway_Intersection）產生一個 Perimeter_Anchor，並在該 Perimeter_Anchor 中同時記錄真實 `segment_id` 與真實路口名稱
3. WHEN 地點涵蓋狀態為 `OUT_OF_BOUNDS` 且座標路徑未啟用，THE Boundary_Snapper SHALL 選擇 `capacity_vph` 最高的周界路段所對應之 Perimeter_Anchor 作為吸附結果，並在 `capacity_vph` 相同時選擇 `segment_id` 字典序最小者
4. WHERE 座標路徑啟用，WHEN 地點涵蓋狀態為 `OUT_OF_BOUNDS`，THE Boundary_Snapper SHALL 選擇與事件座標之大圓距離最小的 Perimeter_Anchor 作為吸附結果，並在距離相同時選擇 `segment_id` 字典序最小者
5. IF Road_Network 中不存在任何周界路段，THEN THE Boundary_Snapper SHALL 回傳 `OUT_OF_JURISDICTION` 並在理由中記錄 `no_perimeter_anchor_available`
6. THE Boundary_Snapper SHALL 使吸附結果的 `segment_id` 屬於 Road_Whitelist
7. THE Boundary_Snapper SHALL 使吸附結果的路口名稱屬於 Intersection_Whitelist
8. WHEN 地點涵蓋狀態為 `IN_SCOPE` 或 `IN_SCOPE_BY_INTERSECTION`，THE Boundary_Snapper SHALL 略過吸附程序並將吸附錨點欄位設為 `null`

### Requirement 5: 吸附距離上限與超出轄區的明確回報

**User Story:** 作為交通指揮官，我想要系統在事件距離路網過遠時明確告訴我「超出轄區」，以便我不會收到把 200 公里外事故硬套到本市路口的假建議。

#### Acceptance Criteria

1. THE Boundary_Snapper SHALL 自 ConfigProvider 讀取 Max_Snap_Distance_Meters，不在程式碼中寫死該數值
2. IF ConfigProvider 未提供 Max_Snap_Distance_Meters，THEN THE Boundary_Snapper SHALL 回傳設定缺失錯誤且不執行吸附
3. WHERE 座標路徑啟用，IF 最近 Perimeter_Anchor 的大圓距離大於 Max_Snap_Distance_Meters，THEN THE Boundary_Snapper SHALL 回傳涵蓋狀態 `OUT_OF_JURISDICTION`、記錄實測距離與門檻值，且不回傳吸附錨點
4. WHEN 涵蓋狀態為 `OUT_OF_JURISDICTION`，THE Containment_Assembler SHALL 在 API 回應中將改道路段與周界管制欄位設為空集合與 `null`，並提供可讀的超出轄區說明
5. WHEN 涵蓋狀態為 `OUT_OF_JURISDICTION`，THE Containment_Assembler SHALL 略過 Bedrock 指揮建議生成，僅生成超出轄區說明文字
6. WHERE 座標路徑未啟用，THE Boundary_Snapper SHALL 在吸附證據中記錄 `distance_threshold_not_applicable`

### Requirement 6: 未知事件類型的通用應變接管

**User Story:** 作為交通指揮官，我想要遇到官方 SOP 未涵蓋的災害類型（例如未知化學氣體洩漏、電信號塔倒塌）時系統仍能給出交通指揮建議，以便我不會在最需要決策時得到一句「無法回答」。

#### Acceptance Criteria

1. THE Sop_Coverage_Resolver SHALL 維護一份事件 `type` 對應官方 SOP 條號的決定性對照表，其內容可回溯到 `emergency_traffic_sop.txt` 的條文
2. WHEN 事件 `type` 在對照表中有對應條號，THE Sop_Coverage_Resolver SHALL 回傳該條號集合並將 SOP 涵蓋狀態設為 `OFFICIAL_SOP_MATCHED`
3. WHEN 事件 `type` 在對照表中查無對應條號且事件 `description` 亦不符合任何條文的文字觸發條件，THE Sop_Coverage_Resolver SHALL 將 SOP 涵蓋狀態設為 `UNKNOWN_TYPE_UNIVERSAL_SOP` 並掛載 DEFAULT_UNIVERSAL_SOP
4. THE DEFAULT_UNIVERSAL_SOP SHALL 包含上游減量、周邊擴散、周界管制三項通用交通防衛原則
5. WHEN SOP 涵蓋狀態為 `UNKNOWN_TYPE_UNIVERSAL_SOP`，THE Containment_Assembler SHALL 在 Safe_Context 中要求 Bedrock_Composer 依 DEFAULT_UNIVERSAL_SOP 產出指揮措辭並說明安全緩衝區 (Buffer Zone) 的建立方式
6. WHEN SOP 涵蓋狀態為 `UNKNOWN_TYPE_UNIVERSAL_SOP`，THE Containment_Assembler SHALL 在 API 回應中將 DEFAULT_UNIVERSAL_SOP 的原則以 `principle_id` 形式標示，且使 `principle_id` 的命名與官方 SOP 條號欄位分屬不同欄位
7. WHEN SOP 涵蓋狀態為 `UNKNOWN_TYPE_UNIVERSAL_SOP`，THE Containment_Assembler SHALL 在 API 回應中提供 `sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE'` 標記，以與 `sop_authority: 'OFFICIAL_SOP'` 區隔
8. THE Containment_Assembler SHALL 使 Safe_Context 中的官方條文原句與 DEFAULT_UNIVERSAL_SOP 原則文字分別以可辨識的區塊標題呈現
9. WHEN SOP 涵蓋狀態為 `UNKNOWN_TYPE_UNIVERSAL_SOP`，THE Containment_Assembler SHALL 在 Safe_Context 中要求輸出建議且不得回覆「無法判斷」類拒答語句

### Requirement 7: 事實數值缺失與涵蓋範圍缺失的並存處理

**User Story:** 作為評審與指揮官，我想要清楚區分「系統缺數據所以不敢算」與「系統缺涵蓋範圍所以改用通用原則」，以便我不會把通用建議誤認為有數據支撐的結論。

#### Acceptance Criteria

1. THE Containment_Assembler SHALL 在 API 回應中以 `data_status` 欄位表達 Fact_Gap 判定結果，並以 `data_scope_status` 欄位表達 Coverage_Gap 判定結果
2. WHEN 系統找不到事件時間點之前的合法 saturation snapshot，THE Containment_Assembler SHALL 將 `data_status` 設為 `insufficient_data` 並提供停止原因
3. WHEN `data_status` 為 `insufficient_data`，THE Containment_Assembler SHALL 在 API 回應中將所有依賴 saturation 數值的欄位設為 `null`
4. WHEN `data_status` 為 `insufficient_data`，THE Containment_Assembler SHALL 禁止 Safe_Context 中出現任何 saturation 數值或依 saturation 推導之數值
5. WHEN `data_status` 為 `insufficient_data` 且 `data_scope_status` 為 `OUT_OF_BOUNDS_SNAPPED`，THE Containment_Assembler SHALL 同時回報兩個狀態，並僅產出不依賴數值的周界管制與緩衝區建議
6. THE Containment_Assembler SHALL 使 DEFAULT_UNIVERSAL_SOP 的掛載不改變 `data_status` 的判定結果
7. WHEN `data_status` 為 `insufficient_data`，THE Containment_Assembler SHALL 在回應說明文字中載明缺少的資料項目名稱
8. `data_status` 之判定範圍**僅限於**既有 `DataIngestionService` 的 manifest STOP gate（`ingestion.data_status`，7 份官方來源雜湊比對）。THE Containment_Assembler SHALL NOT 新增或擴大逐事件（per-incident）層級的 Fact_Gap 偵測邏輯（例如個別路段找不到合法 Saturation_Score snapshot 而 `SnapshotSelector`/`TimeAlignmentStrategy` 回傳空值的情形）；此類逐事件缺值目前由既有 Strategy A 管線以欄位層級 `null` 呈現，不觸發頂層 `data_status: insufficient_data`。若未來需要將逐事件缺值升級為頂層 `insufficient_data`，須另立需求，不屬本 spec 範圍——本 spec 僅負責讓 Coverage_Gap 判定正確讀取既有 `ingestion.data_status`，不改變其觸發條件

### Requirement 8: Safe_Context 的動作空間限制

**User Story:** 作為系統，我需要把 LLM 的動作空間限制在真實路網白名單內，以便 LLM 無法生成不存在的道路。

#### Acceptance Criteria

1. THE Containment_Assembler SHALL 在 Safe_Context 中列出本次決策允許使用的 road id 白名單，且該白名單為 Road_Whitelist 的子集合
2. WHEN 涵蓋狀態為 `OUT_OF_BOUNDS_SNAPPED`，THE Containment_Assembler SHALL 使 Safe_Context 中的允許白名單包含吸附錨點所屬路段及其 `alternatives` 中屬於 Road_Whitelist 的成員
3. THE Containment_Assembler SHALL 在 Safe_Context 中要求 Bedrock_Composer 只使用允許白名單內的 road id
4. WHEN 涵蓋狀態為 `OUT_OF_BOUNDS_SNAPPED`，THE Containment_Assembler SHALL 在 Safe_Context 中載明事件座標或原始地點字串未落於已劃設涵蓋範圍、以及系統已對齊至指定 Perimeter_Anchor 的事實
5. THE Containment_Assembler SHALL 禁止 Safe_Context 包含未經 Boundary_Snapper 或 Sop_Coverage_Resolver 輸出的 road id、路口名稱與數值

### Requirement 9: LLM 輸出的白名單稽核與處理

**User Story:** 作為交通指揮官，我想要 LLM 回覆中任何白名單外的道路都被系統擋下來，以便我看到的每條道路都在官方路網中真實存在。

#### Acceptance Criteria

1. WHEN Bedrock_Composer 回傳生成結果，THE Whitelist_Guard SHALL 抽取該結果中所有符合 road id 格式的字串並比對允許白名單
2. IF Bedrock_Composer 回傳結果包含允許白名單以外的 road id，THEN THE Containment_Assembler SHALL 將該 road id 記入違規清單且不將其寫入 `decision.reroute_roads`
3. WHEN 違規清單非空，THE Containment_Assembler SHALL 在 API 回應中以獨立欄位揭露違規 road id 清單與偵測次數
4. THE Containment_Assembler SHALL 使 `decision.reroute_roads` 的每一個成員皆屬於允許白名單
5. THE Containment_Assembler SHALL 使 `decision.perimeter_control.target_gate` 對應之路段屬於 Road_Whitelist
6. IF Bedrock_Composer 呼叫失敗或超時，THEN THE Containment_Assembler SHALL 以決定性輸出組成不含 AI 措辭的回應並在回應中標示 AI 說明不可用

### Requirement 10: API 回應的顯式標示欄位

**User Story:** 作為 Dashboard 開發者與評審，我想要 API 回應以獨立欄位明示涵蓋範圍狀態與吸附結果，以便畫面能直接呈現「系統知道自己在推斷什麼」。

#### Acceptance Criteria

1. THE Containment_Assembler SHALL 在 API 回應中提供 `data_scope_status` 欄位，其值屬於 `IN_SCOPE`、`IN_SCOPE_BY_INTERSECTION`、`OUT_OF_BOUNDS_SNAPPED`、`OUT_OF_JURISDICTION` 之一
2. WHEN 涵蓋狀態為 `OUT_OF_BOUNDS_SNAPPED`，THE Containment_Assembler SHALL 在 API 回應中提供 `mapped_anchor_node` 欄位，內含吸附錨點的 `segment_id`、路口名稱與吸附距離
3. THE Containment_Assembler SHALL 在 API 回應中提供 `decision.reroute_roads` 欄位，其成員為 road id 字串陣列
4. WHEN 涵蓋狀態為 `OUT_OF_BOUNDS_SNAPPED`，THE Containment_Assembler SHALL 在 API 回應中提供 `decision.perimeter_control` 欄位，內含 `action`、`target_gate`、`reason` 三個子欄位
5. THE Containment_Assembler SHALL 在 API 回應中提供 `decision.ai_reasoning` 欄位，內含 Bedrock_Composer 產出的說明文字
6. THE Containment_Assembler SHALL 在 API 回應中提供 `sop_coverage_status` 與 `sop_authority` 欄位
7. THE Containment_Assembler SHALL 將 `data_scope_status`、`mapped_anchor_node`、`decision.perimeter_control`、`sop_coverage_status`、`sop_authority` 之型別定義置於 `packages/shared-schemas`
8. THE Containment_Assembler SHALL 使 `data_scope_status`、`mapped_anchor_node`、`decision.reroute_roads`、`decision.perimeter_control`、`sop_coverage_status`、`sop_authority` 為 LLM 不可寫入欄位
9. WHEN 涵蓋狀態為 `IN_SCOPE` 或 `IN_SCOPE_BY_INTERSECTION`，THE Containment_Assembler SHALL 將 `mapped_anchor_node` 設為 `null`

### Requirement 11: 設定項目管理

**User Story:** 作為系統維運者，我想要吸附與接管行為的所有門檻都透過設定檔調整，以便不同轄區部署時不需改動程式碼。

#### Acceptance Criteria

1. THE ConfigProvider SHALL 提供 `boundary_snapping.max_snap_distance_meters` 設定項目
2. THE ConfigProvider SHALL 提供 `boundary_snapping.coordinate_path_enabled` 設定項目
3. WHERE `boundary_snapping.coordinate_path_enabled` 為真，THE ConfigProvider SHALL 提供 `boundary_snapping.anchor_gazetteer_source` 設定項目
4. THE ConfigProvider SHALL 提供 `containment.universal_sop_enabled` 設定項目
5. WHERE `containment.universal_sop_enabled` 為假，WHEN SOP 涵蓋狀態為 `UNKNOWN_TYPE_UNIVERSAL_SOP`，THE Containment_Assembler SHALL 回報事件類型未涵蓋且不生成指揮建議
6. IF 任一必要設定項目缺失，THEN THE Containment_Assembler SHALL 回傳設定錯誤且不呼叫 Bedrock_Composer

### Requirement 12: 與既有決定性管線 `runDeterministicDecision` 的執行順序與短路規則

**User Story:** 作為後端工程師，我想要 Boundary_Snapper／Sop_Coverage_Resolver 與既有 `runDeterministicDecision`（`packages/domain/src/rule_engine/decision_pipeline.ts`）之間有明確的呼叫順序與短路規則，以便同一次決策不會產生兩份互相矛盾的地點解析結果。

#### Acceptance Criteria

1. THE Containment_Assembler SHALL 在呼叫 `runDeterministicDecision` 之前，先以 `ingestion.roadNetwork` 與 `ingestion.sopArticles` 執行 Entity_Scope_Check（需求 2）與 SOP 覆蓋解析（需求 6）
2. IF `ingestion.data_status` 不為 `ready`（既有 manifest STOP gate 觸發，`ingestion.roadNetwork` 為 `undefined`），THEN THE Containment_Assembler SHALL 略過 Entity_Scope_Check 與空間吸附程序，直接回傳既有的 `insufficient_data` / `stop_reason`，且不判定 `data_scope_status`
3. WHEN 地點涵蓋狀態為 `IN_SCOPE` 或 `IN_SCOPE_BY_INTERSECTION`，THE Containment_Assembler SHALL 依既有行為完整呼叫 `runDeterministicDecision`（含 RD_ 分支之 classification、Strategy D anchor resolve、evacuation、ETE），不得跳過或改變其既有輸出
4. WHEN 地點涵蓋狀態為 `OUT_OF_BOUNDS_SNAPPED` 或 `OUT_OF_JURISDICTION`，THE Containment_Assembler SHALL 略過 `runDeterministicDecision` 中 RD_ 事件分支的 classification、Strategy D（`IncidentAnchorResolutionStrategy`）、`qualifyCandidates`、`selectEvacuation`、ETE 計算，改以 Boundary_Snapper 之 Perimeter_Anchor 與 DEFAULT_UNIVERSAL_SOP 組裝決策
5. WHEN 地點涵蓋狀態為 `OUT_OF_BOUNDS_SNAPPED` 或 `OUT_OF_JURISDICTION`，THE Containment_Assembler SHALL 仍執行 SOP-3/SOP-4/SOP-6（art.3、art.4、art.6，人流與多語觸發）與既有邏輯相同，因其判定依據為 `BS_ID` 站點而非 `affected_segment`，不受地點涵蓋狀態影響
6. THE Containment_Assembler SHALL 在 API 回應中對任一事件僅呈現一份 `incident_anchor`（既有 `IncidentAnchor`，用於 evacuation 定位）與一份（若適用）`mapped_anchor_node`（新 `Perimeter_Anchor`，用於周界管制），兩者語意不同、不得互相覆蓋，且當 `data_scope_status` 為 `OUT_OF_BOUNDS_SNAPPED`／`OUT_OF_JURISDICTION` 時 `incident_anchor` SHALL 為 `null`（因未執行 Strategy D）
7. THE Containment_Assembler SHALL 具備整合測試，驗證 `IN_SCOPE` 事件的既有 `decision_pipeline.ts` 輸出（`incident_anchor`、`primary_evacuation`、`ete` 等）在導入本功能前後完全不變（no-regression）

### Requirement 13: `LLM_PROHIBITED_FIELDS` 雙份清單同步

**User Story:** 作為系統維運者，我想要新增的顯式標示欄位被既有的 LLM 寫入防護機制涵蓋，以便這些欄位跟 `DecisionCore` 既有欄位受到同等程度的稽核保護。

#### Acceptance Criteria

1. IF `data_scope_status`、`mapped_anchor_node`、`decision.reroute_roads`、`decision.perimeter_control`、`sop_coverage_status`、`sop_authority` 併入 `DecisionCore`（`packages/shared-schemas/src/decision_core.ts`）型別，THEN THE 實作 SHALL 將上述欄位名稱加入 `packages/shared-schemas/src/llm_boundary.ts` 的 `PROHIBITED_KEYS`
2. WHEN `PROHIBITED_KEYS` 有異動，THE 實作 SHALL 同步更新 repo 根目錄 `eslint-local-rules.cjs` 內的手動複本，使其與 `PROHIBITED_KEYS` 保持逐字一致
3. THE 實作 SHALL 令既有 `eslint-local-rules/test/prohibited-fields-sync.test.ts` 涵蓋新增欄位，作為兩份清單一致性的自動化稽核，而非僅依賴人工複查
4. IF 上述欄位改為定義於 `DecisionCore` 以外的獨立型別（不併入 `DecisionCore`），THEN THE 實作 SHALL 提供與 `LLM_PROHIBITED_FIELDS` 等效的獨立守門機制，並在 `packages/rag/src/schema_validator.ts`（或其等效驗證點）中實際套用，不得僅以文件宣稱「LLM 不可寫入」而無程式強制力
5. THE Containment_Assembler SHALL 使 Bedrock_Composer 的輸出內容經過與既有 `DecisionCore` 欄位相同的驗證路徑（`schema_validator.ts`）過濾，禁止 Bedrock 回覆中出現的文字覆寫 `data_scope_status`、`mapped_anchor_node`、`decision.perimeter_control`、`sop_coverage_status`、`sop_authority` 等欄位的值

### Requirement 14: 測試涵蓋要求

**User Story:** 作為專案維護者，我想要吸附與接管邏輯有屬性測試與邊界測試把關，以便規則變更時能立刻發現破壞。

#### Acceptance Criteria

1. THE Boundary_Snapper SHALL 具備以 fast-check 執行且每個屬性至少 100 次迭代的屬性測試
2. THE Boundary_Snapper SHALL 通過屬性「對任意輸入事件，吸附結果的 `segment_id` 為 `null` 或屬於 Road_Whitelist」
3. THE Boundary_Snapper SHALL 通過屬性「對任意輸入事件，以相同輸入重複執行兩次得到相同輸出」
4. THE Boundary_Snapper SHALL 通過屬性「對任意輸入事件，涵蓋狀態為 `OUT_OF_JURISDICTION` 時吸附錨點為 `null`」
5. THE Whitelist_Guard SHALL 通過屬性「對任意 road id 集合，回傳的兩個子集合聯集等於輸入集合且交集為空集合」
6. THE Sop_Coverage_Resolver SHALL 具備涵蓋官方對照表內每一個事件 `type` 以及至少三個未知 `type` 的測試案例
7. THE Boundary_Snapper SHALL 具備 Max_Snap_Distance_Meters 的邊界測試，涵蓋距離恰等於門檻、略小於門檻、略大於門檻三種情形
8. THE Containment_Assembler SHALL 具備整合測試，涵蓋 `IN_SCOPE`、`OUT_OF_BOUNDS_SNAPPED`、`OUT_OF_JURISDICTION`、以及 `insufficient_data` 與 `OUT_OF_BOUNDS_SNAPPED` 並存四種回應情形
9. THE Containment_Assembler SHALL 具備需求 12 的 no-regression 整合測試（`IN_SCOPE` 事件之既有 `decision_pipeline.ts` 輸出於導入前後逐欄位比對不變）
10. THE 實作 SHALL 具備需求 13 的 `prohibited-fields-sync.test.ts` 擴充測試，驗證新增顯式標示欄位在兩份 `LLM_PROHIBITED_FIELDS` 複本中皆存在且一致
11. THE Whitelist_Guard 或 `schema_validator.ts` SHALL 具備測試，驗證 Bedrock_Composer 回覆文字中若包含 `data_scope_status`／`sop_authority` 等保留欄位名稱或試圖覆寫其值，最終輸出仍以決定性程式碼之值為準
