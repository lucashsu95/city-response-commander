# AGENTS.md — 城市交通應變 AI 指揮台

> **Single Source of Truth (SSOT)** — Agent 每次 session 開頭必須讀取此文件。
> 最後更新：2026-07-31

---

## 專案目標

7 天內完成「2026 雲湧智生黑客松」參賽作品：協助交通指揮官在 60 秒內做出可靠決策的 AI 交通指揮台。

---

## 技術棧

| 層級 | 技術 |
|------|------|
| 語言 | TypeScript（唯一允許的語言，見 `docs/language-boundary.md`） |
| 前端 | React SPA |
| 後端 | AWS Lambda + API Gateway |
| AI | Amazon Bedrock（僅負責 NL 生成，不負責決策） |
| 基礎設施 | AWS CDK (TypeScript) |
| 測試 | vitest + fast-check (PBT) |
| Lint | ESLint + Prettier |
| 型別 | TypeScript strict mode |

---

## 核心原則

### 1. 決定性 > AI

所有數值判定（資料解析、分級、SOP 觸發、路徑篩選、ETE 計算）由決定性程式碼負責。Amazon Bedrock **只**負責：
- 建議書措辭
- 民眾警示文案
- 決策解釋
- What-if 互動

**禁止**：讓 AI 做任何需要精確數值或布林判斷的決策。

### 2. SOP 是法律

`sop` 模組裡的每一條規則對應官方 `emergency_traffic_sop.txt` 的一條 SOP。修改規則前必須：
1. 確認原始 SOP 文字
2. 更新 `docs/spec.md` 對應的 User Story
3. 補上 PBT 邊界測試

### 3. 不引入新語言

見 `docs/language-boundary.md`。所有 packages 皆為 TypeScript。Python 邊界需要額外審批。

---

## 套件依賴層級

```
Layer 0 (Leaf):     shared-schemas
                    ↑
Layer 1:            config, domain, ai-generator
                    ↑
Layer 2:            rag, backend, frontend
                    ↑
Layer 3 (Root):     infra (CDK)
```

**禁止方向**：上層不可被下層 import。例如 `domain` 不能 import `backend`。

完整規則見 `docs/architecture.md`。

---

## 檔案結構

```
city-response-commander/
├── packages/
│   ├── shared-schemas/   # 共用型別與列舉（Layer 0）
│   ├── config/           # 設定管理 ConfigProvider（Layer 1）
│   ├── domain/           # 決定性規則引擎 SOP 1~7（Layer 1）
│   ├── ai-generator/     # Bedrock NL 生成（Layer 1）
│   ├── rag/              # RAG + SOP 知識庫（Layer 2）
│   ├── backend/          # Lambda + API（Layer 2）
│   └── frontend/         # React Dashboard（Layer 2）
├── infra/                # CDK 基礎設施（Layer 3）
├── config/               # 環境設定檔
├── docs/                 # 文件
├── scripts/              # 工具腳本
├── .kiro/                # Kiro spec-driven development
├── AGENTS.md             # 本文件（SSOT）
└── package.json          # Monorepo root
```

---

## 重要文件（每次 Session 必讀）

| 檔案 | 用途 | 何時讀 |
|------|------|--------|
| **`AGENTS.md`** | 本文件，SSOT | 每次 session 開頭 |
| **`docs/progress.md`** | 里程碑進度 + 每日追蹤 | 每次 session 開頭與結束 |
| **`docs/architecture.md`** | 依賴層級、模組邊界、資料流 | 修改任何 package 前 |
| **`docs/decisions.md`** | Architectural Decision Records (ADR) | 需要了解「為什麼這樣做」時 |
| **`docs/handoff-protocol.md`** | Session 交接流程 + 範本 | Context 快滿或需要交接時 |
| **`docs/spec.md`** | 33 條 User Stories + 技術決策 | 開始實作新功能前 |
| **`docs/language-boundary.md`** | 語言邊界規範 | 涉及語言選擇時 |
| **`docs/demo-scenario.md`** | 3 個事件場景 + 畫面示意 | 準備 demo 時 |

---

## 禁忌清單

| 禁忌 | 原因 |
|------|------|
| 在 domain 層 import backend/frontend | 違反依賴方向 |
| 在 AI 生成的內容中加入未經規則引擎驗證的數值 | 決定性 > AI |
| 使用 `as any` / `@ts-ignore` / `@ts-expect-error` | 型別安全 |
| 修改 SOP 規則不更新測試 | 規則正確性 |
| 在 packages 中混用 TypeScript 和 Python | 語言邊界 |
| 直接 push 到 main | 必須透過 PR |
| commit 訊息不含 conventional prefix | commit 規範 |

---

## 測試要求

| 模組 | 測試類型 | 最低要求 |
|------|----------|----------|
| domain (SOP 規則) | PBT + 邊界測試 | 每條 SOP 至少 100 iterations |
| backend | 整合測試 | API 回應格式 |
| frontend | 手動測試 | 畫面顯示正確 |
| scripts | 單元測試 | 工具腳本邏輯 |

---

## Session 開頭 Checklist

每次新 session 開始時，agent 應：

1. 讀取本文件（AGENTS.md）
2. 確認當前 git 分支與進度
3. 讀取 `docs/progress.md` 了解里程碑狀態
4. 若正在實作某個 task，讀取對應的 kiro spec
5. 若是接手前一個 session，讀取 `docs/handoff-protocol.md` 並執行交接流程

---

## Session 結束 Checklist

每次 session 結束前，agent 應：

1. 更新 `docs/progress.md` 的進度狀態
2. 若有 architectural decision，更新 `docs/decisions.md`
3. 若 context 快滿或需要交接，按 `docs/handoff-protocol.md` 流程寫 handoff 筆記
4. 確保所有修改都通過 `npm run typecheck && npm run lint`

---

## 常見任務快速指南

### 新增一條 SOP 規則

1. 確認原始 SOP 文字（`emergency_traffic_sop.txt`）
2. 在 `packages/domain/src/sop/` 新增規則
3. 在 `packages/shared-schemas/` 更新型別
4. 補上 PBT 邊界測試（`fast-check`，100+ iterations）
5. 更新 `docs/spec.md` 對應的 User Story

### 新增 API endpoint

1. 在 `packages/backend/src/` 新增 handler
2. 確認只 import `domain`、`config`、`shared-schemas`
3. 補上整合測試
4. 更新 CDK 定義（`infra/`）

### 修正前端畫面

1. 在 `packages/frontend/src/` 修改
2. 確認只 import `shared-schemas`（不直接 import domain）
3. 補上視覺測試或手動測試記錄

---

**文件結束**
