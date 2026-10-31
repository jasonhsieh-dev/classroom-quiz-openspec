# Spec Delta

## ADDED Requirements

### Requirement: 老師首頁以匯入為預設入口
老師進入或重新整理 `/` 時，系統 SHALL 顯示「匯入 Guided Notes」主標題，並於既有老師 Session 初始化成功後提供匯入操作。首頁 MUST 不自動導向或恢復任何活動，也不得顯示 DRAFT／CLOSED 歷史活動清單。存在 OPEN 時，首頁 SHALL 僅額外顯示簡短提示及「返回進行中活動」連結；沒有 OPEN 時不顯示該提示與連結。此導覽 MUST 不刪除歷史資料、不自動結束活動，也不改變同時僅一場 OPEN 的限制。

#### Scenario: 沒有進行中活動
- **WHEN** 老師進入或重新整理 `/`，Session 初始化成功，活動摘要確認沒有 OPEN，即使存在 DRAFT／CLOSED 歷史資料
- **THEN** 首頁顯示匯入標題與匯入操作，URL 保持 `/`，不顯示歷史清單、進行中提示或返回進行中活動連結，歷史資料保持不變

#### Scenario: 存在進行中活動
- **WHEN** 老師進入或重新整理 `/`，Session 初始化成功，活動摘要包含唯一 OPEN
- **THEN** 首頁保持匯入標題、匯入操作與 `/` URL，額外顯示簡短提示及指向該活動 `/teacher/activities/:activityId` 的「返回進行中活動」連結，不載入其快照、不顯示歷史清單，也不結束活動

#### Scenario: 明確返回進行中活動
- **WHEN** 老師點擊首頁的「返回進行中活動」連結
- **THEN** 系統進入該活動專屬網址，透過既有老師 Session 流程與權威快照恢復當下狀態，不建立或重新開放活動

#### Scenario: 老師 Session 初始化失敗
- **WHEN** 老師進入 `/`，但既有 Session 初始化失敗
- **THEN** 系統保留錯誤與重試操作，不提供匯入操作；重試成功並取得活動摘要後依有無 OPEN 顯示首頁

#### Scenario: 活動摘要讀取失敗
- **WHEN** 首頁活動摘要請求失敗或回傳無效格式
- **THEN** 系統顯示明確錯誤與重試入口，不將失敗視為沒有 OPEN、不顯示未確認的活動連結，也不自動導向活動

## MODIFIED Requirements

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
- **THEN** 系統以權威快照恢復該活動並提供相同最終結果與 XLSX 匯出功能

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
