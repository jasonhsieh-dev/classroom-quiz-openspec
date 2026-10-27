import type {
	ActivityState,
	ActivitySummary,
	ApiError,
	ConfirmImportResponse,
	GroupListResponse,
	GroupSummary,
	ImportDraftPreview,
	StudentActivityResults,
	StudentSessionResponse,
	SubmissionResponse,
	TeacherActivityResults,
	TeacherActivitySnapshot,
} from "@classroom-buzzer/shared";
import {
	ActivitySummaryListResponseSchema,
	CloseActivityResponseSchema,
	StudentActivityResultsSchema,
	TeacherActivityResultsSchema,
	TeacherActivitySnapshotSchema,
} from "@classroom-buzzer/shared";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { formatTaipeiDateTime } from "./date-time.js";
import { QuestionPresentation } from "./QuestionPresentation.js";
import {
	type ActivitySocketFactory,
	type SyncStatus,
	useStudentActivitySync,
	useTeacherActivitySync,
} from "./use-activity-sync.js";

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

async function closeErrorMessage(response: Response): Promise<string> {
	const message = await errorMessage(response);
	if (response.status === 401) {
		return `${message} 請重新建立老師工作階段後再試。`;
	}
	if (response.status === 403) {
		return `${message} 請確認目前使用老師端，並重新建立老師工作階段後再試。`;
	}
	return message === "伺服器無法完成匯入，請稍後再試。"
		? "結束活動失敗，請稍後再試。"
		: message;
}

type TeacherManagedActivity = ConfirmImportResponse | TeacherActivitySnapshot;

export function TeacherGroupManager({
	activity,
	socketFactory,
	onStateChange,
	onGroupsChange,
}: {
	activity: TeacherManagedActivity;
	socketFactory?: ActivitySocketFactory;
	onStateChange?: (state: ActivityState, revision?: number) => void;
	onGroupsChange?: (groups: GroupSummary[], revision: number) => void;
}) {
	const initialGroups = "groups" in activity ? activity.groups : [];
	const [groups, setGroups] = useState<GroupSummary[]>(initialGroups);
	const [groupCount, setGroupCount] = useState(
		String(initialGroups.length > 0 ? initialGroups.length : 2),
	);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [activityState, setActivityState] = useState<ActivityState>(
		activity.state,
	);
	const [activityRevision, setActivityRevision] = useState<number | null>(
		"revision" in activity ? activity.revision : null,
	);
	const [closing, setClosing] = useState(false);
	const [liveSyncStatus, setLiveSyncStatus] = useState<SyncStatus>("loading");
	const questionCount =
		"questions" in activity
			? activity.questions.length
			: activity.questionCount;

	useEffect(() => {
		setGroups("groups" in activity ? activity.groups : []);
		setActivityState(activity.state);
		setActivityRevision("revision" in activity ? activity.revision : null);
		const savedGroupCount = "groups" in activity ? activity.groups.length : 0;
		setGroupCount(String(savedGroupCount > 0 ? savedGroupCount : 2));
	}, [activity]);

	async function replaceGroups(event: FormEvent) {
		event.preventDefault();
		const count = Number(groupCount);
		if (!Number.isInteger(count) || count < 1 || count > 100) {
			setError("組別數量必須是 1 至 100 的整數。");
			return;
		}
		if (
			groups.length > 0 &&
			!window.confirm("重新產生會替換目前全部組別，確定要繼續嗎？")
		)
			return;
		setError(null);
		setBusyId("batch");
		try {
			const response = await fetch(
				`/api/teacher/activities/${activity.activityId}/groups`,
				{
					method: "PUT",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ count }),
				},
			);
			if (!response.ok) throw new Error(await errorMessage(response));
			const result = (await response.json()) as GroupListResponse;
			setGroups(result.groups);
			setGroupCount(String(result.groups.length));
			setActivityRevision(result.revision);
			onGroupsChange?.(result.groups, result.revision);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "建立組別失敗。");
		} finally {
			setBusyId(null);
		}
	}

	async function openActivity() {
		setBusyId("open");
		setError(null);
		try {
			const response = await fetch(
				`/api/teacher/activities/${activity.activityId}/open`,
				{ method: "POST", credentials: "same-origin" },
			);
			if (!response.ok) throw new Error(await errorMessage(response));
			const opened = (await response.json()) as {
				state: ActivityState;
				revision: number;
			};
			setActivityRevision(opened.revision);
			setActivityState(opened.state);
			onStateChange?.(opened.state, opened.revision);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "開始活動失敗。");
		} finally {
			setBusyId(null);
		}
	}

	async function closeActivity() {
		if (
			!window.confirm("確定要結束整場搶答活動嗎？結束後不得再提交或修改答案。")
		)
			return;
		setClosing(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/teacher/activities/${activity.activityId}/close`,
				{ method: "POST", credentials: "same-origin" },
			);
			if (!response.ok) throw new Error(await closeErrorMessage(response));
			const parsed = CloseActivityResponseSchema.safeParse(
				await response.json(),
			);
			if (!parsed.success || parsed.data.activityId !== activity.activityId) {
				throw new Error("伺服器回傳的結束活動結果格式無效，請重試。");
			}
			setActivityRevision(parsed.data.revision);
			setActivityState(parsed.data.state);
			onStateChange?.(parsed.data.state, parsed.data.revision);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "結束活動失敗，請稍後再試。",
			);
		} finally {
			setClosing(false);
		}
	}

	return (
		<section className="card">
			<p className="status-label">
				活動狀態：{activityState}
				{activityRevision !== null ? ` · revision ${activityRevision}` : ""}
			</p>
			<h2>{activity.title}</h2>
			<p>
				活動識別碼：<code>{activity.activityId}</code>
			</p>
			<p>本活動共 {questionCount} 題。</p>
			{error && (
				<div className="alert error" role="alert">
					{error}
				</div>
			)}
			{activityState === "DRAFT" ? (
				<form onSubmit={replaceGroups} className="inline-form" noValidate>
					<label className="field">
						<span>組別數量</span>
						<input
							type="number"
							min="1"
							max="100"
							step="1"
							value={groupCount}
							onChange={(event) => setGroupCount(event.target.value)}
							disabled={busyId !== null}
						/>
					</label>
					<button type="submit" disabled={busyId !== null}>
						{busyId === "batch"
							? "建立中…"
							: groups.length > 0
								? "重新產生組別"
								: "建立組別"}
					</button>
				</form>
			) : (
				<p className="status-label">組別數量：{groups.length}</p>
			)}
			{groups.length === 0 ? (
				<p className="muted">尚未建立組別。</p>
			) : (
				<ul className="group-list">
					{groups.map((group) => (
						<li key={group.id}>
							<span>{group.name}</span>
						</li>
					))}
				</ul>
			)}
			{activityState === "DRAFT" && groups.length < 2 && (
				<p className="warning">至少建立兩組才能開始活動。</p>
			)}
			{activityState === "DRAFT" && (
				<div className="actions">
					<button
						type="button"
						disabled={busyId !== null || groups.length < 2}
						onClick={() => void openActivity()}
					>
						{busyId === "open" ? "開始中…" : "開始搶答"}
					</button>
				</div>
			)}
			{activityState === "OPEN" && (
				<>
					<p className="warning">
						活動進行中：全部題目已同時開放，組別不可修改。
					</p>
					<div className="actions">
						<button
							type="button"
							disabled={closing || liveSyncStatus !== "synced"}
							onClick={() => void closeActivity()}
						>
							{closing ? "結束中…" : "結束活動"}
						</button>
					</div>
					<TeacherLiveMonitor
						activityId={activity.activityId}
						{...(socketFactory ? { socketFactory } : {})}
						onStateChange={(state) => {
							setActivityState(state);
							onStateChange?.(state);
						}}
						onSyncStatusChange={setLiveSyncStatus}
					/>
				</>
			)}
			{activityState === "CLOSED" && (
				<TeacherResultsPage activityId={activity.activityId} />
			)}
		</section>
	);
}

export function TeacherResultsPage({ activityId }: { activityId: string }) {
	const [results, setResults] = useState<TeacherActivityResults | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const response = await fetch(
					`/api/teacher/activities/${activityId}/results`,
					{ credentials: "same-origin" },
				);
				if (!response.ok) throw new Error(await errorMessage(response));
				const parsed = TeacherActivityResultsSchema.safeParse(
					await response.json(),
				);
				if (!parsed.success) throw new Error("伺服器回傳的老師結果格式無效。");
				if (active) setResults(parsed.data);
			} catch (caught) {
				if (active)
					setError(
						caught instanceof Error ? caught.message : "無法取得完整結果。",
					);
			}
		})();
		return () => {
			active = false;
		};
	}, [activityId]);
	async function downloadGuidedNotes() {
		setExporting(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/teacher/activities/${activityId}/exports`,
				{ method: "POST", credentials: "same-origin" },
			);
			if (!response.ok) throw new Error(await errorMessage(response));
			const blob = await response.blob();
			const disposition = response.headers.get("content-disposition") ?? "";
			const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
			const filename = encoded
				? decodeURIComponent(encoded)
				: "Guided-Notes-搶答結果.xlsx";
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "匯出失敗，請稍後再試。",
			);
		} finally {
			setExporting(false);
		}
	}
	return (
		<section className="result-panel">
			<h3>唯讀結果</h3>
			<p>活動已結束；人工檢查不會改變成功組別或順位。</p>
			<div className="actions">
				<button
					type="button"
					onClick={() => void downloadGuidedNotes()}
					disabled={!results || exporting}
				>
					{exporting ? "產生匯出檔中…" : "下載已回填 Guided Notes"}
				</button>
			</div>
			{error && (
				<div className="alert error" role="alert">
					{error}
				</div>
			)}
			{!results && !error && <p aria-live="polite">正在載入完整結果…</p>}
			{results?.questions.map((item) => (
				<article className="question-result" key={item.question.id}>
					<QuestionPresentation question={item.question} />
					<p>成功組別：{item.winner?.name ?? "無人作答"}</p>
					{item.rankings.length > 0 && (
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>順位</th>
										<th>組別</th>
										<th>答案</th>
										<th>最後有效提交時間</th>
									</tr>
								</thead>
								<tbody>
									{item.rankings.map((entry) => (
										<tr key={entry.group.id}>
											<td>{entry.rank}</td>
											<td>{entry.group.name}</td>
											<td>{entry.answer}</td>
											<td>
												<time dateTime={entry.serverReceivedAt}>
													{formatTaipeiDateTime(entry.serverReceivedAt)}
												</time>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</article>
			))}
		</section>
	);
}

export function StudentResultsPage({
	activityId,
	initialResults,
}: {
	activityId: string;
	initialResults: StudentActivityResults | null;
}) {
	const [results, setResults] = useState<StudentActivityResults | null>(
		initialResults,
	);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setResults(initialResults);
		if (initialResults) return;
		let active = true;
		void (async () => {
			try {
				const response = await fetch(
					`/api/student/activities/${activityId}/results`,
					{ credentials: "same-origin" },
				);
				if (!response.ok) throw new Error(await errorMessage(response));
				const parsed = StudentActivityResultsSchema.safeParse(
					await response.json(),
				);
				if (!parsed.success) throw new Error("伺服器回傳的學生結果格式無效。");
				if (active) setResults(parsed.data);
			} catch (caught) {
				if (active)
					setError(caught instanceof Error ? caught.message : "無法取得結果。");
			}
		})();
		return () => {
			active = false;
		};
	}, [activityId, initialResults]);
	return (
		<section className="result-panel">
			<h3>唯讀結果</h3>
			<p>活動已結束，不能再提交或修改答案。</p>
			{error && (
				<div className="alert error" role="alert">
					{error}
				</div>
			)}
			{!results && !error && <p aria-live="polite">正在載入本組結果…</p>}
			{results?.questions.map((item) => (
				<article className="question-result" key={item.question.id}>
					<QuestionPresentation question={item.question} />
					<p>成功組別：{item.winner?.name ?? "無人作答"}</p>
					{item.ownResult.status === "ANSWERED" ? (
						<dl>
							<div>
								<dt>本組答案</dt>
								<dd>{item.ownResult.answer}</dd>
							</div>
							<div>
								<dt>本組順位</dt>
								<dd>{item.ownResult.rank}</dd>
							</div>
						</dl>
					) : (
						<p className="muted">本組未作答</p>
					)}
				</article>
			))}
		</section>
	);
}

export function TeacherLiveMonitor({
	activityId,
	socketFactory,
	onStateChange,
	onSyncStatusChange,
}: {
	activityId: string;
	socketFactory?: ActivitySocketFactory;
	onStateChange?: (state: ActivityState) => void;
	onSyncStatusChange?: (status: SyncStatus) => void;
}) {
	const sync = useTeacherActivitySync(activityId, socketFactory);
	useEffect(() => {
		if (sync.snapshot) onStateChange?.(sync.snapshot.state);
	}, [onStateChange, sync.snapshot]);
	useEffect(() => {
		onSyncStatusChange?.(sync.status);
	}, [onSyncStatusChange, sync.status]);
	if (!sync.snapshot)
		return (
			<section className="live-monitor" aria-live="polite">
				{sync.status === "unsynced" ? (
					<>
						<div className="alert error" role="alert">
							即時狀態尚未同步：{sync.error}
						</div>
						<button type="button" onClick={() => void sync.refresh()}>
							重試同步
						</button>
					</>
				) : (
					"正在同步老師監看畫面…"
				)}
			</section>
		);
	const groupNames = new Map(
		sync.snapshot.groups.map((group) => [group.id, group.name]),
	);
	return (
		<section className="live-monitor">
			<div className="monitor-heading">
				<h3>即時提交監看</h3>
				<span>revision {sync.snapshot.revision}</span>
			</div>
			{sync.status === "unsynced" && (
				<div className="alert error" role="alert">
					<span>即時狀態尚未同步：{sync.error}</span>
					<button type="button" onClick={() => void sync.refresh()}>
						重試同步
					</button>
				</div>
			)}
			<div className="monitor-grid">
				{sync.snapshot.questions.map((question) => {
					const submissions = sync.snapshot!.submissions.filter(
						(item) => item.questionId === question.id,
					);
					return (
						<article key={question.id}>
							<QuestionPresentation question={question} />
							{submissions.length === 0 ? (
								<p className="muted">尚無組別提交</p>
							) : (
								<ul>
									{submissions.map((submission) => (
										<li key={submission.groupId}>
											<strong>
												{groupNames.get(submission.groupId) ??
													submission.groupId}
											</strong>
											<span>{submission.answer}</span>
											<time dateTime={submission.serverReceivedAt}>
												{formatTaipeiDateTime(submission.serverReceivedAt)}
											</time>
										</li>
									))}
								</ul>
							)}
						</article>
					);
				})}
			</div>
		</section>
	);
}

export function StudentActivityView({
	session,
	socketFactory,
}: {
	session: StudentSessionResponse;
	socketFactory?: ActivitySocketFactory;
}) {
	const sync = useStudentActivitySync(session.activityId, socketFactory);
	const { snapshot, setSnapshot } = sync;
	const [error, setError] = useState<string | null>(null);
	const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
		null,
	);
	const [answer, setAnswer] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const identityChanged = Boolean(
		snapshot && snapshot.group.id !== session.group.id,
	);
	const pendingSubmission = useRef<{
		questionId: string;
		answer: string;
		key: string;
	} | null>(null);
	function selectQuestion(questionId: string) {
		setSelectedQuestionId(questionId);
		setAnswer(
			snapshot?.submissions.find((item) => item.questionId === questionId)
				?.answer ?? "",
		);
		setError(null);
	}

	async function submitAnswer(event: FormEvent) {
		event.preventDefault();
		if (snapshot?.state !== "OPEN" || !selectedQuestionId) return;
		if (identityChanged) {
			setError(
				"此分頁的學生組別已在其他分頁變更，本次提交未保存。請重新進入正確組別；若要同時操作多個學生身分，請使用無痕視窗或不同瀏覽器 profile。",
			);
			return;
		}
		const normalizedAnswer = answer.trim();
		if (!normalizedAnswer) {
			setError("答案去除前後空白後不得為空。");
			return;
		}
		const current = snapshot.submissions.find(
			(item) => item.questionId === selectedQuestionId,
		);
		if (
			current &&
			current.answer !== normalizedAnswer &&
			!window.confirm(
				"確定要修改這一題的答案嗎？重新提交會更新有效提交時間與順位。",
			)
		) {
			return;
		}
		const pending = pendingSubmission.current;
		const key =
			pending?.questionId === selectedQuestionId &&
			pending.answer === normalizedAnswer
				? pending.key
				: crypto.randomUUID();
		pendingSubmission.current = {
			questionId: selectedQuestionId,
			answer: normalizedAnswer,
			key,
		};
		setSubmitting(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/student/activities/${session.activityId}/questions/${selectedQuestionId}/submission`,
				{
					method: "PUT",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						answer: normalizedAnswer,
						idempotencyKey: key,
						expectedGroupId: session.group.id,
					}),
				},
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => undefined)) as
					| Partial<ApiError>
					| undefined;
				if (body?.error?.code === "ACTIVITY_CLOSED") {
					setSnapshot((value) =>
						value ? { ...value, state: "CLOSED" } : value,
					);
				}
				throw new Error(body?.error?.message ?? "提交答案失敗，請稍後再試。");
			}
			const submitted = (await response.json()) as SubmissionResponse;
			pendingSubmission.current = null;
			setAnswer(submitted.answer);
			setSnapshot((value) =>
				value
					? {
							...value,
							submissions: [
								...value.submissions.filter(
									(item) => item.questionId !== submitted.questionId,
								),
								submitted,
							],
						}
					: value,
			);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "提交答案失敗，請稍後再試。",
			);
		} finally {
			setSubmitting(false);
		}
	}

	useEffect(() => {
		if (!selectedQuestionId || !snapshot) return;
		const current = snapshot.submissions.find(
			(item) => item.questionId === selectedQuestionId,
		);
		if (current) setAnswer(current.answer);
	}, [selectedQuestionId, snapshot]);

	if (!snapshot)
		return (
			<section className="card" aria-live="polite">
				{sync.status === "unsynced" ? (
					<>
						<div className="alert error" role="alert">
							即時狀態尚未同步：{sync.error}
						</div>
						<button type="button" onClick={() => void sync.refresh()}>
							重試同步
						</button>
					</>
				) : (
					"正在同步活動狀態…"
				)}
			</section>
		);
	const selectedQuestion = snapshot.questions.find(
		(item) => item.id === selectedQuestionId,
	);
	const currentSubmission = snapshot.submissions.find(
		(item) => item.questionId === selectedQuestionId,
	);
	return (
		<section className="card">
			<p className="status-label">活動狀態：{snapshot.state}</p>
			<h2>{session.group.name}</h2>
			{identityChanged && (
				<div className="alert error" role="alert">
					此分頁原本是「{session.group.name}」，但目前瀏覽器的學生 session
					已切換為「{snapshot.group.name}」。為避免答案送到錯誤組別，
					請重新進入正確組別；若要同時操作多個學生身分，請使用無痕視窗或不同瀏覽器
					profile。
				</div>
			)}
			{error && (
				<div className="alert error" role="alert">
					{error}
				</div>
			)}
			{sync.status === "unsynced" && (
				<div className="alert error" role="alert">
					<span>即時狀態尚未同步：{sync.error}</span>
					<button type="button" onClick={() => void sync.refresh()}>
						重試同步
					</button>
				</div>
			)}
			{snapshot.state === "DRAFT" && <p>等待老師開始搶答。</p>}
			{snapshot.state === "OPEN" && (
				<>
					<p>全部題目已開放，可自由選擇題號。</p>
					<div className="question-grid">
						{snapshot.questions.map((question) => {
							const submitted = snapshot.submissions.some(
								(item) => item.questionId === question.id,
							);
							return (
								<button
									type="button"
									aria-label={question.displayNumber}
									className={
										selectedQuestionId === question.id ? "selected" : ""
									}
									key={question.id}
									onClick={() => selectQuestion(question.id)}
								>
									<QuestionPresentation question={question} compact />
									<small>{submitted ? "已提交" : "未作答"}</small>
								</button>
							);
						})}
					</div>
					{selectedQuestion && (
						<form className="answer-editor" onSubmit={submitAnswer}>
							<QuestionPresentation
								question={selectedQuestion}
								headingLevel={3}
							/>
							{currentSubmission && (
								<p className="submission-status">
									本組已提交；最後有效時間：
									<time dateTime={currentSubmission.serverReceivedAt}>
										{formatTaipeiDateTime(currentSubmission.serverReceivedAt)}
									</time>
								</p>
							)}
							<label className="field">
								<span>答案</span>
								<textarea
									aria-label="答案"
									value={answer}
									maxLength={2000}
									onChange={(event) => setAnswer(event.target.value)}
									disabled={
										submitting || sync.status !== "synced" || identityChanged
									}
								/>
							</label>
							<button
								type="submit"
								disabled={
									submitting ||
									sync.status !== "synced" ||
									identityChanged ||
									!answer.trim()
								}
							>
								{submitting
									? "提交中…"
									: currentSubmission
										? "修改答案"
										: "提交答案"}
							</button>
						</form>
					)}
				</>
			)}
			{snapshot.state === "CLOSED" && (
				<StudentResultsPage
					activityId={session.activityId}
					initialResults={snapshot.results ?? null}
				/>
			)}
		</section>
	);
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
		if (!activityId.trim()) {
			setError("請輸入活動識別碼。");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/activities/${encodeURIComponent(activityId.trim())}/join`,
			);
			if (!response.ok) throw new Error(await errorMessage(response));
			const body = (await response.json()) as GroupListResponse;
			setJoin(body);
			setSelected(body.groups[0]?.id ?? "");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "讀取活動失敗。");
		} finally {
			setBusy(false);
		}
	}

	async function choose(event: FormEvent) {
		event.preventDefault();
		if (!join || !selected) {
			setError("請選擇組別。");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const response = await fetch("/api/student/session", {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					activityId: join.activityId,
					groupId: selected,
				}),
			});
			if (!response.ok) throw new Error(await errorMessage(response));
			setSession((await response.json()) as StudentSessionResponse);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "選擇組別失敗。");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="shell">
			<header className="page-header">
				<p className="eyebrow">Classroom Buzzer · 學生端</p>
				<h1>選擇組別</h1>
			</header>
			{error && (
				<div className="alert error" role="alert">
					{error}
				</div>
			)}
			{session ? (
				<StudentActivityView session={session} />
			) : !join ? (
				<form className="card" onSubmit={load}>
					<label className="field">
						<span>活動識別碼</span>
						<input
							value={activityId}
							onChange={(event) => setActivityId(event.target.value)}
						/>
					</label>
					<button type="submit" disabled={busy}>
						查詢活動
					</button>
				</form>
			) : (
				<form className="card" onSubmit={choose}>
					<p>活動狀態：{join.state}</p>
					<label className="field">
						<span>選擇組別</span>
						<select
							aria-label="選擇組別"
							value={selected}
							onChange={(event) => setSelected(event.target.value)}
						>
							{join.groups.map((group) => (
								<option key={group.id} value={group.id}>
									{group.name}
								</option>
							))}
						</select>
					</label>
					{join.groups.length === 0 && (
						<p className="warning">老師尚未建立組別。</p>
					)}
					<button type="submit" disabled={busy || !selected}>
						進入活動
					</button>
				</form>
			)}
		</main>
	);
}

function suggestedTitle(filename: string): string {
	return filename.replace(/\.xlsx$/i, "").trim();
}

export function App() {
	return window.location.pathname.startsWith("/student") ? (
		<StudentJoin />
	) : (
		<TeacherApp />
	);
}

function activityIdFromTeacherPath(pathname: string): string | null {
	const match = /^\/teacher\/activities\/([^/]+)\/?$/.exec(pathname);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]!);
	} catch {
		return null;
	}
}

export function teacherPageHeading(state?: ActivityState): string {
	if (state === "DRAFT") return "設定搶答活動";
	if (state === "OPEN") return "搶答活動進行中";
	if (state === "CLOSED") return "活動結果與匯出";
	return "匯入 Guided Notes";
}

export function TeacherApp() {
	const sessionRequestStarted = useRef(false);
	const [sessionState, setSessionState] = useState<SessionState>("loading");
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<ImportDraftPreview | null>(null);
	const [title, setTitle] = useState("");
	const [requestState, setRequestState] = useState<RequestState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [activity, setActivity] = useState<TeacherActivitySnapshot | null>(
		null,
	);
	const [activities, setActivities] = useState<ActivitySummary[]>([]);
	const [recoveryError, setRecoveryError] = useState(false);

	const busy = requestState !== "idle";

	const loadActivity = useCallback(
		async (activityId: string, navigate: boolean) => {
			const response = await fetch(
				`/api/teacher/activities/${encodeURIComponent(activityId)}/snapshot`,
				{ credentials: "same-origin" },
			);
			if (!response.ok) throw new Error(await errorMessage(response));
			const parsed = TeacherActivitySnapshotSchema.safeParse(
				await response.json(),
			);
			if (!parsed.success)
				throw new Error("伺服器回傳的老師活動快照格式無效。");
			setActivity(parsed.data);
			setRecoveryError(false);
			if (navigate)
				window.history.pushState(
					{},
					"",
					`/teacher/activities/${encodeURIComponent(activityId)}`,
				);
			return parsed.data;
		},
		[],
	);

	const loadRoot = useCallback(async () => {
		const response = await fetch("/api/teacher/activities", {
			credentials: "same-origin",
		});
		if (!response.ok) throw new Error(await errorMessage(response));
		const parsed = ActivitySummaryListResponseSchema.safeParse(
			await response.json(),
		);
		if (!parsed.success) throw new Error("伺服器回傳的活動清單格式無效。");
		setActivities(parsed.data.activities);
		const open = parsed.data.activities.filter((item) => item.state === "OPEN");
		if (open.length === 1) {
			await loadActivity(open[0]!.activityId, false);
			window.history.replaceState(
				{},
				"",
				`/teacher/activities/${encodeURIComponent(open[0]!.activityId)}`,
			);
		} else {
			setActivity(null);
			setRecoveryError(false);
		}
	}, [loadActivity]);

	const createTeacherSession = useCallback(async () => {
		setSessionState("loading");
		setError(null);
		try {
			const response = await fetch("/api/teacher/session", {
				method: "POST",
				credentials: "same-origin",
			});
			if (!response.ok) throw new Error(await errorMessage(response));
		} catch (caught) {
			setSessionState("error");
			setError(
				caught instanceof Error ? caught.message : "無法建立本機老師 session。",
			);
			return;
		}
		try {
			const directActivityId = activityIdFromTeacherPath(
				window.location.pathname,
			);
			if (directActivityId) await loadActivity(directActivityId, false);
			else await loadRoot();
			setSessionState("ready");
		} catch (caught) {
			setSessionState("ready");
			setRecoveryError(true);
			setError(caught instanceof Error ? caught.message : "無法恢復老師活動。");
		}
	}, [loadActivity, loadRoot]);

	useEffect(() => {
		if (sessionRequestStarted.current) return;
		sessionRequestStarted.current = true;
		void createTeacherSession();
	}, [createTeacherSession]);

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
			setError(
				caught instanceof Error ? caught.message : "Guided Notes 上傳失敗。",
			);
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
			const confirmed = (await response.json()) as ConfirmImportResponse;
			await loadActivity(confirmed.activityId, true);
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
				<h1>{teacherPageHeading(activity?.state)}</h1>
				<p>
					{activity
						? "活動資料來自伺服器權威快照。"
						: "上傳 Google Sheets 下載的 .xlsx，確認預覽後才會建立活動。"}
				</p>
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
			) : recoveryError ? (
				<section className="card">
					<p>無法恢復指定活動，活動可能不存在或老師 session 已失效。</p>
					<button
						type="button"
						onClick={() => {
							window.history.pushState({}, "", "/");
							setRecoveryError(false);
							setError(null);
							setSessionState("loading");
							void loadRoot()
								.then(() => setSessionState("ready"))
								.catch((caught) => {
									setError(
										caught instanceof Error
											? caught.message
											: "無法讀取活動清單。",
									);
									setSessionState("error");
								});
						}}
					>
						返回活動清單
					</button>
				</section>
			) : activity ? (
				<TeacherGroupManager
					activity={activity}
					onGroupsChange={(groups, revision) =>
						setActivity((current) =>
							current ? { ...current, groups, revision } : current,
						)
					}
					onStateChange={(state, revision) =>
						setActivity((current) => {
							if (!current) return current;
							const nextRevision = revision ?? current.revision;
							return current.state === state &&
								current.revision === nextRevision
								? current
								: { ...current, state, revision: nextRevision };
						})
					}
				/>
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
									<th scope="col">完整題目</th>
									<th scope="col">工作表</th>
									<th scope="col">答案範圍</th>
									<th scope="col">原內容</th>
								</tr>
							</thead>
							<tbody>
								{preview.questions.map((question) => (
									<tr key={`${question.sheetName}:${question.numberCell}`}>
										<td>{question.displayNumber}</td>
										<td className="prompt-text">{question.promptText}</td>
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
						請確認題號、完整題目與答案範圍正確。按下確認後才會保存原始檔並建立
						DRAFT 活動。
					</p>
					<div className="actions">
						<button
							className="secondary"
							type="button"
							onClick={cancel}
							disabled={busy}
						>
							{requestState === "cancelling" ? "取消中…" : "取消匯入"}
						</button>
						<button type="button" onClick={confirm} disabled={busy}>
							{requestState === "confirming" ? "建立中…" : "確認並建立活動"}
						</button>
					</div>
				</section>
			) : (
				<>
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
							<small>
								僅接受 .xlsx；系統會依「題號」、「題目」及「作答」表頭動態辨識。
							</small>
						</label>
						{file && <p className="selected-file">已選擇：{file.name}</p>}
						<button type="submit" disabled={busy}>
							{requestState === "uploading" ? "解析中…" : "上傳並預覽"}
						</button>
					</form>
					{activities.length > 0 && (
						<section className="card activity-list">
							<h2>既有活動</h2>
							<p>請明確選擇要恢復的草稿或已結束活動。</p>
							<ul>
								{activities
									.filter((item) => item.state !== "OPEN")
									.map((item) => (
										<li key={item.activityId}>
											<button
												type="button"
												onClick={() => {
													setError(null);
													setSessionState("loading");
													void loadActivity(item.activityId, true)
														.then(() => setSessionState("ready"))
														.catch((caught) => {
															setError(
																caught instanceof Error
																	? caught.message
																	: "無法恢復活動。",
															);
															setRecoveryError(true);
															setSessionState("ready");
														});
												}}
											>
												開啟 {item.title}
											</button>
											<span>
												{item.state} · {item.questionCount} 題
											</span>
										</li>
									))}
							</ul>
						</section>
					)}
				</>
			)}
		</main>
	);
}
