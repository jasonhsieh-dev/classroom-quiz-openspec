import type {
	StudentActivitySnapshot,
	TeacherActivitySnapshot,
} from "@classroom-buzzer/shared";
import { describe, expect, it } from "vitest";
import {
	applyActivityState,
	applyStudentSubmission,
	applyTeacherSubmission,
	preferNewestSnapshot,
} from "./activity-sync.js";

const student: StudentActivitySnapshot = {
	role: "student",
	activityId: "a1",
	state: "OPEN",
	revision: 5,
	group: { id: "g1", name: "第一組" },
	questions: [
		{
			id: "q1",
			displayNumber: "1",
			promptText: "第一題完整題目",
			sortOrder: 0,
		},
	],
	submissions: [],
	results: null,
};

describe("前端 revision 同步器", () => {
	it("延遲返回的舊 HTTP snapshot 不覆蓋較新的 Socket.IO 狀態", () => {
		const newer = { ...student, revision: 8 };
		expect(preferNewestSnapshot(newer, { ...student, revision: 7 })).toBe(
			newer,
		);
		expect(preferNewestSnapshot(newer, { ...student, revision: 8 })).not.toBe(
			newer,
		);
	});

	it("忽略舊、重複及亂序事件，但直接接受不連續的較新 revision", () => {
		expect(
			applyActivityState(student, {
				activityId: "a1",
				state: "CLOSED",
				revision: 4,
			}),
		).toBe(student);
		expect(
			applyActivityState(student, {
				activityId: "a1",
				state: "CLOSED",
				revision: 5,
			}),
		).toBe(student);
		expect(
			applyActivityState(student, {
				activityId: "other",
				state: "CLOSED",
				revision: 99,
			}),
		).toBe(student);
		expect(
			applyActivityState(student, {
				activityId: "a1",
				state: "CLOSED",
				revision: 12,
			}),
		).toMatchObject({
			state: "CLOSED",
			revision: 12,
		});
	});

	it("學生只套用本組裁切事件且不要求 revision 連續", () => {
		const updated = applyStudentSubmission(student, {
			activityId: "a1",
			questionId: "q1",
			answer: "本組新答案",
			serverReceivedAt: "2026-10-24T03:00:00.000Z",
			revision: 9,
		});
		expect(updated).toMatchObject({
			revision: 9,
			submissions: [{ questionId: "q1", answer: "本組新答案" }],
		});
		expect(JSON.stringify(updated)).not.toContain("groupId");
		expect(
			applyStudentSubmission(updated, {
				activityId: "a1",
				questionId: "q1",
				answer: "過期答案",
				serverReceivedAt: "2026-10-24T02:00:00.000Z",
				revision: 8,
			}),
		).toBe(updated);
	});

	it("老師依題目與組別更新目前答案，不保留失效答案", () => {
		const teacher: TeacherActivitySnapshot = {
			title: "測試活動",
			role: "teacher",
			activityId: "a1",
			state: "OPEN",
			revision: 2,
			groups: [{ id: "g1", name: "第一組" }],
			questions: student.questions,
			submissions: [
				{
					questionId: "q1",
					groupId: "g1",
					answer: "舊答案",
					serverReceivedAt: "2026-10-24T01:00:00.000Z",
				},
			],
			results: null,
		};
		const updated = applyTeacherSubmission(teacher, {
			activityId: "a1",
			questionId: "q1",
			groupId: "g1",
			answer: "新答案",
			serverReceivedAt: "2026-10-24T02:00:00.000Z",
			revision: 3,
		});
		expect(updated.submissions).toEqual([
			{
				questionId: "q1",
				groupId: "g1",
				answer: "新答案",
				serverReceivedAt: "2026-10-24T02:00:00.000Z",
			},
		]);
	});
});
