# Session Handoff Protocol

> 當 context 過長或需要交接時，agent 應遵循此協議。
> 最後更新：2026-07-31

---

## 何時需要 Handoff

| 情況 | 觸發條件 | 行動 |
|------|----------|------|
| Context 過長 | 估計已用 > 75% context window | 開始收尾，準備 handoff |
| Context 爆掉 | 估計已用 > 90% context window | **必須** handoff，不可繼續 |
| 任務切換 | 從一個功能切到另一個功能 | 自然 handoff 點 |
| Session 中斷 | 使用者離開或系統超時 | 保存狀態後 handoff |

---

## Handoff 流程

### Step 1: 保存進度

更新 `docs/progress.md`：

```markdown
### YYYY-MM-DD（Handoff）

| 工作 | 負責人 | 狀態 |
|------|--------|------|
| [已完成的工作] | agent | ✅ |
| [進行中的工作] | agent | ⏳ [停在哪裡] |
| [待開始的工作] | agent | ❓ |
```

### Step 2: 保存技術決定

如果在 session 中做了任何技術決定，更新 `docs/decisions.md`：

```markdown
### ADR-XXX: [決定標題]

- **日期**: YYYY-MM-DD
- **狀態**: Accepted
- **決策者**: [agent/team member]
- **背景**: [為什麼做這個決定]
- **決策**: [決定做什麼]
- **理由**: [為什麼這樣選]
```

### Step 3: 寫 Handoff 筆記

在 `docs/handoff-notes/` 建立一個檔案（如果目錄不存在就建立）：

```markdown
# Handoff: [功能名稱]

**Session**: [日期時間]
**前一個 Agent**: [名稱]
**進度**: [完成百分比]

## 已完成

- [具體完成了什麼]

## 進行中

- [正在做什麼，停在哪一行/哪一個 function]

## 下一步

1. [具體的下一步動作]
2. [需要參考的檔案]

## 注意事項

- [任何需要注意的事]
- [已知的 bug 或 issue]

## 相關檔案

- `path/to/file.ts` — [為什麼重要]
```

### Step 4: 通知接手者

如果有下一個 agent（或同一個 agent 的下一個 session），確保它知道：

1. 讀取 `AGENTS.md`（SSOT）
2. 讀取 `docs/progress.md`（進度）
3. 讀取 `docs/handoff-notes/[最新的 handoff 筆記]`
4. 讀取 `docs/decisions.md`（技術決定）

---

## Handoff 筆記模板

```markdown
# Handoff: [功能名稱]

**Session**: YYYY-MM-DD HH:MM
**前一個 Agent**: [名稱]
**進度**: [完成百分比]

## 已完成

- [ ] [工作 1]
- [ ] [工作 2]

## 進行中

- [ ] [工作 3] — 停在 `packages/domain/src/sop/sop3.ts` line 42

## 下一步

1. 完成 [工作 3]
2. 補上 PBT 測試
3. 更新 `docs/spec.md` 對應的 User Story

## 注意事項

- `segment_id` 的 mapping 在 `shared-schemas` 裡，不要重複定義
- ETE 公式在 `domain/ete.ts`，修改時要同步更新測試

## 相關檔案

- `packages/domain/src/sop/sop3.ts` — SOP-3 判斷邏輯
- `packages/shared-schemas/src/road.ts` — 路段型別定義
- `docs/spec.md` US-23 — 對應的 User Story
```

---

## Context 保存技巧

### 當 Context 接近上限時

1. **立即做的事**：
   - 更新 `docs/progress.md`
   - 寫 handoff 筆記
   - 確保所有修改都通過 `npm run typecheck && npm run lint`

2. **不要做的事**：
   - 不要開始新的功能
   - 不要重構（除非是 fix bug）
   - 不要回覆使用者的非必要問題

3. **可以做的事**：
   - 讀取和理解現有程式碼
   - 規劃下一步（但不要開始做）

### 新 Session 的開頭

```markdown
# Session Start Checklist

1. [ ] 讀取 AGENTS.md（SSOT）
2. [ ] 讀取 docs/progress.md（進度）
3. [ ] 讀取 docs/handoff-notes/[最新的 handoff 筆記]
4. [ ] 讀取 docs/decisions.md（技術決定）
5. [ ] 確認 git 分支與狀態
6. [ ] 確認當前 tasks（如果有 kiro spec）
```

---

## 常見 Handoff 場景

### 場景 1: 功能開發到一半

```
Handoff 內容:
- 已完成: 型別定義、parser 基礎
- 進行中: SOP-3 判斷邏輯（停在 line 85）
- 下一步: 完成 SOP-3 + 補 PBT 測試
```

### 場景 2: 測試失敗需要 debug

```
Handoff 內容:
- 已完成: 所有 SOP 規則實作
- 進行中: PBT 測試失敗（TC-SOP3-002）
- 下一步: 檢查 0.30 邊界值的處理
- 注意事項: fast-check 的 arbitrary 要 include edge cases
```

### 場景 3: 整合測試需要多人協作

```
Handoff 內容:
- A 完成: domain 層所有規則
- B 完成: backend API handler
- 待整合: backend import domain 的方式
- 下一步: B 需要確認 import path 正確
```

---

**文件結束**
