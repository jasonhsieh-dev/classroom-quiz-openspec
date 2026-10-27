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
系統 SHALL 提供包含活動識別碼、名稱、目前狀態、題號與完整題目清單、角色可見資料及遞增 revision 的權威快照。老師重新整理或重新進入時，系統 MUST 能識別並恢復目前 `OPEN` 活動，並允許老師選擇既有 `DRAFT` 或 `CLOSED` 活動；所有用戶端 MUST 以伺服器快照為準，不得以本機畫面推斷活動仍可操作。

#### Scenario: 重新整理活動頁面
- **WHEN** 老師或學生重新整理其目前活動頁面
- **THEN** 系統依對應角色 session 回傳最新權威活動狀態與允許顯示的資料，且不建立重複活動

#### Scenario: 老師重新整理進行中活動
- **WHEN** 系統已有唯一 `OPEN` 活動且老師重新整理老師頁面
- **THEN** 系統以權威快照恢復同一活動、組別、題目、提交與 revision，不建立重複活動

#### Scenario: 老師重新進入已結束活動
- **WHEN** 老師選擇或直接進入既有 `CLOSED` 活動
- **THEN** 系統以權威快照恢復該活動並提供相同最終結果與 XLSX 匯出功能

#### Scenario: 老師恢復草稿活動
- **WHEN** 老師選擇既有 `DRAFT` 活動
- **THEN** 系統恢復已確認的題目、mapping 與目前組別設定，且不再次匯入或建立活動

#### Scenario: 學生重新整理活動頁面
- **WHEN** 具有有效學生 session 的學生重新整理頁面
- **THEN** 系統回傳符合該 session 組別權限的最新活動狀態與資料

#### Scenario: 學生畫面尚未收到截止事件
- **WHEN** 活動已在伺服器成為 `CLOSED`，但學生畫面仍顯示可編輯狀態
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
