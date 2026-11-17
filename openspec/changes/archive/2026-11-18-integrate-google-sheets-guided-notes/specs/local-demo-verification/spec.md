## MODIFIED Requirements

### Requirement: 提供可重現的本機啟動流程
專案 MUST 提供繁體中文本機啟動說明，列出必要工具版本、安裝、環境設定、資料庫初始化、啟動前後端及停止服務的步驟。使用者 SHALL 不需要公開部署；完整 Guided Notes Demo MUST 設定 Google Cloud 專案、Sheets API、Service Account、文件編輯分享權限及網路。憑證僅由後端讀取。

#### Scenario: 全新環境依文件啟動
- **WHEN** 驗收者在符合版本要求的本機環境依 README 執行步驟
- **THEN** 系統啟動老師端、學生端、後端與本機資料庫，且可完成健康檢查

#### Scenario: 缺少必要設定
- **WHEN** 啟動時缺少必要環境變數或資料目錄無法使用
- **THEN** 系統以不洩漏機密的訊息指出缺少項目，且不以不明錯誤繼續執行

### Requirement: 核心規則具有自動化驗證
自動化測試 MUST 涵蓋三表頭與合併／跨列題目匯入、組別批次交易、同瀏覽器老師與學生 session 隔離、每題依單調接收序號獨立排名、修改重設有效接收資訊、冪等相同／衝突 payload、並行提交、相同時間戳與系統時鐘倒退、提交與截止競爭、HTTP close 不依賴 Socket.IO、成功組別亦不例外的學生隱私、重新整理與斷線重連 snapshot，以及雲端精確寫回、非目標內容保護、衝突與不明結果核對。

#### Scenario: 執行核心規則測試套件
- **WHEN** 完整測試套件執行
- **THEN** 每項核心規則至少有一個成功案例與相關錯誤或邊界案例

#### Scenario: 驗證不同版面學習單
- **WHEN** 匯入測試使用題數、列、欄、合併範圍或跨列題目位置不同的合成 Google Sheets 網格 fixture
- **THEN** 測試確認系統依「題號」、「題目」、「作答」表頭及實際位置建立題目與答案 mapping，而非依賴範例座標

#### Scenario: 驗證同瀏覽器雙角色截止
- **WHEN** 瀏覽器在同一 profile 先建立老師 session，再建立學生 session 並由老師確認結束活動
- **THEN** 自動化測試確認兩種 cookie 同時存在、close 成功、SQLite 為 `CLOSED`、最終結果已建立且截止後提交被拒絕

#### Scenario: 驗證截止事件遺失
- **WHEN** 測試使 close HTTP 成功但阻止或延遲老師端接收 Socket.IO 截止事件
- **THEN** 老師介面仍立即切換為 `CLOSED` 並可讀取結果與匯出

#### Scenario: 驗證老師重新整理恢復
- **WHEN** 老師分別在 `DRAFT`、`OPEN` 與 `CLOSED` 活動重新整理或重新進入
- **THEN** 系統由權威 snapshot 恢復同一活動，且不建立重複活動或遺失組別、提交、結果及 Google Sheets 寫回能力

### Requirement: 提供人工驗收流程
專案 SHALL 提供繁體中文人工驗收清單，依序涵蓋雲端網址、分頁選擇與三表頭匯入預覽、完整題目顯示、依數量建立組別、同瀏覽器老師與學生共存、開始、多人提交、修改、隱私、重新整理恢復、截止、結果及 Google Sheets 寫回，並列出每一步預期畫面與資料結果。

#### Scenario: 老師依清單完成 Demo
- **WHEN** 驗收者依人工清單操作同一瀏覽器 profile 的老師與一個學生頁面，並另開至少一個隔離學生 session
- **THEN** 每個改善需求與既有核心功能都有明確操作、預期結果及可判定通過或失敗的檢查點

#### Scenario: 驗證各活動階段標題
- **WHEN** 驗收者依序停留在未建立活動、`DRAFT`、`OPEN` 與 `CLOSED` 畫面
- **THEN** 主標題依序為「匯入 Guided Notes」、「設定搶答活動」、「搶答活動進行中」與「活動結果與匯出」

## ADDED Requirements

### Requirement: 雲端整合驗收
自動測試 MUST 使用隔離資料庫與可控制的 Google adapter，不依賴私人憑證；人工驗收 MUST 使用真實 Google Sheets 完成直接讀取及寫回，不以模擬測試替代。README MUST 說明安全憑證設定、分享權限、錯誤處理與展示期間避免外部編輯；不得包含真實私鑰。

#### Scenario: 真實雲端端到端驗收
- **WHEN** 老師依文件提供合成資料的 Google Sheets 網址，選分頁、預覽、建立活動，與兩組學生完成提交並截止
- **THEN** 老師確認寫回後可在同一雲端文件看到第一名答案，未作答、其他分頁及非目標公式格式不變，全程不使用 XLSX 上下載，並記錄去敏驗收結果

#### Scenario: 完整回歸
- **WHEN** 執行完整驗證
- **THEN** Vitest、Playwright、typecheck、lint、build、Change 與主規格 strict validation 及 git diff --check 均通過；涵蓋單題／題組混合、移動表頭、合併格、不同分頁、權限、離線、API 錯誤、來源衝突、重複寫回、逾時核對及既有 Session／Cookie／排名／活動恢復
