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
Bedrock (RAG + 文字生成) + DynamoDB + S3
```

## 開發環境

- **TypeScript** (主要語言)
- **React** (前端)
- **AWS CDK** (基礎設施即程式碼)
- **Amazon Bedrock** (生成式 AI)

## 快速開始

```bash
# 安裝依賴
npm install

# 型別檢查
npm run typecheck

# 建置
npm run build
```

## 專案結構

```
city-response-commander/
├── packages/
│   ├── shared-schemas/   # 共用型別與列舉
│   ├── config/           # 設定管理
│   ├── domain/           # 決定性規則引擎
│   ├── backend/          # Lambda + API
│   ├── rag/              # Bedrock RAG 整合
│   └── frontend/         # React Dashboard
├── infra/                # CDK 基礎設施
├── config/               # 環境設定檔
└── docs/                 # 文件
```

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
