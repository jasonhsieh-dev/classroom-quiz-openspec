# 真實 Google Sheets 唯讀驗收嘗試（2026-11-18，Asia/Taipei）

狀態：**讀取未通過；授權成功尚未確認**。本輪僅獲准讀取，未獲准寫回。

- 使用者指定文件：ID 尾碼 kqjuI1，sheetId 436731168（不在公開證據重複完整私人網址）。
- Codex 工具程序未繼承 GOOGLE_APPLICATION_CREDENTIALS；未搜尋或輸出私鑰。
- sandbox 內 localhost 不可達；使用允許本機連線的執行環境後，正式後端 health 回傳 status=ok。
- 建立本機老師 Session，呼叫正式 POST /api/teacher/imports/sheets 與 POST /api/teacher/imports 預覽。兩者對 Google 僅使用 spreadsheets.get；沒有呼叫 confirm 活動、writeback、batchUpdate 或其他 Google 更新。
- 分頁清單與指定分頁預覽均回傳 HTTP 400、GOOGLE_REQUEST_REJECTED。單獨重試分頁清單同樣失敗。
- 顯示「Google 拒絕批次請求，請檢查來源範圍與資料。」為目前共用錯誤轉譯，不能據此推斷已發送寫入。轉譯未保留足以區分 Token 授權與 Sheets 文件錯誤的資訊。
- 正式授權模組會先讀取及檢查服務帳號設定；本次未出現 GOOGLE_NOT_CONFIGURED／GOOGLE_CREDENTIALS_INVALID。但無法單憑 400 確認 Token 授權成功。

尚未取得分頁名稱、儲存格、合併範圍或題目，無法對照真實文件，也不宣稱定位正確。可能原因包括授權請求問題、文件識別或文件格式不受 Sheets API 支援；目前無法確定，不將推測當根本原因。

下一步：在已設定憑證的使用者終端分開測試 Token 取得與唯讀 metadata GET；僅回報成功旗標、HTTP status 與去敏 Google error code／reason。確認文件是原生 Google 試算表，而非仍以 Excel 格式開啟的檔案，並檢查私鑰是否撤銷及電腦時間是否正確。修正後重跑正式 Reader，取得預覽再與原文件人工對照。

Tasks 5.2、5.3 保持未完成。真實寫回測試尚未具備已驗證的前置條件；需先通過讀取，且另行取得明確寫回授權。
