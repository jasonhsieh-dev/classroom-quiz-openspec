# 原生 Google Sheets 真實唯讀驗收（2026-11-18，Asia/Taipei）

模式：正式後端，非 Mock。使用者僅授權讀取，未授權寫回。

- 後端監聽程序為正式 src/index.ts／dist/index.js 入口，不是 google-sheets-server 測試入口。
- 文件 ID 尾碼 fP6Qr8；指定 sheetId 1133085307。
- 正式 POST /api/teacher/imports/sheets 回傳 HTTP 200，確認分頁「學習單」、sheetId 正確。
- 正式 POST /api/teacher/imports 預覽回傳 HTTP 201，sourceKind=google-sheets，解析 7 題；未再發生 GOOGLE_REQUEST_REJECTED。
- 正式 Reader 以服務帳號讀取私人文件成功，可確認本次授權與文件存取成功；未讀出後端程序環境值、私鑰或 Token。
- 從本次真實 API 草稿快照唯讀交叉比對：23 個合併範圍；7 題的題號、完整題目顯示文字、答案合併範圍及左上 anchor 全部相符。

| 題號 | 題目摘要 | 題號格 | 題目範圍 | 答案範圍 | anchor |
|---|---|---|---|---|---|
| 1 | 執行指令的核心硬體英文縮寫 | B5 | C5:F5 | G5:H5 | G5 |
| 2 | 二進位的另一個數字 | B7 | C7:F7 | G7:H7 | G7 |
| 3 | 網路設備識別位址 | B9 | C9:F9 | G9:H9 | G9 |
| 4 | 管理硬體的系統軟體 | B11 | C11:F11 | G11:H11 | G11 |
| 5 | 後進先出資料結構 | B13 | C13:F13 | G13:H13 | G13 |
| 6 | 解決問題的步驟與規則 | B15 | C15:F15 | G15:H15 | G15 |
| 7 | 有沒有來上課? | B17 | C17:F17 | G17:H17 | G17 |

7 個答案原值皆為空。完整去敏 API DTO 與交叉比對結果保存於 Git 忽略的 var/google-native-read-evidence.json、var/google-native-read-crosscheck.json。這是 API 原始網格交叉比對，未宣稱完成 Google Sheets 畫面的人工逐格核對。

僅建立本機老師 Session 與匯入預覽草稿，沒有確認建立正式活動，沒有修改歷史活動、搶答結果或 Google 文件，沒有呼叫 batchUpdate／writeback。未記錄憑證。

結論：真實讀取與動態定位通過；真實寫回及非目標寫回前後比較仍未驗證。Tasks 5.2、5.3 保持未完成。下一階段須另行明確授權原文件、指定分頁與成功題 anchor 的測試寫回，並先保存原始版本／停止共編；本輪不自動繼續。
