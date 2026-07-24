# 🏗️ 城市交通應變 AI 指揮台 — 團隊分工公告

**專案啟動日期：** 2026/07/24
**比賽日期：** 2026/08/01 (8 天後)

---

## 📋 專案一句話

> 做一個「城市交通 AI 指揮台」Dashboard，當車禍/事故發生時，系統自動讀官方 SOP、算出疏散路線、告訴指揮官怎麼辦，還能用 What-if 模擬假設情境。

---

## 🎯 Demo 範圍（豪華版）

- ✅ 3 個官方事件都做
- ✅ What-if 模擬
- ✅ 中英多語 + 日韓加分
- ✅ 完整 Dashboard 畫面
- ✅ 提案簡報 + 錄製影片

---

## 👥 五人分工表

| 角色 | 負責什麼 | 認領條件 | 最小交付 |
|------|----------|----------|----------|
| **A. 規則引擎** | SOP 1~7 判斷、ETE 計算、路徑篩選 | 邏輯最強 | `rule-engine.ts` |
| **B. 後端 API** | Lambda、API Gateway、DynamoDB | 會 AWS | API endpoints |
| **C. 前端 Dashboard** | React 畫面、地圖、What-if 視窗 | 會 React | Dashboard 畫面 |
| **D. AI 整合** | Bedrock 串接、建議書、多語生成 | 會 API | AI 文字生成 |
| **E. 報告 + 協調** | 簡報、錄影片、進度追蹤 | 會簡報 | 15 頁簡報 + 影片 |

---

## 🚀 七天衝刺排程

| 天數 | 日期 | 工作內容 |
|------|------|----------|
| D1 | 7/24 (今天) | 建 repo + 分工確認 |
| D2 | 7/25 | 規則引擎 + 前端框架 |
| D3 | 7/26 | API 串接 + 畫面 |
| D4 | 7/27 | Bedrock 整合 + What-if |
| D5 | 7/28 | 整合測試 |
| D6 | 7/29 | 打磨 demo + 報告 |
| D7 | 7/30 | 報告 + 錄影片 |
| 8/01 | 比賽日 🎯 | |

---

## 📁 Repo 連結

```
GitHub: [請隊友 B 建 repo 後補上]
```

### Clone + 安裝

```bash
git clone [repo 連結]
cd city-response-commander
npm install
npm run typecheck  # 確認環境正常
```

---

## 📝 請每人回答

請在今天內回答以下問題：

**1. 你的技術能力？**
- [ ] TypeScript/JavaScript
- [ ] React
- [ ] AWS (Lambda/DynamoDB/API Gateway)
- [ ] 做簡報/設計
- [ ] Python

**2. 你的工作包選擇？（選一個）**
- [ ] A. 規則引擎（SOP 判斷邏輯）
- [ ] B. 後端 API（AWS Lambda）
- [ ] C. 前端 Dashboard（React）
- [ ] D. AI 整合（Bedrock）
- [ ] E. 報告 + 協調

**3. 你每天能投入多少時間？**
- [ ] 2 小時以下
- [ ] 2-4 小時
- [ ] 4 小時以上

---

## ⚠️ 重要提醒

1. **今天內認領工作包**，明天開始分工
2. **所有人用 shared-schemas 的型別**，不要自己定義
3. **先做 MVP**，確保有東西交，再加功能
4. **報告至少 1 天**，不要等到最後才做

---

有任何問題，隨時在群組問！
