# 本機 Demo 身分與安全邊界

本專案目前只支援受控本機課堂 Demo，不提供 PIN、帳號、密碼或公開網路部署。

## 已提供的保護

- 老師必須由伺服器的本機老師入口建立 opaque session；客戶端提交的 `role` 不會被採用。
- 老師 session 屬於本機執行個體，不綁定活動或組別；學生 session 則必須同時綁定有效活動與該活動中的組別。
- 老師 session 使用 `classroom_buzzer_teacher_session`，學生 session 使用 `classroom_buzzer_student_session`。兩者是獨立的 `HttpOnly`、`SameSite=Lax`、`Path=/` Cookie，HTTPS 請求會加上 `Secure`，因此同一瀏覽器 profile 可同時保有老師與學生身分。
- 老師入口及老師 API 只接受 loopback 連線。不安全方法會拒絕跨網站 `Sec-Fetch-Site`，並在有 `Origin` 時只接受 localhost、127.0.0.1 或 IPv6 loopback。
- 老師 API 只解析老師 Cookie，學生 API 只解析學生 Cookie，並在伺服器端驗證 session、到期時間、role、activity 與 group scope；隱藏前端按鈕不構成授權控制。
- Socket.IO 客戶端必須宣告連線用途為 `teacher` 或 `student`，但該值不授予權限，只讓伺服器選擇相應 Cookie。伺服器仍以 SQLite session 驗證真實角色與資料範圍，再加入老師或本組 room。

## 已知限制

- 無法驗證操作老師入口者的真實身分；任何能操作這台電腦及本機瀏覽器的人都可能建立老師 session。
- 雙 Cookie 只解決同一瀏覽器中老師與學生 session 互相覆蓋，不是帳號系統，也不會把瀏覽器操作者驗證為特定老師或學生。
- 無法防止使用者另開隔離瀏覽器 session，重新選擇其他組別。
- 這些限制只適用於本機受控展示，不應將目前入口直接暴露至區域網路或公開網路。
- 若未來需要跨主機使用，必須先新增正式身分驗證、明確的允許來源設定、HTTPS 與相應 CSRF 防護；不應只解除 loopback 限制。

README 已完成安裝、啟動、Demo 流程與安全邊界說明；本文件補充本機老師入口、session 與無 PIN 模式的威脅模型細節。
