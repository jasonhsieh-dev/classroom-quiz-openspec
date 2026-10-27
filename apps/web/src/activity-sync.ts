import type {
	ActivityClosedEvent,
	ActivityOpenedEvent,
	StudentActivitySnapshot,
	StudentSubmissionUpdatedEvent,
	TeacherActivitySnapshot,
	TeacherSubmissionUpdatedEvent,
} from "@classroom-buzzer/shared";

export function preferNewestSnapshot<
	T extends StudentActivitySnapshot | TeacherActivitySnapshot,
>(current: T | null, incoming: T): T {
	if (!current || current.activityId !== incoming.activityId) return incoming;
	return incoming.revision >= current.revision ? incoming : current;
}

type StateEvent = ActivityOpenedEvent | ActivityClosedEvent;

function isNewer(
	snapshot: { activityId: string; revision: number },
	event: { activityId: string; revision: number },
): boolean {
	return (
		snapshot.activityId === event.activityId &&
		event.revision > snapshot.revision
	);
}

export function applyActivityState<
	T extends StudentActivitySnapshot | TeacherActivitySnapshot,
>(snapshot: T, event: StateEvent): T {
	return isNewer(snapshot, event)
		? { ...snapshot, state: event.state, revision: event.revision }
		: snapshot;
}

export function applyStudentSubmission(
	snapshot: StudentActivitySnapshot,
	event: StudentSubmissionUpdatedEvent,
): StudentActivitySnapshot {
	if (!isNewer(snapshot, event)) return snapshot;
	return {
		...snapshot,
		revision: event.revision,
		submissions: [
			...snapshot.submissions.filter(
				(item) => item.questionId !== event.questionId,
			),
			{
				questionId: event.questionId,
				answer: event.answer,
				serverReceivedAt: event.serverReceivedAt,
			},
		],
	};
}

export function applyTeacherSubmission(
	snapshot: TeacherActivitySnapshot,
	event: TeacherSubmissionUpdatedEvent,
): TeacherActivitySnapshot {
	if (!isNewer(snapshot, event)) return snapshot;
	return {
		...snapshot,
		revision: event.revision,
		submissions: [
			...snapshot.submissions.filter(
				(item) =>
					item.questionId !== event.questionId ||
					item.groupId !== event.groupId,
			),
			{
				questionId: event.questionId,
				groupId: event.groupId,
				answer: event.answer,
				serverReceivedAt: event.serverReceivedAt,
			},
		],
	};
}
