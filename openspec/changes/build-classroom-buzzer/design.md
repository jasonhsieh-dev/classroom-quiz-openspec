# Design

## Context

本專案目前只有 OpenSpec 與 Git 設定，尚無既有程式架構或資料需要遷移。需求與行為邊界見 `proposal.md` 及本 Change 的七個 capability specs。

系統只需在單一本機 Node.js 執行個體展示，但必須讓老師與至少兩組學生以不同瀏覽器 session 同時操作。伺服器接收順序是順位的唯一權威，且提交與截止必須具備可重現的競爭結果。Guided Notes 是從 Google Sheets 下載的 `.xlsx`；系統不使用 Google API，並需保存來源檔其他內容與格式。

## Goals / Non-Goals

**Goals:**

- 以單一儲存庫與單一本機啟動流程提供老師端、學生端、API、即時同步及 SQLite。
- 讓資料模型直接表達活動狀態、組別 session、題目 mapping、不可變提交歷程、目前有效提交與最終結果。
- 在資料庫交易內明確決定提交與截止的先後，並於交易提交後才推播事件。
- 由伺服器依角色建立回應 DTO 與 Socket.IO room，避免把完整資料送給學生再由前端隱藏。
- 以來源 `.xlsx` 副本寫入成功答案，並以合成 fixture 驗證動態位置與格式保留。
- 讓初學者可用少量明確指令完成啟動、測試及多人 Demo。

**Non-Goals:**

- 不處理公開網路部署、水平擴充、多伺服器 Socket.IO、Redis 或雲端資料庫。
- 不提供 PIN、完整帳號登入、OAuth 或可抵抗惡意冒用組別的身分驗證。
- 不支援 Google Sheets API、`.xls`、`.xlsm`、任意版面辨識、題組或 CSV 匯出。
- 不判斷答案正確性，不提供正誤標記、順位遞補或加權演算法。
- 不保證保留巨集、外部連結、圖表等超出 Google Sheets 標準 `.xlsx` 範本的進階 Excel 功能。

## Decisions

### 1. 採用 TypeScript npm workspace 的單體架構

儲存庫分為：

```text
apps/web       React + Vite 老師／學生介面
apps/server    Express + Socket.IO API 與檔案處理
packages/shared  共用 DTO、事件型別與驗證 schema
tests/fixtures   合成 Guided Notes
var/             本機資料庫、上傳與匯出（Git ignored）
```

前端使用 React、Vite、TypeScript；後端使用 Node.js、Express、TypeScript；共用型別與執行期驗證 schema 放在 `packages/shared`。同一個 Web 應用依路由提供老師與學生頁面，開發模式可由 Vite proxy 連接 Express，展示模式由 Express 提供建置後靜態檔案。

選擇理由：技術種類少、文件與測試工具成熟，Socket.IO 與 HTTP 可共用 session。替代方案 Next.js 會增加 server/client boundary；Firebase 會引入雲端帳號與安全規則；純靜態前端無法提供權威排序與交易截止。

### 2. 使用 SQLite 與 better-sqlite3

SQLite 檔案存於 `var/data/classroom-quiz.sqlite`，啟用 foreign keys、WAL 與合理 busy timeout。後端以 `better-sqlite3` 執行同步交易，schema migration 以版本化 SQL 保存於儲存庫。

選擇理由：單機 Demo 不需額外資料庫服務；同步交易 API 易於說明與測試寫入順序。替代方案 PostgreSQL 對本機期末展示過重；純記憶體狀態無法可靠測試重新啟動與提交歷程。

### 3. 資料模型

| 實體 | 重要欄位與限制 |
|---|---|
| `activities` | `id`、`title`、`state`、`revision`、`next_receive_sequence`、`source_file_path`、`source_sha256`、`opened_at`、`closed_at`; state 僅為 `DRAFT/OPEN/CLOSED` |
| `groups` | `id`、`activity_id`、`name`、`normalized_name`; `(activity_id, normalized_name)` 唯一 |
| `sessions` | opaque `id`、`role`、`activity_id`、nullable `group_id`、`created_at`、`expires_at`; 學生 session 必須有 group |
| `questions` | `id`、`activity_id`、`display_number`、`sort_order`、`sheet_name`、`number_cell`、`answer_range`、`answer_anchor`、序列化 `original_answer`; `(activity_id, display_number)` 唯一 |
| `submission_attempts` | 自增 `id`、`activity_id`、`question_id`、`group_id`、`session_id`、`answer`、`server_received_at`、`receive_sequence`、`idempotency_key`; 歷程不可變；`(activity_id, receive_sequence)` 唯一，`(session_id, question_id, idempotency_key)` 唯一 |
| `current_submissions` | `activity_id`、`question_id`、`group_id`、`attempt_id`; `(question_id, group_id)` 唯一 |
| `result_entries` | `activity_id`、`question_id`、`group_id`、`attempt_id`、`rank`; 關閉交易建立，`(question_id, rank)` 唯一 |
| `export_records` | `id`、`activity_id`、`output_path`、`sha256`、`created_at` |

`display_number` 使用字串以保留 `1-1` 或 `A1`。答案保存純文字；API 在驗證後去除前後空白，並設定可配置的最大長度，預設 2,000 字。`submission_attempts.id` 僅為紀錄識別碼；權威排序使用提交交易內從 `activities.next_receive_sequence` 配置的 `receive_sequence`。`server_received_at` 是伺服器時間紀錄與顯示欄位，不參與排名。

不另外建立可修改的 `winner` 欄位；成功組別由 `result_entries.rank = 1` 唯一決定。這避免人工檢查意外改變勝負。

### 4. session 與角色授權

瀏覽器使用 HttpOnly、SameSite=Lax 的 opaque session cookie，伺服器只保存 session ID 對應的角色與組別。學生選組 API 建立 `role=student` 且綁定 `activity_id/group_id` 的 session；學生 submission 與 snapshot 一律從 session 取 group，不讀取 body 中的 group 身分。

老師從本機老師入口建立 `role=teacher` session。因本階段不使用 PIN 或帳號，威脅模型只保證既有學生 session 無法呼叫老師端點或跨組讀取資料，不保證使用者無法另開新 session 冒選組別或老師入口。此限制需在 README 與 Demo 說明標示。

Express middleware 先驗證 role，再由 service 層套用活動與組別限制。前端隱藏按鈕僅改善體驗，不作為授權控制。

### 5. HTTP API 邊界

API 以 `/api` 為前綴，錯誤統一回傳穩定 code、繁體中文 message 及必要 details，不回傳 stack trace 或檔案絕對路徑。

老師端主要端點：

| Method / Path | 行為 |
|---|---|
| `POST /api/teacher/session` | 建立本機老師 session |
| `POST /api/teacher/imports` | 上傳 `.xlsx` 並回傳解析預覽 |
| `POST /api/teacher/imports/:id/confirm` | 確認預覽並建立 `DRAFT` 活動 |
| `POST /api/teacher/activities/:id/groups` | 建立組別 |
| `PATCH/DELETE /api/teacher/activities/:id/groups/:groupId` | 在 `DRAFT` 修改組別 |
| `GET /api/teacher/activities/:id/snapshot` | 取得老師權限完整快照 |
| `POST /api/teacher/activities/:id/open` | 檢查前置條件並開放全部題目 |
| `POST /api/teacher/activities/:id/close` | 原子截止並建立結果 |
| `GET /api/teacher/activities/:id/results` | 取得完整順位、答案與時間 |
| `POST /api/teacher/activities/:id/exports` | 從來源副本產生結果 `.xlsx` |

學生端主要端點：

| Method / Path | 行為 |
|---|---|
| `GET /api/activities/:id/join` | 取得可選組別與公開活動資訊 |
| `POST /api/student/session` | 選擇組別並建立學生 session |
| `GET /api/student/activities/:id/snapshot` | 取得狀態、題號與本組資料 |
| `PUT /api/student/activities/:id/questions/:questionId/submission` | 以答案及 idempotency key 新增或修改提交 |
| `GET /api/student/activities/:id/results` | 取得各題成功組別名稱／識別碼及本組答案／順位；不得含其他組別的答案、時間或順位 |

上傳端點使用 multipart 限制副檔名、MIME、大小及單一檔案。實際內容仍由 XLSX parser 驗證，不能只信任副檔名。

### 6. 活動狀態與 revision

`activities.state` 實作單向 `DRAFT -> OPEN -> CLOSED`。開始交易驗證題目、mapping、組別及「沒有其他 OPEN 活動」，一次將活動改為 `OPEN`。關閉不可逆；重複 close 以冪等方式回傳既有結果與原 `closed_at`。

每次會影響用戶端快照的已提交變更都遞增 `activities.revision`。HTTP snapshot 回傳 revision；Socket.IO 狀態通知帶事件產生時的 revision。revision 是判斷通知新舊的水位標記，不是每個用戶端都必須連續收到的訊息序號：學生不會收到其他組私有變更的通知，因此不得以跳號單獨判定事件遺失或推論隱藏活動。用戶端只套用比目前狀態新的允許通知；初始連線、明確重新整理與 socket 重連後重新取得權限裁切的 HTTP snapshot，不依賴完整事件重播。

### 7. 提交與截止交易策略

提交使用 `BEGIN IMMEDIATE` 語意的單一同步交易：

1. 依 session 取得 activity 與 group。
2. 以唯一鍵 `(session_id, question_id, idempotency_key)` 查詢既有 attempt；正規化答案相同時回傳原結果，不配置序號、不改變時間或 current pointer；答案不同時回傳 `IDEMPOTENCY_CONFLICT`，不改變資料。
3. 驗證活動仍為 `OPEN`、題目屬於活動、答案非空且長度合法。
4. 在同一寫入交易內遞增活動的 `next_receive_sequence` 並取得唯一 `receive_sequence`；`BEGIN IMMEDIATE` 取得寫入鎖的順序即為合法提交的序列化接收順序。
5. 取得伺服器 `server_received_at` 作為稽核／顯示資料，連同 session、答案及接收序號插入 `submission_attempts`。
6. upsert `current_submissions` 指向新 attempt。
7. 遞增 activity revision 並提交交易。
8. 交易完成後才向老師 room 與該組 room 推播裁切通知。

關閉也使用寫入交易：

1. 驗證活動為 `OPEN`；已 `CLOSED` 則回傳既有結果。
2. 將狀態更新為 `CLOSED` 並設定 `closed_at`。
3. 對每題讀取 `current_submissions`，只依 `receive_sequence` 升冪排序並寫入 `result_entries`。
4. 遞增 revision，提交後推播截止事件。

SQLite 單寫者與 `BEGIN IMMEDIATE` 使提交及 close 的寫入交易序列化。先取得寫入順序的有效提交在同一交易內獲得下一個接收序號並提交，因此納入之後的 close；close 先取得寫入順序並寫入 `CLOSED` 時，後續提交會讀到關閉狀態並失敗，不會配置序號。交易外到達的 HTTP／Socket 時機、`server_received_at` 與客戶端時鐘都不參與排序或截止判斷。即使多筆 `server_received_at` 相同或系統時鐘倒退，`receive_sequence` 仍保持權威順序。

### 8. Socket.IO 同步與資料裁切

驗證 session 後，socket 僅能加入以下 room：

- 老師：`activity:{activityId}:teacher`
- 學生：`activity:{activityId}:group:{groupId}`

共用通知包括 `activity.opened`、`activity.closed`、`submission.updated` 與 `snapshot.invalidated`。相同事件名稱可依 room 使用不同 payload：老師的 `submission.updated` 含組別、答案與時間；學生版本只含本組資料。截止通知不夾帶其他組結果，學生收到後經受限 snapshot／results API 取得成功組別名稱或識別碼及本組資料。不得先廣播完整 payload 再由前端過濾。

socket 是通知與即時體驗通道，HTTP/SQLite 才是權威。socket 斷線時仍可依 HTTP 處理提交；重連事件觸發重新抓取權限裁切的 snapshot，並以快照完整取代目前可見狀態。系統不重播斷線期間事件，也不承諾在 socket 持續連線但單一通知未抵達時只靠 revision 跳號立即修復；使用者可藉明確重新整理重新取 snapshot。重連後 snapshot 失敗時 UI 標示尚未同步、停用寫入並提供重試。

### 9. Guided Notes 匯入設計

使用 ExcelJS 從上傳 buffer 讀取 `.xlsx`。解析器執行下列步驟：

1. 正規化文字時去除前後空白，但表頭語意只接受精確的「題號」與「作答」。
2. 掃描所有工作表，找出同一列同時具有兩個表頭的候選；候選不是唯一一組時拒絕。
3. 記錄題號欄與作答欄。掃描表頭下方至工作表 used range 結束，題號欄非空的列建立題目，空白列略過。
4. 題號轉為保留顯示的字串並檢查正規化後唯一。
5. 以該題同列、作答欄所在儲存格為目標；若屬於合併範圍，保存完整範圍及左上角 anchor。
6. 檢查每題恰有一個答案目標、範圍不重疊且至少有一題。
7. 產生 preview DTO：題號、sheet、number cell、answer range、原值與非空警告。

解析預覽先保存在短期 import draft 與 `var/uploads/tmp`。老師確認後才將原始檔移至活動專屬目錄、計算 SHA-256、保存 mapping 並建立 `DRAFT` 活動；取消或過期 draft 要清理暫存檔。

替代方案是依固定欄位或 named range 解析，但不符合動態位置要求；完全任意版面或 OCR 則不可可靠驗收。

### 10. Guided Notes 匯出設計

匯出時重新讀取保存的來源副本與 mapping，不重新推測題目位置。對每題查找 `rank=1` 的 result entry；存在時將其 attempt 答案寫入 `answer_anchor`，不存在時完全不寫該位置。來源檔永不原地修改，輸出寫至新暫存檔，驗證成功後才移入 `var/exports/{activityId}`。

匯出驗證以來源與輸出活頁簿的完整語意模型比較所有工作表及順序、所有非目標儲存格的值與公式、所有儲存格格式、合併範圍、列高、欄寬，以及工作表／列／欄隱藏狀態。唯一允許的差異是具有 `rank=1` 結果之 `answer_anchor` 的值；該目標的格式不得改變，無成功組別的目標必須完全相同。另驗證題目數與 mapping 可定位性。輸出失敗或任一未授權差異時刪除暫存輸出並回報錯誤，不提供可能損毀的檔案。

選擇 ExcelJS 是因為它能以 TypeScript 同時處理儲存格、合併範圍及基本樣式，適合目前 Google Sheets 標準範本。實作匯出前先用目前單題範本與涵蓋上述語意屬性的合成 fixtures 執行 ExcelJS load/save round-trip 技術驗證；只有完整語意比較證明 ExcelJS 無法保存本階段必要屬性時，才針對答案 cell 的 XLSX XML 採用最小替換 fallback，並以相同測試契約驗證。此 fallback 不擴大支援格式範圍。

### 11. 結果 DTO 與隱私

關閉後建立三種明確 DTO：

- Teacher result：每題成功組別、所有提交組別之 rank、answer、receivedAt。
- Student result：每題只提供成功組別的名稱或識別碼，加上 session 組別自己的 answer、rank 或未作答狀態；其他組即使是成功組別，也不提供 answer、receivedAt 或 rank。
- Export result：只讀取每題 `rank=1` 的 answer，不接受老師覆寫。

活動開放期間不建立或回傳學生可見的暫時順位。老師即時畫面可看到答案與提交時間，但人工檢查沒有寫入結果的 API。

### 12. 測試策略

- Vitest 單元測試：表頭／合併範圍解析、完整活頁簿語意比較、驗證、接收序號順位、DTO 裁切與狀態機。
- Supertest + 暫存 SQLite 整合測試：session 權限、API 錯誤、提交修改、冪等相同／衝突 payload、相同時間戳、時鐘倒退、交易截止與匯出。
- Playwright 端對端測試：一個老師 context、至少兩個學生 context、Socket.IO 更新、結果隱私（含成功組別）、重連、老師結束 UI 與完整 Demo。
- 合成 `.xlsx` fixtures：目前單題版面、移動列欄／不同題數、原答案非空、缺表頭、重複題號、重疊或缺少答案範圍。
- 交易競爭測試需以同步 barrier 同時釋放提交與 close，斷言結果只符合兩個合法序列之一，且資料庫無部分寫入。

完整測試指令在乾淨暫存目錄執行，並以非零狀態表示失敗。README 另提供繁體中文人工驗收清單。

## Risks / Trade-offs

- [無 PIN 或帳號時無法防止故意冒選組別或老師入口] → 在 README 明示本機 Demo 威脅模型；仍對已建立的學生 session 強制跨組與老師端點隔離。
- [ExcelJS round-trip 可能無法保存特殊 Excel 物件] → 限定 Google Sheets 標準 `.xlsx`，以合成 fixtures 驗證必要格式；驗證失敗即拒絕提供輸出。
- [單一 SQLite writer 在大量提交時序列化寫入] → 本機課堂規模可接受；保持交易短小並設定 busy timeout，避免在交易內執行檔案 I/O 或 socket emit。
- [系統時間可能被主機調整] → 排名只使用交易內單調遞增的 `receive_sequence`；`server_received_at` 僅供顯示與稽核，因此相同時間或時鐘倒退不會改變順位。
- [同組多個 session 可能互相覆蓋答案] → 這是同一邏輯組別的預期行為；UI 顯示最新有效時間，歷程保留以利測試與說明。
- [事件可能延遲、重複或單筆未抵達] → revision 僅去除已套用的舊通知；初始載入、重新整理與 socket 重連以權限裁切的 HTTP snapshot 恢復。持續連線期間不以 revision 跳號推論遺失，亦不提供事件重播。
- [上傳檔可能包含敏感課堂資料] → 只存本機 ignored 目錄，限制檔型與大小；版本控制僅使用合成 fixture。

## Migration Plan

本專案為 greenfield，沒有既有資料 migration。實作依 tasks 分階段加入 workspace、資料庫 migration、API、前端與測試；每階段必須先通過相應測試再進入下一階段。

本機 schema 變更透過版本化 SQL migration 前進。開發期間若尚未有需保留資料，可停止服務後移除 Git ignored 的本機資料庫並重新初始化；不得以刪除 OpenSpec 或測試 fixture 作為 rollback。任何匯入／匯出失敗都只清理該次暫存檔，不覆蓋來源檔或已保存結果。
