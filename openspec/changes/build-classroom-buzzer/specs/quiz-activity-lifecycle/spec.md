# Spec Delta

## Purpose

定義單場課堂搶答活動從準備、一次開放全部題目到整場結束的權威狀態流程，確保老師與學生遵循一致且不可歧義的階段規則。

## ADDED Requirements

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
系統 SHALL 僅在 `DRAFT` 活動具有至少一題、至少一個組別及有效來源 mapping 時允許老師開始活動。若前置條件不足，系統 MUST 顯示缺少的條件且不改變狀態。

#### Scenario: 開始已完成設定的活動
- **WHEN** 老師開始具有有效題目、組別與 mapping 的 `DRAFT` 活動
- **THEN** 系統以單一權威操作將活動轉為 `OPEN`

#### Scenario: 缺少組別或題目
- **WHEN** 老師開始缺少組別、題目或有效 mapping 的活動
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
系統 SHALL 允許老師以單一操作結束 `OPEN` 活動。狀態成功轉為 `CLOSED` 後，全部題目 MUST 同時停止接受新增或修改，並保留關閉瞬間的最終有效提交集合。

#### Scenario: 正常結束活動
- **WHEN** 老師對 `OPEN` 活動執行結束操作
- **THEN** 系統將活動設為 `CLOSED`，停止全部題目提交並提供最終結果

#### Scenario: 重複結束請求
- **WHEN** 老師重送已成功處理的結束操作
- **THEN** 系統維持相同的 `CLOSED` 狀態與原結束時間，不重複計算出不同結果

### Requirement: 同時間僅一場開放活動
系統 MUST 在本階段限制同一系統執行個體最多只有一場活動處於 `OPEN`，但 SHALL 允許保留其他 `DRAFT` 或 `CLOSED` 活動。

#### Scenario: 已有開放活動時開始另一場
- **WHEN** 一場活動已為 `OPEN`，老師嘗試開始另一場 `DRAFT` 活動
- **THEN** 系統拒絕第二場開始操作並指出目前開放中的活動

### Requirement: 提供權威活動快照
系統 SHALL 提供包含活動識別碼、目前狀態、題號清單、角色可見資料及遞增 revision 的權威快照。所有用戶端 MUST 以伺服器快照為準，不得以本機畫面推斷活動仍可操作。

#### Scenario: 重新整理活動頁面
- **WHEN** 老師或學生重新整理頁面
- **THEN** 系統回傳符合其角色權限的最新活動狀態與資料

#### Scenario: 學生畫面尚未收到截止事件
- **WHEN** 活動已在伺服器成為 `CLOSED`，但學生畫面仍顯示可編輯狀態
- **THEN** 伺服器仍拒絕學生提交，且下一次快照使畫面切換為唯讀
