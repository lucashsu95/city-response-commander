# 進度追蹤 — 城市交通應變 AI 指揮台

**最後更新**: 2026-08-01
**比賽日期**: 2026-08-01
**剩餘天數**: 0 天（比賽日）

> ⚠️ 本文件 7/25–7/31 的每日區塊自 7/24 起未再更新，狀態欄仍為初始規劃值，
> **不代表實際進度**。目前唯一經過驗證的交付紀錄見下方「成員二交付紀錄」。
> 其他成員的實際狀態請各自補齊。

---

## 里程碑

| # | 里程碑 | 目標日期 | 狀態 |
|---|--------|----------|------|
| M1 | Repo 建立 + 共用型別完成 | 7/24 | ✅ 完成 |
| M2 | 團隊分工確認 + 各套件啟動 | 7/25 | ⏳ 進行中 |
| M3 | 資料解析 + 規則引擎 MVP | 7/27 | ❓ 待開始 |
| M4 | API + 前端串接 | 7/29 | ❓ 待開始 |
| M5 | 3 個事件全跑通 + 多語 | 7/30 | ❓ 待開始 |
| M6 | What-if + 報告 + 錄影片 | 7/31 | ❓ 待開始 |
| M7 | 提交 | 8/1 | ❓ 待開始 |

---

## 成員二（Backend Workflow Lead）交付紀錄

**分支**: `80/backend-workflow-phase4-5` ｜ **狀態**: 已推送，待 Reviewer 11346082 進行 PR Review 與 Merge

| 項目 | 內容 | 驗證方式 | 狀態 |
|---|---|---|---|
| **TASK-097** | Step Functions ASL 接線與 Workflow Wiring（`workflow/wiring.ts`），修復 ASL JSONPath 與缺口狀態處理 | 單元 + 整合測試 | ✅ 完成 |
| **TASK-155** | 5 個官方 CloudWatch Counter 名稱對齊 | 135 tests；與 `infra/lib/constructs/observability.ts` 的 `METRIC_NAMES` 逐字比對確認 | ✅ 完成 |
| **TASK-125** | `GET /roads` Canonical Contract 對齊（`RoadSegmentDTO` / `GetRoadsResponse` + runtime validator） | handler 輸出直接以 `GetRoadsResponseSchema.safeParse` 驗證（含 STOP-gate 路徑） | ✅ 完成 |
| **Lambda Entry Points** | `src/entry/workflow_status.ts`、`src/entry/recovery_gate.ts`（lazy singleton，含測試接縫） | `tsc --build` 0 錯誤；runtime smoke 確認 import 不建立 AWS client | ✅ 完成 |
| **Source Gate 防護** | 官方 CSV SHA-256 雜湊保護 + `.gitattributes` `-text` 修復 | 實算 SHA-256 = `official_source_manifest.ts` 的 `DEFAULT_EXPECTED_HASHES` | ✅ 完成 |

**Commit 序列**（`80/backend-workflow-phase4-5`）

| SHA | 內容 |
|---|---|
| `87ace0b` | `.gitattributes` LF 換行規範（其官方 CSV 副作用由 `fab8022` 修正） |
| `40dc96e` | TASK-155 CloudWatch Counter 名稱對齊 |
| `dfe1bc2` | APP_ENV 防禦性橋接、Table 常數契約、2 個 Lambda Entry Points（見 ADR-014） |
| `41bb7ff` | TASK-125 `GET /roads` Canonical Contract |
| `fab8022` | 官方資料集 SHA-256 保護與 `.gitattributes` `-text`（見 ADR-015） |

**測試狀態**: `packages/backend` + `packages/shared-schemas` + `packages/domain` = 105 files / **1,521 tests 全綠**；`tsc --build` 0 型別錯誤；ESLint 乾淨。

### 交接給 Reviewer 的未解項

| # | 項目 | 說明 |
|---|---|---|
| 1 | `dashboard_query.ts` 版本分歧 | main 版本的 `CrowdStationView` 缺 provenance 欄位、僅涵蓋 SOP-3/4；本分支版本含 `SnapshotProvenance`、`in_multilingual_scope`、SOP-6。**已決議以本分支為權威版本**，但 git textual merge 不會報衝突，合併後需人工確認保留正確版本。 |
| 2 | 合併衝突（預期） | `.gitattributes`（add/add，以 `fab8022` 為準）與 `package-lock.json`（content）。 |
| 3 | 既有 CI 紅燈（非本分支造成） | 8 個失敗 / 4 檔：`scripts/test/verify_sources.test.ts`（3，Windows bash 路徑 bug）、`eslint-local-rules/test/no-llm-prohibited-field-write.test.ts`（2，LLM 禁寫守門在 computed/update writes 失效）、`infra/test/ssm_params.test.ts`（1，與 `config_schema.ts:278` 的 `required:false` 矛盾）。 |
| 4 | ADR-003 已與實作不符 | ADR-003 決議「Lambda 直接編排，不用 Step Functions」，但 TASK-097 已交付 ASL 接線。該 ADR 狀態需由全隊決定是否標記為 Superseded。 |
| 5 | `DataSourceProvider` 無 production 實作 | interface 已從 `@city-commander/domain` 正常匯出，但只有測試內臨時實作，LOCAL_MOCK 端到端目前跑不起來。歸屬待認領。 |

---

## 每日進度

### 7/24（今天）— ✅ 完成

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 建立 monorepo 結構 | Sisyphus | ✅ |
| 建立 shared-schemas 套件 | Sisyphus | ✅ |
| 建立 config/config.local.yaml | Sisyphus | ✅ |
| 建立 docs/team-announcement.md | Sisyphus | ✅ |
| 建立 docs/demo-scenario.md | Sisyphus | ✅ |
| 建立 docs/spec.md | Sisyphus | ✅ |
| 建立 docs/progress.md | Sisyphus | ✅ |
| Git 初始化 + 首次 commit | Sisyphus | ✅ |

---

### 7/25（明天）— ⏳ 待團隊確認

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 團隊成員回答技術能力 | 全員 | ⏳ |
| 認領工作包 A/B/C/D/E | 全員 | ⏳ |
| 建立 team-roles.md | 你 | ⏳ |
| 推 repo 到 GitHub | 隊友 B | ⏳ |
| 確認 AWS 帳號 | 隊友 B | ⏳ |

---

### 7/26（後天）— ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 資料解析模組開發 | A（規則引擎） | ❓ |
| API 開發 | B（後端） | ❓ |
| 前端畫面開發 | C（前端） | ❓ |
| AI 整合開發 | D（AI） | ❓ |

---

### 7/27 — ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 規則引擎 MVP 完成 | A | ❓ |
| API 串接資料解析 | B | ❓ |
| 前端路網地圖 | C | ❓ |
| Bedrock 整合 | D | ❓ |

---

### 7/28 — ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 規則引擎測試通過 | A | ❓ |
| API 整合測試 | B | ❓ |
| 前端決策建議書畫面 | C | ❓ |
| AI 建議書文案 | D | ❓ |

---

### 7/29 — ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 3 個事件規則全跑通 | A | ❓ |
| API 部署到 Amplify | B | ❓ |
| 前端串接 API | C | ❓ |
| 多語通報完成 | D | ❓ |

---

### 7/30 — ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| What-if 模擬功能 | A | ❓ |
| 前端 What-if 視窗 | C | ❓ |
| 提案簡報初稿 | E | ❓ |

---

### 7/31 — ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 全系統整合測試 | 全員 | ❓ |
| 錄製 Demo 影片 | E | ❓ |
| 簡報定稿 | E | ❓ |
| 提交前檢查 | 全員 | ❓ |

---

### 8/1（比賽日）— ❓ 待開始

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| 提交簡報 | E | ❓ |
| 提交 GitHub 連結 | B | ❓ |
| 提交影片 | E | ❓ |

---

## 關鍵路徑

```
Day 1 (7/24)  ✅ Repo + 類型定義
     ↓
Day 2 (7/25)  ⏳ 團隊分工 + 各套件啟動
     ↓
Day 3-4 (7/26-27)  ❓ 規則引擎 + API + 前端並行開發
     ↓
Day 5 (7/28)  ❓ 整合測試
     ↓
Day 6 (7/29)  ❓ 3 個事件全跑通
     ↓
Day 7 (7/30)  ❓ 報告 + 錄影片
     ↓
Day 8 (7/31)  ❓ 提交前檢查
     ↓
Day 9 (8/1)   ❓ 提交
```

---

## 風險與阻斷

| 風險 | 影響 | 緩解方案 |
|------|------|----------|
| 團隊分工延遲 | 全部延後 | 今天先確認 |
| 沒有 AWS 帳號 | 無法上雲端 | 先用 LOCAL_MOCK |
| 規則引擎複雜度高 | 延後完成 | 先做 MVP，再迭代 |
| 報告來不及 | 扣分 | 提前準備模板 |

---

## 重要連結

| 連結 | 用途 |
|------|------|
| GitHub Repo | ⏳ 待建立 |
| Amplify 部署網址 | ⏳ 待建立 |
| 提案簡報 | ⏳ 待建立 |
| Demo 影片 | ⏳ 待建立 |

---

## 每日站會

**時間**: 每天 21:00
**形式**: 群組语音或文字
**內容**:
1. 今天做了什麼？
2. 遇到什麼問題？
3. 明天要做什麼？

---

**文件結束**
