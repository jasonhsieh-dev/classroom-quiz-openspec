# Proposal

## Why

目前以新 idempotency key 重複提交相同答案仍會建立 attempt、更新序號與時間，讓未實際修改答案的組別失去原有順位。本輪只阻止這類無變更提交，保留真正修改答案的既有排名規則。

## What Changes

- 在既有 SQLite immediate transaction 內、分配新序號之前，比較同組同題目前有效答案與本次 `trim()` 後答案。
- 新 key 且答案未變更時回傳 `409 ANSWER_UNCHANGED`，不新增 attempt、不改變 current submission、序號、revision、時間與順位，也不觸發 `submission.updated`。
- 學生端將該回應顯示為「答案未變更，無須重新提交」提示。
- 保留首次提交、真正修改、不同組相同文字、A → B → A、既有成功 key 重送／衝突、Session 驗證與截止競爭的原有語意。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `answer-submission-ranking`：限定後續新有效提交須有內容變更，定義無變更回應、學生提示與並行／冪等邊界。

## Impact

- 預計修改 `apps/server/src/services/submission-service.ts`、`apps/web/src/App.tsx`，及對應 API、真正並行、前端、E2E 測試與 `docs/manual-acceptance.md`。
- 沿用既有 `findCurrent`、ApiError 格式與提交端點，新增一種業務回應；不新增相依套件，不修改 schema 或排名演算法。
- 不修改首頁、活動導覽、Cookie、Session 安全機制、Socket.IO 實作及 XLSX 匯入匯出，不新增 CSV 或跨裝置功能。前一個首頁 Change 的既有工作保持原樣。
