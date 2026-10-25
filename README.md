# 課堂搶答系統

這是軟體工程期末專題的本機 Demo。老師匯入由 Google Sheets 下載的 Guided Notes `.xlsx`，建立組別並一次開放全部題目；學生選組後可自由選題、提交及修改。活動截止後，系統依各組每題最後有效提交的伺服器接收序號排名，並把第一名答案回填至原學習單副本。

## 環境需求

- Node.js 22 以上（驗證版本：24.22.0）
- npm 10 以上（驗證版本：11.19.1）
- Windows、macOS 或 Linux 的本機環境
- Chromium（執行 Playwright 驗收時由 Playwright 安裝）

不需要 Google API、雲端資料庫或公開部署帳號。

## 安裝

```bash
npm ci
npx playwright install chromium
```

`npm ci` 依 `package-lock.json` 重現依賴。測試 XLSX 位於 `tests/fixtures/`，全部是合成資料。

## 環境設定與資料庫

所有設定皆有本機預設值；可複製 `.env.example` 的值至啟動 shell，但程式不會自動載入 `.env`。

| 變數 | 預設值 | 用途 |
|---|---|---|
| `CLASSROOM_BUZZER_DATA_DIR` | `var/data` | SQLite 資料目錄 |
| `CLASSROOM_BUZZER_UPLOAD_DIR` | `var/uploads` | 保存匯入來源副本 |
| `CLASSROOM_BUZZER_EXPORT_DIR` | `var/exports` | 保存匯出檔 |
| `CLASSROOM_BUZZER_PORT` | `3000` | API 與 Socket.IO 連接埠 |

伺服器啟動時會建立目錄、開啟 SQLite、依序執行尚未套用的版本化 migration，無須手動建立資料庫。空白目錄設定、無法建立目錄或不合法連接埠會使啟動失敗並顯示繁體中文錯誤，不會繼續使用不明狀態。

## 開發與展示啟動

```bash
npm run dev
```

- 老師端：<http://127.0.0.1:5173/>
- 學生端：<http://127.0.0.1:5173/student>
- 健康檢查：<http://127.0.0.1:3000/api/health>

健康檢查應回傳 `{"status":"ok","service":"classroom-buzzer-server"}`。按 `Ctrl+C` 停止前後端。執行期資料都在 Git 忽略的 `var/`；要重新展示可先停止服務，再自行備份並移除所需的 `var/` 子目錄。

## Demo 流程

1. 老師上傳 `.xlsx`，檢查動態解析預覽後確認建立活動。
2. 老師建立至少兩組並開始搶答，將畫面顯示的活動識別碼提供給學生。
3. 使用兩個隔離瀏覽器 context 或無痕視窗開啟學生端，輸入活動識別碼並分別選組。
4. 兩組選題、提交、修改；老師即時監看，學生只能看到本組狀態。
5. 老師結束活動；所有畫面切換為唯讀結果。
6. 老師下載回填後的 Guided Notes，新檔不會覆蓋來源檔。

完整逐步通過條件請見 [人工驗收清單](docs/manual-acceptance.md)。

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
openspec validate build-classroom-buzzer --strict
```

Playwright 使用 `var/e2e/` 隔離資料庫、上傳與匯出檔，啟動時會清除此專用目錄，不接觸日常 Demo 資料。

## 建置與部署限制

`npm run build` 產生前端與後端建置檔；`npm start` 僅啟動建置後的 API／Socket.IO 伺服器，沒有代管前端靜態檔。期末展示請使用 `npm run dev` 的本機雙程序流程。

本階段只支援單一後端 Node.js 執行個體、單一 SQLite writer 與本機 loopback 存取。不支援多程序／水平擴充、Redis、雲端資料庫、公開網路部署或多主機 Socket.IO。不得直接把目前服務暴露到區域網路或 Internet。

## 無 PIN Demo 的安全邊界

- 老師身分由只接受 loopback 的伺服器入口建立，學生 session 不能呼叫老師 API。
- Session Cookie 是 `HttpOnly`、`SameSite=Lax`；HTTPS 時使用 `Secure`。
- 本系統沒有 PIN、帳號或真實身分驗證，因此無法確認操作者真實身分。
- 能操作本機電腦的人可以另開 session 進入本機老師入口，也可以另開學生 session 冒選其他組別。
- 這些限制適合受控課堂 Demo，不適合公開部署。公開使用前必須新增正式登入、來源允許清單、HTTPS 與完整 CSRF 防護。

更完整的威脅模型見 [本機 Demo 身分與安全邊界](docs/security-model.md)。請勿把 `.env`、Cookie、SQLite、真實課堂上傳、匯出檔、憑證或金鑰提交到 Git。
