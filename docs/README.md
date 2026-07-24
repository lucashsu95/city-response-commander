# 📁 docs/ — 城市交通應變 AI 指揮台 文件目錄

**最後更新**: 2026-07-24

---

## 📂 文件分類

### 🎯 專案管理

| 檔案 | 內容 | 誰該看 |
|------|------|--------|
| `team-announcement.md` | 團隊分工公告（貼到群組用） | 全員 |
| `team-roles.md` | 工作包詳細任務 + 認領狀態 | 隊長、各工作包負責人 |
| `progress.md` | 7 天里程碑 + 每日進度追蹤 | 全員 |

### ⚙️ 技術規格

| 檔案 | 內容 | 誰該看 |
|------|------|--------|
| `spec.md` | 33 條 User Stories + 技術決策 + 測試 Seam | A（規則引擎）、B（後端） |
| `language-boundary.md` | 語言邊界規範（TypeScript 為主） | 全員 |

### 📊 資料分析

| 檔案 | 內容 | 誰該看 |
|------|------|--------|
| `data_audit.md` | 7 個官方檔案的 SHA-256 驗證 + 資料結構分析 | A（規則引擎） |

### 🎬 Demo 準備

| 檔案 | 內容 | 誰該看 |
|------|------|--------|
| `demo-scenario.md` | 3 個事件完整場景 + 畫面示意 + 評分重點 | E（報告）、C（前端） |

---

## 📋 閱讀順序建議

### 新成員入門（30 分鐘）

1. `team-announcement.md` — 了解專案目標和分工
2. `team-roles.md` — 找到自己的工作包
3. `spec.md` — 了解技術需求
4. `demo-scenario.md` — 了解要 demo 什麼

### 技術深入（1 小時）

1. `spec.md` — 33 條 User Stories
2. `data_audit.md` — 資料結構分析
3. `language-boundary.md` — 程式碼規範
4. `demo-scenario.md` — Demo 場景細節

### 每日站會（5 分鐘）

1. `progress.md` — 檢查進度

---

## 📁 目錄結構

```
docs/
├── README.md                 ← 本文件
├── team-announcement.md      ← 團隊分工公告（貼群組）
├── team-roles.md             ← 工作包詳細任務
├── progress.md               ← 進度追蹤
├── spec.md                   ← 專案規格書
├── language-boundary.md      ← 語言邊界規範
├── data_audit.md             ← 資料審計報告
└── demo-scenario.md          ← Demo 場景定義
```

---

## 🔗 相關連結

| 連結 | 說明 |
|------|------|
| `../README.md` | 專案根目錄說明 |
| `../config/config.local.yaml` | LOCAL_MOCK 設定 |
| `../packages/shared-schemas/` | 共用型別定義 |

---

**文件結束**
