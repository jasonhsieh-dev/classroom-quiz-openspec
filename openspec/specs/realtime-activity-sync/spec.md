# realtime-activity-sync Specification

## Purpose

定義老師與學生畫面的即時活動同步、依角色裁切的 Socket.IO 狀態變更通知，以及斷線重連後由權威 HTTP 快照恢復一致狀態的行為。

## Requirements

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

### Requirement: 即時同步活動階段
系統 SHALL 在活動開始與結束後透過即時通道通知已連線的老師與學生，事件 MUST 包含活動識別碼、最新狀態與事件產生時的活動 revision。用戶端 MUST 不套用 revision 低於或等於目前已套用狀態的事件，但 MUST 將 revision 視為新舊水位標記而非連續訊息序號；學生不需要收到無權查看之變更所產生的每一個全域 revision。

#### Scenario: 老師開始活動
- **WHEN** 活動成功從 `DRAFT` 轉為 `OPEN`
- **THEN** 已連線的相關用戶端收到較新 revision 的開始事件並切換至可作答或監看畫面

#### Scenario: 老師結束活動
- **WHEN** 活動成功從 `OPEN` 轉為 `CLOSED`
- **THEN** 已連線的相關用戶端收到截止事件，學生畫面停止編輯並取得允許顯示的結果

#### Scenario: 收到過期事件
- **WHEN** 用戶端收到 revision 小於或等於已套用 revision 的舊事件
- **THEN** 用戶端忽略該事件且不回復到較舊狀態

#### Scenario: 學生收到不連續 revision
- **WHEN** 學生下一個允許接收的事件 revision 大於目前 revision 加一
- **THEN** 用戶端可套用該較新狀態通知，不得僅因 revision 跳號判定事件遺失或推論其他組別曾有變更

### Requirement: 老師收到完整提交更新
老師連線 SHALL 在每次有效提交或修改後收到題目、組別、最新答案、最後有效提交時間及目前活動 revision。事件內容 MUST 不包含已失效提交作為目前答案。

#### Scenario: 學生首次提交
- **WHEN** 任一組對題目完成第一筆有效提交
- **THEN** 老師畫面即時顯示該組已提交、答案及最後有效提交時間

#### Scenario: 學生修改答案
- **WHEN** 任一組修改已提交題目的答案
- **THEN** 老師畫面以新答案與新時間更新該組該題狀態

### Requirement: 學生只收到允許的即時資料
活動開放期間，學生連線 MUST 只收到公開活動狀態及其 session 所綁定組別的提交更新。系統 MUST 不向學生 socket 廣播其他組別的答案、提交狀況、時間或暫時順位。

#### Scenario: 其他組完成提交
- **WHEN** 另一組對任一題提交或修改答案
- **THEN** 學生連線不收到可辨識該組提交狀況或答案的事件

#### Scenario: 自己組別完成提交
- **WHEN** 同一組的任一有效 session 完成提交
- **THEN** 該組其他已連線 session 收到本組最新答案與提交狀態

#### Scenario: 學生嘗試加入老師事件範圍
- **WHEN** 學生 socket 嘗試訂閱老師或其他組別的事件範圍
- **THEN** 伺服器拒絕訂閱，且不傳送受限制資料

### Requirement: 初始連線使用權威快照
老師與學生用戶端 SHALL 在初次載入及 socket 建立後取得符合角色權限的 HTTP 快照，再套用較新且允許接收的狀態通知。系統 MUST 不要求用戶端僅靠事件重播建立完整狀態，也 MUST 不使用 revision 跳號作為唯一的事件遺失判斷。

#### Scenario: 學生在活動進行中加入
- **WHEN** 學生在活動已 `OPEN` 後建立 session 並開啟活動頁面
- **THEN** 系統回傳目前活動、全部題號及自己組別作答狀況的快照

#### Scenario: 老師重新整理頁面
- **WHEN** 老師在已有多筆提交後重新整理
- **THEN** 系統回傳所有組別最新有效提交的完整老師快照

### Requirement: 斷線重連後恢復一致狀態
用戶端偵測 socket 重新連線後 MUST 重新取得符合目前 session 權限的權威 HTTP 快照，以該快照完整取代可見活動狀態，並從快照 revision 繼續處理較新的允許事件。恢復範圍 SHALL 包含快照提供的目前活動階段、題目與角色可見的最新提交或結果；系統不重播斷線期間的逐筆事件，也不恢復學生無權查看的資料。若 HTTP snapshot 取得失敗，用戶端 MUST 顯示尚未同步並提供重試，不得將舊畫面視為權威。

#### Scenario: 學生活動中斷線後重連
- **WHEN** 學生斷線期間本組答案被另一 session 修改
- **THEN** 重連後快照顯示本組最新有效答案與時間

#### Scenario: 截止期間斷線
- **WHEN** 用戶端斷線期間老師結束活動
- **THEN** 用戶端重連後由快照取得 `CLOSED` 狀態與其角色可見結果

#### Scenario: 重連快照暫時失敗
- **WHEN** socket 已重新連線但權威 HTTP snapshot 請求失敗
- **THEN** 用戶端標示尚未同步、保持寫入操作停用並允許重試，直到取得最新快照

### Requirement: 即時通道失敗不放寬伺服器規則
Socket.IO 中斷、延遲或單一通知未抵達 MUST 不改變 HTTP API、session 權限、提交有效性或截止判斷。Socket.IO 僅提供狀態變更通知；HTTP 與資料庫為權威。系統 SHALL 在初始連線、重新連線及明確重新整理時讓用戶端透過 HTTP snapshot 取得目前狀態，但不承諾在連線持續存在且沒有重連或重新整理時自動偵測每一個未抵達的通知。

#### Scenario: socket 中斷時提交
- **WHEN** 學生 socket 中斷但仍透過 HTTP 送出提交
- **THEN** 伺服器依活動權威狀態處理提交，並在重連快照中反映結果

#### Scenario: socket 中斷後活動已截止
- **WHEN** 學生未收到截止事件並嘗試提交
- **THEN** 伺服器依 `CLOSED` 狀態拒絕提交，而非依賴前端畫面狀態
