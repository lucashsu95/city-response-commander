# Architectural Decision Records (ADR)

> 記錄本專案的關鍵技術決策。新 agent 读此文件可快速了解「为什么这么做」。
> 最後更新：2026-08-01

---

## 格式

每筆 ADR 使用以下格式：

```markdown
### ADR-XXX: [標題]

- **日期**: YYYY-MM-DD
- **狀態**: Accepted | Deprecated | Superseded by ADR-YYY
- **決策者**: [誰做的決定]
- **背景**: [為什麼需要做這個決定]
- **決策**: [我們決定做什麼]
- **理由**: [為什麼這樣選]
- **影響**: [這個決定影響什麼]
- **替代方案**: [考慮過但放棄的選項]
```

---

## ADR-001: 決定性程式碼優於 AI 判斷

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: 全隊
- **背景**: 黑客松評審要求「可靠決策」。如果讓 Bedrock 做數值判定，每次執行結果可能不同，無法保證一致性。
- **決策**: 所有數值判定（資料解析、分級、SOP 觸發、路徑篩選、ETE 計算）由 TypeScript 決定性程式碼負責。Bedrock 只負責 NL 生成。
- **理由**: 決定性程式碼的輸出可預測、可測試、可稽核。AI 生成的數值不可靠。
- **影響**: `domain` 層是整個系統的核心，所有判定邏輯都在這裡。`ai-generator` 只做文字包裝。
- **替代方案**: 讓 Bedrock 直接做判定 → 拒絕，因為不可靠。

---

## ADR-002: 時間對齊取最近 prior (Strategy A)

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: A（規則引擎）
- **背景**: 事件發生時間（如 14:35）可能不在 CSV 的時間序列中（14:30, 14:40）。如何對齊？
- **決策**: 取最近的 prior（不超過 10 分鐘），例如 14:35 → 用 14:30 的資料。
- **理由**: 不用未來資料，符合即時監控邏輯（指揮官看到的是「已發生」的狀態）。
- **影響**: `domain` 層的時間對齊函數需實現此邏輯。
- **替代方案**: 取最近的（可能用未來資料）→ 拒絕。 interpolation（插值）→ 太複雜，7 天內不做。

---

## ADR-003: Lambda 直接編排（不用 Step Functions）

- **日期**: 2026-07-26
- **狀態**: Accepted
- **決策者**: B（後端）
- **背景**: 最初設計用 Step Functions Express Workflow 編排 Lambda，但 7 天內時間有限。
- **決策**: 先用 Lambda 直接編排（單一 Lambda 處理完整流程），待 demo 後再重構為 Step Functions。
- **理由**: 降低複雜度，確保 7 天內能跑通。黑客松不是產品，先求功能正確。
- **影響**: `backend` 層的 handler 會比較大，但更容易 debug。
- **替代方案**: Step Functions → 保留為 M6+ 的重構目標。

---

## ADR-004: LOCAL_MOCK 先行

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: 全隊
- **背景**: 不確定每位隊員都有 AWS 帳號權限。7 天內先確保能跑，再上雲端。
- **決策**: 開發階段全部用 LOCAL_MOCK 模式（讀取本地 JSON/CSV），deploy 階段再切 AWS。
- **理由**: 降低外部依賴風險，讓每個人可以在本地開發。
- **影響**: `config` 層需支援 LOCAL_MOCK 和 AWS 雙模式。
- **替代方案**: 直接用 AWS → 風險太高，有人沒帳號。

---

## ADR-005: 時間對齊忽略 affected_road (Strategy B)

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: A（規則引擎）
- **背景**: 官方 `affected_road` 欄位在 SOP 第 3 條（捷運人流）中未提及，但在其他 SOP 中有模糊引用。
- **決策**: 忽略 `affected_road` 欄位，所有路段判定依據 `segment_id` 和 `saturation_score`。
- **理由**: 最小化假設，不引入未在 SOP 中明確定義的邏輯。
- **影響**: 規則引擎不使用此欄位，可能導致某些 edge case 判定不完整。
- **替代方案**: 使用 affected_road → 需要額外假設，風險較高。

---

## ADR-006: ETE 受影響路段 = 事故路段 + alternatives (Strategy C)

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: A（規則引擎）
- **背景**: ETE 計算需要知道「受影響路段」，但 SOP 沒有明確定義範圍。
- **決策**: 受影響路段 = 事故路段本身 + alternatives 中被選為疏散路徑的路段。
- **理由**: 最小合理範圍，不擴大影響評估。
- **影響**: ETE 可能低估實際影響範圍。
- **替代方案**: 包含所有上游路段 → 太複雜，7 天內不做。

---

## ADR-007: 測試接縫在 Domain 層

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: 全隊
- **背景**: 需要決定主要測試策略。是測 API？測前端？測規則引擎？
- **決策**: 主要測試接縫在 `domain` 層（SOP 判斷），使用 PBT + 邊界測試。其他層用較少的測試。
- **理由**: Domain 是核心邏輯，所有其他模組都依賴它的輸出。測好 domain = 系統可靠。
- **影響**: 測試資源集中在 domain，其他層可能有 coverage gap。
- **替代方案**: 全面測試 → 時間不夠。

---

## ADR-008: Commit 訊息使用 Conventional Commits

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: 全隊
- **背景**: 多人協作需要統一的 commit 訊息格式，方便 generate changelog 和 code review。
- **決策**: 使用 Conventional Commits 格式（feat/fix/docs/refactor/test/chore）。
- **理由**: 業界標準，工具支援好，易於 parse。
- **影響**: 所有 commit 都要遵循格式。
- **替代方案**: 無格式 → 太亂。

---

## ADR-009: 事故錨點解析用 LLM + 程式確認 (Strategy D)

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: D（AI 整合）
- **背景**: `live_incidents.json` 中的位置描述是自然語言（如「光復南路」），需要轉換為 `segment_id`。
- **決策**: 先用 LLM 從自然語言中提取候選路段，再用程式碼確認（exact match 或 fuzzy match）。
- **理由**: 平衡準確性與彈性。LLM 做初步提取，程式碼做最終確認。
- **影響**: `domain` 層需要一個 `resolveRoadSegment()` 函數。
- **替代方案**: 純 LLM → 不可靠。純程式碼 → 難以處理自然語言。

---

## ADR-010: 多語範圍 = 全資料集基地台 (Strategy F)

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: D（AI 整合）
- **背景**: SOP 第 6 條說「任一基地台」Roaming >= 30% 時觸發多語通報。但「任一」是指事故現場的基地台？還是全市？
- **決策**: 取全資料集（所有 9 個基地台）的 roaming 數據，任一 >= 30% 即觸發。
- **理由**: 最嚴格解釋，不漏警報。安全優先。
- **影響**: 可能觸發頻率較高（false positive 較多）。
- **替代方案**: 只看事故現場基地台 → 可能漏報。

---

## ADR-011: 先不做多事件同時發生

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: 全隊
- **背景**: 真實場景中可能同時發生多起事故，但 7 天內時間有限。
- **決策**: 一次只處理一個事件。如果同時有多個事件，取最高優先級的。
- **理由**: 降低複雜度，確保 7 天內能完成。
- **影響**: Demo 時只能展示單一事件場景。
- **替代方案**: 多事件併行 → 太複雜。

---

## ADR-012: Demo 範圍 = 3 個全做

- **日期**: 2026-07-24
- **狀態**: Accepted
- **決策者**: 全隊
- **背景**: 官方提供 3 個事件（ACC_001 車禍、EVT_002 捷運人流、EVT_003 號誌故障）。要全做還是只做 1 個？
- **決策**: 3 個全做，展示系統完整性。
- **理由**: 評審會看是否能處理不同類型的事件。全做能展示廣度。
- **影響**: 工作量增加，但邊界案例都在 domain 層已定義。
- **替代方案**: 只做 1 個 → 風險較低但展示不完整。

---

## ADR-013: 報告格式 = 15 頁簡報 + 3 分鐘影片

- **日期**: 2026-07-28
- **狀態**: Accepted
- **決策者**: E（報告）
- **背景**: 黑客松提交需要簡報和影片，但規格不明確。
- **決策**: 15 頁 PowerPoint 簡報 + 3 分鐘 Demo 影片。
- **理由**: 黑客松標準配置，足夠展示技術深度和產品價值。
- **影響**: E 需要額外時間製作簡報和影片。
- **替代方案**: 只做 README → 太簡陋。

---

## ADR-014: APP_ENV 環境變數橋接與 Fail-Fast 配置解析策略

- **日期**: 2026-08-01
- **狀態**: Accepted
- **決策者**: B（後端 / Backend Workflow Lead）
- **背景**: `infra/lib/constructs/lambdas.ts` 在每個 runtime Lambda 注入 `APP_ENV`，並將該 key 列為保留（`environment` prop 覆寫它會在 synth 時拋錯）；但 `packages/config/src/provider_factory.ts` 的 `resolveProfile()` 只讀 `CITY_COMMANDER_ENV`。兩者之間沒有任何橋接。結果是已部署的 Lambda 會有正確的 `APP_ENV`、沒有 `CITY_COMMANDER_ENV`，然後在第一次 `createConfigProvider()` 就拋 `ConfigLoadError` — **每次 invocation 冷啟動崩潰，而錯誤訊息指向一個基礎設施從未設定的變數**。
- **決策**: 改為依序讀取 `PROFILE_ENV_KEYS = ['CITY_COMMANDER_ENV', 'APP_ENV']`。兩項附帶規則：
  1. 值為空字串或全空白視為「未設定」，繼續往下一個 key（CloudFormation 未解析的 `Ref` 會渲染成空字串，而非省略變數）。
  2. **有值但不是合法 profile 時立刻拋錯，不 fallback 到下一個 key**，錯誤訊息指名是哪個 key 出錯。
- **理由**: `CITY_COMMANDER_ENV` 保留優先權，讓本機 shell 仍能覆寫平台注入的值。而第 2 條是關鍵：若 typo（例如 `CITY_COMMANDER_ENV=PERSONAL_AWS`）靜默落到 `APP_ENV`，可能讓 dev shell 指向 `COMPETITION_AWS` — 這正好違反本模組「Never silently falls back to hard-coded values」的存在理由。**寧可冷啟動拒絕啟動，也不要連到錯誤環境。**
- **影響**: `packages/config` 匯出 `PROFILE_ENV_KEYS`。既有 88 個 config 測試全數通過（原有的錯誤訊息斷言使用 regex，新訊息仍相符）。長期建議統一為 `APP_ENV` 單一名稱，因為它是 CDK 自動注入且無法被誤蓋的那個；反向統一則需改動 `ai-generator/src/bedrock.ts`、`scripts/local_mock_rehearsal.sh`、`scripts/mock-bedrock-walkthrough.ts`、`.github/workflows/ci.yml`、`runbooks/00_local_mock_rehearsal.md` 共 5 處。
- **替代方案**:
  - 只改 CDK 改注入 `CITY_COMMANDER_ENV` → 需同時改動 `lambdas.ts` 的保留 key 驗證，且不解決已部署環境的問題。
  - 給 profile 一個預設值（例如 `LOCAL_MOCK`）→ **拒絕**。預設值會讓設定缺失變成靜默的錯誤環境連線，這比崩潰危險得多。

---

## ADR-015: 官方競賽資料集 `.gitattributes` `-text` 雜湊保護策略

- **日期**: 2026-08-01
- **狀態**: Accepted
- **決策者**: B（後端 / Backend Workflow Lead）
- **背景**: `中華電信資料集/` 下的官方檔案是 SSOT，SHA-256 記錄在 `packages/domain/src/source_manifest/official_source_manifest.ts` 的 `DEFAULT_EXPECTED_HASHES`。為修正 Windows 上 `prettier --check` 誤報，曾加入全域 `* text=auto eol=lf`，並執行 `git add --renormalize .` — 這把兩個官方 CSV 由 CRLF 轉成 LF，**改變了它們的位元組，因此改變了 SHA-256**。實測證據：

  | 檔案 | manifest expected | CRLF（正確） | LF（被破壞） |
  |---|---|---|---|
  | `city_traffic_flow.csv` | `B31436B5…541D5F2A` | `B31436B5…541D5F2A` ✅ | `94B3B78F…AF30173D` ❌ |
  | `signaling_crowd_density.csv` | `BD9BC159…E9564073` | `BD9BC159…E9564073` ✅ | `FDCEA7BE…AA6CACAD` ❌ |

  兩個檔案都是 runtime decision source，雜湊不符會觸發 `SOURCE_INTEGRITY_STOP`，**decision pipeline 整條停止**。

- **決策**:
  1. `中華電信資料集/** -text` — 完全禁用行尾轉換，位元組不做任何修飾。此規則**刻意放在 `.gitattributes` 最後**，因為後者覆蓋前者，確保上方的 `*.json` / `*.pdf` / `*.docx` 規則不會蓋掉這批資料的保護。
  2. 移除全域 `* text=auto eol=lf`，改為按副檔名限定（`*.ts` / `*.tsx` / `*.js` / `*.json` / `*.md` / `*.yml` / `*.sh` 等），同樣達成 Prettier 一致性目的。
- **理由**: **不可使用 `text eol=lf` 來「鎖定」雜湊驗證對象。** 該屬性的語意是「這是文字檔，請把它轉成 LF」，對一個以 CRLF 提交的檔案，它會**主動製造**它宣稱要防止的雜湊不符。這不是推論 — 在 `text eol=lf` 生效的狀態下實際觀察到三個症狀：(a) `git status` 永久顯示這兩個檔案為已修改；(b) `git checkout -- "中華電信資料集/"` 無法清除；(c) 切換分支被「local changes would be overwritten」擋住。`-text` 的語意才是「完全不做行尾轉換」，這是雜湊驗證輸入唯一正確的保證。
- **影響**: 修復後 `git ls-files --eol` 顯示 `i/crlf w/crlf attr/-text`，狀態一致、工作目錄乾淨、切分支不再被擋。`.gitattributes` 內已寫入實測雜湊值與推理過程作為註解，避免重犯。合併至 main 時此檔案會是 add/add 衝突，**應以本版本為準**。
- **替代方案**:
  - `中華電信資料集/** binary` → 效果等同（`binary` 是 `-text -diff` 的別名），但會同時關閉 diff，不利於審視資料變更。
  - 依 LF 內容更新 manifest 的 expected hash → **拒絕**。官方檔案是 SSOT，應該調整我們的工具設定去適應它，而不是改寫官方資料的雜湊紀錄。
  - 保留全域 `* text=auto eol=lf` 並將官方資料排除 → 可行但脆弱：任何新增的官方資料若未同步加排除規則就會再次被破壞，且失效時症狀離成因很遠、極難追查。

---

## 待決策（Open）

以下問題尚未最終決定，先用暫定方案（見 `docs/spec.md` OQ-001~011）：

| ID | 問題 | 暫定方案 |
|---|---|---|
| OQ-001 | 事件時間 vs CSV 時間對不起來 | 取最近 prior |
| OQ-004 | 自然語言位置解析 | LLM + 程式確認 |
| OQ-009 | AI vs 程式判斷 | 程式說了算 |

---

**文件結束**
