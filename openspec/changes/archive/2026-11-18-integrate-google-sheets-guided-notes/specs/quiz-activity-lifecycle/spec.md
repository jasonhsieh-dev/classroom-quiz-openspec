## MODIFIED Requirements

### Requirement: 建立草稿活動
系統 SHALL 在老師確認 Guided Notes 匯入預覽後建立 `DRAFT` 活動，並將已確認的題目與 mapping 關聯到該活動。系統 MUST 不在解析失敗或預覽尚未確認時建立可使用的活動。

#### Scenario: 由確認的匯入建立活動
- **WHEN** 老師確認有效 Guided Notes 的匯入預覽
- **THEN** 系統建立包含實際解析題目的 `DRAFT` 活動

#### Scenario: 尚未確認預覽
- **WHEN** 老師尚未確認、取消或遇到無效匯入
- **THEN** 系統不建立可開始的活動

### Requirement: 提供權威活動快照
系統 SHALL 提供包含活動識別碼、名稱、目前狀態、題號與完整題目清單、角色可見資料及遞增 revision 的權威快照。老師直接進入或重新整理 `/teacher/activities/:activityId` 時，系統 MUST 透過既有老師 Session 初始化流程恢復指定的 DRAFT、OPEN 或 CLOSED 活動；根頁 `/` 不自動恢復活動，DRAFT／CLOSED 可由活動專屬網址恢復。所有用戶端 MUST 以伺服器快照為準，不得以本機畫面推斷活動仍可操作。

#### Scenario: 重新整理活動頁面
- **WHEN** 老師或學生重新整理其目前活動頁面
- **THEN** 系統依對應角色 session 回傳最新權威活動狀態與允許顯示的資料，且不建立重複活動

#### Scenario: 老師重新整理進行中活動
- **WHEN** 老師直接進入或重新整理既有 OPEN 活動的 `/teacher/activities/:activityId`
- **THEN** 系統以權威快照恢復同一活動、組別、題目、提交與 revision，不建立重複活動

#### Scenario: 老師重新進入已結束活動
- **WHEN** 老師直接進入或重新整理既有 CLOSED 活動的 `/teacher/activities/:activityId`
- **THEN** 系統以權威快照恢復該活動並提供相同最終結果與 來源相容的輸出功能：雲端活動提供寫回預覽與狀態，舊 XLSX 活動保留歷史輸出

#### Scenario: 老師恢復草稿活動
- **WHEN** 老師直接進入或重新整理既有 DRAFT 活動的 `/teacher/activities/:activityId`
- **THEN** 系統恢復已確認的題目、mapping 與目前組別設定，且不再次匯入或建立活動

#### Scenario: 指定活動無法恢復
- **WHEN** 指定活動不存在或權威快照讀取失敗
- **THEN** 系統顯示明確錯誤及「返回匯入首頁」操作，不建立替代活動；返回 `/` 後依有無 OPEN 顯示匯入首頁，不自動恢復其他活動

#### Scenario: 學生重新整理活動頁面
- **WHEN** 具有有效學生 session 的學生重新整理頁面
- **THEN** 系統回傳符合該 session 組別權限的最新活動狀態與資料

#### Scenario: 學生畫面尚未收到截止事件
- **WHEN** 活動已在伺服器成為 CLOSED，但學生畫面仍顯示可編輯狀態
- **THEN** 伺服器仍拒絕學生提交，且下一次快照使畫面切換為唯讀

## ADDED Requirements

### Requirement: 雲端整合不阻塞搶答核心
活動確認建立後，系統 MUST 由已保存快照支援開始、提交、排名、Socket.IO 同步、截止及活動恢復，不依賴 Google API。寫回狀態 MUST 獨立於 DRAFT／OPEN／CLOSED；老師首頁與唯一 OPEN 規則 MUST 保持不變。

#### Scenario: 活動建立後 Google 中斷
- **WHEN** 有效活動已建立而 Google API 無法使用
- **THEN** 系統仍可管理組別、開始、提交、拒絕相同答案、截止及恢復；僅雲端讀寫操作顯示失敗

#### Scenario: 寫回失敗
- **WHEN** CLOSED 活動無法完成 Google 寫回
- **THEN** 活動保持 CLOSED，最終結果、順位及提交時間均不改變
