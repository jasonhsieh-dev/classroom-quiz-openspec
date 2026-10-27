# classroom-access Specification

## Purpose

定義課堂搶答中老師、學生與組別的存取邊界，確保學生 session 綁定單一組別，且所有資料可見性由伺服器依角色強制執行。

## Requirements

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

### Requirement: 學生選組並建立 session
系統 SHALL 允許學生從活動的現有組別中選擇一組，並由伺服器建立綁定該活動與組別的 session。後續學生請求中的組別身分 MUST 取自 session，而非信任用戶端提供的組別識別碼。

#### Scenario: 學生選擇有效組別
- **WHEN** 學生選擇屬於目標活動的現有組別
- **THEN** 伺服器建立 session，並讓學生以該組別身分讀取與提交資料

#### Scenario: 學生選擇不存在的組別
- **WHEN** 學生提交不存在或不屬於該活動的組別識別碼
- **THEN** 系統拒絕建立 session，且不建立任何學生身分狀態

#### Scenario: 多個 session 選擇同一組
- **WHEN** 多個學生瀏覽器 session 選擇同一組別
- **THEN** 系統將它們視為同一邏輯組別，且任一 session 的有效提交都更新該組該題的目前有效提交

### Requirement: 學生 session 權限隔離
系統 MUST 在伺服器端限制學生只能存取 session 所綁定組別的非公開資料。學生提供不同 `groupId`、修改 URL 或竄改 request body 時，系統 MUST 忽略或拒絕該組別指定。

#### Scenario: 學生讀取自己組別資料
- **WHEN** 具有有效 session 的學生查詢活動中的作答狀況
- **THEN** 系統只回傳該 session 綁定組別的答案、提交狀態及允許顯示的時間資料

#### Scenario: 學生嘗試讀取其他組資料
- **WHEN** 學生在請求中指定其他組別或直接存取其他組別資源
- **THEN** 系統回傳禁止存取或不包含目標資料的結果，且不得洩漏該組是否已提交、答案或順位

#### Scenario: 無效或缺少 session
- **WHEN** 學生存取需要組別身分的端點但 session 缺少、過期或不屬於該活動
- **THEN** 系統拒絕請求，且不回傳任何組別私有資料

### Requirement: 老師檢視權限
系統 SHALL 允許老師檢視活動內所有題目、組別、答案、最後有效提交時間及活動結束後的完整順位。老師權限 MUST 與學生 session 的資料範圍分離。

#### Scenario: 老師在活動進行中查看提交
- **WHEN** 老師查看 `OPEN` 活動的即時狀況
- **THEN** 系統回傳各題已提交組別、各組最後有效答案及最後有效提交時間

#### Scenario: 學生呼叫老師端點
- **WHEN** 學生 session 嘗試呼叫老師專用端點或訂閱老師事件
- **THEN** 系統拒絕請求或訂閱，且不回傳老師可見的完整資料

### Requirement: Demo 身分邊界
系統 MUST 在本階段支援無 PIN、無完整帳號登入的本機課堂 Demo，並 SHALL 以伺服器 session 授權作為既有 session 的資料隔離機制。系統 SHALL 在 README 明示此模式不能驗證選組者的真實身分，不能防止使用者另開新 session 選擇其他組別或進入未受保護的本機老師入口。

#### Scenario: 無憑證完成選組
- **WHEN** 使用者未提供 PIN、帳號或密碼而選擇活動中的有效組別
- **THEN** 伺服器建立綁定該組別的學生 session，後續受保護請求只依該 session 授權

#### Scenario: 學生重新進入並重新選組
- **WHEN** 使用者在另一個隔離瀏覽器 context 建立新 session 並選擇不同組別
- **THEN** 新 session 綁定新選擇，而原 session 仍綁定原組別，兩者的受保護資料回應分別依各自綁定組別裁切
