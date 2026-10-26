# Tasks

## 1. 共用契約與 SQLite 向前相容

- [x] 1.1 擴充 shared schemas/types，為 question summary 與匯入預覽加入完整題目文字、為 teacher snapshot 加入活動名稱，並定義活動摘要與 close 權威回應；以 schema 單元測試驗證合法 payload、缺欄位及學生結果 allowlist
- [x] 1.2 新增版本化 SQLite migration，為 `questions` 加入 nullable `prompt_text`、`prompt_range`，並以既有資料庫 migration 測試確認 activities、mapping、submissions、results 與 sessions 均不遺失
- [x] 1.3 擴充 QuestionRepository 的建立、讀取與題目 metadata 更新，並以 repository 測試驗證題目文字、來源範圍及所有既有 mapping 欄位保持一致
- [x] 1.4 擴充 ActivityRepository 的最新優先摘要查詢與 question count，並以多個 `DRAFT/OPEN/CLOSED` 活動測試驗證排序、狀態與識別碼穩定
- [x] 1.5 實作歷史 activity 題目文字回填流程，以每場活動獨立交易從保存的來源 XLSX 核對既有題號與 mapping；測試成功回填、來源遺失、舊格式缺少題目及單場失敗不阻止其他活動

## 2. Guided Notes 題目文字匯入

- [x] 2.1 擴充合成 XLSX fixtures，涵蓋三表頭移位、水平合併題目、跨列題目、換行／富文字／公式結果、缺少題目表頭、空白題目、重複與歧義題目來源，並以 fixture manifest 測試確認不含真實資料
- [x] 2.2 將 header candidate 掃描擴充為唯一「題號／題目／作答」邏輯表頭並忽略 merge slave；以 parser 測試驗證正常、多工作表候選、缺漏與重複表頭
- [x] 2.3 實作每個題號對應的題目 master cell、`promptText` 與 `promptRange` 解析，並以水平／跨列合併、空白分隔列及不同題數 fixtures 驗證不建立重複題目
- [x] 2.4 實作題目空白、合併範圍被多題共用及無法唯一定位的繁體中文錯誤，並以失敗測試確認整次匯入不產生 draft 或部分 mapping
- [x] 2.5 擴充 import draft JSON 驗證、preview DTO 與 confirm 持久化，並以整合測試驗證題目文字從上傳到 `questions` 保存且原答案 mapping 完全不變
- [x] 2.6 更新匯入預覽介面顯示題號、完整題目、工作表、答案範圍與覆蓋警告，並以元件測試驗證長題目、換行、取消及錯誤訊息
- [x] 2.7 以加入題目文字後的 fixtures 執行來源／輸出完整語意比較，確認匯出仍只允許成功題目的 `answer_anchor` 值改變，題目儲存格及其他內容全部不變

## 3. 角色 Session、Socket.IO 與截止修正

- [ ] 3.1 定義老師與學生不同的 HttpOnly cookie 名稱及角色專用解析函式，並以 session 單元測試驗證 cookie 解析、到期、錯誤角色、SameSite、Secure 與 path 設定
- [ ] 3.2 更新老師與學生 session 建立端點，使建立任一角色不清除或覆蓋另一角色 cookie；以同一 Supertest agent 的整合測試驗證兩種 cookie 可同時存在及各自授權
- [ ] 3.3 將 teacher/student HTTP middleware 改為只解析對應角色 cookie，並以 401/403 API 測試驗證繁體中文 code/message、學生不可呼叫老師端點且老師 cookie 不會授權學生端點
- [ ] 3.4 擴充 Socket.IO handshake 的連線用途，伺服器依用途選擇 cookie 後驗證真實 role、expiry、activity 與 group scope；以 socket 測試驗證同瀏覽器雙角色 room 隔離、偽造 role 與跨活動連線被拒絕
- [ ] 3.5 保持 close transaction 與 result 建立的現有原子性，新增實際 session middleware 回歸測試，確認同瀏覽器建立學生 session 後老師仍可 close、結果只建立一次且截止後提交回覆 409
- [ ] 3.6 更新老師 close UI 解析成功回應並立即套用 `CLOSED` 與 revision，再載入 results；以元件測試阻止截止 socket 事件，確認仍顯示唯讀結果與匯出操作
- [ ] 3.7 更新老師 close 的 401/403 與一般失敗處理，以元件／API mock 測試驗證顯示明確繁體中文錯誤、保持可重試狀態且不誤顯示 `CLOSED`
- [ ] 3.8 更新 session 與本機 Demo 安全文件，說明雙 cookie、同瀏覽器共存與未新增真實身分驗證；檢查既有 `README.md`、`docs/security-model.md` 修改均被保留並整合

## 4. 組別數量與開始條件

- [ ] 4.1 實作 1–100 整數驗證及單一交易的組別批次設定 service，自動產生「第 1 組」至「第 N 組」並只遞增一次 revision；以 service 測試驗證成功、邊界及故意失敗時全數回滾
- [ ] 4.2 在 `DRAFT` 且沒有學生 session 時支援重新設定完整組別清單，有任一學生 session 時拒絕；以資料庫整合測試確認組別 id、session 綁定及原清單在拒絕後不變
- [ ] 4.3 提供老師批次組別 API 並維持 `OPEN/CLOSED` 鎖定，使用 Supertest 驗證非整數、0、101、錯誤角色、已有 session 與活動狀態錯誤
- [ ] 4.4 將活動開始前置條件改為至少兩組，並以 lifecycle/API 測試驗證一組不可開始、兩組可開始且其他題目與 mapping 檢查維持
- [ ] 4.5 將老師組別 UI 改為數量欄位與完整自動命名清單，並以元件測試驗證輸入 6、驗證錯誤、重設警告、DRAFT 可用及 OPEN/CLOSED 停用
- [ ] 4.6 更新人工驗收中的組別建立步驟，實際依數量建立至少兩組並確認學生選組、同組多 session 與隱私行為維持

## 5. 老師活動恢復與狀態化介面

- [ ] 5.1 新增老師 activity summary API，回傳最新優先的 id、title、state、revision、時間與題數；以授權及多活動整合測試驗證唯一 OPEN、DRAFT/CLOSED 列表與錯誤回應
- [ ] 5.2 擴充 teacher snapshot 包含活動名稱與完整題目，並以 DTO/API 測試驗證 `DRAFT/OPEN/CLOSED` 資料、角色裁切及 revision
- [ ] 5.3 建立可恢復的 `/teacher/activities/:activityId` 前端路由與載入流程，並以路由元件測試驗證直接 URL、無效 id 及重新建立老師 session 後仍讀取同一活動
- [ ] 5.4 實作老師根頁初始化：唯一 `OPEN` 自動恢復，否則顯示匯入入口與既有 `DRAFT/CLOSED` 活動選擇；以多活動元件測試驗證不自動建立或確認重複活動
- [ ] 5.5 將老師頁面主標題集中映射為「匯入 Guided Notes／設定搶答活動／搶答活動進行中／活動結果與匯出」，並以狀態轉換與恢復元件測試驗證四種標題
- [ ] 5.6 補齊 DRAFT 恢復的組別設定、OPEN 恢復的即時監看及 CLOSED 恢復的結果／匯出，並以重新整理整合測試確認資料來自權威 snapshot 而非 React 記憶體
- [ ] 5.7 更新 README 與人工驗收的活動恢復說明，移除「展示期間避免重新整理」限制並以實際 DRAFT、OPEN、CLOSED 操作驗證文件

## 6. 題目顯示、結果隱私與匯出回歸

- [ ] 6.1 建立共用題目呈現元件，以題號與完整題目文字供老師監看、學生選題／作答及結果頁使用；以長文字、換行與 legacy fallback 元件測試驗證可讀性
- [ ] 6.2 更新 teacher/student snapshot 消費端，使 OPEN 畫面顯示完整題目但不改變選題、提交、修改及本組 current submission；以雙組元件測試驗證行為與隱私
- [ ] 6.3 更新 teacher/student results builders 與畫面加入完整題目文字，並以兩組整合與元件測試驗證老師完整順位、學生 winner identity/ownResult allowlist 及其他組資料不出現在 response、store 或 DOM
- [ ] 6.4 對提交、修改、同題／不同題並行、相同 timestamp、時鐘倒退與 close 競爭重跑既有排名測試，確認題目 metadata 不參與 `receive_sequence`、current submission 或 result 排序
- [ ] 6.5 對有人作答、無人作答、既有答案及完整語意 fixtures 重跑匯出測試，確認成功答案來源、無人作答原值、格式、公式、合併範圍及題目文字完全符合既有保真契約

## 7. 跨模組 Demo 與品質閘門

- [ ] 7.1 擴充 Playwright 使用同一 browser context 的老師頁與學生頁，再加入第二個隔離學生 context，驗證雙 cookie、選組、提交、老師 close、截止後拒絕、角色結果與 XLSX 下載
- [ ] 7.2 擴充 Playwright 驗證三表頭完整題目、輸入 6 組、四種老師標題，以及 `DRAFT/OPEN/CLOSED` 重新整理恢復不重複建立活動
- [ ] 7.3 執行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:e2e` 與 `npm run build`，修正所有回歸並保存各指令成功摘要
- [ ] 7.4 依更新後人工驗收清單完成一次老師、同 profile 學生及另一隔離學生的真實 Demo，記錄題目、組別、截止、恢復、隱私、結果與匯出全部通過
- [ ] 7.5 執行 `openspec validate improve-classroom-buzzer --strict`、`git status`、`git check-ignore` 與敏感資料檢查，確認 Change 有效且只追蹤程式、規格、文件與合成 fixtures

## Workflow follow-up

- Apply 與專題審查完成後，再另行執行 OpenSpec Sync 與 Archive。
- Sync／Archive 前重新驗證七份主規格與本 Change 的 delta 合併結果。
