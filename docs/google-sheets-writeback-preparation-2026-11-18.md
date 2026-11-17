# 真實 Google Sheets 寫回前準備（2026-11-18，Asia/Taipei）

狀態：PREPARED，**未執行 Google 寫入**。使用者僅授權真實讀取、本機測試活動及預覽。不是 Mock，也不是寫回成功紀錄。

- 文件 ID 尾碼 fP6Qr8；分頁「學習單」，sheetId 1133085307。
- 正式分頁清單、匯入預覽、確認建立活動成功；建立前已確認沒有其他 OPEN 活動，未關閉或修改任何既有活動。
- 本機新活動：3b834c9b-2ad1-4771-a457-472ec109da46。
- 兩組使用隔離 Session；六題各有兩筆有效提交，第 1／2 組交替先提交。第七題兩組均不提交。
- 正式 open／close 完成，活動 CLOSED，結果版本 15。
- 正式 writeback/preview 成功；operationId 7d74c616-bd65-4461-83ef-cd5de24fbd6f，狀態 PREPARED，errorCode=null。

| 題號 | 第一名 | 預計答案 | Anchor | 原值 |
|---|---|---|---|---|
| 1 | 第 1 組 | CPU | G5 | 空白 |
| 2 | 第 2 組 | 0 | G7 | 空白 |
| 3 | 第 1 組 | IP | G9 | 空白 |
| 4 | 第 2 組 | 作業系統 | G11 | 空白 |
| 5 | 第 1 組 | 堆疊 | G13 | 空白 |
| 6 | 第 2 組 | 演算法 | G15 | 空白 |
| 7 | 無 | 不寫入 | G17 不在計畫內 | 保留 |

唯讀核對全部通過：六題均有兩組排名、計畫答案等於最終 rank=1 答案、所有目標綁定指定 sheetId、來源與計畫結構指紋一致、原值皆空白、第七題無提交亦無目標。預覽服務已實際重讀 Google 並檢查來源結構與目標原值，沒有發現衝突。

雲端寫回前的原始儲存格、格式及合併範圍快照已由真實 Reader 保存。完整去敏證據位於 Git 忽略的 var/google-writeback-preparation.json、var/google-writeback-before-snapshot.json；不含 Cookie、Token 或私鑰。

僅新增本機活動、兩組 Session、提交、截止結果及預覽操作紀錄；未呼叫 writeback/confirm、retry、reconcile、spreadsheets.batchUpdate 或其他 Google 更新。未變更歷史活動。未以本輪準備取代真實寫回及非目標前後比較驗收，Tasks 5.2、5.3 保持未完成。

下一步需要使用者另行明確授權同一文件、指定分頁的 G5／G7／G9／G11／G13／G15 真實測試寫回；G17 不寫。應停止外部共編並保存雲端原始版本。正式確認仍須再次讀取 preflight，本輪無衝突不保證稍後文件不變。
