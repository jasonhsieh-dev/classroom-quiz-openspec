最新狀態：既有真實讀寫與人工可見範圍驗收證據保留。後續 OpenSpec Verify 曾因租期交錯缺陷判定 FAIL；本輪 Apply 修正與合成回歸見 [修正紀錄](google-sheets-verify-fix-2026-11-18.md)。本次沒有重新執行真實寫入，亦未重新 Verify。下方 Task 完成與未完成描述為各階段歷史，最新進度以 tasks.md 為準。



## 2026-11-18 最終人工驗收與交付判定

使用者回報已在 Google Sheets 網頁以頁面上、下兩張截圖核對：G5=CPU、G7=0、G9=IP、G11=作業系統、G13=堆疊、G15=演算法、G17 空白，均通過；六個答案位於正確作答欄。可見題目、表格邊框與合併區域無明顯異常，答案無明顯裁切、溢出或對齊異常。

證據來源為本輪使用者明確回報，不是 Codex 自行檢視截圖。本輪未取得兩張可存取圖片附件或檔案，沒有保存或虛構圖片連結。人工結論僅及於截圖可見範圍；不延伸宣稱未檢查的列高、欄寬或全部隱藏屬性均已驗證。

真實 API 證據見 google-sheets-native-read-2026-11-18.md 與 google-sheets-native-writeback-2026-11-18.md，原始去敏前後快照位於 Git 忽略的 var/。六值為 stringValue、G17 不變、非目標已讀內容及 userEnteredFormat 保留、23 個 merge 不變；六個目標 effectiveFormat 新增 LEFT／PLAIN_TEXT，保留此差異而非稱為 JSON 全等。使用者確認可見外觀沒有異常，符合本次功能及畫面驗收；未驗證屬性作為證據範圍限制，不假稱全面保真。

已由正式系統完成兩組學生搶答及 CLOSED 結果、真實讀取與一次寫回；本輪沒有再呼叫 Google 更新、confirm 或 renew。原始 Task 5.2 的讀寫、非目標比較及必要人工核對已有分層證據，最終自動回歸已通過並完成 5.3；不以 Mock 取代真實驗收。

---

歷史過程／模板（下列未執行或未完成文字僅代表當時狀態，最新結論見上方）

> 最新結果：本次已完成一次真實寫回，六值讀回正確、操作 SUCCEEDED。目標 effectiveFormat 出現衍生欄位差異，人工畫面檢查與最終回歸尚未完成；5.2、5.3 未勾選。下方先前停止紀錄保留，最新證據見文末。

# 真實寫回驗收：寫入前停止（2026-11-18，Asia/Taipei）

結果：**未執行寫入，不是成功驗收**。使用者授權僅一次 batchUpdate，現有服務無單次操作的嘗試次數限制，因此未呼叫確認。

- Spreadsheet ID：〔已遮蔽，尾碼 fP6Qr8〕；sheetId：1133085307，學習單。完整文件識別僅保存在 Git 忽略的本機原始證據，不宣稱文件已獲准公開。
- Activity ID：3b834c9b-2ad1-4771-a457-472ec109da46，狀態 CLOSED。
- Operation ID：7d74c616-bd65-4461-83ef-cd5de24fbd6f，狀態 PREPARED，沒有其他進行中操作。
- 正式後端狀態／結果讀取成功，真實 Reader 預覽 HTTP 201，解析 7 題。
- 結構指紋與活動來源一致，六題第一名答案與授權一致；六個目標仍空白，G17 仍空白。

| 目標 | 寫回前 | 授權期望 | 寫回後 |
|---|---|---|---|
| G5 | 空白 | CPU | 未執行 |
| G7 | 空白 | 0 | 未執行 |
| G9 | 空白 | IP | 未執行 |
| G11 | 空白 | 作業系統 | 未執行 |
| G13 | 空白 | 堆疊 | 未執行 |
| G15 | 空白 | 演算法 | 未執行 |
| G17 | 空白 | 不得修改 | 未執行 |

阻礙：google-sheets-writeback-service.ts 的 confirm 使用最多三次更新嘗試，429 與特定 5xx 分支可再次呼叫 writer.write。即使 transport 禁止自動重試，服務層仍可能重送。不能以預期第一次會成功取代硬性「只允許一次」限制。

本輪沒有呼叫 writeback/confirm 或 Google batchUpdate，沒有寫入 HTTP 結果及寫回後比較證據；沒有改變原活動、排名或操作狀態。僅新增本機預覽草稿及保存證據，未建立其他活動。

完整必要寫入前網格快照與核對位於 Git 忽略的 var/google-writeback-final-precheck.json、var/google-writeback-final-before.json，不含憑證或 Cookie。未宣稱已逐項比較未取得的跨分頁版面屬性。

下一步需先在正式服務加入可驗證的單次更新限制，保留既有操作識別、來源重檢與 reconcile；並補足完整跨分頁格式／版面讀回證據。完成後再重新檢查並執行授權測試。Tasks 5.2、5.3 均保持未完成，尚不適合以完整完成狀態進入最終 Verify。

## 後續程式修正（未執行真實寫回）

已新增可信後端 CLASSROOM_BUZZER_SINGLE_UPDATE=true、持久已嘗試標記、獨立 renew 操作及底層授權重播防護。完整 Vitest 296／296、獨立埠 Mock Playwright 3／3、typecheck、lint、build、Change strict 與 diff 檢查通過。先前的單次限制阻礙已由程式與 Mock 測試處理，但真實環境必須於啟動終端啟用並重啟、重新 preflight；不能將本次測試記為真實寫回成功。原活動 CLOSED／revision 15、原 operationId PREPARED、singleUpdateAttempted=false，未修改既有操作內容。Tasks 5.2、5.3 保持未完成。


## 最新驗收嘗試：停止於執行實例模式確認

正式後端 health 成功，入口為正式 index、非 E2E Mock。既有操作 API 回傳 PREPARED、原 operationId、resultVersion 15，文件／分頁及六個答案均符合授權。

目前 API 沒有回傳服務實例的 singleUpdate 設定；health 也沒有該資訊。啟動命令列未包含設定，但這不能證明環境變數未設定；同樣，程式支援該設定也不能證明目前實例已啟用。因此無法可靠確認使用者要求的第一階段第 2 項，依明確指示立即停止，未進行本輪第二階段雲端重讀或 confirm。

本輪 batchUpdate 次數為 0；沒有 Google 寫入 HTTP 結果或寫回後驗證。未呼叫 renew、再次 confirm 或 reconcile，沒有修改原活動或 PREPARED 操作。Tasks 5.2、5.3 保持未完成。

建議補上受老師權限保護、僅回傳目前服務實例布林值的模式狀態（不回傳任何憑證／環境全文），並測試；或以正式啟動時的安全模式紀錄提供可核對證據。確認後才能重新開始此次驗收。不可把命令列不含設定誤判為模式關閉，也不可憑外部 shell 的變數值宣稱既有程序已啟用。

## runtime 狀態佐證修正

已新增受老師權限保護的 GET writeback/runtime，與操作狀態共享服務 instanceId／有效模式。後續先重啟並查詢證實模式再做真實驗收；本輪僅程式與 Mock 測試，未呼叫原活動 confirm／renew 或修改 PREPARED 操作。

唯讀 runtime 修正驗證：完整 Vitest 298／298、獨立埠 Mock Playwright 3／3、typecheck、lint、build、Change strict 與 git diff --check 通過。原 operationId 7d74c616-bd65-4461-83ef-cd5de24fbd6f 仍為 PREPARED、尚未嘗試更新；未執行真實 confirm／renew，未勾選 5.2／5.3。下一輪須由真實後端 runtime API 確認有效模式，不能把本輪 Mock true 當作正式程序的 true。


## 真實單次寫回實際結果

- 環境：2026-11-18（Asia/Taipei）、正式 loopback 後端 http://127.0.0.1:3000、正式 Reader／Writeback Service，非 Mock。
- Spreadsheet ID：〔已遮蔽，尾碼 fP6Qr8〕；sheetId 1133085307，學習單。
- Activity ID：3b834c9b-2ad1-4771-a457-472ec109da46；operationId 7d74c616-bd65-4461-83ef-cd5de24fbd6f。
- runtime／操作狀態／confirm 三者的 singleUpdateMode=true，instanceId 均為 55024a46-33d1-49cf-9740-3a1ec143f298。
- 寫前檢查通過：CLOSED／revision 15、PREPARED 且無嘗試標記、無其他 IN_FLIGHT、來源指紋一致、六題 rank=1 答案相符、六個目標及 G17 皆空白。已保存新鮮網格快照。
- 僅送出一次正式 confirm，後端 HTTP 200、state=SUCCEEDED、errorCode=null；未 renew、未再次 confirm，沒有需要 reconcile。
- 更新次數：依實際執行路徑、單次模式與已持久保存的 singleUpdateAttempted=true，可判定一次 Writer batchUpdate 更新；未取得獨立封包計數。原始 Google HTTP status 未由服務保留，因此不捏造 Google HTTP 200；可觀測證據為正式 confirm HTTP 200、服務成功及獨立真實讀回。

| Anchor | 寫前 | 真實讀回 userEnteredValue |
|---|---|---|
| G5 | 空白 | stringValue: CPU |
| G7 | 空白 | stringValue: 0 |
| G9 | 空白 | stringValue: IP |
| G11 | 空白 | stringValue: 作業系統 |
| G13 | 空白 | stringValue: 堆疊 |
| G15 | 空白 | stringValue: 演算法 |
| G17 | 空白 | 空白、不變 |

### API 快照比較

所有已讀取的非目標儲存格內容、公式與格式一致；所有儲存格 userEnteredFormat 一致；23 個 merge 範圍及已讀分頁 properties 不變。前後分頁清單一致，均僅有「學習單」，沒有其他分頁可逐格比較。

嚴格全欄位比較並非全相同：G5、G7、G9、G11、G13、G15 的 effectiveFormat 增加 horizontalAlignment=LEFT 與 hyperlinkDisplayType=PLAIN_TEXT。userEnteredFormat 並未改變，更新 mask 僅 userEnteredValue；這與 Google 對文字值的有效顯示格式推導一致，但未經人工畫面檢視，不能宣稱所有有效顯示格式完全不變。未讀取的列高、欄寬等版面屬性亦不冒稱已逐項 API 比較。差異保留於證據，沒有自動覆原或再次更新。

### 本機資料庫驗證

操作 SUCCEEDED，singleUpdateAttempted=true；活動仍 CLOSED、revision 15；組別、最終結果、各題第一名、順位與時間和寫前完全相同。

### 證據與待辦

Git 忽略的 var/google-writeback-runtime-check.json、google-writeback-authorized-before.json、google-writeback-authorized-before-snapshot.json、google-writeback-authorized-confirm.json、google-writeback-authorized-after.json、google-writeback-authorized-comparison.json、google-writeback-authorized-differences.json 保存了去敏證據；不含憑證、Token 或 Cookie。

仍待人工確認文字對齊／外觀及其他版面；真實授權故障清單未全數人工走查，且尚未做本次寫回後最終完整回歸。Tasks 5.2、5.3 保持未完成，整體 9/11，不自動進入 Verify／Sync／Archive。
