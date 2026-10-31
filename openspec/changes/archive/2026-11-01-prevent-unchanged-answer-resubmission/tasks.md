# Tasks

## 1. 無變更提交防護與驗證

- [x] 1.1 在 `apps/server/src/services/submission-service.ts` 原 immediate transaction 中，既有 key／OPEN／題目檢查後、序號配置前比較 current，回傳 `409 ANSWER_UNCHANGED`；擴充 `apps/server/src/activities/submission-routes.test.ts` 與 `transaction-concurrency.test.ts`，驗證 trim 相同、新 key、跨同組 session、不寫入所有有效欄位、不發布 committed event、不同組不去重、A → B → A、既有成功 key 原結果／衝突／不回復 current、截止優先，以及獨立連線 barrier 下首次／修改／已有相同 current 的並行請求；以這兩個檔案的 Vitest 測試全部通過為完成條件。
- [x] 1.2 在 `apps/web/src/App.tsx` 的學生提交回應分支顯示「答案未變更，無須重新提交」一般提示，清除該次 pending key 並解除等待，切題／編輯／下次提交時清除提示；擴充 `apps/web/src/App.test.tsx`，驗證不捏造新時間、不依過時 snapshot 略過後端、真正修改確認與提交、網路失敗同 key 重試、Session 身分保護與 CLOSED 處理保持原樣，以該檔案 Vitest 測試全部通過為完成條件。
- [x] 1.3 擴充 `tests/e2e/classroom-buzzer.spec.ts`，以兩組先後提交驗證第一組重送相同答案時顯示提示、attempt／current／序號／revision／時間不變且截止結果仍為第一名，另以其他題驗證真正修改仍依新序號排名；更新 `docs/manual-acceptance.md` 對應步驟並記錄實際走查結果，保留既有驗收紀錄。執行 `npm test`、`npm run test:e2e`、`npm run typecheck`、`npm run lint`、`npm run build`、`openspec validate prevent-unchanged-answer-resubmission --strict` 與 `git diff --check`，全部通過且差異未改動首頁、導覽、Cookie、Socket.IO、schema、排名或 XLSX 實作，才完成本項。
