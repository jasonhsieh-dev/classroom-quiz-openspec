# build-classroom-buzzer Change review 驗證紀錄

日期：2026-10-25

本文件保存 Task 10 最終驗收的可重現命令與結果摘要。詳細人工步驟見 `docs/manual-acceptance.md`。

| 檢查 | 指令 | 預期 |
|---|---|---|
| 依賴重現 | `npm ci` | 成功，依 lockfile 安裝 450 packages |
| Lint | `npm run lint` | 90 個檔案，零錯誤、零警告 |
| 單元與整合測試 | `npm test` | 25 個檔案、123 個測試通過 |
| 真實瀏覽器 E2E | `npm run test:e2e` | Chromium 1 個完整 Demo、4 contexts 通過 |
| 型別 | `npm run typecheck` | 3 個 workspace 全部通過 |
| Production build | `npm run build` | shared、server、web 全部通過 |
| Git whitespace | `git diff --check` | 零錯誤 |
| OpenSpec | `openspec validate build-classroom-buzzer --strict` | Change valid |
| 忽略規則 | `git check-ignore` | `var/`、資料庫、上傳、匯出被忽略；程式／規格／fixtures 不被忽略 |

Playwright 流程包含老師匯入及預覽、建立兩組、開始、同題與不同題提交、修改、同組多 session、即時監看、斷線重連、冪等重送、跨活動拒絕、截止防重複、截止後拒絕、角色裁切結果及真實 XLSX 下載。下載檔的動態 mapping、成功答案、無人題目原值與完整活頁簿語意均須通過比較。

安全檢查結果：沒有追蹤 `.env`、資料庫、執行期目錄、真實上傳、匯出檔、憑證或金鑰；版本控制中的 9 個 `.xlsx` 均位於 `tests/fixtures/guided-notes/` 且為合成資料。`var/`、Playwright report 與 test results 均由 `.gitignore` 排除，OpenSpec、程式碼及合成 fixture 未被誤排除。常見私鑰、AWS、GitHub 與 `sk-` token 簽章掃描無結果。

`npm audit` 顯示 ExcelJS 間接相依的舊 `uuid` 有 2 項中度公告；目前建議修復是把 ExcelJS 降到 3.4.0，會背離已驗證的 4.4.0 活頁簿保真策略，因此本 Change 不強制降版。系統不直接呼叫該 `uuid` 的受影響 buffer API，且只定位為受控本機 Demo；後續應持續追蹤 ExcelJS 上游更新。
