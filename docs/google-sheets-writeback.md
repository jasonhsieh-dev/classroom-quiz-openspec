# Google Sheets 雲端寫回操作與復原（Phase 4）

僅適用 google-sheets 來源且已 CLOSED 的活動。舊 XLSX 活動保留歷史下載，不轉綁雲端。2026-11-18 已完成真實 Google API 讀取與寫回、六個答案讀回，以及使用者回報的截圖可見範圍核對；限制見 [真實驗收紀錄](google-sheets-native-writeback-2026-11-18.md)。本次租期交錯修正僅使用合成測試，未重新執行真實寫回。正式啟動不載入 Mock。

## 老師操作

在結果頁按「寫回 Google Sheets」，檢查文件連結、分頁、題號、anchor、原始輸入及第一名答案，再按「確認寫回 Google Sheets」。無獲勝者的題目不列入；全無答案時顯示無需寫回。原始公式會在預覽列出，確認後只將有獲勝者的 anchor 改為字串，包含等號開頭的答案。

請暫停外部共編。來源結構指紋與目標原值會在預覽及每次送出前重讀；這不是雲端鎖，無法消除檢查至更新間的競態。發現變動即停止，不自動改綁、移動 mapping 或覆原老師的修改。

## API 與權限

- `GET /api/teacher/activities/:activityId/writeback`：讀取持久狀態與預覽資料，不發出更新請求。
- `POST .../writeback/preview`：檢查來源並準備唯一操作。
- `POST .../writeback/confirm`：JSON `{ operationId, confirmed: true }`，明確確認或重試同一操作。
- `POST .../writeback/reconcile`：JSON `{ operationId }`，只核對，不發出更新請求。

所有路由沿用老師 Session、loopback 與同站 mutation 保護；不接受學生 Session。來源與答案均來自後端已保存資料，不接受用戶端指定其他文件、目標或答案。前端不取得憑證或完整 snapshot。

## 更新契約

使用單次 spreadsheets.batchUpdate，每題一個單格 UpdateCellsRequest，只設定 fields=userEnteredValue 及 stringValue。上限 1000 個目標及 2 MB payload；超限直接拒絕，不拆批。合併答案只寫左上 anchor。API 的原子批次不等於 Google 與 SQLite 的跨系統交易。

讀回檢查目標字串、結構及所選分頁非目標原始值／明確格式；計算結果與顯示文字的重算不當成輸入修改。其他分頁及列欄版面不在更新 mask 範圍，自動測試另比較完整合成文件確認保留。

## 狀態與復原

- NOT_PREPARED／PREPARED：待預覽／待確認，未發出更新。
- IN_FLIGHT：操作進行中，重複請求只回狀態。網路請求不在 SQLite transaction 中。
- SUCCEEDED：目標與保護內容讀回核對成功；相同結果版本的重送不再寫入。
- FAILED：確定拒絕，或讀回確認全部仍為原值；老師檢查原因後可明確重試，每次重新檢查來源。
- UNKNOWN：逾時或無法讀回，先按「核對寫回狀態」；不能直接重送。
- CONFLICT：結構、目標混合值或保護內容有差異，停止重試，須人工檢查；不自動回滾。

相同活動結果版本只有一個持久操作。更新前以 immediate transaction 取得操作權，之後在 transaction 外讀寫 Google。每個有界網路階段更新操作時間；程序中斷遺留 IN_FLIGHT，在最後更新超過 120 秒後呈現 UNKNOWN，下一次明確核對才接手，避免並行請求立即搶占。

核對全部期望值且保護內容一致即成功；全部原值且結構／保護內容一致則可重試；混合值或其他值為衝突。Google 成功但 SQLite 記錄失敗時盡力標示 UNKNOWN；若資料庫仍不可寫則保留 IN_FLIGHT 供租期後核對。不要刪除操作紀錄來強制重送。

429 或暫時 5xx 最多三次更新嘗試，採指數退避加 jitter；5xx 先讀回，只有確認全部原值才重試。每次讀取階段最多兩次。連線／逾時不自動重送更新，讀回原值後仍需老師明確重試。401 檢查服務帳號；403 檢查 Editor 分享及保護範圍；404 可能不存在或無權限。錯誤紀錄只存代碼，不存 Google 原始回應、Token 或私鑰。

寫回失敗、核對或重試不修改 CLOSED、revision、submission attempts、最終結果或順位。既有真實驗收成功不表示任何新的環境都已連線；新環境仍須設定憑證及文件分享。合成故障測試不冒充真實故障實測。

## 展示與證據

使用 [人工清單](manual-acceptance.md) 比較真實文件，並填寫 [證據模板](google-sheets-evidence-template.md)。[自動驗證紀錄](google-sheets-verification-2026-11-18.md) 涵蓋受控故障，不代表真實 Google 寫回已驗證；不要為展示逾時或配額錯誤而對私人文件進行危險實驗。


## 單次更新驗收設定

在後端啟動終端設定 `$env:CLASSROOM_BUZZER_SINGLE_UPDATE = 'true'` 再重啟正式服務。未設定時沿用一般模式。設定不是前端參數，confirm 的 strict API 拒絕多餘重試選項。

單次模式在 Google 更新前保存已嘗試標記；同一 operationId 永不再更新，包括失敗、重複點擊、重啟及切回一般模式。reconcile 只讀。必要時先核對至 FAILED，再明確 POST `/api/teacher/activities/:activityId/writeback/renew`，JSON `{ operationId, confirmed: true }`；新 preflight 成功才產生新 PREPARED 操作，再用新識別明確 confirm。舊操作資訊保存於 history。此功能不自動呼叫，也不清除原成功／衝突紀錄。

底層更新使用取得授權 headers 後的原始 transporter，禁止 OAuth2 401／403 重播、HTTP 自動重試與轉址。已嘗試但未收到回應不表示未寫入；不得用修改資料庫旗標繞過核對。


## 寫入前確認有效執行模式

取得老師 Session 後，GET `/api/teacher/activities/:activityId/writeback/runtime`，回應只有 `singleUpdateMode` 與隨機 `instanceId`，例如 `{ "singleUpdateMode": true, "instanceId": "<UUID>" }`。這是實際 Writeback Service 的有效設定，不是即時重讀環境變數，也不能用 query 或 body 改成 true；唯讀端點不觸發 Google 或 SQLite 更新，回應禁止快取。

再 GET 同一 base URL 的 `/writeback`，確認 singleUpdateMode=true、instanceId 與 runtime 一致，及原操作 PREPARED／未嘗試。不同 Port、服務重啟或識別不同時，停止並重新核對。僅支援直接連線的單一後端，不支援多實例負載平衡；instanceId 是觀測識別，不是分散式鎖。不要把另一個 PowerShell 的變數視為已啟動程序的證據。

更新程式後需由啟動終端重新載入／重啟後端；若目前模式為 false，先停止服務，在同一終端設定 `$env:CLASSROOM_BUZZER_SINGLE_UPDATE = 'true'` 後重新啟動，再以此 API 實證。此文件不代表已啟用或已獲准寫回。

## 租期接手與單次資格

每次 claim 保存新的 ownershipToken。狀態保存及每個跨 await 階段都核對同一操作、token 與有效租期；過期請求只能取得最新狀態，不能改寫結果。寫入前 SQLite CAS 同時檢查 IN_FLIGHT、token、租期與未嘗試標記，受影響列數必須恰為一列才可進入 Writer。JSON 以欄位修補更新，避免舊快照清除已嘗試標記。

已取得的單次資格不因超過 120 秒、接手或程序重啟而再次核發。reconcile 只讀，更新結果不明時不可盲目重送；需要新更新仍依明確 renew 及新 operationId 流程。token 不會撤銷已送出的 Google 請求，也不是共編鎖。修正與測試證據見 [Verify FAIL 修正紀錄](google-sheets-verify-fix-2026-11-18.md)。舊正式後端需重新啟動才能載入修正，本輪不重啟或操作既有測試活動。

正式 transport 亦在授權 headers 取得後、送出更新 HTTP 前執行同一操作權 guard；過期或被接手時不送出 HTTP。guard 僅由後端 Service 傳入，不是前端可指定的參數，亦不包含在 Google 請求 JSON。
