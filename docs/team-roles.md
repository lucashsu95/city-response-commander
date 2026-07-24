# 團隊分工 — 城市交通應變 AI 指揮台

**文件版本**: v1.0
**建立日期**: 2026-07-24
**狀態**: ⏳ 待團隊確認

---

## 工作包總覽

| # | 工作包 | 職責 | 需要技能 | 預估工時 |
|---|--------|------|----------|----------|
| A | 規則引擎 | SOP 1~7 判斷邏輯、資料解析 | TypeScript, 邏輯思維 | 20h |
| B | 後端 API | Lambda + API Gateway + 部署 | TypeScript, AWS | 15h |
| C | 前端 Dashboard | React 畫面、路網地圖 | React, CSS | 20h |
| D | AI 整合 | Bedrock 文字生成、多語 | Python/TS, AWS Bedrock | 15h |
| E | 報告 + 協調 | 簡報、錄影片、進度追蹤 | 簡報設計、溝通 | 10h |

---

## 認領狀態

| 工作包 | 認領人 | 技術能力 | 狀態 |
|--------|--------|----------|------|
| A. 規則引擎 | ⏳ 待認領 | TypeScript | ❓ |
| B. 後端 API | ⏳ 待認領 | AWS | ❓ |
| C. 前端 Dashboard | ⏳ 待認領 | React | ❓ |
| D. AI 整合 | ⏳ 待認領 | Python | ❓ |
| E. 報告 + 協調 | ⏳ 待認領 | 簡報設計 | ❓ |

---

## 各工作包詳細任務

### A. 規則引擎

**負責人**: ⏳ 待認領
**需要技能**: TypeScript, 邏輯思維, 資料結構
**預估工時**: 20 小時

#### 任務清單

| # | 任務 | 預估時間 | 狀態 |
|---|------|----------|------|
| A1 | 設計 DecisionCore 輸出結構 | 2h | ❓ |
| A2 | 實作 SOP-1 交通壅塞分級 | 2h | ❓ |
| A3 | 實作 SOP-2 車禍與路障應變 | 3h | ❓ |
| A4 | 實作 SOP-3 捷運人流疏散 | 2h | ❓ |
| A5 | 實作 SOP-4 大巨蛋散場連動 | 2h | ❓ |
| A6 | 實作 SOP-5 號誌故障應變 | 2h | ❓ |
| A7 | 實作 SOP-6 多語化通報觸發 | 2h | ❓ |
| A8 | 實作 SOP-7 ETE 計算 | 2h | ❓ |
| A9 | 整合測試 + 邊界測試 | 3h | ❓ |

#### 依賴關係

```
A1 → A2~A8（可並行）→ A9
```

#### 交付物

- `packages/domain/src/sop1-congestion.ts`
- `packages/domain/src/sop2-accident.ts`
- `packages/domain/src/sop3-metro.ts`
- `packages/domain/src/sop4-arena.ts`
- `packages/domain/src/sop5-signal.ts`
- `packages/domain/src/sop6-multilingual.ts`
- `packages/domain/src/sop7-ete.ts`
- `packages/domain/src/engine.ts`

---

### B. 後端 API

**負責人**: ⏳ 待認領
**需要技能**: TypeScript, AWS Lambda, API Gateway
**預估工時**: 15 小時

#### 任務清單

| # | 任務 | 預估時間 | 狀態 |
|---|------|----------|------|
| B1 | 設計 API 合約 | 2h | ❓ |
| B2 | 實作資料解析 Lambda | 3h | ❓ |
| B3 | 實作決策 API Lambda | 3h | ❓ |
| B4 | 實作 What-if API Lambda | 2h | ❓ |
| B5 | 設定 Amplify Hosting | 2h | ❓ |
| B6 | 整合測試 | 3h | ❓ |

#### 依賴關係

```
B1 → B2, B3, B4（可並行）→ B5 → B6
```

#### 交付物

- `packages/backend/src/parser.ts`
- `packages/backend/src/decision.ts`
- `packages/backend/src/whatif.ts`
- `packages/backend/src/api.ts`

---

### C. 前端 Dashboard

**負責人**: ⏳ 待認領
**需要技能**: React, CSS, 資料視覺化
**預估工時**: 20 小時

#### 任務清單

| # | 任務 | 預估時間 | 狀態 |
|---|------|----------|------|
| C1 | 設計 UI 畫面配置 | 3h | ❓ |
| C2 | 實作路網地圖元件 | 4h | ❓ |
| C3 | 實作即時數據面板 | 3h | ❓ |
| C4 | 實作決策建議書元件 | 3h | ❓ |
| C5 | 實作對話視窗 (What-if) | 3h | ❓ |
| C6 | 實作多語通報面板 | 2h | ❓ |
| C7 | 串接後端 API | 2h | ❓ |

#### 依賴關係

```
C1 → C2~C6（可並行）→ C7
```

#### 交付物

- `packages/frontend/src/App.tsx`
- `packages/frontend/src/components/MapView.tsx`
- `packages/frontend/src/components/DataPanel.tsx`
- `packages/frontend/src/components/DecisionCard.tsx`
- `packages/frontend/src/components/ChatWindow.tsx`
- `packages/frontend/src/components/MultilingualPanel.tsx`

---

### D. AI 整合

**負責人**: ⏳ 待認領
**需要技能**: Python/TypeScript, AWS Bedrock, 提示工程
**預估工時**: 15 小時

#### 任務清單

| # | 任務 | 預估時間 | 狀態 |
|---|------|----------|------|
| D1 | 設計 Bedrock 調用架構 | 2h | ❓ |
| D2 | 實作決策建議書生成 | 3h | ❓ |
| D3 | 實作多語通報生成 | 3h | ❓ |
| D4 | 實作 What-if 對話理解 | 3h | ❓ |
| D5 | 實作決策解釋鏈生成 | 2h | ❓ |
| D6 | 整合測試 | 2h | ❓ |

#### 依賴關係

```
D1 → D2~D5（可並行）→ D6
```

#### 交付物

- `packages/rag/src/bedrock.ts`
- `packages/rag/src/decision-generator.ts`
- `packages/rag/src/multilingual-generator.ts`
- `packages/rag/src/whatif-understander.ts`

---

### E. 報告 + 協調

**負責人**: ⏳ 待認領
**需要技能**: 簡報設計, 溝通, 專案管理
**預估工時**: 10 小時

#### 任務清單

| # | 任務 | 預估時間 | 狀態 |
|---|------|----------|------|
| E1 | 設計簡報模板 | 2h | ❓ |
| E2 | 製作提案簡報 | 4h | ❓ |
| E3 | 錄製 Demo 影片 | 2h | ❓ |
| E4 | 進度追蹤 + 每日站會 | 2h | ❓ |

#### 依賴關係

```
E1 → E2, E3（可並行）
E4（持續進行）
```

#### 交付物

- `docs/presentation.pptx` 或 `docs/presentation.md`
- `docs/demo-video.mp4`
- `docs/progress.md`（持續更新）

---

## 團隊成員

| # | 姓名 | 技術能力 | 認領工作包 | 每日可投入時間 |
|---|------|----------|-----------|---------------|
| 1 | ⏳ | TypeScript/JavaScript | ⏳ | ⏳ |
| 2 | ⏳ | React | ⏳ | ⏳ |
| 3 | ⏳ | AWS | ⏳ | ⏳ |
| 4 | ⏳ | 簡報/設計 | ⏳ | ⏳ |
| 5 | ⏳ | Python | ⏳ | ⏳ |

---

## 溝通機制

| 機制 | 時間 | 形式 |
|------|------|------|
| 每日站會 | 21:00 | 群組語音或文字 |
| 緊急問題 | 隨時 | 群組訊息 |
| 技術討論 | 需要時 | 視訊會議 |

---

## 確認清單

- [ ] 每個人回答技術能力
- [ ] 每個人認領工作包
- [ ] 每個人回報每日可投入時間
- [ ] 確認有 AWS 帳號
- [ ] 確認報告格式
- [ ] 建立 GitHub repo
- [ ] 推送程式碼到 GitHub

---

## 下一步

1. 將 `docs/team-announcement.md` 內容貼到團隊群組
2. 等每個人回答
3. 更新本文件
4. 開始開發

---

**文件結束**
