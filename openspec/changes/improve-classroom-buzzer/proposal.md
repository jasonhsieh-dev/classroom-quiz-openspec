# Proposal

## Why

實際 Demo 顯示現有系統雖已完成核心搶答流程，但老師與學生共用 session cookie 會在同一瀏覽器 profile 中互相覆蓋，使老師可能無法結束活動；老師重新整理後亦無法從 SQLite 恢復目前活動。現行匯入只保存題號而未保存題目文字，逐組輸入名稱也增加課堂設定成本，因此需要在不改變排名、隱私與 XLSX 匯出契約的前提下改善既有系統。

## What Changes

- 將老師與學生改為獨立的 HttpOnly session cookie，讓同一瀏覽器 profile 可同時維持兩種角色，並由伺服器驗證 HTTP 與 Socket.IO 所使用的角色及 session。
- 修正活動截止流程：close HTTP 成功即以權威回應切換為 `CLOSED`，建立最終排名並提供匯出；Socket.IO 僅負責同步通知，401/403 顯示明確繁體中文錯誤。
- 擴充 Guided Notes 匯入契約，動態辨識「題號」、「題目」與「作答」，正確解析合併儲存格及跨列題目，保存並在預覽、作答、監看與結果畫面顯示完整題目文字。
- 將老師逐組輸入改為在 `DRAFT` 輸入 1–100 的組別數量，於單一交易中自動建立「第 1 組」至指定數量；活動仍須至少兩組才可開始，且不得破壞既有學生 session 綁定。
- 依未建立活動、`DRAFT`、`OPEN`、`CLOSED` 顯示對應中文主標題，並以後端權威 snapshot 恢復重新整理後的目前活動、結果與 XLSX 下載能力。
- 保留全部既有搶答、最後有效提交、`receive_sequence` 獨立排名、截止交易、角色隱私、匯出保真、安全邊界及單一 Node.js／SQLite 本機 Demo 規則。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `classroom-access`: 分離老師與學生 session cookie、支援同瀏覽器雙角色共存，並改為依數量原子建立自動命名組別。
- `guided-notes-workbooks`: 新增「題目」表頭與完整題目文字解析、保存、預覽及匯出保真限制。
- `quiz-activity-lifecycle`: 強化老師截止的 HTTP 權威行為、至少兩組開始條件、狀態化老師介面與重新整理活動恢復。
- `realtime-activity-sync`: 明確化雙角色 Socket.IO 驗證，以及 close 成功不依賴即時通知的用戶端收斂行為。
- `quiz-results`: 老師與學生結果加入題號及完整題目文字，同時維持原有可見性邊界。
- `local-demo-verification`: 擴充同瀏覽器雙角色、截止、題目解析、批次組別與活動恢復的自動化及人工驗收。

## Impact

- 前端：老師狀態路由／恢復、動態標題、組別數量表單、題目顯示、close 錯誤與 HTTP 成功收斂。
- 共用契約：session、題目摘要、匯入預覽、snapshot 與 results DTO／schema。
- 後端：角色專用 session cookie、Socket.IO handshake、活動列表／恢復 API、批次組別 API、Guided Notes parser 與 snapshot/result builders。
- SQLite：新增題目文字及必要來源定位欄位的版本化 migration；既有活動資料需有明確相容策略。
- 測試與文件：Vitest、Supertest、Socket.IO、Playwright、XLSX fixtures、README 與人工驗收說明。
- 不新增雲端服務、帳號系統、PIN、Google Sheets API、多伺服器同步或非 SQLite 儲存。
