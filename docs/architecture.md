# Architecture — 城市交通應變 AI 指揮台

> 模組邊界與依賴規則。Agent 修改任何 package 前必須確認本文件。
> 最後更新：2026-07-31

---

## 依賴層級 (Dependency Layering)

```
Layer 0 (Leaf)     ┌─────────────────────┐
                    │   shared-schemas     │
                    └──────────┬──────────┘
                               │
Layer 1             ┌──────────┼──────────┐
                    │          │          │
               ┌────▼───┐ ┌───▼────┐ ┌───▼──────────┐
               │ config  │ │ domain │ │ ai-generator │
               └────┬───┘ └───┬────┘ └───┬──────────┘
                    │         │          │
Layer 2        ┌────┼─────────┼──────────┘
               │    │         │
          ┌────▼──┐ │  ┌─────▼─────┐
          │  rag  │ │  │  backend  │
          └───┬───┘ │  └─────┬─────┘
              │     │        │
          ┌───▼─────▼────────▼───┐
          │      frontend        │
          └──────────┬──────────┘
                     │
Layer 3         ┌────▼────┐
                │  infra   │
                └─────────┘
```

---

## 依賴規則

### 允許方向（上層可 import 下層）

| Package | 可以 import |
|---------|-------------|
| shared-schemas | （無，leaf） |
| config | shared-schemas |
| domain | shared-schemas |
| ai-generator | shared-schemas |
| rag | shared-schemas, config |
| backend | shared-schemas, domain, config |
| frontend | shared-schemas |
| infra | 全部 |

### 禁止方向（不可 import）

| Package | 不可以 import |
|---------|---------------|
| shared-schemas | 任何其他 package |
| config | domain, ai-generator, rag, backend, frontend, infra |
| domain | config, ai-generator, rag, backend, frontend, infra |
| ai-generator | config, domain, rag, backend, frontend, infra |
| rag | domain, ai-generator, backend, frontend, infra |
| backend | ai-generator, rag, frontend, infra |
| frontend | domain, backend, rag, ai-generator, config, infra |

### 規則口訣

> **Domain 是心臟，不依賴任何人。Backend 是大腦，只看 Domain。Frontend 是眼睛，只看 Shared。**

---

## 各 Package 職責

### Layer 0: shared-schemas

- **職責**：共用型別、列舉、合約
- **內容**：事件類型、SOP 條件、路段結構、API 回應格式
- **規則**：不含任何邏輯，只有 type 定義

### Layer 1: config

- **職責**：設定管理（ConfigProvider pattern）
- **內容**：LOCAL_MOCK / AWS 雙模式設定
- **規則**：讀取 `config/config.local.yaml` 或 AWS SSM

### Layer 1: domain

- **職責**：決定性規則引擎（SOP 1~7）
- **內容**：資料解析、分級判定、路徑篩選、ETE 計算
- **規則**：所有數值判定都在這裡，不呼叫外部 API

### Layer 1: ai-generator

- **職責**：Bedrock NL 生成
- **內容**：建議書措辭、多語警示、What-if 解釋
- **規則**：只負責文字生成，不做數值判定

### Layer 2: rag

- **職責**：RAG 檢索 + SOP 知識庫
- **內容**：Bedrock Knowledge Bases 整合
- **規則**：查詢 domain 的規則文檔，不直接執行規則

### Layer 2: backend

- **職責**：Lambda + API Gateway
- **內容**：HTTP/WebSocket handler、Step Functions 編排
- **規則**：呼叫 domain 執行規則，呼叫 ai-generator 生成文字

### Layer 2: frontend

- **職責**：React Dashboard
- **內容**：時序監測、事件注入、What-if 對話
- **規則**：只 import shared-schemas 做型別對齊

### Layer 3: infra

- **職責**：AWS CDK 基礎設施
- **內容**：Lambda、API Gateway、DynamoDB、S3、Amplify
- **規則**：可以 reference 全部 packages 的 build output

---

## 資料流

```
官方資料 (CSV/JSON/TXT)
    ↓
[shared-schemas] 型別定義
    ↓
[domain] 資料解析 → SOP 判斷 → 決策結果
    ↓
[backend] API 回應格式化
    ↓
[ai-generator] NL 生成（建議書、警示、解釋）
    ↓
[frontend] Dashboard 渲染
```

---

## 測試 Seam（接縫）

主要測試接縫在 `domain` 層（ Seam 3）：

```
Seam 1: API 回應 → 畫面渲染        [frontend 測試]
Seam 2: 請求 → 決策核心 → 回應     [backend 測試]
Seam 3: 事件 + 資料 → SOP 判斷      [domain PBT ★ 主要接縫]
Seam 4: 原始檔案 → 型別化記錄       [domain parser 測試]
```

---

## 語言邊界

完整規則見 `docs/language-boundary.md`。

**摘要**：所有 packages 皆為 TypeScript。Python 邊界需要額外審批（需有 `pyproject.toml` + Hypothesis PBT）。

---

**文件結束**
