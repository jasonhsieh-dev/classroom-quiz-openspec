# Verify FAIL 修正紀錄（2026-11-18，Asia/Taipei）

本輪為 Apply 修正，未重新執行最終 Verify；不代表先前 FAIL 已自動改為 PASS。未呼叫真實 Google 寫入、正式 confirm／renew，未改動原雲端測試活動、結果或歷史封存。

## 原因與先失敗證據

原 Service 的 await 後整包 JSON 更新缺少持久 fencing 與原子寫入資格，過期請求可能清除新標記並覆寫成功狀態。先加入四個 deferred Promise／注入時鐘案例，在舊程式上全部失敗：第一個案例 Writer 實際呼叫兩次；其餘案例分別重現舊錯誤覆寫 SUCCEEDED，以及過期 Writer 改寫接手狀態。測試使用隔離 SQLite 與合成 Reader／Writer，沒有 Google 網路呼叫，也沒有等待真實 120 秒。

## 修正範圍

新增寫回操作 Repository，沿用既有 targets_json 保存 ownershipToken；claim 每次換 token，所有狀態與錯誤更新須核對 token、IN_FLIGHT 與租期。寫入前單一 SQLite CAS 持久保存單次嘗試並核對 changes===1，失去資格不得呼叫 Writer。只以 json_set 修補目前 JSON，不讓舊 Stored 清除標記；renew 產生新識別的條件更新亦檢查列數。

不修改 migration 005 或新增 migration，不執行正式資料遷移。既有成功操作的嘗試標記可繼續使用。一般模式原有有限退避保留，Writer 與授權 transport 的禁止隱含更新重試不變。

## 驗證結果

| 檢查 | 本輪結果 |
|---|---|
| 決定性 fencing 回歸 | 7／7；其中原始四個案例已先在舊程式失敗，再於修正後通過 |
| Writer／transport 新案例 | 2／2；guard 傳遞及等待 Token 後失去操作權不發更新 HTTP |
| fencing／Service／Writer／授權專項 | 54／54；另由完整套件涵蓋 API 路由及整合 |
| 完整 Vitest | 42 檔、307／307 通過，比原先新增 9 項 |
| 完整 Playwright Chromium | 3／3；Mock 後端 3001、前端 4174，隔離 var/e2e |
| typecheck／lint／build | 全部通過 |
| Active Change strict validation | 通過 |
| 主規格 strict validation | 7／7；未 Sync，不代表主規格已納入新需求 |
| git diff --check | 通過；既有 package JSON 的 LF／CRLF 提示非 whitespace 錯誤 |
| Git 機敏資訊 | 210 個追蹤或未忽略文字檔模式掃描無候選，暫存區空；.env、憑證目錄與常見金鑰檔忽略有效 |
| 歷史相容與核心回歸 | 升級 migration 測試、歷史 XLSX E2E、老師／學生 Session、Cookie、分組、提交、排名、Socket.IO、截止及恢復通過 |

程式路徑檢查確認單次模式的唯一入口先經 SQLite CAS，取得資格後保存不可逆標記；過期 token、第二次資格及切換一般模式均不可繞過。一般模式保留有限退避，並非承諾一般模式同一 ID 永遠只呼叫一次 Writer。

4.3、5.3 曾因 FAIL 重新開啟，本輪有上述證據後重新勾選，恢復 11／11。可交由下一次 OpenSpec Verify 評估；本輪未執行 Verify，不宣稱 PASS。正式後端尚未由本輪重啟，載入修正需重新啟動，但本輪不要求再次真實寫回。

## 本輪新增／修改檔案

程式及測試：

- apps/server/src/db/repositories/google-sheets-writeback-repository.ts（新增）
- apps/server/src/guided-notes/google-sheets-writeback-fencing.test.ts（新增）
- apps/server/src/guided-notes/google-sheets-writeback-service.ts
- apps/server/src/guided-notes/google-sheets-writer.ts
- apps/server/src/guided-notes/google-sheets-writer.test.ts
- apps/server/src/guided-notes/google-sheets-authorization.ts
- apps/server/src/guided-notes/google-sheets-authorization.test.ts

Active Change 與文件：

- openspec/changes/integrate-google-sheets-guided-notes/design.md
- openspec/changes/integrate-google-sheets-guided-notes/specs/guided-notes-workbooks/spec.md
- openspec/changes/integrate-google-sheets-guided-notes/tasks.md
- docs/google-sheets-writeback.md
- docs/google-sheets-verify-fix-2026-11-18.md（新增）
- docs/google-sheets-native-writeback-2026-11-18.md
- docs/google-sheets-evidence-template.md
- docs/google-sheets-final-checks-2026-11-18.md

未修改 proposal、其他三份 delta、主規格、migration、排名演算法、UI 或歷史封存。沒有 Commit／Push／Sync／Archive。

## 真實驗收的適用範圍

既有真實 API 讀取與寫回成功、六個字串答案及 G17 讀回、SQLite CLOSED 與排名不變等證據保留於 google-sheets-native-writeback-2026-11-18.md。人工截圖可見範圍核對由使用者回報，沒有可保存的截圖檔。六個目標 effectiveFormat 的衍生差異保留，未逐項檢查的列高、欄寬等屬性不宣稱通過；更新次數沒有獨立封包計數證據。

此次 fencing 修正僅由合成測試驗證，未重新執行真實 Google 寫回。Google 共編讀寫競態與 SQLite／Google 非原子性仍依原設計限制處理。
