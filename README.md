# 課堂搶答系統

這是軟體工程期末專題的本機 Demo。老師透過 Google Sheets 網址選擇分頁、確認 Guided Notes 預覽並建立組別；學生選組後可自由選題、提交及修改。活動截止後，系統依各組每題最後有效提交的伺服器接收序號排名。

系統依「題號」、「題目」與「作答」表頭動態辨識題目文字及答案位置，並保存快照。新活動直接讀取 Google Sheets；CLOSED 後可預覽並明確確認雲端答案寫回，詳見 [寫回與復原](docs/google-sheets-writeback.md)。歷史 XLSX 活動與檔案保留，可由活動網址查看及使用原有歷史輸出。

## 環境需求

- Node.js 22 以上（驗證版本：24.22.0）
- npm 10 以上（驗證版本：11.19.1）
- Windows、macOS 或 Linux 的本機環境
- Chromium（執行 Playwright 驗收時由 Playwright 安裝）

雲端匯入需要網路、Google Sheets API 及後端 Service Account 設定；不需要雲端資料庫或公開部署。活動建立後搶答不依賴 Google API。

## 安裝

```bash
npm ci
npx playwright install chromium
```

`npm ci` 依 `package-lock.json` 重現依賴。測試 XLSX 位於 `tests/fixtures/`，全部是合成資料。

### Windows PowerShell

若 PowerShell 因 Execution Policy 阻擋 `npm.ps1`，不需要也不建議為本專案修改系統安全設定；請直接使用 Windows 的命令包裝檔：

```powershell
npm.cmd ci
npx.cmd playwright install chromium
```

安裝完成後，依下方「開發與展示啟動」設定憑證並啟動。其他 npm 指令也可用相同方式將 `npm` 改為 `npm.cmd`。

## 環境設定與資料庫

下表執行期設定皆有本機預設值；Google 雲端匯入另需後端憑證設定；可複製 `.env.example` 的值至啟動 shell，但程式不會自動載入 `.env`。

| 變數 | 預設值 | 用途 |
|---|---|---|
| `CLASSROOM_BUZZER_DATA_DIR` | `var/data` | SQLite 資料目錄 |
| `CLASSROOM_BUZZER_UPLOAD_DIR` | `var/uploads` | 保存匯入來源副本 |
| `CLASSROOM_BUZZER_EXPORT_DIR` | `var/exports` | 保存匯出檔 |
| `CLASSROOM_BUZZER_PORT` | `3000` | API 與 Socket.IO 連接埠 |

伺服器啟動時會建立目錄、開啟 SQLite、依序執行尚未套用的版本化 migration，無須手動建立資料庫。空白目錄設定、無法建立目錄或不合法連接埠會使啟動失敗並顯示繁體中文錯誤，不會繼續使用不明狀態。

## 開發與展示啟動

先完成下方「Google Sheets 後端授權設定」，將原生 Google Sheets 分享給 Service Account 並授予編輯權。Windows Demo 請在專案根目錄的同一個 PowerShell 設定並啟動；下列 JSON 路徑僅為安全示例，須改成你保存在專案外的實際路徑：

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\private\credentials\service-account.json'
$env:CLASSROOM_BUZZER_SINGLE_UPDATE = 'true'

Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS

npm.cmd run dev
```

`Test-Path` 應回傳 `True`；若為 `False`，請先修正路徑再啟動。`True` 只代表檔案存在，Google 存取仍取決於有效憑證、API 啟用與文件分享權限。此 Demo 設定啟用單次更新模式；未設定該變數時，程式仍沿用一般模式。

不需在網站輸入私鑰，也不需每次重新下載 JSON。`$env:` 設定只對目前 PowerShell 與其啟動的程序有效；同一視窗停止後重啟可沿用，關閉後另開視窗則須重新設定，或事先設定 Windows 使用者環境變數並重開終端機。環境變數保存的是 JSON 檔案路徑，不是私鑰內容；專案目前不自動載入 `.env`。若後端已在執行，須先停止，再於設定完成後重新啟動，才能套用設定。

其他平台請先在啟動 shell 設定相同環境變數，再執行 `npm run dev`。

- 老師端：<http://localhost:5173/>
- 學生端：<http://localhost:5173/student>
- 健康檢查：<http://127.0.0.1:3000/api/health>

Vite 開發伺服器預設會在終端顯示 `localhost:5173`，日常操作請以該終端實際顯示的 Local URL 為準；Express／Socket.IO 後端則只監聽 `127.0.0.1:3000`。自動化端對端測試已驗證的瀏覽器網址是 <http://127.0.0.1:4173/>，但該網址只會在 `npm run test:e2e` 執行期間由 Playwright 專用伺服器提供，不是一般 Demo 的啟動網址。

健康檢查應回傳 `{"status":"ok","service":"classroom-buzzer-server"}`。按 `Ctrl+C` 停止前後端。執行期資料都在 Git 忽略的 `var/`；要重新展示可先停止服務，再自行備份並移除所需的 `var/` 子目錄。

## Demo 流程

1. 老師貼上 Google Sheets 網址、按「讀取分頁」、選擇單一分頁並預覽，確認題目及答案位置後建立活動。
2. 老師建立至少兩組並開始搶答，將畫面顯示的活動識別碼提供給學生。
3. 同一個瀏覽器 profile 可同時開啟老師端與一個學生端；若要模擬不同學生身分，再使用隔離 browser context 或無痕視窗，輸入活動識別碼並分別選組。
4. 兩組選題、提交、修改；老師即時監看，學生只能看到本組狀態。
5. 老師結束活動；所有畫面切換為唯讀結果。
6. 雲端活動在 CLOSED 結果頁預覽並確認「寫回 Google Sheets」；只有歷史 XLSX 活動保留原有副本下載。

完整逐步通過條件請見 [人工驗收清單](docs/manual-acceptance.md)。

### 老師活動恢復

老師活動頁使用 `/teacher/activities/:activityId` URL，重新整理後會先建立老師 session，再從後端權威 snapshot 恢復同一活動，不依賴先前的 React 頁面狀態。`DRAFT` 會恢復題目與組別設定，`OPEN` 會恢復目前提交與結束活動操作，`CLOSED` 會恢復最終結果；歷史 XLSX 活動可再次下載，雲端活動不提供 XLSX 備援。

老師根頁 `/` 固定顯示「匯入 Guided Notes」，老師 session 初始化成功且活動摘要載入後提供匯入操作，不自動恢復活動，也不顯示 `DRAFT/CLOSED` 歷史清單。有 `OPEN` 時僅額外顯示簡短提示與「返回進行中活動」連結，點擊才進入對應的 `/teacher/activities/:activityId`；沒有 `OPEN` 時不顯示該提示與連結。請保存活動專屬網址，以便再次恢復草稿或查看已結束活動。SQLite 歷史資料仍保留，系統不自動結束活動；開始另一場前須自行返回並結束原本的 `OPEN` 活動。Session 初始化失敗仍可重試；活動摘要失敗或格式無效會顯示錯誤與返回匯入首頁的重試入口。直接 URL 指向不存在的活動或 snapshot 無法載入時會顯示錯誤與「返回匯入首頁」操作，不會重新確認匯入或建立重複活動。

## 測試與檢查

完整核心自動化測試的單一入口：

```bash
npm run test:all
```

此指令依序執行 Vitest 單元／API／Socket／資料庫測試，以及真實 Chromium Playwright 端對端測試。任一測試失敗都會回傳非零狀態。各層也可獨立執行：

```bash
npm run lint
npm test
npm run test:e2e
npm run typecheck
npm run build
openspec validate --specs --strict
```

原 `build-classroom-buzzer` Change 已封存於 `openspec/changes/archive/2026-10-26-build-classroom-buzzer/`；目前應驗證已同步至 `openspec/specs/` 的主規格，因此不再使用針對 active Change 的舊驗證指令。

Playwright 使用 `var/e2e/` 隔離資料庫、上傳與匯出檔，啟動時會清除此專用目錄，不接觸日常 Demo 資料。

## 建置與部署限制

`npm run build` 產生前端與後端建置檔；`npm start` 僅啟動建置後的 API／Socket.IO 伺服器，沒有代管前端靜態檔。期末展示請使用 `npm run dev` 的本機雙程序流程。

本階段只支援單一後端 Node.js 執行個體、單一 SQLite writer 與本機 loopback 存取。不支援多程序／水平擴充、Redis、雲端資料庫、公開網路部署或多主機 Socket.IO。不得直接把目前服務暴露到區域網路或 Internet。

## 無 PIN Demo 的安全邊界

- 老師身分由只接受 loopback 的伺服器入口建立，學生 session 不能呼叫老師 API。
- 老師與學生分別使用 `classroom_buzzer_teacher_session` 與 `classroom_buzzer_student_session`，兩顆 Cookie 可在同一瀏覽器 profile 共存，不會因學生選組而覆蓋老師 session。
- 兩顆 Session Cookie 都是 `HttpOnly`、`SameSite=Lax`、`Path=/`；HTTPS 時使用 `Secure`。
- HTTP API 只解析符合端點角色的 Cookie；Socket.IO 的連線用途只負責選擇 Cookie，實際角色、到期、活動及組別範圍仍由伺服器驗證。
- 本系統沒有 PIN、帳號或真實身分驗證，因此無法確認操作者真實身分。
- 能操作本機電腦的人可以另開 session 進入本機老師入口，也可以另開學生 session 冒選其他組別。
- 這些限制適合受控課堂 Demo，不適合公開部署。公開使用前必須新增正式登入、來源允許清單、HTTPS 與完整 CSRF 防護。

更完整的威脅模型見 [本機 Demo 身分與安全邊界](docs/security-model.md)。請勿把 `.env`、Cookie、SQLite、真實課堂上傳、匯出檔、憑證或金鑰提交到 Git。


## Google Sheets 後端授權設定

目前已接上老師端 Google Sheets 網址、分頁選擇及預覽／確認／取消 API；CLOSED 雲端活動已提供寫回預覽、明確確認及不明結果核對。新活動僅接受 Google Sheets，XLSX 僅保留歷史相容。後端匯入契約見 [Google Sheets 匯入契約](docs/google-sheets-import-contract.md)。自動測試使用合成輸入及 mock，不代表真實 Google 連線已驗證。

1. 在 Google Cloud Console 建立或選擇展示專案，至「APIs & Services → Library」尋找 Google Sheets API 並啟用（sheets.googleapis.com）。本流程不需 Drive API、API Key 或使用者 OAuth 同意畫面。
2. 至「IAM & Admin → Service Accounts → Create service account」建立帳號，記下其電子郵件。指定文件分享模式不需授予 Project Owner／Editor 或網域全權委派。
3. 進入該服務帳號「Keys → Add key → Create new key → JSON」，依組織政策建立 JSON 金鑰，存放於專案外的私人目錄；限制檔案權限僅目前使用者可讀。不將 JSON、私鑰或 Token 貼到程式、文件、Git 或日誌。
4. 將展示用 Google Sheets 分享給服務帳號的電子郵件，授予編輯權；不需公開文件。若學校政策禁止此分享，先處理政策限制，不改用假連線。
5. 在啟動後端的同一個 PowerShell 設定絕對路徑（下列僅為佔位路徑）：

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\private\credentials\service-account.json'
$env:CLASSROOM_BUZZER_SINGLE_UPDATE = 'true'

Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS

npm.cmd run dev
```

目前不自動載入 `.env`；勿使用 `VITE_` 變數傳遞憑證。未設定或無效設定只影響雲端整合，不阻止既有本機活動。授權限定 Sheets scope，Token 由官方後端授權函式庫在記憶體管理；不持久保存 Token。更換金鑰後重啟後端；外洩時立即在 Cloud Console 撤銷金鑰。

403 請檢查文件分享、API 啟用與保護範圍；404 可能是文件不存在或無權存取；429 為配額限制；連線／逾時不能當成寫入未發生。Phase 1 transport 禁止自動重試及轉址，後續寫回流程必須先核對不明結果。

新 migration `005_google_sheets_sources.sql` 由正常初始化套用。正式資料升級前停止服務並備份 SQLite 及 `var/`；本階段測試僅遷移隔離測試資料庫。保留舊來源、匯出檔、提交與結果；雲端來源不使用假路徑。回復需保留新資料副本，並還原成對的程式與資料庫備份。

參考：[Google 憑證設定](https://developers.google.com/workspace/guides/create-credentials)、[官方 Node 授權函式庫](https://github.com/googleapis/google-auth-library-nodejs)。


## Google Sheets 驗收與 Demo

目前 [自動驗證紀錄](docs/google-sheets-verification-2026-11-18.md) 僅代表受控 Mock 與本機核心回歸；真實 Google 讀寫已通過，另有 [真實寫回與人工回報](docs/google-sheets-native-writeback-2026-11-18.md)；完整性限制詳見該紀錄。正式測試前請明確指定可寫的合成文件與授權範圍，勿將私鑰貼到聊天或文件。

- [目前人工驗收清單](docs/manual-acceptance.md)：雲端流程在最前，歷史 XLSX 紀錄另外標示。
- [真實驗收證據模板](docs/google-sheets-evidence-template.md)：包含原始模板及最新實測／人工回報，請以最上方結論為準。
- [五分鐘 Demo](docs/google-sheets-demo.md)：設定完成後的建議展示順序，尚非實測耗時。

Sheets scope 為 `https://www.googleapis.com/auth/spreadsheets`，權限不能縮至單一分頁；請僅分享必要的展示文件給服務帳號。應用程式仍限制只寫綁定分頁 anchor。參考 [Google scopes](https://developers.google.com/workspace/sheets/api/scopes)。若組織禁止建立金鑰或外部分享，先由管理者確認政策，不以公開文件或假成功繞過。

真實單次寫回驗收前，可在後端 PowerShell 設定 `$env:CLASSROOM_BUZZER_SINGLE_UPDATE = 'true'` 並重啟；詳見 [單次模式](docs/google-sheets-writeback.md)。本次程式修正沒有執行真實寫入。

最終驗收已包含使用者回報的可見畫面檢查；未取得可保存的截圖檔，不宣稱存有圖片。最終回歸見 [交付檢查](docs/google-sheets-final-checks-2026-11-18.md)。
