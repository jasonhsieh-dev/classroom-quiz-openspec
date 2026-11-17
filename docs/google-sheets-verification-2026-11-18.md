# Google Sheets 整合自動驗證（2026-11-18，Asia/Taipei）

模式：受控 Mock Google API ＋ 隔離本機 SQLite／Chromium。**真實 Google API 讀取、寫入及人工驗收均尚未執行。** 本次未使用真實憑證或呼叫真實 Sheets 更新。

## 實際執行結果

| 指令 | 結果 |
|---|---|
| npm test | 41 檔案，285／285 通過 |
| npm run test:e2e | Chromium 3／3 通過 |
| npm run typecheck | 通過 |
| npm run lint | 通過 |
| npm run build | 通過 |
| openspec validate integrate-google-sheets-guided-notes --strict | 通過 |
| openspec validate --specs --strict | 7／7 通過 |
| git diff --check | 通過 |

主規格驗證只是現有主規格結構驗證，尚未 Sync，不代表主規格已包含本 Change 的雲端要求。

## 證據分層

| 要求 | 受控證據 |
|---|---|
| 網址、分頁、預覽、取消、確認 | classroom-buzzer.spec.ts 第三條 E2E；import-routes／Reader／App 測試 |
| 三狀態、兩組、唯一 OPEN、Session／Cookie、Socket.IO、恢復 | 三條 E2E 與既有 API／Socket 測試 |
| 排名、相同答案拒絕、真正修改 | 第二條 E2E，包含時間、序號與結果斷言 |
| CLOSED 寫回、刷新成功狀態、第一名 anchor | 第二條 E2E，檢查實際送出的合成 batch 與前後文件 |
| 公式、格式、合併、未答及其他分頁保留 | E2E Mock 文件補強 merged C2:D2、目標格式、未答公式及非目標公式；完整前後合成文件比較；writer 單元測試 |
| 來源衝突、401／403／404、配額、5xx | planner／authorization／writeback-service／API 測試 |
| 逾時已寫／未寫、UNKNOWN、重試、並行及 DB 不同步 | writeback-service 與 GoogleSheetsWriteback 前端測試；這些故障未在真實 Google 重現 |
| 歷史 XLSX | 第一條 E2E 與舊 parser／匯出測試 |

## 安全檢查與界線

- Git 暫存區為空；追蹤與未忽略文字檔的 PEM 私鑰內容、常見 Token、service_account JSON 及 .env 特徵掃描未發現候選。測試的 SYNTHETIC-NOT-A-KEY 不是真實金鑰。
- git check-ignore 確認 secrets/、credentials/、service-account JSON、.env 與 token.json 範例路徑被忽略。
- 授權模組由後端 GOOGLE_APPLICATION_CREDENTIALS 讀取絕對路徑；固定 Sheets scope／端點，禁止轉址，錯誤去敏，不記錄 Google 原始回應。
- dev:server／start 指向正式 index；正式呼叫 startServer() 不注入 Mock。合成 Google executor 僅由 tests/e2e/google-sheets-server.ts 注入。
- 掃描是啟發式檢查，不保證檢出所有秘密；之後每次暫存仍須人工檢查，不能將任意名稱的憑證 JSON 留在專案。

## Tasks 判定

5.1 已具備 Mock 整合與既有兩輪回歸證據，可以勾選。5.2 的文件已準備，但真實兩組 Google 讀寫及非目標比較未做，保持未完成。5.3 的自動檢查已通過，但原 Task 明定真實驗收完成才勾選，因此保持未完成。

真實測試前置與五分鐘流程見 manual-acceptance.md、google-sheets-demo.md；空白證據格式見 google-sheets-evidence-template.md。不得將此紀錄複製為真實驗收 PASS。
