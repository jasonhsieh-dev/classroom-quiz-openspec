# 本機 Demo 身分與安全邊界

本專案目前只支援受控本機課堂 Demo，不提供 PIN、帳號、密碼或公開網路部署。

## 已提供的保護

- 老師必須由伺服器的本機老師入口建立 opaque session；客戶端提交的 `role` 不會被採用。
- 老師 session 屬於本機執行個體，不綁定活動或組別；學生 session 則必須同時綁定有效活動與該活動中的組別。
- Session ID 僅透過 `HttpOnly`、`SameSite=Lax` Cookie 傳送；HTTPS 請求會加上 `Secure`。
- 老師入口及老師 API 只接受 loopback 連線。不安全方法會拒絕跨網站 `Sec-Fetch-Site`，並在有 `Origin` 時只接受 localhost、127.0.0.1 或 IPv6 loopback。
- 老師 API 在伺服器端驗證 session 與 role；隱藏前端按鈕不構成授權控制。

## 已知限制

- 無法驗證操作老師入口者的真實身分；任何能操作這台電腦及本機瀏覽器的人都可能建立老師 session。
- 無法防止使用者另開隔離瀏覽器 session，重新選擇其他組別。
- 這些限制只適用於本機受控展示，不應將目前入口直接暴露至區域網路或公開網路。
- 若未來需要跨主機使用，必須先新增正式身分驗證、明確的允許來源設定、HTTPS 與相應 CSRF 防護；不應只解除 loopback 限制。

README 已完成安裝、啟動、Demo 流程與安全邊界說明；本文件補充本機老師入口、session 與無 PIN 模式的威脅模型細節。
