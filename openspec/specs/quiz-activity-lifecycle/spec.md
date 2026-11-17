# quiz-activity-lifecycle Specification

## Purpose

定義單場課堂搶答活動從準備、一次開放全部題目到整場結束的權威狀態流程，確保老師與學生遵循一致且不可歧義的階段規則。

## Requirements

### Requirement: 建立草稿活動
系統 SHALL 在老師確認 Guided Notes 匯入預覽後建立 `DRAFT` 活動，並將已確認的題目與 mapping 關聯到該活動。系統 MUST 不在解析失敗或預覽尚未確認時建立可使用的活動。

#### Scenario: 由確認的匯入建立活動
- **WHEN** 老師確認有效 Guided Notes 的匯入預覽
- **THEN** 系統建立包含實際解析題目的 `DRAFT` 活動

#### Scenario: 尚未確認預覽
- **WHEN** 老師尚未確認、取消或遇到無效匯入
- **THEN** 系統不建立可開始的活動

### Requirement: 活動狀態機
系統 MUST 僅允許 `DRAFT -> OPEN -> CLOSED` 的單向狀態轉換。`CLOSED` 活動 MUST 不得重新開放，匯出紀錄 MUST 不成為新的活動狀態。

#### Scenario: 合法狀態轉換
- **WHEN** 老師依序開始 `DRAFT` 活動並結束 `OPEN` 活動
- **THEN** 系統依序將狀態設為 `OPEN` 與 `CLOSED`，並保存開始與結束時間

#### Scenario: 嘗試跳過或反轉狀態
- **WHEN** 使用者嘗試將 `DRAFT` 直接關閉、將 `OPEN` 改回 `DRAFT` 或重新開啟 `CLOSED` 活動
- **THEN** 系統拒絕轉換，且保留原狀態

### Requirement: 開始活動前置條件
系統 SHALL 僅在 `DRAFT` 活動具有至少一題、至少兩個組別及有效來源 mapping 時允許老師開始活動。若前置條件不足，系統 MUST 顯示所有缺少的條件且不改變狀態。

#### Scenario: 開始已完成設定的活動
- **WHEN** 老師開始具有有效題目、至少兩個組別與有效 mapping 的 `DRAFT` 活動
- **THEN** 系統以單一權威操作將活動轉為 `OPEN`

#### Scenario: 缺少組別或題目
- **WHEN** 老師開始少於兩個組別、缺少題目或缺少有效 mapping 的活動
- **THEN** 系統拒絕開始並指出所有未滿足的前置條件

### Requirement: 一次開放全部題目
活動轉為 `OPEN` 時，系統 SHALL 同時開放該活動的全部題目供所有有效學生 session 選擇作答。系統 MUST 不提供逐題開放、鎖定或依組別限制題目的行為。

#### Scenario: 活動開始後選擇任意題目
- **WHEN** 活動進入 `OPEN`
- **THEN** 每個有效學生 session 可看到所有顯示題號，並可自由選擇任一題提交答案

#### Scenario: 多組選擇相同或不同題目
- **WHEN** 不同組別在活動進行中選擇相同或不同題目
- **THEN** 系統同時接受各題的合法提交，且不因其他組別正在作答而鎖定題目

### Requirement: 老師結束整場活動
系統 SHALL 允許具有有效老師 session 的老師以單一 HTTP 操作結束 `OPEN` 活動。close 交易成功後，HTTP 回應 MUST 包含權威 `CLOSED` 狀態與最新 revision，用戶端 MUST 立即切換至唯讀結果，不得依賴 Socket.IO 通知才完成切換；全部題目 MUST 同時停止接受新增或修改，並保留關閉瞬間的最終有效提交集合。

#### Scenario: 正常結束活動
- **WHEN** 老師確認對 `OPEN` 活動執行結束操作且 close HTTP 成功
- **THEN** 系統將活動設為 `CLOSED`、建立最終結果、停止全部題目提交，且老師畫面立即顯示唯讀結果及匯出功能

#### Scenario: 截止通知未抵達
- **WHEN** close HTTP 已成功但老師端未收到、延遲收到或遺失 Socket.IO 截止事件
- **THEN** 老師畫面仍以 HTTP 權威回應切換為 `CLOSED` 並可讀取最終結果

#### Scenario: 重複結束請求
- **WHEN** 老師重送已成功處理的結束操作
- **THEN** 系統維持相同的 `CLOSED` 狀態與原結束時間，不重複計算出不同結果

#### Scenario: 無效老師 session 執行結束
- **WHEN** close 請求缺少有效老師 session 或使用錯誤角色 session
- **THEN** 系統不改變活動狀態，並回傳 401 或 403 及清楚的繁體中文錯誤

### Requirement: 同時間僅一場開放活動
系統 MUST 在本階段限制同一系統執行個體最多只有一場活動處於 `OPEN`，但 SHALL 允許保留其他 `DRAFT` 或 `CLOSED` 活動。

#### Scenario: 已有開放活動時開始另一場
- **WHEN** 一場活動已為 `OPEN`，老師嘗試開始另一場 `DRAFT` 活動
- **THEN** 系統拒絕第二場開始操作並指出目前開放中的活動

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

### Requirement: 老師介面依活動階段顯示標題
系統 SHALL 依老師目前正在操作的流程或權威活動狀態顯示繁體中文主標題，且狀態改變或恢復活動後 MUST 同步更新標題。

#### Scenario: 尚未建立活動
- **WHEN** 老師尚未建立或選擇可操作的活動
- **THEN** 老師頁面主標題顯示「匯入 Guided Notes」

#### Scenario: 顯示草稿活動
- **WHEN** 老師正在操作 `DRAFT` 活動
- **THEN** 老師頁面主標題顯示「設定搶答活動」

#### Scenario: 顯示進行中活動
- **WHEN** 老師正在操作 `OPEN` 活動
- **THEN** 老師頁面主標題顯示「搶答活動進行中」

#### Scenario: 顯示已結束活動
- **WHEN** 老師正在操作 `CLOSED` 活動
- **THEN** 老師頁面主標題顯示「活動結果與匯出」

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

### Requirement: 雲端整合不阻塞搶答核心
活動確認建立後，系統 MUST 由已保存快照支援開始、提交、排名、Socket.IO 同步、截止及活動恢復，不依賴 Google API。寫回狀態 MUST 獨立於 DRAFT／OPEN／CLOSED；老師首頁與唯一 OPEN 規則 MUST 保持不變。

#### Scenario: 活動建立後 Google 中斷
- **WHEN** 有效活動已建立而 Google API 無法使用
- **THEN** 系統仍可管理組別、開始、提交、拒絕相同答案、截止及恢復；僅雲端讀寫操作顯示失敗

#### Scenario: 寫回失敗
- **WHEN** CLOSED 活動無法完成 Google 寫回
- **THEN** 活動保持 CLOSED，最終結果、順位及提交時間均不改變
