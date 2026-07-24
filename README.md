# 城市交通應變 AI 指揮台

> **City Response Commander** — 2026 雲湧智生黑客松競賽 🏆

在城市發生交通事故時，協助指揮官於 60 秒內做出可靠決策的 AI 交通指揮台。

## 專案定位

這不是一般聊天機器人，也不是讓 AI 任意猜測。

本系統是一套會讀取城市交通資料、依照官方 SOP 進行判斷、提出疏散方案，並將結果清楚呈現在 Dashboard 上的智慧城市決策系統。

### 核心原則

- **決定性程式碼** 擁有一切數值與布林真值（資料解析、分級、SOP 觸發、路徑篩選、ETE 計算）
- **Amazon Bedrock** 只負責自然語言（建議書措辭、民眾警示、決策解釋、What-if 互動）

## 技術架構

```
React/TS SPA (Dashboard)
    ↓
API Gateway HTTP + WebSocket
    ↓
Lambda (DecisionFn + RendererFn)
    ↓
Step Functions Express Workflow
    ↓
Bedrock (AI 文字生成) + DynamoDB + S3
```

## 開發環境

- **TypeScript** (主要語言)
- **React** (前端)
- **AWS CDK** (基礎設施即程式碼)
- **Amazon Bedrock** (AI 文字生成)

## 快速開始

```bash
# 安裝依賴
npm install

# 型別檢查
npm run typecheck

# 建置
npm run build
```

## 開發流程（PR 工作流）

本專案使用 Branch 保護規則，`main` 分支禁止直接 push，必須透過 Pull Request 合併。

```bash
# 1. 建立新分支
git checkout -b feat/my-feature

# 2. 做修改、commit
git add .
git commit -m "feat: 新增某某功能"

# 3. 推到 GitHub
git push -u origin feat/my-feature

# 4. 建立 PR（在 GitHub 網頁上）
# 點 "Compare & pull request" 按鈕

# 5. 等隊友 approve 後合併
```

### Commit 訊息規範

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

| 前綴 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | 修 bug |
| `docs:` | 文件變更 |
| `refactor:` | 重構（不改功能） |
| `test:` | 測試 |
| `chore:` | 雜項（設定、依賴等） |

### 範例

```bash
git commit -m "feat: 新增 SOP-2 車禍疏散路徑計算"
git commit -m "fix: 修正 ETE 公式小數點精度問題"
git commit -m "docs: 更新 demo-scenario.md 場景定義"
```

## 專案結構

```
city-response-commander/
├── packages/
│   ├── shared-schemas/   # 共用型別與列舉
│   ├── config/           # 設定管理
│   ├── domain/           # 決定性規則引擎
│   ├── backend/          # Lambda + API
│   ├── ai-generator/     # Bedrock AI 文字生成
│   └── frontend/         # React Dashboard
├── infra/                # CDK 基礎設施
├── config/               # 環境設定檔
└── docs/                 # 文件
```

## 文件分類

### 🎯 專案管理

| 檔案 | 內容 |
|------|------|
| `docs/team-announcement.md` | 團隊分工公告（貼群組用） |
| `docs/team-roles.md` | 工作包詳細任務 + 認領狀態 |
| `docs/progress.md` | 7 天里程碑 + 每日進度追蹤 |

### ⚙️ 技術規格

| 檔案 | 內容 |
|------|------|
| `docs/spec.md` | 33 條 User Stories + 技術決策 |
| `docs/language-boundary.md` | 語言邊界規範（TypeScript 為主） |

### 📊 資料分析

| 檔案 | 內容 |
|------|------|
| `docs/data_audit.md` | 7 個官方檔案的 SHA-256 驗證 |

### 🎬 Demo 準備

| 檔案 | 內容 |
|------|------|
| `docs/demo-scenario.md` | 3 個事件完整場景 + 畫面示意 |

## 官方資料

本專案使用五個官方資料檔案：

| 檔案 | 內容 |
|------|------|
| `city_traffic_flow.csv` | 15 路段車流資料 |
| `signaling_crowd_density.csv` | 9 基地台人流資料 |
| `road_network_geometry.json` | 路網幾何資料 |
| `live_incidents.json` | 3 個官方事件 |
| `emergency_traffic_sop.txt` | 7 條 SOP 規則 |

## 官方交付物

1. **提案簡報** — 含 AWS 架構圖
2. **Dashboard Live Demo** — 可運作的部署網址 + 錄製影片
3. **GitHub 原始碼** — 完整原始碼連結

## License

Private — 2026 雲湧智生黑客松競賽
