# Design

## Context

動機見 proposal.md。`SubmissionService.submit` 已使用 SQLite immediate transaction，依序處理既有 key、活動狀態、題目、分配序號、建立 attempt 與 current，交易成功後才發布事件。`SubmissionRepository.findCurrent(questionId, groupId)` 已可讀取有效答案。前端成功後清除 pending key，下一次操作用新 key；目前只對內容不同顯示修改確認，未區分 ANSWER_UNCHANGED。

## Goals / Non-Goals

**Goals:** 由交易內的權威 current 判定是否改變，保留 Session／冪等／截止優先序，讓無變更請求不寫入且有明確學生提示。

**Non-Goals:** 不重構提交端點、排名或同步架構；不新增去重資料表或成功收據；其餘範圍限制見 proposal.md。

## Decisions

1. **比較置於原 immediate transaction 的題目驗證後、UPDATE activities 前。** 沿用 `findCurrent` 並以 session 綁定組別查詢，將本次既有 `trim()` 後答案與已正規化保存的有效答案精確比較。相同時丟出既有 AppError 格式的 `409 ANSWER_UNCHANGED`，訊息為「答案未變更，無須重新提交」。不呼叫 clock、不配置序號、不建立 attempt、不移動 current、不產生 committed event；原有發布機制保持不變。交易外比較或僅前端攔截都無法保護多 session／並行請求，故不採用。
2. **不更動既有判斷順序。** middleware 的 Session、角色、活動 scope 與 expectedGroupId 檢查保持原樣。交易內仍先查既有成功 key：同內容回原結果、不同內容衝突；未命中才檢查 OPEN 與題目，再比較 current。因此舊成功 key 在 CLOSED 後重送仍回原結果，新 key 即使內容相同也先收到 ACTIVITY_CLOSED。無變更不是成功提交，不保存或占用新 key；不把未保存的新 key 當作有永久重播保證的成功收據。
3. **沿用既有寫入序列化，不加唯一約束。** 兩個同組同題不同 key 的相同新答案請求，第一個建立 attempt，第二個取得鎖後讀到更新的 current 而被拒絕；既有 current 已相同則兩者皆不寫入。涵蓋同組不同 session，且不同組不互相去重。不能對歷史答案加 UNIQUE，否則 A → B → A 會被誤擋。保留原忙碌等待、提交／截止競爭與真正修改的序號分配。
4. **學生端專門處理業務回應，不依本機 snapshot 略過權威請求。** 在 `StudentActivityView` 既有錯誤回應分支識別 ANSWER_UNCHANGED，顯示一般狀態提示並清除該次 pending key，透過原 finally 解除提交等待，不修改既有答案／時間，也不觸發成功提交更新。切題、編輯或下一次提交時清除舊提示。網路失敗仍保留 pending key 重試，ACTIVITY_CLOSED 與其他錯誤維持原處理；真正不同答案仍使用既有修改確認。一般 ApiError code 為字串，因此不需修改 shared contracts 或成功回應格式。

## Risks / Trade-offs

- [前端 snapshot 可能落後同組另一 session] → 後端 current 為唯一判斷依據，前端不自行宣告未變更，也不從本次請求捏造新時間；沿用既有 snapshot／事件更新。
- [未變更被誤當網路失敗而一直重送] → 前端以專用 code 顯示提示並清除本次 pending；保留原真正網路重試邏輯並測試區別。
- [冪等檢查順序改動造成舊 key 覆寫 current] → 補測 A → B 後重播 A 的成功 key 僅回原結果，不恢復 A；key 衝突亦須優先於未變更判斷。
- [並行測試只測到同一連線排隊] → 沿用既有 worker／獨立 SQLite 連線與 barrier，驗證不同 key、同組不同 session 的真實並行，檢查 attempt 數量、current、序號、時間與 revision；API 測試注入 onCommitted spy 確認無變更不發布事件，無需修改 Socket.IO 實作。

## Migration Plan

僅部署提交服務與學生回應處理，無資料遷移或歷史資料清理。前一個首頁 Change 的工作不納入本輪改寫。若需回復，只還原本輪程式與對應測試／驗收文件；不回寫既有 attempt、時間或順位。
