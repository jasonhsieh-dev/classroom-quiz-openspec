# Tasks

## 1. 專案骨架與共用契約

- [x] 1.1 建立 npm workspace、`apps/web`、`apps/server`、`packages/shared` 與根層 TypeScript 設定，並以安裝、型別檢查及空白建置指令驗證所有 workspace 可運作
- [x] 1.2 加入 React、Vite、Express、Socket.IO、SQLite、ExcelJS、Vitest、Supertest 與 Playwright 依賴，並驗證鎖定檔可在乾淨環境重現安裝
- [x] 1.3 在 shared package 定義活動狀態、角色、錯誤格式、HTTP DTO、Socket 事件與執行期驗證 schema，並以型別與 schema 單元測試驗證合法及錯誤 payload
- [x] 1.4 建立繁體中文錯誤處理 middleware、健康檢查端點及不洩漏 stack／絕對路徑的回應格式，並以 Supertest 驗證成功與例外回應
- [x] 1.5 建立 `var/data`、`var/uploads`、`var/exports` 的可配置路徑與啟動檢查，確認 `.gitignore` 明確忽略整個 `var/`，並以 `git check-ignore` 驗證執行期檔案會被忽略、OpenSpec／程式碼／測試與 `tests/fixtures/` 合成資料不會被誤排除，且缺少必要設定時有明確錯誤

## 2. SQLite Schema 與資料存取

- [x] 2.1 建立版本化 SQL migration，包含 activities 的單調接收序號計數器，以及 groups、sessions、questions、submission_attempts、current_submissions、result_entries、export_records；`submission_attempts` 必須含 `session_id`、`server_received_at`、`receive_sequence`、`UNIQUE(activity_id, receive_sequence)` 與 `UNIQUE(session_id, question_id, idempotency_key)`，並在暫存資料庫測試唯一鍵／外鍵
- [x] 2.2 初始化 SQLite foreign keys、WAL 與 busy timeout，並以整合測試驗證 foreign key 與唯一限制確實生效
- [x] 2.3 實作 activity、group、session 與 question repositories，並以 repository 測試驗證建立、查詢、更新及不存在資料的結果
- [x] 2.4 實作 `DRAFT -> OPEN -> CLOSED` 狀態檢查與 revision 遞增工具，並以單元測試驗證合法、跳級、反轉及重複 close 行為
- [x] 2.5 實作測試用暫存 SQLite lifecycle，並驗證每個測試可獨立建立、migration 及清理而不使用開發資料庫

## 3. Guided Notes 動態匯入

- [x] 3.1 建立不含真實個資的合成 `.xlsx` fixtures，涵蓋目前單題版面、移動列欄、不同題數、文字題號、既有答案、缺表頭、重複題號、無效 mapping，以及多工作表、值、公式、格式、合併範圍、列高、欄寬與工作表／列／欄隱藏狀態，並以 fixture 清單檢查內容
- [x] 3.2 實作 `.xlsx` 檔型、大小與可解析性驗證，並以正常、非 XLSX、偽造副檔名、損毀及超限檔案測試拒絕行為
- [x] 3.3 實作跨工作表「題號」／「作答」唯一表頭候選掃描，並以單元測試驗證列欄移動、空白分隔列、缺少表頭與多重候選
- [x] 3.4 實作題號字串化、唯一性檢查、答案普通儲存格／合併範圍解析及重疊檢查，並以 fixture 測試確認不含任何固定範例座標
- [x] 3.5 實作匯入 preview DTO，顯示題數、題號、工作表、題號 cell、答案 range、原值與覆蓋警告，並以 snapshot 測試驗證空白及非空答案格
- [ ] 3.6 實作暫存 import draft、取消／過期清理及確認後保存來源 SHA-256、mapping 與 `DRAFT` 活動的 API，並以整合測試驗證取消不留活動、失敗不產生部分資料
- [ ] 3.7 建立老師匯入與預覽畫面，並以元件測試驗證解析結果、警告、取消、確認及錯誤訊息
- [x] 3.8 在開始實作匯出前，以目前單題範本與完整語意 fixtures 執行 ExcelJS load/save round-trip 技術驗證；完整比較所有工作表、非目標值與公式、格式、合併範圍、列高、欄寬及隱藏狀態，只有 ExcelJS 未達契約時才記錄證據並選用最小 XML cell 替換 fallback，之後所有匯出任務沿用通過驗證的策略

## 4. 組別、角色與 Session 隔離

- [ ] 4.1 實作 HttpOnly、SameSite session cookie 與 teacher／student role middleware，並以 Supertest 驗證缺少、過期及錯誤角色 session 被拒絕
- [ ] 4.2 實作本機老師 session 入口並記錄無 PIN Demo 威脅模型，驗證學生 session 無法存取老師端點
- [ ] 4.3 實作 `DRAFT` 活動組別新增、重新命名、刪除與名稱正規化，並以整合測試驗證空白、重複名稱及 `OPEN/CLOSED` 後禁止修改
- [ ] 4.4 實作學生可選組別查詢與選組 session 建立 API，並以測試驗證不存在、跨活動組別被拒絕及同組多 session 被允許
- [ ] 4.5 建立老師組別管理與學生選組畫面，並以元件測試驗證合法流程、欄位錯誤及活動階段限制
- [ ] 4.6 對學生 snapshot、submission 與 result service 強制從 session 取得 group，並以竄改 URL、body、query 的整合測試確認無法跨組讀取或提交

## 5. 活動生命週期與權威快照

- [ ] 5.1 實作開始活動交易，驗證至少一題、至少一組、有效 mapping 及沒有其他 `OPEN` 活動，並以整合測試驗證成功與所有缺少前置條件
- [ ] 5.2 實作所有題目同時開放的老師 API 與學生題號清單，並以測試確認不存在逐題鎖定且不同組可選相同或不同題目
- [ ] 5.3 實作 teacher 與 student 權威 snapshot builder，依角色裁切 activity、question、group 與 submission 資料，並以 DTO 測試比較兩種輸出
- [ ] 5.4 實作「同時間最多一場 OPEN 活動」限制，並以兩場草稿活動的整合測試驗證第二場開始被拒絕
- [ ] 5.5 建立老師開始控制與學生依活動狀態切換的畫面，並以元件測試驗證 `DRAFT/OPEN/CLOSED` 的可用操作
- [ ] 5.6 建立老師結束活動 UI：僅在 `OPEN` 顯示結束按鈕、要求確認、防止請求中重複點擊，分別處理成功、伺服器回覆已結束與 API 失敗，成功或已結束時切換至唯讀結果畫面、失敗時保留可重試狀態；以元件及 API mock 測試所有分支

## 6. 提交、修改、順位與截止交易

- [ ] 6.1 實作提交輸入驗證，涵蓋活動、題目、session、trim 後非空及 2,000 字長度限制，並以整合測試驗證錯誤提交不改變資料
- [ ] 6.2 實作 `BEGIN IMMEDIATE` 提交交易，在所有驗證通過後於同一交易內依寫入序列化順序配置唯一單調 `receive_sequence`，另寫入僅供紀錄／顯示的 `server_received_at`、attempt、current submission 與 revision，並驗證客戶端時間與 body groupId 不影響保存或順位
- [ ] 6.3 實作修改答案的不可變歷程與 current pointer 更新，並以測試驗證舊歷程保留、最新答案生效及有效接收時間重設
- [ ] 6.4 實作 `UNIQUE(session_id, question_id, idempotency_key)` 冪等處理：相同 key 與相同正規化答案回傳原結果且不新增歷程／序號／時間，相同 key 與不同答案回傳 `IDEMPOTENCY_CONFLICT` 且不改變資料；以 API 與資料庫整合測試驗證兩條路徑
- [ ] 6.5 實作學生多題提交及同組多 session 更新，並以整合測試驗證每個「組別＋題目」互相獨立
- [ ] 6.6 實作 close 寫入交易，在狀態切換時只依每題 current submissions 的 `receive_sequence` 建立 result entries，並以測試驗證各題獨立順位、相同 `server_received_at` 仍依接收序號排序與無人作答
- [ ] 6.7 實作 close 冪等行為，並以重複請求測試驗證 `closed_at`、revision 與結果不被重新產生
- [ ] 6.8 建立並行提交測試，以同步 barrier 驗證至少兩組同題／不同題近乎同時提交時無遺失更新且接收序號唯一
- [ ] 6.9 建立提交與截止競爭測試，分別驗證提交先完成時納入結果、close 先完成時提交被拒絕，且兩種順序都沒有部分寫入
- [ ] 6.10 建立學生題號選擇、答案編輯、提交狀態及修改確認畫面，並以元件測試驗證多題作答、重送處理及截止後唯讀
- [ ] 6.11 以可控制的伺服器時鐘測試相同 timestamp 與系統時鐘倒退，確認 `server_received_at` 只影響顯示、`receive_sequence` 仍單調且最終順位不反轉；同時斷言修改答案取得新序號並失去舊順位

## 7. Socket.IO 即時同步與重連

- [ ] 7.1 將 HTTP session 驗證套用到 Socket.IO handshake，僅允許老師加入 teacher room、學生加入自己 group room，並以 socket 整合測試驗證越權訂閱失敗
- [ ] 7.2 在開始、提交、修改與截止交易成功提交後發送依 room 裁切、帶 activityId／revision 的狀態變更通知，並以測試驗證失敗或 rollback 交易不發送通知、截止通知不夾帶其他組結果
- [ ] 7.3 建立老師與學生不同的 `submission.updated` payload，並以事件測試驗證學生永遠收不到其他組答案、提交狀況、時間或暫時順位
- [ ] 7.4 實作前端 snapshot 加狀態通知同步器，忽略舊 revision，但允許學生套用不連續的較新 revision 且不因跳號推論事件遺失或其他組變更；以單元測試驗證舊、重複、亂序及跳號通知
- [ ] 7.5 實作 socket 斷線重連後重新取得權限裁切的 HTTP snapshot，以快照取代目前可見狀態；snapshot 失敗時顯示尚未同步、停用寫入並可重試，以整合測試驗證斷線期間答案修改、活動截止與失敗重試。文件與測試明示不重播逐筆事件，且持續連線期間不保證只靠 revision 偵測單一遺失通知
- [ ] 7.6 建立老師即時監看畫面，顯示各題已提交組別、最新答案與最後有效時間，並以元件／socket 測試驗證首次提交及修改更新

## 8. 結果與角色可見性

- [ ] 8.1 實作 teacher result DTO 與 API，回傳每題成功組別及所有有效組別的完整順位、答案、時間，並以整合測試驗證穩定排序及無人作答
- [ ] 8.2 實作 student result DTO 與 API，只回傳每題成功組別名稱／識別碼及 session 本組的答案／順位／未作答狀態；以欄位 allowlist 與兩組整合測試確認其他組即使是成功組別也沒有答案、提交時間或順位欄位
- [ ] 8.3 阻止學生在 `DRAFT/OPEN` 取得順位或暫時成功組別，並以 API 與 socket 測試驗證開放期間隱私
- [ ] 8.4 建立老師完整結果頁，並以元件測試確認沒有正誤、取消成功或順位遞補操作
- [ ] 8.5 建立學生受限結果頁，並以兩組資料的元件測試驗證只顯示成功組別名稱／識別碼與本組答案／順位，DOM、前端 store 與網路 response 均不含其他組（包括成功組別）的答案、時間或順位
- [ ] 8.6 以整合測試驗證老師人工查看不修改 result entries，且錯誤答案仍維持第一名及匯出來源

## 9. Guided Notes 結果匯出

- [ ] 9.1 實作從保存來源副本與 mapping 產生新 `.xlsx` 的 export service，並以測試驗證只將 `rank=1` 答案寫入 answer anchor
- [ ] 9.2 實作既有答案覆蓋與無成功組別保留原內容，並以含原內容及無人作答 fixture 驗證輸出值
- [ ] 9.3 實作來源／輸出活頁簿完整語意比較：所有工作表及順序、所有非目標儲存格值與公式、所有儲存格格式、合併範圍、列高、欄寬、工作表／列／欄隱藏狀態、題數與 mapping 均須一致；只允許成功題目 `answer_anchor` 的值改變，並以逐類故意破壞輸出的測試驗證失敗檔不會提供下載
- [ ] 9.4 實作 `CLOSED` 限制、來源檔不可覆蓋、暫存檔原子移動、SHA-256 與 export record，並以整合測試驗證 `DRAFT/OPEN` 拒絕及多次匯出產生獨立新檔
- [ ] 9.5 建立老師匯出操作與錯誤提示，並以元件及 API 測試驗證成功下載、處理中狀態與驗證失敗訊息
- [ ] 9.6 以 3.8 已驗證通過的 ExcelJS 或最小 XML fallback 策略，對目前單題範本、移動列欄及完整語意 fixtures 執行匯出 round-trip；確認只有成功題目答案值改變、無成功組別保留原值，且 9.3 的完整比較全部通過

## 10. 本機 Demo、文件與整合驗收

- [ ] 10.1 建立 Playwright 完整流程，以一個老師 context 與兩個學生 context 驗證匯入、建立組別、開始、同題／不同題提交、修改、即時監看、老師結束確認與防重複點擊、截止後唯讀、角色結果及匯出
- [ ] 10.2 擴充 API、Socket 與端對端隱私檢查，確認開放期間兩組互不可見，截止後只公開成功組別名稱／識別碼與本組資料，且其他組即使成功也不洩漏答案、提交時間或順位；另驗證竄改請求無法跨組存取
- [ ] 10.3 擴充端對端斷線與截止檢查，驗證 socket 重連恢復快照、截止後 UI 唯讀且伺服器拒絕延遲提交
- [ ] 10.4 撰寫繁體中文 README，包含工具版本、安裝、環境設定、migration、開發／展示啟動、停止、健康檢查與完整測試指令；明確記錄無 PIN／帳號的已知安全限制（無法驗證真實身分、可另開 session 冒選組別、未保護的本機老師入口），並在乾淨環境逐步執行驗證
- [ ] 10.5 撰寫繁體中文人工驗收清單，列出老師與兩組學生每一步操作、預期畫面、資料結果及通過條件，並實際走查一次完整流程
- [ ] 10.6 執行型別檢查、lint、單元測試、API 整合測試、Playwright、production build 與 OpenSpec validation，並保存指令結果摘要供 Change review
- [ ] 10.7 檢查 `git status`、`git check-ignore` 與敏感資料掃描，確認只追蹤程式、OpenSpec、測試及合成 fixture，不含 `.env`、資料庫、真實上傳、匯出、憑證或金鑰

## 11. Requirement-to-task 對照表

下表以 `capability / Requirement` 對應負責實作與主要驗收 task；跨模組 E2E 另由 10.1–10.3 覆蓋。

| Capability / Requirement | 實作 Task | 主要測試／驗收 Task |
|---|---:|---:|
| classroom-access / 老師建立活動組別 | 4.3、4.5 | 4.3、4.5、10.1 |
| classroom-access / 學生選組並建立 session | 4.4、4.5 | 4.4、10.1 |
| classroom-access / 學生 session 權限隔離 | 4.1、4.6 | 4.6、10.2 |
| classroom-access / 老師檢視權限 | 4.1、7.6、8.1 | 4.1、7.6、8.1 |
| classroom-access / Demo 身分邊界 | 4.2、4.4、10.4 | 4.4、10.2、10.4 |
| guided-notes-workbooks / 接受 XLSX Guided Notes | 3.2、3.6 | 3.2、3.6 |
| guided-notes-workbooks / 動態辨識表頭與題目 | 3.3、3.4 | 3.3、3.4、10.1 |
| guided-notes-workbooks / 建立答案儲存格 mapping | 3.4、3.6 | 3.4、9.6 |
| guided-notes-workbooks / 驗證題號 | 3.4 | 3.4 |
| guided-notes-workbooks / 提供匯入預覽與確認 | 3.5–3.7 | 3.5–3.7、10.1 |
| guided-notes-workbooks / 以原始檔案副本匯出結果 | 9.1、9.2、9.4、9.5 | 9.1、9.2、9.4–9.6 |
| guided-notes-workbooks / 保留未指定的活頁簿內容與格式 | 3.8、9.3、9.6 | 3.8、9.3、9.6 |
| quiz-activity-lifecycle / 建立草稿活動 | 3.6 | 3.6、10.1 |
| quiz-activity-lifecycle / 活動狀態機 | 2.4、5.1、6.6 | 2.4、5.1、6.7 |
| quiz-activity-lifecycle / 開始活動前置條件 | 5.1 | 5.1 |
| quiz-activity-lifecycle / 一次開放全部題目 | 5.2、5.5 | 5.2、10.1 |
| quiz-activity-lifecycle / 老師結束整場活動 | 5.6、6.6、6.7 | 5.6、6.7、6.9、10.1 |
| quiz-activity-lifecycle / 同時間僅一場開放活動 | 5.4 | 5.4 |
| quiz-activity-lifecycle / 提供權威活動快照 | 5.3、7.4、7.5 | 5.3、7.4、7.5 |
| answer-submission-ranking / 接受每組每題的有效提交 | 6.1、6.2 | 6.1、6.2 |
| answer-submission-ranking / 同組可對多題提交 | 6.5、6.10 | 6.5、6.10 |
| answer-submission-ranking / 修改答案建立新歷程 | 6.3 | 6.3、6.11 |
| answer-submission-ranking / 伺服器接收順序 | 2.1、6.2 | 6.8、6.11 |
| answer-submission-ranking / 每題獨立計算順位 | 6.6 | 6.6、6.8 |
| answer-submission-ranking / 第一名直接成為成功組別 | 6.6、8.1、8.6 | 6.6、8.6 |
| answer-submission-ranking / 提交與截止使用原子交易排序 | 6.2、6.6 | 6.9 |
| answer-submission-ranking / 防止請求重送造成重複提交 | 2.1、6.4 | 6.4 |
| realtime-activity-sync / 即時同步活動階段 | 7.2、7.4 | 7.2、7.4、10.3 |
| realtime-activity-sync / 老師收到完整提交更新 | 7.2、7.6 | 7.6、10.1 |
| realtime-activity-sync / 學生只收到允許的即時資料 | 7.1、7.3 | 7.1、7.3、10.2 |
| realtime-activity-sync / 初始連線使用權威快照 | 5.3、7.4 | 5.3、7.4 |
| realtime-activity-sync / 斷線重連後恢復一致狀態 | 7.5 | 7.5、10.3 |
| realtime-activity-sync / 即時通道失敗不放寬伺服器規則 | 6.1、7.5 | 7.5、10.3 |
| quiz-results / 截止後建立最終結果 | 6.6、6.7 | 6.6、6.7 |
| quiz-results / 老師查看完整結果 | 8.1、8.4 | 8.1、8.4 |
| quiz-results / 學生查看受限結果 | 8.2、8.5 | 8.2、8.5、10.2 |
| quiz-results / 開放期間不公布學生順位 | 5.3、7.3、8.3 | 7.3、8.3、10.2 |
| quiz-results / 人工檢查不改變結果 | 8.4、8.6 | 8.6 |
| local-demo-verification / 提供可重現的本機啟動流程 | 1.1、1.5、10.4 | 10.4、10.6 |
| local-demo-verification / 提供自動化測試入口 | 2.5、10.4、10.6 | 10.6 |
| local-demo-verification / 核心規則具有自動化驗證 | 3.1、6.8、6.9、10.1–10.3 | 10.6 |
| local-demo-verification / 支援至少兩組學生並行 Demo | 6.8、10.1 | 10.1、10.5 |
| local-demo-verification / 提供人工驗收流程 | 10.5 | 10.5 |
| local-demo-verification / 測試資料不得包含機密或真實個資 | 1.5、3.1、10.7 | 10.7 |

## Workflow follow-up

- 完成 Apply 與專題審查後，另行執行 OpenSpec Sync／Archive；本 Change 的實作 tasks 不會自動封存或同步規格。
