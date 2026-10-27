# Design

## Context

現有系統為 React/Vite 前端、Express/Socket.IO 後端及單一 SQLite 資料庫。活動、題目 mapping、session、提交與結果均由伺服器保存，但老師與學生共用 `classroom_buzzer_session` cookie；學生選組會在同一瀏覽器 profile 覆蓋老師 cookie，而已建立的老師 socket 仍留在原 room，造成畫面可監看但新的老師 HTTP 請求被拒絕。老師頁面同時只以 React state 保存剛建立的活動，重新整理後無法重新定位 SQLite 中的活動。

Guided Notes parser 目前只辨識「題號」與「作答」，`questions`、共用 DTO、snapshot 及 results 均沒有題目文字。現有實際範本的「題目」表頭及內容可位於水平或跨列合併範圍。答案 mapping 與匯出完整語意比較已穩定，這次不得改變其排序、寫入目標或允許差異集合。

## Goals / Non-Goals

**Goals:**

- 讓同一瀏覽器 cookie jar 同時維持老師與學生身分，且 HTTP 與 Socket.IO 均由伺服器執行角色授權。
- 使 close HTTP 回應、SQLite 狀態與結果成為截止權威，不依賴即時事件完成呼叫端 UI 切換。
- 以動態表頭及合併範圍解析完整題目文字，貫穿 preview、持久化、DTO 與四種題目顯示位置。
- 以原子批次操作建立自動命名組別，並保護既有學生 session 關係。
- 讓老師以 URL 與後端 activity summary/snapshot 恢復既有活動。
- 以版本化 migration 向前相容目前 SQLite 資料，並維持既有匯出與排名契約。

**Non-Goals:**

- 不加入帳號、PIN、OAuth、公開部署、跨主機存取或更強的真實身分驗證。
- 不改變最後有效提交、`receive_sequence`、冪等鍵、截止交易或成功組別算法。
- 不讓題目文字參與判分、排名、答案 mapping 或 XLSX 寫入決策。
- 不加入逐題開放、組別專屬題目、自動判分、取消成功或順位遞補。
- 不更換 SQLite、Socket.IO、ExcelJS 或既有單一 Node.js 執行架構。

## Decisions

### 1. 角色使用不同 cookie 名稱，session 資料表維持單一來源

老師與學生分別使用 `classroom_buzzer_teacher_session` 與 `classroom_buzzer_student_session`，兩者皆維持 HttpOnly、SameSite=Lax、path `/`、相同 TTL 與 HTTPS 時的 Secure 設定。SessionService 提供明確的 teacher/student 解析入口；老師 middleware 不再讀取學生 cookie，學生 middleware亦不讀取老師 cookie。建立其中一種 session 不清除另一種 cookie。

保留單一 `sessions` 表與既有 role/check constraints，避免複製儲存模型。只分離瀏覽器傳遞憑證的名稱，不改變伺服器端 session 身分資料。

曾考慮以 cookie path 分隔 `/api/teacher` 與 `/api/student`，但 Socket.IO 使用共用 `/socket.io` path，無法可靠取得兩個受 API path 限制的 cookie；不同名稱且 path `/` 能同時服務 HTTP 與 socket。

### 2. Socket handshake 的角色提示只用於選擇 cookie，不授予權限

前端建立 socket 時傳送 `activityId` 與連線用途 `teacher` 或 `student`。伺服器以用途選擇對應 cookie，解析資料庫 session 後再次驗證實際 role、有效期限及活動／組別範圍，再決定 teacher room 或 group room。用戶端用途是未受信任輸入；沒有對應有效 cookie 時一律拒絕。

同一頁面若因 reconnect 建立新連線，必須重新執行完整 handshake。既有 room 裁切與事件 payload allowlist 維持不變。

### 3. Close HTTP 回應直接推進老師端權威狀態

close service 保持現有 `BEGIN IMMEDIATE` 等價交易：更新 `activities`、建立 `result_entries`、提交後再發布事件。前端解析成功回應中的 `state`、`revision`、`closedAt`，立即將目前活動切換為 `CLOSED`，停止 live monitor 寫入控制並載入 results。Socket 截止事件只負責其他已連線頁面，不能成為呼叫端切換條件。

401/403 使用既有結構化錯誤格式顯示伺服器繁體中文 message，並明確提示重新建立對應角色 session；其他錯誤保留活動為 `OPEN` 並允許重試。重複 close 繼續回傳既有 `CLOSED` 結果，前端以成功結果收斂。

### 4. 題目文字作為獨立 metadata，不納入答案 mapping identity

Guided Notes header candidate 擴充為同列唯一的「題號」、「題目」、「作答」三個邏輯表頭。掃描時忽略 merge slave，只以 master cell 判定表頭；若任一表頭缺漏、同列重複或跨工作表有多個完整候選，拒絕匯入。

對每個非空題號列，parser 取得題目欄所在儲存格；若它屬於合併範圍，讀取 master 的可見文字與完整範圍。合併範圍可以水平或向下跨列，但必須涵蓋該題號列，且不得同時被兩個不同題號列宣告。沒有題號的延伸列不建立額外題目。題目文字使用 ExcelJS 可見文字、保留內容中的換行並只去除整體前後空白；空白或歧義題目使整次匯入失敗。

`questions` 新增 `prompt_text` 與 `prompt_range`。`display_number`、`number_cell`、`answer_range`、`answer_anchor`、`original_answer` 與 `sort_order` 保持原欄位及語意。匯出 validation 的 mapping identity 與可修改儲存格集合不加入 `prompt_text` 或 `prompt_range`，但完整語意比較自然會確認題目儲存格未被改變。

共用 `QuestionSummary`、preview、teacher/student snapshot 及 results 統一帶 `promptText`。UI 建立單一題目標題呈現元件，供預覽、老師監看、學生選題／作答及結果共用，避免不同頁面遺漏。

### 5. 題目 schema migration 採 nullable 欄位加來源副本回填

版本化 SQL migration 先加入 nullable `prompt_text`、`prompt_range`，使既有資料庫可無損升級。啟動後的受控 backfill 逐一讀取既有 activity 保存的來源 `.xlsx`，以新 parser 依既有 `sheet_name`、`number_cell` 與題號核對後填入題目資料；每場活動在獨立交易中更新，失敗不影響其他活動、答案 mapping、提交或結果。

新匯入必須寫入非空題目文字。對來源檔遺失或舊格式沒有「題目」表頭而無法回填的歷史活動，保留可查看與匯出的既有資料，API 以明確 legacy fallback 文字顯示，不阻止服務啟動；不得猜測題目內容。這個相容分支只適用於 migration 前活動。

### 6. 組別數量使用單一批次端點與交易

老師端以一個數量欄位呼叫批次設定端點，例如 `PUT /api/teacher/activities/:activityId/groups`，body 為 `{ count }`。Service 在單一交易內依序：驗證老師授權、`DRAFT`、1–100 整數、既有學生 session、產生完整名稱、替換組別清單、遞增一次 revision。任何錯誤回滾全部資料。

若不存在學生 session，可在 `DRAFT` 重新設定數量；為保持結果可預測，重新設定會重建完整的「第 1 組」至「第 N 組」。只要已有任一學生 session，拒絕整次重設，即使新的數量較大也不進行部分追加。既有逐組 repository 可保留供內部測試或相容使用，但老師主要 UI 不再要求逐組命名。

活動開始 service 將最低組別數由一組改為兩組；數量 1 是可保存但尚不可開始的草稿設定，介面需顯示缺少第二組。

### 7. 老師活動以 URL 與後端資料恢復

新增老師可見 activity summary API，至少回傳 `activityId`、title、state、revision、時間與 question count；排序以最新活動優先。老師活動頁使用可重建的 `/teacher/activities/:activityId` URL，載入時取得 teacher snapshot，而不是依賴匯入完成後的 React object。

老師根頁初始化順序為：建立或確認 teacher session、查詢活動摘要、若有唯一 `OPEN` 活動則導向並恢復；否則顯示匯入入口與既有 `DRAFT/CLOSED` 活動清單供選擇。直接開啟合法 activity URL 亦可恢復。所有恢復路徑只讀既有資料，不重新確認 import、不建立 activity。

Teacher snapshot 增加 title、question count 所需資料及完整題目文字。`CLOSED` snapshot 仍由 results service 提供穩定結果，匯出沿用 activityId。狀態主標題由目前流程／snapshot state 的單一映射產生。

### 8. 核心演算法與學生資料 allowlist 不變

提交仍只從學生 session 取得 group，修改建立新 attempt，排名只使用每題最後有效 attempt 的 `receive_sequence`。Result DTO 僅在既有 question summary 中增加公開題目文字；學生結果仍只包含 winner identity 與 ownResult，不加入其他組答案、時間、順位或提交狀態。

匯出仍從保存的來源副本產生新檔，只改變每題 rank 1 答案所對應的 `answer_anchor`；無成功組別保留原值。所有既有 workbook semantic checks 必須在加入題目 metadata 後原樣通過。

## Risks / Trade-offs

- [同時存在兩種 cookie 可能使錯誤 middleware 讀到非預期憑證] → 使用角色專用解析函式與端點／socket 整合測試，禁止通用「取第一個 session cookie」邏輯。
- [用戶端偽造 socket role 提示] → 提示只選擇 cookie；伺服器仍驗證資料庫 session role 與 activity/group scope。
- [跨列合併範圍可能錯配到兩個題號] → parser 明確檢查範圍歸屬與重疊，歧義時拒絕整次匯入並回報位置。
- [歷史來源檔缺少題目表頭或檔案遺失] → nullable migration、逐活動回填與明確 legacy fallback；不阻止其他活動或服務啟動。
- [批次重建組別可能使既有 id 失效] → 只在沒有任何學生 session 的 `DRAFT` 允許重設，且整批交易回滾。
- [自動恢復錯誤活動] → 只自動選擇資料庫唯一允許的 `OPEN` 活動；其他狀態由 URL 或活動清單明確選擇。
- [題目文字擴充意外改變學生隱私 DTO] → 共用 schema 使用嚴格 allowlist，新增欄位限於公開 question summary，兩組資料的網路 response 與 DOM 測試持續檢查禁用欄位。

## Migration Plan

1. 先加入向前相容的 SQLite migration、角色 cookie constants 與擴充後的共用 DTO schema。
2. 實作題目 parser 與新匯入保存路徑，再加入歷史 activity 的受控題目回填；回填前後核對既有答案 mapping。
3. 切換 HTTP middleware 與 Socket.IO handshake 到角色專用 cookie，保留舊單一 cookie 只作一次性過渡讀取或明確失效，不得讓它再次覆蓋新 cookie。
4. 加入批次組別與活動摘要／恢復 API，再更新前端路由、標題、題目顯示及 close 收斂。
5. 依層級執行 migration、parser、repository、API、socket、component、E2E 與 XLSX round-trip 測試。

若需回滾應先停止服務並備份 `var/`。新增 nullable 欄位可留存在舊程式未使用的資料庫中；應回滾程式而非刪除活動、提交、結果或來源檔。已建立的新角色 cookie 可由舊程式忽略，但回滾後需重新建立舊版 session；不得回退或重算既有 `receive_sequence` 與 result entries。
