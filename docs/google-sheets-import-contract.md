# Google Sheets 後端匯入契約（Phase 2）

目前已接上老師介面與正式雲端匯入 HTTP 路由；CLOSED 後寫回規則見 [雲端寫回與復原](google-sheets-writeback.md)。真實 API 尚未驗證；自動化使用合成 Google 回應。授權設定見 README 的 Google Sheets 段落。

## 讀取

只接受 HTTPS `docs.google.com/spreadsheets/d/<spreadsheetId>` 文件網址，可有 edit/view/preview 與 gid；gid 只作為預選資訊，呼叫者仍須選定存在的單一 sheetId。拒絕帳密網址、其他主機、無效識別及不一致 gid。後端不抓取輸入網址，而是由既有 Service Account transport 對固定 Sheets API v4 spreadsheets.get 發出請求。

先取得分頁 properties，再讀取所選分頁的完整合法網格範圍與必要 fields（原始／有效值、顯示文字、輸入／有效格式、合併範圍）。支援一般 GRID 分頁；每頁最多 100000 格、回應最多 4 MB，超限拒絕而非截斷題目。分頁名稱中的單引號以 A1 規則跳脫；API 回應的零起算、半開範圍轉為中立唯讀網格的一起算座標。

## 定位

雲端與 XLSX 使用同一解析器，保留 NFKC/trim、同列唯一「題號／題目／作答」、非空題目、唯一題號、題目與答案範圍不重疊等規則。只解析所選分頁；多個候選表頭拒絕。題組混合指已有獨立唯一題號的子題，不解析額外題組階層，不支援多題共用同一題目合併區。

普通答案格必須位於唯一作答欄、有效題號列及分頁網格範圍，才接受 API 省略的空格；任意空白格不建立題目或 mapping。合併答案以左上角為 anchor；答案與任何題號或題目相交時拒絕。XLSX 空格的既有樣式判定不變。

保留 userEnteredValue（含公式）、formattedValue、effectiveValue 與必要格式；題目使用顯示文字，原始答案另存型別值。公式結果為空也保留其公式並在預覽提示覆寫。

## 草稿與確認

草稿有效 30 分鐘，保存題目 mapping、原始答案、網格快照及 SHA256 結構指紋。指紋以 canonical key 排序計算，涵蓋分頁識別／維度、合併範圍、mapping、表頭／題號／題目原始輸入；不以格式化顯示或公式重算結果作為整份文件版本。目標原值另外比較。

確認時重新讀取，結構或原始答案改變即拒絕，要求重新預覽。雲端等待不持有 SQLite transaction；返回後在 immediate transaction 再檢查草稿未取消、未到期，才一次保存 DRAFT 活動、來源及全部題目，並消耗草稿。並行確認最多成功一次；任一步保存失敗整筆回滾。取消刪除草稿，不建立活動。

建立後搶答及恢復只讀 SQLite，不呼叫 Google。來源／mapping 留在後端，不加入學生 snapshot。舊 XLSX 與 prompt-backfill 保持相容，雲端活動不進入 XLSX 回填。

## 限制

指紋與確認前重讀不是雲端鎖，無法消除重讀後的共編競態；Phase 4 仍須再次檢查。預覽至寫回期間請避免外部編輯。權限、不可存取文件、離線及配額沿用去敏錯誤；不自動下載 XLSX、不靜默使用舊快取替代失敗的雲端讀取。


## 老師端 API（Phase 3）

- `POST /api/teacher/imports/sheets`：JSON `{ url }`，取得 spreadsheetId 與分頁 sheetId／title。
- `POST /api/teacher/imports`：JSON `{ url, sheetId }`，取得帶 sourceKind 的 strict 雲端預覽 DTO。
- `POST /api/teacher/imports/:id/confirm`：JSON `{ title }`，確認重讀後建立 DRAFT，僅回傳活動識別、名稱、狀態及題數。
- `DELETE /api/teacher/imports/:id`：取消草稿，回傳 204。

以上全部沿用 loopback、同站 mutation 保護與老師 Cookie Session。學生 Cookie 不可替代老師 Cookie；輸入／輸出使用 strict contracts，不傳送原始憑證、檔案路徑或完整 snapshot。multipart XLSX 不再由正式路由接受。舊 XLSX service 只保留歷史相容與隔離測試用途。

老師先貼網址讀取分頁，明確選擇後預覽，再確認或取消；載入時禁止重複操作，修改網址清除舊分頁選擇。確認成功後進入活動網址；若快照讀取失敗，保留該網址以供重新整理恢復，不重新確認建立活動。Google 錯誤不切換 XLSX 備援。雲端活動不顯示 XLSX 下載按鈕；寫回見 [雲端寫回與復原](google-sheets-writeback.md)。

Playwright 使用獨立測試啟動檔注入合成 Google 回應，並預建歷史 XLSX fixture 驗證舊活動；正式 `npm run dev:server` 不載入這個 Mock，也沒有以環境變數切換假成功的入口。

## 驗收入口

最新受控測試見 [自動驗證紀錄](google-sheets-verification-2026-11-18.md)。真實操作前依 [人工清單](manual-acceptance.md) 完成設定與授權，結果填入 [證據模板](google-sheets-evidence-template.md)。Mock 結果不能填成真實 API PASS。
