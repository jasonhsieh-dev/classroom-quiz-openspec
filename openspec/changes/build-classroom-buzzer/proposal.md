# Proposal

## Why

課堂分組搶答目前缺乏能同時處理多題、保存公平提交順序並將結果寫回 Guided Notes 的本機工具。本變更建立一套可由老師控制、讓多組學生同步作答且具備可驗收隱私與截止規則的課堂搶答系統，作為軟體工程期末專題的完整核心功能。

## What Changes

- 建立老師與學生角色、老師預先建立組別、學生選組後由伺服器綁定組別 session 的存取模型。
- 支援匯入由 Google Sheets 下載的 `.xlsx` Guided Notes，依「題號」與「作答」表頭動態辨識題目及答案儲存格，並提供匯入預覽與錯誤診斷。
- 建立單一活動狀態流程，讓老師一次開放所有題目並結束整場活動；結束後禁止任何新增或修改提交。
- 支援每組對多題提交與修改答案，保存完整提交歷程，並以每組每題最後一次有效提交為排名依據。
- 對每題依資料庫交易內產生的單調遞增接收序號獨立排名，以伺服器接收時間作為紀錄與顯示欄位，並處理並行提交以及提交與截止的交易競爭。
- 透過依角色裁切的 HTTP snapshot 與 Socket.IO 狀態通知提供即時同步；斷線重連後以 HTTP snapshot 恢復，不假設學生收到所有全域 revision。
- 結束後向老師提供完整答案與順位；向學生僅公布各題成功組別的名稱或識別碼，以及自己組別的答案與順位，不公開任何其他組別的答案、提交時間或順位。
- 以原始 Guided Notes 副本匯出成功答案，僅允許成功題目的答案儲存格值改變，並以完整語意比較驗證其他工作表內容與格式；無成功組別時保留原填空內容。
- 提供自動化測試、至少兩組學生同時操作的本機 Demo，以及可重現的啟動與人工驗收說明。
- 不納入題組、CSV 匯出、公平順位加權、自動判分、正誤標記、順位遞補、Google Sheets API、PIN、完整帳號登入或公開部署。

## Capabilities

### New Capabilities

- `classroom-access`: 定義老師、學生、組別、session 綁定與角色資料可見性。
- `guided-notes-workbooks`: 定義 `.xlsx` Guided Notes 的動態辨識、匯入預覽、mapping 保存與原格式匯出。
- `quiz-activity-lifecycle`: 定義活動建立、所有題目同時開放、整場結束及狀態同步規則。
- `answer-submission-ranking`: 定義每組每題提交、修改、歷程、有效提交、獨立順位與截止交易競爭。
- `realtime-activity-sync`: 定義 Socket.IO 事件、HTTP snapshot、revision 與斷線重連行為。
- `quiz-results`: 定義老師與學生在結束後可查看的結果範圍及成功組別。
- `local-demo-verification`: 定義自動化測試、本機啟動與至少兩組學生的可驗收 Demo。

### Modified Capabilities

無。本專案目前沒有既有 capability。

## Impact

- 新增 React、Vite、TypeScript 學生／老師前端，以及 Node.js、Express、Socket.IO 後端。
- 新增 SQLite 資料模型與交易邏輯，並使用 `better-sqlite3` 保存活動、組別、題目、提交與結果。
- 新增 ExcelJS 活頁簿匯入／匯出流程及原始檔案保存區。
- 新增 HTTP API、Socket.IO 事件契約、角色授權與 session 管理。
- 新增 Vitest、Supertest、Playwright 測試與本機操作文件。
- 產生的環境檔、資料庫、上傳與匯出檔必須維持在 Git 忽略範圍內；版本控制僅保存程式、OpenSpec、測試及不含個資的合成 fixture。
