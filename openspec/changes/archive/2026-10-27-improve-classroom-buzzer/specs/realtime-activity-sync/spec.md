# Spec Delta

## ADDED Requirements

### Requirement: 即時連線依角色 session 驗證
系統 MUST 在每次 Socket.IO handshake 由伺服器依連線用途選擇對應的老師或學生 session cookie 並驗證角色、有效期限與活動範圍。用戶端宣告的角色、活動或 room MUST 不得單獨授予權限；同一瀏覽器 profile 同時具有兩種 cookie 時，兩種連線 MUST 維持獨立資料範圍。

#### Scenario: 同瀏覽器建立老師與學生連線
- **WHEN** 同一瀏覽器 profile 同時具有有效老師與學生 cookie，並分別從老師端及學生端建立活動 socket
- **THEN** 老師 socket 加入該活動的 teacher room，學生 socket 只加入其 session 所綁定的 group room，且兩者不互相覆蓋

#### Scenario: 學生宣告老師連線用途
- **WHEN** 只有學生 session 的用戶端宣告老師角色或要求加入 teacher room
- **THEN** 伺服器拒絕 handshake 或訂閱，且不傳送任何老師可見資料

#### Scenario: 活動範圍與 session 不一致
- **WHEN** 學生 socket 指定的活動與學生 session 所綁定活動不同
- **THEN** 伺服器拒絕連線，且不洩漏目標活動或組別資料

### Requirement: 截止完成不依賴即時通知
系統 SHALL 將 close HTTP 回應與後端資料庫狀態視為截止是否成功的權威來源。Socket.IO 截止事件只能使其他已連線用戶端提早收斂；事件發送失敗、延遲、重複或遺失 MUST 不回滾已提交的 close，也不得使提出 close 的老師端繼續把活動視為 `OPEN`。

#### Scenario: Close 成功但推播失敗
- **WHEN** 活動 close 交易成功提交，但伺服器無法發出截止事件
- **THEN** HTTP 呼叫端依成功回應切換為 `CLOSED`，資料庫與結果保持已提交狀態

#### Scenario: 其他用戶端遺失截止事件
- **WHEN** 其他老師或學生用戶端未收到截止事件
- **THEN** 伺服器仍拒絕其後續提交，且重新整理或重連後的權威快照恢復 `CLOSED` 狀態

#### Scenario: 重複收到截止事件
- **WHEN** 用戶端在已套用 close HTTP 回應後又收到相同或較舊 revision 的截止事件
- **THEN** 用戶端忽略重複或過期事件，不重建結果或回復狀態
