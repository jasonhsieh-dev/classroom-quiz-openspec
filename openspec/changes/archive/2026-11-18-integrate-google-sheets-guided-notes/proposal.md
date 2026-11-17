# Proposal

## Why

助教要求 Guided Notes 直接讀寫雲端 Google Sheets；現行 XLSX 離線流程不符合新要求。保留既有搶答核心，替換來源與結果輸出邊界。

## What Changes

- **BREAKING**：新活動改以 Google Sheets 網址、單一分頁選擇及雲端預覽建立，不再提供 XLSX 上傳／下載正式流程。
- 使用 Sheets API v4 與後端 Service Account；保留動態定位、題目快照及既有排名。
- 新增版本化資料遷移、雲端來源與可靠寫回紀錄，保留歷史活動及 XLSX。
- CLOSED 後明確預覽並批次寫回原文件，處理衝突、重複操作、逾時核對與錯誤。

## Capabilities

### New Capabilities

無；整合行為由既有 Guided Notes 能力承接。

### Modified Capabilities

- `guided-notes-workbooks`：雲端授權、讀取、定位、來源保存及安全寫回。
- `quiz-activity-lifecycle`：雲端快照建立與來源相容恢復。
- `quiz-results`：結果頁雲端寫回與排名獨立性。
- `local-demo-verification`：Google 設定、模擬自動測試與真實雲端驗收。

## Impact

影響 guided-notes 模組、來源 repositories、新 migration、共用 contracts、老師 App、相關測試及 README／人工驗收。新增 Google API 用戶端依賴及網際網路需求；學生提交不呼叫 Google。classroom-access、answer-submission-ranking、realtime-activity-sync 規則不變並回歸；不實作 OAuth 登入、多分頁題目聚合、Drive 複製、題組管理或 CSV，不修改封存歷史。
