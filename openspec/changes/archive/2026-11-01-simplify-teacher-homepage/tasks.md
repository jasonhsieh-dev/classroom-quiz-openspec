# Tasks

## 1. 首頁導覽與對應驗證

- [x] 1.1 調整 `apps/web/src/App.tsx`：首頁沿用摘要 API 只顯示 OPEN 提示與真正的返回連結，移除自動恢復與歷史清單，錯誤返回改為匯入首頁；同步更新 `App.test.tsx`，以 `npx vitest run apps/web/src/App.test.tsx` 驗證空資料／僅歷史／有 OPEN、URL 不變、不預載 snapshot、連結目標、Session 與摘要失敗重試、錯誤返回，以及既有三狀態網址恢復與匯入流程。
- [x] 1.2 擴充 `tests/e2e/classroom-buzzer.spec.ts`：有 OPEN 時另頁進入並重新整理根頁，確認匯入、提示與返回連結，點擊後恢復同一活動；沒有 OPEN 時確認沒有提示與歷史清單；以 `npm run test:e2e` 驗證新案例及既有 DRAFT／OPEN／CLOSED 恢復、Session 隔離、多人搶答、排名、截止與 XLSX 匯出回歸，並確認活動數量及歷史資料未被首頁導覽改變。
- [x] 1.3 更新 `README.md` 與 `docs/manual-acceptance.md` 的現行首頁與錯誤返回說明，保留舊驗收紀錄；人工走查有／沒有 OPEN、返回連結及三狀態活動網址恢復，記錄結果並確認文件與畫面一致。

## 2. 整合檢查

- [x] 2.1 執行 `npm run lint`、`npm run typecheck`、`npm test` 與 `openspec validate simplify-teacher-homepage --strict`，確認全部通過；檢查差異僅包含規劃及上述前端、測試與文件，沒有後端 API、schema、Session、Socket.IO、排名、XLSX 實作或歷史資料變更。
