import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleWritebackResponseSchema, type GoogleWritebackResponse } from "@classroom-buzzer/shared";
const errorAdvice: Record<string,string> = {
  GOOGLE_AUTH_FAILED: "Google 授權失敗，請檢查後端服務帳號憑證並重新啟動。",
  GOOGLE_PERMISSION_DENIED: "Google 權限不足，請確認服務帳號具有編輯權，且目標不在禁止編輯的保護範圍。",
  GOOGLE_DOCUMENT_UNAVAILABLE: "文件不存在或無權存取，請確認原文件及服務帳號分享權限。",
  GOOGLE_REQUEST_REJECTED: "Google 拒絕整批請求，請檢查來源範圍與文件設定。",
  GOOGLE_QUOTA_EXCEEDED: "Google API 配額已達限制，請稍後再確認重試。",
  GOOGLE_API_FAILED: "Google 暫時性 API 錯誤，請先核對狀態，再依結果重試。",
  GOOGLE_CONNECTION_FAILED: "Google 連線中斷或逾時，請檢查網路並先核對，不要盲目重送。",
  GOOGLE_SOURCE_CHANGED: "來源結構或原值不同，請人工檢查文件；系統已停止覆蓋。",
  WRITEBACK_VERIFICATION_CONFLICT: "讀回核對發現差異，請人工檢查文件，不會自動回滾。",
  WRITEBACK_RECORD_UNAVAILABLE: "雲端與本機紀錄可能不同步，請重新讀取並核對。",
  WRITEBACK_NOT_APPLIED: "讀回確認尚未寫入，可檢查預覽後明確重試。",
};
export function GoogleSheetsWriteback({ activityId }: { activityId: string }) {
  const [status,setStatus] = useState<GoogleWritebackResponse | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const base = `/api/teacher/activities/${encodeURIComponent(activityId)}/writeback`;
  const readResponse = useCallback(async (response: Response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? "無法取得寫回狀態，請重新讀取；不要直接重送。");
    const parsed = GoogleWritebackResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("伺服器回傳的寫回狀態格式無效。");
    return parsed.data;
  },[]);
  useEffect(() => {
    let active = true;
    void fetch(base,{ credentials: "same-origin" }).then(readResponse).then((value) => { if (active) setStatus(value); })
      .catch((error) => { if (active) setError(error instanceof Error ? error.message : "無法讀取寫回狀態。"); });
    return () => { active = false; };
  },[base,readResponse]);
  async function run(action: "preview" | "confirm" | "reconcile" | "status") {
    if (lock.current) return;
    lock.current = true;setBusy(action);setError(null);
    try {
      const response = await fetch(action === "status" ? base : `${base}/${action}`,action === "status" ? { credentials: "same-origin" } : {
        method: "POST",credentials: "same-origin",headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "preview" ? {} : { operationId: status?.operationId,...(action === "confirm" ? { confirmed: true } : {}) }),
      });
      setStatus(await readResponse(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "寫回請求失敗，請先重新讀取狀態。");
      // A lost HTTP reply must never leave an enabled confirm button for blind resubmission.
      if (action === "confirm" || action === "reconcile") setStatus((current) => current ? { ...current,state: "UNKNOWN",canRetry: false,message: "結果不明，請先重新讀取並核對。" } : current);
    } finally { lock.current = false;setBusy(null); }
  }
  return <section className="card">
    <h4>Google Sheets 雲端答案寫回</h4>
    <p>只寫入各題第一名答案。檢查至寫入之間仍有外部共編競態，請暫停編輯原文件。</p>
    {error && <p role="alert" className="alert error">{error}</p>}
    {status && <>
      <p><a href={`https://docs.google.com/spreadsheets/d/${status.spreadsheetId}/edit#gid=${status.sheetId}`} target="_blank" rel="noreferrer">{status.sheetTitle}（分頁 {status.sheetId}）</a></p>
      <p aria-live="polite">{busy === "confirm" ? "寫回中…" : busy ? "正在讀取與核對…" : status.message}</p>
      {status.errorCode && <p>{errorAdvice[status.errorCode] ?? "請檢查後端設定與原文件，再重新讀取狀態。"}（{status.errorCode}）</p>}
      {status.targets.length > 0 && status.state !== "NOT_PREPARED" && <div className="table-wrap"><table>
        <thead><tr><th>題號</th><th>目標儲存格</th><th>第一名答案</th><th>原始輸入</th></tr></thead>
        <tbody>{status.targets.map((t) => <tr key={t.anchor}><td>{t.displayNumber}</td><td>{t.anchor}</td><td className="prompt-text">{t.answer}</td><td>{t.originalValue === null ? "空白" : JSON.stringify(t.originalValue)}</td></tr>)}</tbody>
      </table></div>}
      <div className="actions">
        {status.state === "NOT_PREPARED" && <button type="button" disabled={Boolean(busy)} onClick={() => void run("preview")}>寫回 Google Sheets</button>}
        {status.state === "PREPARED" && <button type="button" disabled={Boolean(busy)} onClick={() => void run("confirm")}>確認寫回 Google Sheets</button>}
        {status.canRetry && <button type="button" disabled={Boolean(busy)} onClick={() => void run("confirm")}>確認重試寫回</button>}
        {status.state === "UNKNOWN" && <button type="button" disabled={Boolean(busy)} onClick={() => void run("reconcile")}>核對寫回狀態</button>}
      </div>
    </>}
    {(!status || status.state === "IN_FLIGHT" || error) && <button type="button" disabled={Boolean(busy)} onClick={() => void run("status")}>重新讀取寫回狀態</button>}
  </section>;
}
