# Proposal

## Why

老師根頁目前會自動恢復唯一 OPEN 活動，或顯示 DRAFT／CLOSED 歷史清單，讓新一輪匯入的入口不固定。本輪僅簡化首頁導覽，同時保留進行中活動的明確返回入口及活動專屬網址恢復能力。

## What Changes

- `/` 預設顯示「匯入 Guided Notes」與既有匯入操作，不自動導向或恢復活動，也不顯示 DRAFT／CLOSED 清單。
- 有 OPEN 時，僅額外顯示簡短提示及「返回進行中活動」連結；沒有 OPEN 時不顯示該提示或連結。
- 保留老師 Session 初始化、失敗重試，以及 `/teacher/activities/:activityId` 的 DRAFT／OPEN／CLOSED 權威快照恢復。
- 活動恢復錯誤的返回操作改為返回匯入首頁；同步調整前端測試、E2E 與操作文件。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `quiz-activity-lifecycle`：區分匯入首頁與指定活動恢復，定義有／沒有 OPEN 的首頁行為。

## Impact

- 實作預計限於 `apps/web/src/App.tsx`、`apps/web/src/App.test.tsx`、`tests/e2e/classroom-buzzer.spec.ts`、`README.md` 與 `docs/manual-acceptance.md`，不新增相依套件。
- 沿用既有活動摘要與 snapshot API；不修改後端 API、SQLite schema 或歷史資料、Session 機制、Socket.IO、搶答順位與 XLSX 匯入匯出。
- 不新增 CSV、題組或跨裝置功能，不改變同時僅一場 OPEN 的限制，也不自動結束活動。
