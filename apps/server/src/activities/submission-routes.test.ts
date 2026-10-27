import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import {
	SessionService,
	STUDENT_SESSION_COOKIE_NAME,
} from "../auth/session-auth.js";
import {
	ActivityRepository,
	GroupRepository,
	QuestionRepository,
	SessionRepository,
	SubmissionRepository,
} from "../db/repositories/index.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { ActivityStateService } from "../services/activity-state.js";
import { SubmissionService } from "../services/submission-service.js";

const databases: TestDatabase[] = [];
const baseTime = "2026-10-24T02:00:00.000Z";
afterEach(() => {
	for (const item of databases.splice(0)) item.cleanup();
});

function setup(clockValues: string[] = ["2026-10-24T02:01:00.000Z"]) {
	const testDatabase = createTestDatabase();
	databases.push(testDatabase);
	const sessions = new SessionService(testDatabase.database, {
		now: () => new Date(baseTime),
	});
	let clockIndex = 0;
	const submissions = new SubmissionService(testDatabase.database, {
		clock: () => clockValues[Math.min(clockIndex++, clockValues.length - 1)]!,
	});
	const app = createApp({
		registerRoutes(instance) {
			registerApplicationRoutes(
				instance,
				testDatabase.database,
				{
					data: join(testDatabase.directory, "data"),
					uploads: join(testDatabase.directory, "uploads"),
					exports: join(testDatabase.directory, "exports"),
				},
				{ sessions, submissions },
			);
		},
	});
	return { app, testDatabase };
}

function createActivity(testDatabase: TestDatabase, id: string) {
	new ActivityRepository(testDatabase.database).create({
		id,
		title: id,
		sourceFilePath: `${id}/source.xlsx`,
		sourceSha256: "synthetic",
		createdAt: baseTime,
	});
}

function addQuestion(
	testDatabase: TestDatabase,
	activityId: string,
	id: string,
	sortOrder: number,
) {
	new QuestionRepository(testDatabase.database).create({
		id,
		activityId,
		displayNumber: id,
		promptText: `完整題目 ${id}`,
		promptRange: `C${sortOrder + 2}`,
		sortOrder,
		sheetName: "學習單",
		numberCell: `A${sortOrder + 2}`,
		answerRange: `B${sortOrder + 2}`,
		answerAnchor: `B${sortOrder + 2}`,
		originalAnswer: null,
	});
}

function addGroup(testDatabase: TestDatabase, activityId: string, id: string) {
	new GroupRepository(testDatabase.database).create({
		id,
		activityId,
		name: id,
		createdAt: baseTime,
	});
}

function addSession(
	testDatabase: TestDatabase,
	id: string,
	activityId: string,
	groupId: string,
) {
	new SessionRepository(testDatabase.database).create({
		id,
		role: "student",
		activityId,
		groupId,
		createdAt: baseTime,
		expiresAt: "2026-10-24T10:00:00.000Z",
	});
}

function fixture(testDatabase: TestDatabase, open = true) {
	createActivity(testDatabase, "a1");
	addGroup(testDatabase, "a1", "g1");
	addGroup(testDatabase, "a1", "g2");
	addQuestion(testDatabase, "a1", "q1", 0);
	addQuestion(testDatabase, "a1", "q2", 1);
	addSession(testDatabase, "s1", "a1", "g1");
	addSession(testDatabase, "s1b", "a1", "g1");
	addSession(testDatabase, "s2", "a1", "g2");
	if (open)
		new ActivityStateService(testDatabase.database, () => baseTime).transition(
			"a1",
			"OPEN",
		);
}

function cookie(id: string) {
	return `${STUDENT_SESSION_COOKIE_NAME}=${id}`;
}
function path(questionId: string, activityId = "a1") {
	return `/api/student/activities/${activityId}/questions/${questionId}/submission`;
}
function counts(testDatabase: TestDatabase) {
	return {
		attempts: (
			testDatabase.database
				.prepare("SELECT COUNT(*) count FROM submission_attempts")
				.get() as { count: number }
		).count,
		current: (
			testDatabase.database
				.prepare("SELECT COUNT(*) count FROM current_submissions")
				.get() as { count: number }
		).count,
	};
}

describe("學生提交 API", () => {
	it("學生 cookie 已被另一分頁切換組別時拒絕舊分頁的身分斷言且不建立提交", async () => {
		const { app, testDatabase } = setup();
		fixture(testDatabase);
		const rejected = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s2"))
			.send({
				answer: "不可錯置的答案",
				idempotencyKey: "stale-tab",
				expectedGroupId: "g1",
			})
			.expect(409);
		expect(rejected.body).toEqual({
			error: {
				code: "STUDENT_SESSION_CHANGED",
				message: expect.stringContaining("本次提交未保存"),
			},
		});
		expect(counts(testDatabase)).toEqual({ attempts: 0, current: 0 });
		expect(
			new ActivityRepository(testDatabase.database).getById("a1"),
		).toMatchObject({
			nextReceiveSequence: 0,
			revision: 1,
		});
	});

	it("拒絕無 session、未開放活動、空白／超長答案與不存在或跨活動題目，且不改變資料", async () => {
		const { app, testDatabase } = setup();
		fixture(testDatabase, false);
		await request(app)
			.put(path("q1"))
			.send({ answer: "答案", idempotencyKey: "k" })
			.expect(401);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案", idempotencyKey: "k" })
			.expect(409);
		new ActivityStateService(testDatabase.database, () => baseTime).transition(
			"a1",
			"OPEN",
		);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "  \n ", idempotencyKey: "blank" })
			.expect(400);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "字".repeat(2001), idempotencyKey: "long" })
			.expect(400);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案" })
			.expect(400);
		await request(app)
			.put(path("missing"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案", idempotencyKey: "missing" })
			.expect(404);
		createActivity(testDatabase, "a2");
		addQuestion(testDatabase, "a2", "other-q", 0);
		await request(app)
			.put(path("other-q"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案", idempotencyKey: "other" })
			.expect(404);
		await request(app)
			.put(path("q1", "a2"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案", idempotencyKey: "scope" })
			.expect(403);
		expect(counts(testDatabase)).toEqual({ attempts: 0, current: 0 });
		expect(
			new ActivityRepository(testDatabase.database).getById("a1"),
		).toMatchObject({ nextReceiveSequence: 0, revision: 1 });
	});

	it("在 immediate 交易內配置單調序號，使用伺服器時間與 session 組別並忽略客戶端欄位", async () => {
		const { app, testDatabase } = setup([
			"2026-10-24T02:01:00.000Z",
			"2026-10-24T02:02:00.000Z",
		]);
		fixture(testDatabase);
		const first = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({
				answer: "  第一個答案  ",
				idempotencyKey: "k1",
				groupId: "g2",
				clientReceivedAt: "1900-01-01T00:00:00.000Z",
			})
			.expect(200);
		const second = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s2"))
			.send({
				answer: "第二個答案",
				idempotencyKey: "k2",
				groupId: "g1",
				serverReceivedAt: "1900-01-01T00:00:00.000Z",
			})
			.expect(200);
		expect(first.body).toEqual({
			questionId: "q1",
			answer: "第一個答案",
			serverReceivedAt: "2026-10-24T02:01:00.000Z",
		});
		expect(second.body.serverReceivedAt).toBe("2026-10-24T02:02:00.000Z");
		const attempts = new SubmissionRepository(
			testDatabase.database,
		).listAttemptsByActivity("a1");
		expect(
			attempts.map(({ groupId, receiveSequence, serverReceivedAt }) => ({
				groupId,
				receiveSequence,
				serverReceivedAt,
			})),
		).toEqual([
			{
				groupId: "g1",
				receiveSequence: 1,
				serverReceivedAt: "2026-10-24T02:01:00.000Z",
			},
			{
				groupId: "g2",
				receiveSequence: 2,
				serverReceivedAt: "2026-10-24T02:02:00.000Z",
			},
		]);
		expect(
			new ActivityRepository(testDatabase.database).getById("a1"),
		).toMatchObject({ nextReceiveSequence: 2, revision: 3 });
	});

	it("修改建立不可變歷程並只移動目前有效指標及有效接收資訊", async () => {
		const { app, testDatabase } = setup([
			"2026-10-24T02:01:00.000Z",
			"2026-10-24T02:05:00.000Z",
		]);
		fixture(testDatabase);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "舊答案", idempotencyKey: "old" })
			.expect(200);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "新答案", idempotencyKey: "new" })
			.expect(200);
		const repository = new SubmissionRepository(testDatabase.database);
		expect(
			repository
				.listAttemptsByActivity("a1")
				.map(({ answer, receiveSequence }) => ({ answer, receiveSequence })),
		).toEqual([
			{ answer: "舊答案", receiveSequence: 1 },
			{ answer: "新答案", receiveSequence: 2 },
		]);
		expect(repository.findCurrent("q1", "g1")).toMatchObject({
			answer: "新答案",
			serverReceivedAt: "2026-10-24T02:05:00.000Z",
			receiveSequence: 2,
		});
	});

	it("相同 session、題目與 key 的相同正規化答案回傳原結果，不同答案回傳衝突且皆不改變資料", async () => {
		const { app, testDatabase } = setup([
			"2026-10-24T02:01:00.000Z",
			"2026-10-24T09:00:00.000Z",
		]);
		fixture(testDatabase);
		const original = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案", idempotencyKey: " stable-key " })
			.expect(200);
		const replay = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "  答案  ", idempotencyKey: "stable-key" })
			.expect(200);
		expect(replay.body).toEqual(original.body);
		const beforeConflict = new ActivityRepository(
			testDatabase.database,
		).getById("a1");
		const conflict = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "不同答案", idempotencyKey: "stable-key" })
			.expect(409);
		expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
		expect(counts(testDatabase)).toEqual({ attempts: 1, current: 1 });
		expect(
			new ActivityRepository(testDatabase.database).getById("a1"),
		).toMatchObject({
			nextReceiveSequence: beforeConflict.nextReceiveSequence,
			revision: beforeConflict.revision,
		});
		expect(
			new SubmissionRepository(testDatabase.database).findCurrent("q1", "g1"),
		).toMatchObject({
			answer: "答案",
			serverReceivedAt: original.body.serverReceivedAt,
		});

		testDatabase.database
			.prepare(
				"UPDATE activities SET state = 'CLOSED', closed_at = ? WHERE id = 'a1'",
			)
			.run("2026-10-24T03:00:00.000Z");
		const closedReplay = await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "答案", idempotencyKey: "stable-key" })
			.expect(200);
		expect(closedReplay.body).toEqual(original.body);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "截止後新答案", idempotencyKey: "after-close" })
			.expect(409, {
				error: {
					code: "ACTIVITY_CLOSED",
					message: "活動已結束，不得再提交或修改答案。",
				},
			});
		expect(counts(testDatabase)).toEqual({ attempts: 1, current: 1 });
	});

	it("同組可獨立提交多題，且同組另一 session 只更新目標題目的 current pointer", async () => {
		const { app, testDatabase } = setup([
			"2026-10-24T02:01:00.000Z",
			"2026-10-24T02:02:00.000Z",
			"2026-10-24T02:03:00.000Z",
		]);
		fixture(testDatabase);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "第一題舊答案", idempotencyKey: "q1-old" })
			.expect(200);
		await request(app)
			.put(path("q2"))
			.set("Cookie", cookie("s1"))
			.send({ answer: "第二題答案", idempotencyKey: "q2" })
			.expect(200);
		await request(app)
			.put(path("q1"))
			.set("Cookie", cookie("s1b"))
			.send({ answer: "第一題新答案", idempotencyKey: "q1-new" })
			.expect(200);
		const repository = new SubmissionRepository(testDatabase.database);
		expect(repository.findCurrent("q1", "g1")).toMatchObject({
			answer: "第一題新答案",
			sessionId: "s1b",
			receiveSequence: 3,
		});
		expect(repository.findCurrent("q2", "g1")).toMatchObject({
			answer: "第二題答案",
			sessionId: "s1",
			receiveSequence: 2,
		});
		expect(repository.listAttemptsByActivity("a1")).toHaveLength(3);
	});
});
