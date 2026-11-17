# Tasks

## 1. Phase 1：資料模型與 Google API 授權

- [x] 1.1 新增來源分型與雲端／操作紀錄 migration 設計之實作；完成條件為不造假路徑且舊資料完整；以舊資料庫升級、外鍵／唯一 OPEN、重啟及資料保存測試驗證。
- [x] 1.2 建立 Service Account adapter 與安全設定、錯誤映射並補設定文件；以 mock 驗證固定 API 端點、缺設定、403／404／429、去敏及未授權老師請求不呼叫 Google。

## 2. Phase 2：雲端讀取、解析及動態定位

- [x] 2.1 抽出中立網格與雲端讀取 adapter；以單題／題組混合、移動表頭、不同分頁、合併格、公式、API 省略空白及無效 mapping fixtures 驗證，保留既有定位規則。
- [x] 2.2 實作雲端草稿、確認重讀、來源指紋及快照保存，限制掃描大小並隔離 legacy backfill；以來源變動拒絕、取消不建活動、離線活動恢復及重啟測試驗證，更新匯入契約文件。

## 3. Phase 3：老師端匯入與分頁選擇

- [x] 3.1 更新 strict contracts 與老師網址／分頁／題目覆寫預覽確認，移除新活動 XLSX 正式入口與 API；以 API／contract／App 測試驗證錯誤、取消、確認、Session retry、OPEN 提示及三狀態網址恢復，文件同步說明 legacy 邊界。

## 4. Phase 4：雲端答案寫回及錯誤處理

- [x] 4.1 建立 CLOSED 第一名答案計畫、目標與答案預覽及結構／原值 preflight；以無作答、非 CLOSED、來源修改、目標已有公式與不同組答案測試驗證，確認不改排名。
- [x] 4.2 實作單批 UpdateCells、stringValue 與讀回核對；以合併 anchor、等號文字、非目標公式格式／分頁、保護範圍整批失敗、大小超限測試驗證，不拆批或清空整區。
- [x] 4.3 持久化操作識別及狀態並實作結果頁成功／失敗／重試；以重複與並行點擊、429、離線、逾時已寫／未寫／混合、程序重啟與 DB 保存失敗測試驗證先核對再重試，補充操作與錯誤文件。另須以決定性租期交錯測試驗證持久 ownership token、原子寫入資格與過期請求不可覆寫狀態。

## 5. Phase 5：測試、README 與人工 Demo

- [x] 5.1 更新 Playwright 整合流程，以可控 adapter 完成雲端匯入至寫回，保留既有兩輪回歸斷言；完成條件為 Session／Cookie、組別、唯一 OPEN、排名、相同答案、Socket.IO、截止與恢復均通過。
- [x] 5.2 整合 README 與 docs/manual-acceptance.md，依去敏步驟用真實 Google Sheets 與兩組學生完成讀寫及非目標比較；記錄實際驗收結果，無憑證時明確標未完成，不以 mock 替代。
- [x] 5.3 執行完整 Vitest、Playwright、typecheck、lint、build、openspec validate integrate-google-sheets-guided-notes --strict、openspec validate --specs --strict、git diff --check；全部成功且真實驗收完成才勾選，檢查無憑證或無關修改。


## Phase 5 驗收阻礙修正說明

單次更新模式、持久嘗試標記、明確 renew 及底層授權重播防護納入本 Change，使用 Mock 驗證。這不代表真實寫回通過，5.2、5.3 保持未勾選。

新增唯讀 runtime 查詢及相同服務 instanceId 佐證，Mock 測試驗證模式與權限；5.2、5.3 仍待真實驗收，不據此勾選。

最新狀態：使用者已提供可見範圍人工核對結果，與真實 API 及本機證據共同完成 5.2；前述保持未勾選的說明為歷史階段狀態。未取得實際圖片檔，不宣稱保存截圖。

歷史完成紀錄：最後回歸 Vitest 298／298、Playwright 3／3 等通過後曾勾選全部項目；後續 Verify 發現租期交錯缺陷而 FAIL，因此本輪重新開啟 4.3、5.3，等待修正及完整回歸。5.2 的真實讀寫與人工可見範圍證據保留，不再呼叫真實 Google 更新。本輪是 Apply 修正，尚未重新 Verify。

本輪修正完成：4.3、5.3 在修正及驗證後重新勾選，進度恢復 11／11。新增 9 個合成回歸案例，完整 Vitest 307／307（42 檔）、隔離 Mock Playwright 3／3，typecheck／lint／build／兩種 strict validation／diff／機敏檢查通過。詳見 docs/google-sheets-verify-fix-2026-11-18.md。這是 Apply 完成證據，未重新 Verify，不將先前 FAIL 自動改為 PASS，也未重新執行真實雲端寫回。
