# 團隊分工 — 城市交通應變 AI 指揮台

**文件版本**: v2.0 (基於 000 程序正式分工)
**建立日期**: 2026-07-24
**更新日期**: 2026-07-25
**狀態**: 📋 正式分工 (4/5 已認領，待填入成員 1)

---

## 分工原則

- 五人分成五條專業線，而非五人都碰所有檔案
- Task 數量不能代表實際工作量（IAM、分散式狀態機、ETE 規則與前端視覺化的風險、複雜度與專業需求完全不同）

### 評分比重

| 評分項目                         | 比重 |
| -------------------------------- | ---- |
| 技術可行性與決策邏輯準確性       | 35%  |
| Dashboard 與智慧指揮官主題切合度 | 35%  |
| 完成度                           | 20%  |
| 商業與國際化                     | 10%  |

---

## 成員分工

### 成員 1：系統規則與決定性引擎負責人

**職位名稱**: Deterministic Domain Lead
**負責人**: 許恩綸
**應由**: 團隊中最擅長 TypeScript、演算法、資料結構、測試與規則邊界的人擔任

#### 主要責任

- 共用 Schema 與核心型別
- 官方來源 Hash 驗證
- Rule Engine SOP 1 至 7
- 路徑候選、上下游、主次疏散
- HG-001 三個政策
- ETE 計算
- EvidenceTrace
- canonical core_hash
- Property、Boundary、Golden tests
- 技術規格裁決

#### Primary Tasks

TASK-001..003, TASK-006..012, TASK-020..035, TASK-039..047, TASK-051..058, TASK-165, TASK-168

#### 專屬程式區域

```
packages/shared-schemas/
packages/domain/src/rule_engine/
packages/domain/src/strategies/
packages/domain/src/road_network/
packages/domain/src/ete/
packages/domain/src/evidence/
packages/domain/test/property/
packages/domain/test/golden/
```

#### 不負責

- 不寫 React Dashboard
- 不寫 Bedrock Prompt
- 不碰 CDK Stack 最終組裝
- 不直接部署 AWS

#### 必須守住的紅線

- 數值與布林真值只能由決定性程式產生
- Design 明確規定 Bedrock 只能產生語言，不能修改以下內容：
  - ETE
  - 等級
  - 主疏散路線
  - SOP 觸發結果

#### 驗收責任

- ACC_001 = 78.6
- EVT_002 uses 22:15
- EVT_003 = 41.0
- P1..P37 tests green
- 所有數值邊界完全精確

---

### 成員 2：資料管線、後端流程與 Fast Path 負責人

**職位名稱**: Backend Workflow Lead
**負責人**: 林佳欣
**應由**: 最熟悉 API、狀態機、冪等性、DynamoDB 條件寫入與非同步流程的人擔任

#### 主要責任

- ConfigProvider 實作
- 五份 Runtime 資料解析
- DataIngestionService
- InjectFn
- Idempotency lease
- Workflow lifecycle
- RecoveryGate
- DecisionFn
- DecisionCore persistence
- Fast Path
- Read Model 與 GET API
- Backend failure handling

#### Primary Tasks

TASK-004..005, TASK-013..019, TASK-036..038, TASK-085..107, TASK-149..150, TASK-153..158

#### 專屬程式區域

```
packages/config/
packages/domain/src/ingestion/
packages/backend/src/inject/
packages/backend/src/workflow/
packages/backend/src/recovery/
packages/backend/src/decision/
packages/backend/src/read/
packages/backend/src/observability/
```

#### 不負責

- 不修改 Rule Engine 的正式邏輯
- 不自行重算 ETE
- 不改 IAM Role 權限
- 不直接修改前端 UI

#### 關鍵交接

- 成員 2 完成 TASK-013..019 → 成員 1 才能穩定完成 TASK-020..035
- 成員 1 完成 DecisionCore contract → 成員 2 才能完成 TASK-099..107

#### 驗收責任

- 重複事件不產生兩份 DecisionCore
- start_failed 可透過租約復原
- stale execution 不可覆寫新 execution
- Fast Path 不受 Bedrock 失敗阻擋
- 5 秒團隊目標與 60 秒正式要求均有量測

---

### 成員 3：AWS、CDK、IAM、安全與發布平台負責人

**職位名稱**: AWS Platform and Security Lead
**負責人**: 林斯賢
**應由**: 五人中最熟悉 AWS、CDK、IAM、API Gateway、Step Functions、Cognito 與 CloudFormation 的人擔任
**重要**: 不能只是「負責按部署按鈕的人」，必須真正理解最小權限與跨 Stack 依賴

#### 主要責任

- 四個 CDK Stacks
- S3、DynamoDB、Knowledge Base
- Lambda 定義
- API Gateway HTTP/WebSocket
- Cognito
- SSM、Secrets Manager
- Step Functions
- IAM Roles
- CloudWatch 與安全測試
- Competition AWS 部署流程
- 最終 Stack 組裝
- Cleanup 與 residual check

#### Primary Tasks

TASK-059..084, TASK-159..164, TASK-166..167, TASK-171, TASK-175..180

#### 專屬程式區域

```
infra/
infra/lib/constructs/
infra/lib/roles/
infra/test/
runbooks/aws/
scripts/deploy/
scripts/cleanup/
```

#### 絕對單一所有權

下列檔案只有此人可進行最終寫入：

- infra/lib/data_stack.ts
- infra/lib/compute_stack.ts
- infra/lib/network_auth_stack.ts
- infra/lib/frontend_stack.ts
- infra/bin/app.ts
- TASK-180 明確要求單一整合所有者

#### 不負責

- 不修改 SOP 邏輯
- 不修改前端 React 元件
- 不撰寫 Bedrock 推理內容
- 不自行改 API response schema

#### 驗收責任

- 每個 Lambda 使用指定 Role
- RendererFn 無法寫入 DecisionCore
- DecisionFn 無法寫入 IdempotencyTable
- WorkflowStatusFn 只能寫入 IdempotencyTable
- 所有 API Route 與 SFN State 均指向存在的 Lambda
- PERSONAL_AWS_DEV 與 COMPETITION_AWS 均可 synth
- 無 CloudFormation cycle
- cdk destroy 有完整流程，但比賽前不得任意執行

---

### 成員 4：Bedrock、RAG、What-if 與通報內容負責人

**職位名稱**: GenAI and RAG Lead
**負責人**: 林原郁
**應由**: 最熟悉 LLM、Prompt、RAG、結構化輸出、驗證器與多語內容的人擔任
**重要**: 不是「把所有判斷交給 AI」，主要工作是約束 AI

#### 主要責任

- Bedrock Adapter
- Bedrock Knowledge Base Retrieve
- S3 SOP fallback
- SOP citation
- SchemaValidator
- ReportComposer
- PublicAlertComposer
- ExplanationComposer
- 中文、英文、日文與韓文
- What-if 四階段流程
- Publish 與 Audit
- AI 邊界測試

#### Primary Tasks

TASK-048..050, TASK-108..120, TASK-136..140, TASK-142..148, TASK-151..152
TASK-141 What-if UI 交給成員 5，避免此人修改共用 React 區域

#### 專屬程式區域

```
packages/rag/
packages/backend/src/narrative/
packages/backend/src/whatif/
packages/backend/src/publish/
packages/backend/test/rag/
packages/backend/test/narrative/
```

#### 不負責

- 不計算 ETE
- 不決定 A/B 級
- 不決定 SOP 是否觸發
- 不選主疏散道路
- 不更動 DecisionCore
- 不直接修改 CDK Stack

#### 必須執行的防線

任何 Bedrock 回應若嘗試寫入核心欄位，必須執行：

```
SchemaValidator rejects response
↓
Use deterministic template fallback
↓
DecisionCore remains unchanged
```

#### 驗收責任

- Citation 對應正確 SOP 條文
- Knowledge Base 失敗時可切換 S3 article fallback
- Bedrock 失敗不阻擋 Fast Path
- What-if 重算不修改正式狀態
- 多語 fallback 不會只剩中文
- Prompt injection 不可改寫核心數值

---

### 成員 5：Dashboard、產品整合與比賽展示負責人

**職位名稱**: Dashboard and Demo Lead
**負責人**: 陳羿伶
**應由**: 最熟悉 React、視覺層次、即時 UI、使用者流程與簡報展示的人擔任
**重要**: 不能只是美術，必須能處理 WebSocket、API 狀態、錯誤狀態與前端測試

#### 主要責任

- React/TypeScript SPA
- WebSocket 與 polling fallback
- Timeline
- 路段與基地台視覺化
- 異常彈窗
- Incident injection UI
- EvidenceTrace 顯示
- 主次疏散路線
- ETE 公式展示
- Report/Public Alert panels
- What-if 對話視窗
- 響應式與日韓語 UI
- Demo 腳本、錄影與證據包

#### Primary Tasks

TASK-121..135, TASK-141, TASK-169..170, TASK-172..174

#### 專屬程式區域

```
packages/frontend/
packages/frontend/src/app.tsx
packages/frontend/src/api/client.ts
packages/frontend/src/components/
packages/frontend/src/whatif/
packages/frontend/test/
docs/demo/
```

**重要**: app.tsx 與 API client 為單一所有者，其他人不應直接修改

#### 不負責

- 不在前端重新計算 A/B、ETE 或 SOP
- 不在 UI 使用自行定義的邏輯推導主路線
- 不修改後端 DecisionCore
- 不修改 IAM

#### 必須呈現的展示順序

1. 時間軸自動前進
2. 異常自動彈窗
3. 注入 ACC_001
4. 顯示主路線與次路線
5. 顯示 ETE 78.6 與完整公式
6. 顯示 SOP 引用與排除原因
7. 注入 EVT_002
8. 顯示 22:15 observation 與 affected_road context
9. What-if BL17 = 40000
10. 一鍵發布多語通報

#### 重要提醒

Dashboard 是正式評分的 35%，不是最後兩天再補的外殼。官方命題要求 Dashboard 具備：

- 自動感知
- 即時異常
- 事件注入
- What-if
- 推理鏈
- 多語發布

---

## 分工總表

| 成員               | 主角色                         | Primary Tasks                                         |
| ------------------ | ------------------------------ | ----------------------------------------------------- |
| ⏳ 待認領 (成員 1) | 決定性規則與系統架構           | 001–003、006–012、020–035、039–047、051–058、165、168 |
| 佳欣 (成員 2)      | 資料、後端流程與 Fast Path     | 004–005、013–019、036–038、085–107、149–150、153–158  |
| 林斯賢 (成員 3)    | AWS、CDK、IAM、安全與部署      | 059–084、159–164、166–167、171、175–180               |
| 林原郁 (成員 4)    | Bedrock、RAG、What-if、Publish | 048–050、108–120、136–140、142–148、151–152           |
| 伶 (成員 5)        | Dashboard、前端與 Demo         | 121–135、141、169–170、172–174                        |

這份分法涵蓋 TASK-001 至 TASK-180，沒有遺漏，也沒有 Primary Owner 重疊。

---

## 強制 Code Ownership

建議立即建立 CODEOWNERS：

| 路徑                              | 所有者 |
| --------------------------------- | ------ |
| /packages/shared-schemas/         | 成員 1 |
| /packages/domain/src/rule_engine/ | 成員 1 |
| /packages/domain/src/strategies/  | 成員 1 |
| /packages/domain/src/ingestion/   | 成員 2 |
| /packages/config/                 | 成員 2 |
| /packages/backend/src/inject/     | 成員 2 |
| /packages/backend/src/workflow/   | 成員 2 |
| /packages/backend/src/decision/   | 成員 2 |
| /packages/backend/src/read/       | 成員 2 |
| /packages/rag/                    | 成員 4 |
| /packages/backend/src/narrative/  | 成員 4 |
| /packages/backend/src/whatif/     | 成員 4 |
| /packages/backend/src/publish/    | 成員 4 |
| /packages/frontend/               | 成員 5 |
| /infra/                           | 成員 3 |
| /runbooks/aws/                    | 成員 3 |

### 審查規則

- 自己不能核准自己的 PR
- 修改共用 Schema：成員 1 必須核准
- 修改 backend contract：成員 2 必須核准
- 修改 AWS、IAM、CDK：成員 3 必須核准
- 修改 Bedrock、Prompt、Citation：成員 4 必須核准
- 修改 Dashboard 與 Demo flow：成員 5 必須核准
- TASK-179、TASK-180 必須由成員 3 實作，成員 1 複核
- Golden Scenario 變動必須由成員 1 與成員 2 雙重核准
- 任何數值由 LLM 產生，直接拒絕合併

---

## 三個共同 Gate

### Gate 1：Correctness Gate

**負責人**: 成員 1
**複核**: 成員 2

必須通過：

- P1..P37 Boundary tests
- ACC_001
- EVT_002
- EVT_003
- Official source Hash STOP gate

### Gate 2：Platform Gate

**負責人**: 成員 3
**複核**: 成員 2

必須通過：

- IAM denial tests
- CDK synth
- No cyclic dependency
- No orphan handler
- No shared-file conflict

### Gate 3：Demo Gate

**負責人**: 成員 5
**複核**: 成員 4

必須通過：

- 3 official events
- What-if
- WebSocket loss fallback
- Bedrock failure fallback
- Multilingual publication
- 5 秒／60 秒 latency evidence
- Recorded demo rehearsal

**重要**: 只有三個 Gate 全部通過，000 程序才能建立 release candidate。

---

## 人員選擇標準

應依以下順序對號入座：

1. 最強規則邏輯與 TypeScript → 成員 1
2. 最強後端狀態與 API → 成員 2
3. 最強 AWS、CDK、IAM → 成員 3
4. 最強 LLM、RAG、Prompt → 成員 4
5. 最強 React、UI、產品表達 → 成員 5

### 禁止錯配

- 不要把成員 3 分給只會操作 AWS Console、但不理解 IAM 與 CDK 的人
- 不要把成員 5 分給只會做視覺稿、但不會 React 與 API 串接的人
- 不要讓成員 4 決定任何正式數值
- 不要讓五個人同時修改 shared-schemas 或 CDK Stack

---

## 團隊成員

| #   | 姓名          | 技術能力                   | 認領工作包                              | 每日可投入時間 |
| --- | ------------- | -------------------------- | --------------------------------------- | -------------- |
| 1   | ⏳ 待填寫     | TypeScript/演算法/資料結構 | ⏳ 待認領                               | ⏳             |
| 2   | 佳欣          | API/狀態機/DynamoDB        | 成員 2 (Backend Workflow Lead)          | ⏳             |
| 3   | 林斯賢 (X!@N) | AWS/CDK/IAM                | 成員 3 (AWS Platform and Security Lead) | ⏳             |
| 4   | 林原郁 (龍王) | LLM/RAG/Prompt             | 成員 4 (GenAI and RAG Lead)             | ⏳             |
| 5   | 伶            | React/UI/產品表達          | 成員 5 (Dashboard and Demo Lead)        | ⏳             |

---

## 確認清單

- [x] 每個人確認自己的成員編號與角色 (2026-07-25 群組確認)
- [ ] 每個人回報每日可投入時間
- [ ] 確認有 AWS 帳號
- [ ] 建立 GitHub repo
- [ ] 建立 CODEOWNERS 檔案
- [ ] 確認報告格式
- [ ] 開始開發

---

**文件結束**
