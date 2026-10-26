# Spec Delta

## ADDED Requirements

### Requirement: 老師與學生使用獨立 session cookie
系統 MUST 以名稱不同的 HttpOnly cookie 分別保存老師與學生 session，且老師端點 MUST 只接受有效老師 session、學生端點 MUST 只接受有效學生 session。建立或更新其中一種角色 session 時，系統 MUST 不覆蓋、刪除或改變另一種角色的 session cookie。

#### Scenario: 同一瀏覽器建立兩種角色 session
- **WHEN** 使用者在同一瀏覽器 profile 先建立老師 session，再從學生端選組建立學生 session
- **THEN** 瀏覽器同時保有兩種角色的獨立 HttpOnly cookie，老師與學生端點分別使用正確角色 session

#### Scenario: 學生選組後老師執行操作
- **WHEN** 同一瀏覽器 profile 的學生完成選組後，老師對其目前活動執行受保護操作
- **THEN** 系統仍以老師 session 授權該操作，不因學生 cookie 建立而回覆角色不符

#### Scenario: 錯誤角色或失效 session
- **WHEN** 老師或學生請求缺少對應角色 cookie、cookie 無效、過期或角色不符
- **THEN** 系統以 401 或 403 拒絕請求，並回傳可供介面顯示的繁體中文錯誤 code 與 message

#### Scenario: Cookie 不可由用戶端腳本讀取
- **WHEN** 伺服器建立老師或學生 session cookie
- **THEN** cookie 設為 HttpOnly 並維持既有 SameSite、本機存取與安全邊界

## MODIFIED Requirements

### Requirement: 老師建立活動組別
系統 SHALL 允許老師在 `DRAFT` 活動輸入 1 至 100 的整數組別數量，並在單一資料庫交易中建立完整組別清單，名稱依序為「第 1 組」至「第 N 組」。活動進入 `OPEN` 或 `CLOSED` 後，系統 MUST 拒絕變更組別清單；若變更會刪除或改變已有學生 session 綁定的組別，系統亦 MUST 拒絕且保留原清單。

#### Scenario: 依數量建立多個組別
- **WHEN** 老師在沒有組別的 `DRAFT` 活動輸入數量 6
- **THEN** 系統以單一交易建立名稱為「第 1 組」至「第 6 組」的六個唯一組別，並顯示完整清單

#### Scenario: 老師建立多個組別
- **WHEN** 老師在 `DRAFT` 活動提交合法的組別數量
- **THEN** 系統保存依數量產生的多個唯一組別，並在活動開始前的設定畫面顯示完整清單

#### Scenario: 建立重複或空白組別
- **WHEN** 批次建立結果包含空白名稱或與同活動既有組別正規化後相同的名稱
- **THEN** 系統拒絕整批操作並回傳可辨識的驗證錯誤，且組別清單維持不變

#### Scenario: 組別數量超出範圍
- **WHEN** 老師輸入非整數、小於 1 或大於 100 的組別數量
- **THEN** 系統拒絕操作、顯示可辨識的驗證錯誤，且組別清單維持不變

#### Scenario: 批次建立中任一步驟失敗
- **WHEN** 建立自動命名組別的交易發生驗證、唯一限制或資料庫錯誤
- **THEN** 系統回滾整批操作，不留下部分建立的組別

#### Scenario: 重設尚未被學生選擇的草稿組別
- **WHEN** 老師在 `DRAFT` 活動重新輸入組別數量，且該活動沒有任何學生 session 綁定既有組別
- **THEN** 系統以單一交易將組別清單調整為新的完整自動命名清單

#### Scenario: 已有學生 session 時重設組別
- **WHEN** 老師嘗試以新的組別數量重設 `DRAFT` 活動，但已有學生 session 綁定其中任一組別
- **THEN** 系統拒絕整次變更，且所有組別與 session 綁定保持不變

#### Scenario: 活動開始後修改組別
- **WHEN** 老師嘗試在 `OPEN` 或 `CLOSED` 活動建立或重設組別
- **THEN** 系統拒絕操作，且不修改任何組別、session 或既有提交資料
