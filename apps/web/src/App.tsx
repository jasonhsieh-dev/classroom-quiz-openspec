import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ActivityState,
  ApiError,
  ConfirmImportResponse,
  GroupListResponse,
  GroupSummary,
  ImportDraftPreview,
  StudentSessionResponse,
  StudentActivitySnapshot,
} from "@classroom-buzzer/shared";

type RequestState = "idle" | "uploading" | "confirming" | "cancelling";
type SessionState = "loading" | "ready" | "error";

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (body.error?.message) return body.error.message;
  } catch {
    // 非 JSON 錯誤由下方提供穩定訊息。
  }
  return "伺服器無法完成匯入，請稍後再試。";
}

export function TeacherGroupManager({ activity }: { activity: ConfirmImportResponse }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activityState, setActivityState] = useState<ActivityState>(activity.state);
  const [closing, setClosing] = useState(false);

  async function addGroup(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("組別名稱不可空白。");
      return;
    }
    setError(null);
    setBusyId("new");
    try {
      const response = await fetch(`/api/teacher/activities/${activity.activityId}/groups`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const created = (await response.json()) as GroupSummary;
      setGroups((current) => [...current, created]);
      setName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新增組別失敗。");
    } finally {
      setBusyId(null);
    }
  }

  async function renameGroup(group: GroupSummary) {
    const nextName = window.prompt("輸入新的組別名稱", group.name);
    if (nextName === null) return;
    if (!nextName.trim()) {
      setError("組別名稱不可空白。");
      return;
    }
    setBusyId(group.id);
    setError(null);
    try {
      const response = await fetch(`/api/teacher/activities/${activity.activityId}/groups/${group.id}`, {
        method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ name: nextName }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const updated = (await response.json()) as GroupSummary;
      setGroups((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新命名失敗。");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteGroup(group: GroupSummary) {
    setBusyId(group.id);
    setError(null);
    try {
      const response = await fetch(`/api/teacher/activities/${activity.activityId}/groups/${group.id}`, {
        method: "DELETE", credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setGroups((current) => current.filter((item) => item.id !== group.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "刪除組別失敗。");
    } finally {
      setBusyId(null);
    }
  }

  async function openActivity() {
    setBusyId("open"); setError(null);
    try {
      const response = await fetch(`/api/teacher/activities/${activity.activityId}/open`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setActivityState("OPEN");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "開始活動失敗。"); }
    finally { setBusyId(null); }
  }

  async function closeActivity() {
    if (!window.confirm("確定要結束整場搶答活動嗎？結束後不得再提交或修改答案。")) return;
    setClosing(true); setError(null);
    try {
      const response = await fetch(`/api/teacher/activities/${activity.activityId}/close`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as Partial<ApiError> | undefined;
        if (body?.error?.code === "ACTIVITY_ALREADY_CLOSED") { setActivityState("CLOSED"); return; }
        throw new Error(body?.error?.message ?? "結束活動失敗，請稍後再試。");
      }
      setActivityState("CLOSED");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "結束活動失敗，請稍後再試。"); }
    finally { setClosing(false); }
  }

  return <section className="card">
    <p className="status-label">活動狀態：{activityState}</p>
    <h2>{activity.title}</h2>
    <p>本活動共 {activity.questionCount} 題。</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    <form onSubmit={addGroup} className="inline-form">
      <label className="field"><span>組別名稱</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={busyId !== null || activityState !== "DRAFT"} /></label>
      <button type="submit" disabled={busyId !== null || activityState !== "DRAFT"}>{busyId === "new" ? "新增中…" : "新增組別"}</button>
    </form>
    {groups.length === 0 ? <p className="muted">尚未建立組別。</p> : <ul className="group-list">{groups.map((group) => <li key={group.id}><span>{group.name}</span><div className="actions"><button type="button" className="secondary" disabled={busyId !== null || activityState !== "DRAFT"} onClick={() => void renameGroup(group)}>重新命名</button><button type="button" className="secondary" disabled={busyId !== null || activityState !== "DRAFT"} onClick={() => void deleteGroup(group)}>刪除</button></div></li>)}</ul>}
    {activityState === "DRAFT" && <div className="actions"><button type="button" disabled={busyId !== null} onClick={() => void openActivity()}>{busyId === "open" ? "開始中…" : "開始搶答"}</button></div>}
    {activityState === "OPEN" && <><p className="warning">活動進行中：全部題目已同時開放，組別不可修改。</p><div className="actions"><button type="button" disabled={closing} onClick={() => void closeActivity()}>{closing ? "結束中…" : "結束活動"}</button></div></>}
    {activityState === "CLOSED" && <div className="result-panel"><h3>唯讀結果</h3><p>活動已結束，不能再修改組別或提交答案。</p></div>}
  </section>;
}

export function StudentActivityView({ session }: { session: StudentSessionResponse }) {
  const [snapshot, setSnapshot] = useState<StudentActivitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/student/activities/${session.activityId}/snapshot`, { credentials: "same-origin" })
      .then(async (response) => { if (!response.ok) throw new Error(await errorMessage(response)); return response.json() as Promise<StudentActivitySnapshot>; })
      .then((body) => { if (active) setSnapshot(body); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "同步活動狀態失敗。"); });
    return () => { active = false; };
  }, [session.activityId]);
  if (error) return <section className="card"><div className="alert error" role="alert">{error}</div></section>;
  if (!snapshot) return <section className="card" aria-live="polite">正在同步活動狀態…</section>;
  return <section className="card"><p className="status-label">活動狀態：{snapshot.state}</p><h2>{session.group.name}</h2>
    {snapshot.state === "DRAFT" && <p>等待老師開始搶答。</p>}
    {snapshot.state === "OPEN" && <><p>全部題目已開放，可自由選擇題號。</p><div className="question-grid">{snapshot.questions.map((question) => <button type="button" key={question.id}>{question.displayNumber}</button>)}</div></>}
    {snapshot.state === "CLOSED" && <div className="result-panel"><h3>唯讀結果</h3><p>活動已結束，不能再提交或修改答案。</p></div>}
  </section>;
}

export function StudentJoin() {
  const [activityId, setActivityId] = useState("");
  const [join, setJoin] = useState<GroupListResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [session, setSession] = useState<StudentSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(event: FormEvent) {
    event.preventDefault();
    if (!activityId.trim()) { setError("請輸入活動識別碼。"); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activityId.trim())}/join`);
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = (await response.json()) as GroupListResponse;
      setJoin(body); setSelected(body.groups[0]?.id ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "讀取活動失敗。"); }
    finally { setBusy(false); }
  }

  async function choose(event: FormEvent) {
    event.preventDefault();
    if (!join || !selected) { setError("請選擇組別。"); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/student/session", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ activityId: join.activityId, groupId: selected }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setSession((await response.json()) as StudentSessionResponse);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "選擇組別失敗。"); }
    finally { setBusy(false); }
  }

  return <main className="shell"><header className="page-header"><p className="eyebrow">Classroom Buzzer · 學生端</p><h1>選擇組別</h1></header>
    {error && <div className="alert error" role="alert">{error}</div>}
    {session ? <StudentActivityView session={session} /> : !join ? <form className="card" onSubmit={load}><label className="field"><span>活動識別碼</span><input value={activityId} onChange={(event) => setActivityId(event.target.value)} /></label><button disabled={busy}>查詢活動</button></form> : <form className="card" onSubmit={choose}><p>活動狀態：{join.state}</p><label className="field"><span>選擇組別</span><select aria-label="選擇組別" value={selected} onChange={(event) => setSelected(event.target.value)}>{join.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{join.groups.length === 0 && <p className="warning">老師尚未建立組別。</p>}<button disabled={busy || !selected}>進入活動</button></form>}
  </main>;
}

function suggestedTitle(filename: string): string {
  return filename.replace(/\.xlsx$/i, "").trim();
}

export function App() {
  if (window.location.pathname.startsWith("/student")) return <StudentJoin />;
  const sessionRequestStarted = useRef(false);
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportDraftPreview | null>(null);
  const [title, setTitle] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmImportResponse | null>(null);

  const busy = requestState !== "idle";

  async function createTeacherSession() {
    setSessionState("loading");
    setError(null);
    try {
      const response = await fetch("/api/teacher/session", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setSessionState("ready");
    } catch (caught) {
      setSessionState("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "無法建立本機老師 session。",
      );
    }
  }

  useEffect(() => {
    if (sessionRequestStarted.current) return;
    sessionRequestStarted.current = true;
    void createTeacherSession();
  }, []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("請先選擇 Guided Notes .xlsx 檔案。");
      return;
    }

    setError(null);
    setRequestState("uploading");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/teacher/imports", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = (await response.json()) as ImportDraftPreview;
      setPreview(result);
      setTitle(suggestedTitle(result.filename));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Guided Notes 上傳失敗。");
    } finally {
      setRequestState("idle");
    }
  }

  async function cancel() {
    if (!preview) return;
    setError(null);
    setRequestState("cancelling");
    try {
      const response = await fetch(`/api/teacher/imports/${preview.importId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setPreview(null);
      setFile(null);
      setTitle("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消匯入失敗。");
    } finally {
      setRequestState("idle");
    }
  }

  async function confirm() {
    if (!preview) return;
    if (!title.trim()) {
      setError("活動名稱不可空白。");
      return;
    }
    setError(null);
    setRequestState("confirming");
    try {
      const response = await fetch(
        `/api/teacher/imports/${preview.importId}/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ title: title.trim() }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      setConfirmed((await response.json()) as ConfirmImportResponse);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "確認匯入失敗。");
    } finally {
      setRequestState("idle");
    }
  }

  return (
    <main className="shell">
      <header className="page-header">
        <p className="eyebrow">Classroom Buzzer · 老師端</p>
        <h1>匯入 Guided Notes</h1>
        <p>上傳 Google Sheets 下載的 .xlsx，確認預覽後才會建立活動。</p>
      </header>

      {error && (
        <div className="alert error" role="alert">
          <strong>無法完成操作</strong>
          <span>{error}</span>
        </div>
      )}

      {sessionState === "loading" ? (
        <section className="card" aria-live="polite">
          <p>正在建立本機老師 session…</p>
        </section>
      ) : sessionState === "error" ? (
        <section className="card">
          <p>老師入口目前無法使用。</p>
          <button type="button" onClick={() => void createTeacherSession()}>
            重試
          </button>
        </section>
      ) : confirmed ? (
        <TeacherGroupManager activity={confirmed} />
      ) : preview ? (
        <section className="card preview-panel">
          <div className="preview-heading">
            <div>
              <p className="status-label">匯入預覽</p>
              <h2>{preview.filename}</h2>
            </div>
            <span className="count-badge">共 {preview.questionCount} 題</span>
          </div>

          <label className="field">
            <span>活動名稱</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
              required
            />
          </label>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">題號</th>
                  <th scope="col">工作表</th>
                  <th scope="col">答案範圍</th>
                  <th scope="col">原內容</th>
                </tr>
              </thead>
              <tbody>
                {preview.questions.map((question) => (
                  <tr key={`${question.sheetName}:${question.numberCell}`}>
                    <td>{question.displayNumber}</td>
                    <td>{question.sheetName}</td>
                    <td>
                      <code>{question.answerRange}</code>
                    </td>
                    <td>
                      {question.willOverwrite ? (
                        <span className="warning">
                          已有「{question.originalAnswer}」；有成功組別時將覆蓋
                        </span>
                      ) : (
                        <span className="muted">空白，不需覆蓋</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="preview-note">
            請確認題號與答案範圍正確。按下確認後才會保存原始檔並建立 DRAFT 活動。
          </p>
          <div className="actions">
            <button className="secondary" type="button" onClick={cancel} disabled={busy}>
              {requestState === "cancelling" ? "取消中…" : "取消匯入"}
            </button>
            <button type="button" onClick={confirm} disabled={busy}>
              {requestState === "confirming" ? "建立中…" : "確認並建立活動"}
            </button>
          </div>
        </section>
      ) : (
        <form className="card upload-panel" onSubmit={upload}>
          <label className="file-picker">
            <span>Guided Notes 檔案</span>
            <input
              aria-label="Guided Notes 檔案"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
              disabled={busy}
            />
            <small>僅接受 .xlsx；系統會依「題號」及「作答」表頭動態辨識。</small>
          </label>
          {file && <p className="selected-file">已選擇：{file.name}</p>}
          <button type="submit" disabled={busy}>
            {requestState === "uploading" ? "解析中…" : "上傳並預覽"}
          </button>
        </form>
      )}
    </main>
  );
}
