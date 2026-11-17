# Design

## Context

現有 parser 綁定 ExcelJS；import-service 保存本機來源，export-service 複製 XLSX 再寫入。activities 的 source_file_path/source_sha256 與 export_records 的檔案欄位必填；不能直接塞入雲端識別。動機見 proposal.md。

## Goals / Non-Goals

**Goals:** 替換 I/O 邊界、保留定位與搶答核心；新活動直接讀寫雲端且可恢復寫回狀態。

**Non-Goals:** OAuth 登入、Drive 複製、多分頁題目聚合、新題組管理、CSV、跨裝置、排名變更與封存改寫。混合範本指同一表格中有獨立題號的單題與題組子題；仍須符合唯一表頭、非空題目、唯一題號及非重疊答案契約。

## Decisions

1. 使用 Sheets API v4 官方 Node 用戶端與 Service Account，僅後端環境設定憑證路徑；文件分享服務帳號 Editor，不使用網域全權委派。拒絕 OAuth 雙軌以控制範圍。缺設定時雲端入口回報設定不足，既有活動仍可運作。README 只列變數名稱與佔位路徑，不列私鑰。
2. Adapter 提供 list/read/batch-write，正式實作只呼叫固定 Google API；輸入嚴格限定 https://docs.google.com/spreadsheets/d/<id> 文件格式，解析 id 與選用 gid，拒絕其他來源、帳密 URL 與任意轉址，不 fetch 使用者 URL。sheetId 經讀取清單驗證；所有路由沿用老師 Session、本機 mutation 防護。錯誤去敏映射為設定／授權、權限、不可存取文件、連線、配額及一般 API 失敗；404 不保證能區分無權限。
3. spreadsheets.get 以 fields/ranges 取得 sheet properties、merges、userEnteredValue、formattedValue 與必要格式。中立 grid adapter 保存零起算座標及省略空格；解析器沿用 NFKC/trim、表頭、題號及合併 anchor 規則。單次只解析所選分頁；一頁多候選仍拒絕。公式顯示作題目快照，原始輸入（包括公式）另存作衝突比較。限制可掃描格數及請求大小，超限明確拒絕，避免無界全表載入。
4. 新 migration 將活動來源明確分型為 legacy-xlsx/google-sheets；來源檔欄位只對 legacy 必要，必要時重建表並檢查 FK／唯一 OPEN 索引。新增雲端來源與匯入草稿資料，不偽造路徑；既有題目 snapshot 與 mapping 擴充 sheetId／網格座標。寫回紀錄保存 operationId、activityId、結果版本、payload hash、目標原值／期望值、狀態與去敏錯誤。原有 export_records 與檔案保留，不修改歷史 migration。
5. 預覽後確認時重讀結構與相關內容；指紋涵蓋所選表格表頭、題號、題目來源輸入、範圍與合併結構，不以整份 JSON 或會重算的有效公式結果當文件版本。活動開始後題目快照凍結，不在學生流程呼叫 Google。既有 prompt-backfill 僅處理 legacy，不在啟動時讀雲端。
6. 老師首頁保留既有標題、OPEN 提示與 Session retry；改提供網址、分頁清單、題目／覆寫預覽及確認。CLOSED 結果頁增加目標文件連結、第一名答案預覽與明確確認。新雲端活動不提供 XLSX 路由；legacy 僅保留歷史來源的檢視／原有輸出，不自動轉成雲端活動。共用 strict contracts 明確區分來源；學生 snapshot 不含雲端憑證或來源內容。
7. 寫回計畫由不可變最終結果建立，只包含 rank=1；無人作答不列入。送出前重讀結構與目標 userEnteredValue，和匯入確認基準比較，不一致即衝突。用單一 spreadsheets.batchUpdate 的 UpdateCellsRequest，僅 fields=userEnteredValue、stringValue 寫每個 anchor，保留公式以外的其他屬性；超出單批安全限制直接拒絕而非拆批。零目標顯示無需寫回。
8. SQLite 短交易先建立／取得活動結果版本唯一操作並防並行，交易外呼叫 Google；狀態 PREPARED、IN_FLIGHT、SUCCEEDED、FAILED、UNKNOWN、CONFLICT。相同版本成功操作回傳原狀態；可重試失敗沿用操作識別。逾時／重啟遺留 IN_FLIGHT 改 UNKNOWN，先 GET：全為期望值則成功；全為原值且結構一致才可重試；混合或其他值標衝突，不自動回滾。未成功確認不得報成功；Google 成功但 SQLite 保存失敗可由相同操作恢復核對。
9. 更新後讀回核對目標；測試同時比較非目標 userEnteredValue、格式、merge、列欄及分頁屬性。公式 effectiveValue 自動重算不視為系統覆寫。用 field mask 保證寫入範圍，不以重建 workbook 保留格式。429／暫時性故障採有上限退避；不明寫入先核對後重試，避免重送覆蓋外部編輯。

## Risks / Trade-offs

- [外部共編競態] → API 無跨讀寫 compare-and-swap；指紋不是鎖，Demo 要求預覽至寫回期間停止外部編輯，讀回發現差異不報成功，不宣稱絕對隔離。
- [Google／SQLite 非原子交易] → 持久操作紀錄與不明狀態核對，不持有 SQLite transaction 等待網路。
- [學校禁止服務帳號分享] → 真實驗收前確認展示帳號與文件可分享；若不可行需另行調整方案，不能靜默改 OAuth。
- [憑證與資料洩漏] → 後端限定、Git ignore、去敏日誌及純合成測試；禁止公開分享作為解法。
- [主規格 Purpose 仍描述 XLSX] → 本輪不修改主規格；後續經授權 Sync 時同步更新 guided-notes-workbooks 的 Purpose，不能只合併 requirement 而留錯誤定位。

## Migration Plan

Apply 時先備份 SQLite／var，再新增版本化 migration，驗證舊 fixture 升級、外鍵、索引、資料筆數及重啟冪等。部署憑證與文件權限後啟用雲端入口。回復時停止服務、保留新資料副本，再還原配對的程式與備份資料庫；不盲目降版破壞新來源紀錄。此階段只規劃，不建立或執行 migration。


## 單次更新模式修正

可信後端設定 `CLASSROOM_BUZZER_SINGLE_UPDATE=true`（啟動前設定並重啟）使每次確認最多更新一次；不接受前端重試參數。一般模式仍最多三次有限退避。單次模式在呼叫 Writer 前持久化 singleUpdateAttempted 至既有 targets_json；同一 operationId 無論 FAILED、UNKNOWN、重啟或切回一般模式均不能再次更新，reconcile 仍只讀雲端。標記先保存後更新，崩潰時採保守停止。

更新先以 JWT getRequestHeaders 取得授權，再由原始 transporter.request 發送 retry=false、maxRedirects=0 的請求，避開 OAuth2 requestAsync 在 401／403 的重新授權重播；Token 取得不算 Sheets 更新，且不輸出 Token。

必要的第二次更新必須使用獨立的 `POST writeback/renew`、舊 operationId 與 confirmed=true；只接受單次模式已嘗試且狀態 FAILED 的操作（UNKNOWN 必須先 reconcile）。重新讀取來源及原值成功後以 SQLite immediate transaction 建立新 operationId／PREPARED，舊識別、狀態與錯誤資訊保存在 targets_json.history；再經新一次明確 confirm。原成功／衝突操作不可 renew。原有每活動結果版本唯一的目前操作列不變。


## 執行實例模式唯讀佐證

沿用老師專用 `/api/teacher/activities/:activityId/writeback/runtime` GET，直接由同一 router 閉包中的 Writeback Service 回傳 `{ singleUpdateMode, instanceId }`。模式讀取建構時捕捉且實際控制 confirm 的 private singleUpdate，不再讀外部 shell 或另一套設定。instanceId 每個服務實例隨機生成，狀態／確認回應亦附相同識別；不含 PID、憑證、環境全集或路徑。runtime 使用 no-store，沿用老師 Session、loopback 與既有請求保護，health 不變。查詢不讀 Google、不寫 SQLite。

本系統只支援單一 Node 後端與直接 loopback 連線。查詢與後續操作必須使用同一 scheme／host／port，核對 runtime 與操作狀態 instanceId；服務重啟或識別改變必須重查模式與來源。跨 Port／反向代理多實例的一致性不在支援範圍，instanceId 不是跨請求鎖，不能保證查詢後程序永不重啟。

## Verify FAIL 修正：持久操作權與原子寫入資格

原先只在 claim 時讀取嘗試標記，且 await 後以舊 Stored 整包覆寫 JSON，造成租期接手後舊請求仍可能送出第二次更新或覆寫 SUCCEEDED。修正由 GoogleSheetsWritebackRepository 集中處理條件更新。

- 沿用 migration 005 的 targets_json，不修改既有 migration、不新增 schema 或遷移正式資料；每次取得操作權以 SQLite immediate transaction 保存新的隨機 ownershipToken。token 是等值 fencing 識別，不宣稱具有單調序號。舊紀錄缺 token 時於下一次合法 claim 加入，原嘗試標記保持不變。
- heartbeat、讀取後檢查、狀態與錯誤保存均須符合 operationId、IN_FLIGHT、目前 token 與未過期租期。租期接手更換 token；任何過期請求只回傳最新持久狀態，不得更新狀態或重新進入 Writer。await 的失敗與退避路徑亦須經同樣檢查。
- 呼叫 Writer 前以單一 SQLite UPDATE CAS 檢查上述條件及 singleUpdateAttempted 未設定；以 json_set 僅更新目前 JSON 的 before 快照，單次模式同時將嘗試標記設為 true。必須 changes===1 才能同步進入 Writer，中間沒有 await。不能使用讀取後判斷替代原子資格。
- Service 傳入可信後端 guard，經 Writer 及授權 adapter 傳到 transport；JWT getRequestHeaders 的 await 完成後，在呼叫原始 transporter.request 前同步重查操作權與租期。guard 不是前端參數、不進入 Google JSON，也不交給底層 HTTP 設定。這涵蓋取得更新資格後仍需等待授權的邊界。
- 單次資格一經保存即不可因租期接手、重啟或切回一般模式重新核發。新的 owner 可以 reconcile 讀回，但不能清除標記。再次更新仍須既有明確 renew，產生不同 operationId；renew 的條件更新亦檢查受影響列數。
- 一般模式保留三次上限退避，但每次送出都重新經過有效 ownership 與 CAS，且不可繞過既有單次標記。Google 網路請求仍全部在 SQLite transaction 外。
- ownershipToken 只保護本機操作資格，不是 Google 共編鎖，亦不撤銷已送出的網路請求。已嘗試但不明的結果仍須 reconcile，不能因租期過期就認定未寫入。正式 Writer 與 transport 的禁止隱含重試規則維持不變。

決定性測試用 deferred Promise 與注入時鐘重現先前 FAIL，不實際等待 120 秒；包含讀取恢復／失敗、接手成功、已取得資格後過期、新 SQLite 連線恢復、CAS 零列及一般模式。此次僅合成驗證，不重新寫入真實 Google；原真實 API 成功及人工可見範圍證據保留。
