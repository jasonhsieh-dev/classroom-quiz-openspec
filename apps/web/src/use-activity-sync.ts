import type {
	ActivityClosedEvent,
	ActivityOpenedEvent,
	ServerToClientEvents,
	StudentActivitySnapshot,
	StudentSubmissionUpdatedEvent,
	TeacherActivitySnapshot,
	TeacherSubmissionUpdatedEvent,
} from "@classroom-buzzer/shared";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
	applyActivityState,
	applyStudentSubmission,
	applyTeacherSubmission,
	preferNewestSnapshot,
} from "./activity-sync.js";

export type SyncStatus = "loading" | "synced" | "syncing" | "unsynced";
export type ActivitySocket = Socket<
	ServerToClientEvents,
	Record<string, never>
>;
export type ActivitySocketUsage = "teacher" | "student";
export type ActivitySocketFactory = (
	activityId: string,
	usage: ActivitySocketUsage,
) => ActivitySocket;

export const createActivitySocket: ActivitySocketFactory = (
	activityId,
	usage,
) =>
	io({
		auth: { activityId, usage },
		withCredentials: true,
	});

interface SyncResult<T> {
	snapshot: T | null;
	setSnapshot: Dispatch<SetStateAction<T | null>>;
	status: SyncStatus;
	error: string | null;
	refresh: () => Promise<void>;
}

function useSnapshot<
	T extends StudentActivitySnapshot | TeacherActivitySnapshot,
>(
	activityId: string,
	path: string,
	applySubmission: (snapshot: T, event: never) => T,
	usage: ActivitySocketUsage,
	socketFactory: ActivitySocketFactory,
): SyncResult<T> {
	const [snapshot, setSnapshot] = useState<T | null>(null);
	const [status, setStatus] = useState<SyncStatus>("loading");
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setStatus((current) => (current === "loading" ? "loading" : "syncing"));
		try {
			const response = await fetch(path, { credentials: "same-origin" });
			if (!response.ok) throw new Error("無法取得權威活動快照。");
			const incoming = (await response.json()) as T;
			setSnapshot((current) => preferNewestSnapshot(current, incoming));
			setError(null);
			setStatus("synced");
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "無法取得權威活動快照。",
			);
			setStatus("unsynced");
		}
	}, [path]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		const socket = socketFactory(activityId, usage);
		const stateChanged = (event: ActivityOpenedEvent | ActivityClosedEvent) => {
			setSnapshot((current) =>
				current ? applyActivityState(current, event) : current,
			);
		};
		const submissionChanged = (
			event: StudentSubmissionUpdatedEvent | TeacherSubmissionUpdatedEvent,
		) => {
			setSnapshot((current) =>
				current ? applySubmission(current, event as never) : current,
			);
		};
		const connected = () => {
			void refresh();
		};
		const disconnected = () => {
			setStatus("unsynced");
			setError("即時連線已中斷；重新連線後將重新取得權威快照。");
		};
		socket.on("activity.opened", stateChanged);
		socket.on("activity.closed", stateChanged);
		socket.on("submission.updated", submissionChanged);
		socket.on("connect", connected);
		socket.on("disconnect", disconnected);
		socket.on("connect_error", disconnected);
		return () => {
			socket.off("activity.opened", stateChanged);
			socket.off("activity.closed", stateChanged);
			socket.off("submission.updated", submissionChanged);
			socket.off("connect", connected);
			socket.off("disconnect", disconnected);
			socket.off("connect_error", disconnected);
			socket.disconnect();
		};
	}, [activityId, applySubmission, refresh, socketFactory, usage]);

	return { snapshot, setSnapshot, status, error, refresh };
}

export function useStudentActivitySync(
	activityId: string,
	socketFactory: ActivitySocketFactory = createActivitySocket,
): SyncResult<StudentActivitySnapshot> {
	return useSnapshot(
		activityId,
		`/api/student/activities/${activityId}/snapshot`,
		applyStudentSubmission as (
			snapshot: StudentActivitySnapshot,
			event: never,
		) => StudentActivitySnapshot,
		"student",
		socketFactory,
	);
}

export function useTeacherActivitySync(
	activityId: string,
	socketFactory: ActivitySocketFactory = createActivitySocket,
): SyncResult<TeacherActivitySnapshot> {
	return useSnapshot(
		activityId,
		`/api/teacher/activities/${activityId}/snapshot`,
		applyTeacherSubmission as (
			snapshot: TeacherActivitySnapshot,
			event: never,
		) => TeacherActivitySnapshot,
		"teacher",
		socketFactory,
	);
}
