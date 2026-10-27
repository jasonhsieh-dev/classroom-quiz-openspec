import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import { parseGuidedNotesWorkbook } from "../../apps/server/src/guided-notes/parser.js";
import {
	captureWorkbookSemantics,
	compareWorkbookSemantics,
} from "../../apps/server/src/guided-notes/workbook-semantics.js";

const fixturePath = resolve(
	"tests/fixtures/guided-notes/reference-single-template.xlsx",
);
const e2eDatabasePath = resolve("var/e2e/data/classroom-quiz.sqlite");

function submissionAttemptCount(): number {
	const database = new Database(e2eDatabasePath, { readonly: true });
	try {
		return (
			database
				.prepare("SELECT COUNT(*) AS count FROM submission_attempts")
				.get() as { count: number }
		).count;
	} finally {
		database.close();
	}
}

async function join(page: Page, activityId: string, groupName: string) {
	await page.goto("/student");
	await page.getByLabel("活動識別碼").fill(activityId);
	await page.getByRole("button", { name: "查詢活動" }).click();
	await page.getByLabel("選擇組別").selectOption({ label: groupName });
	await page.getByRole("button", { name: "進入活動" }).click();
	await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
}

async function submit(
	page: Page,
	questionIndex: number,
	answer: string,
	modifying = false,
) {
	await page.locator(".question-grid button").nth(questionIndex).click();
	await page.getByLabel("答案").fill(answer);
	if (modifying) page.once("dialog", (dialog) => dialog.accept());
	await page
		.getByRole("button", { name: modifying ? "修改答案" : "提交答案" })
		.click();
	await expect(page.getByText("本組已提交；最後有效時間：")).toBeVisible();
}

async function jsonFetch(page: Page, url: string, init?: RequestInit) {
	return page.evaluate(
		async ({ target, options }) => {
			const response = await fetch(target, options);
			const body = await response.json().catch(() => null);
			return { status: response.status, body };
		},
		{ target: url, options: init },
	);
}

test("同 profile 老師學生完成搶答、恢復、隱私、截止及 XLSX 匯出", async ({
	browser,
}) => {
	const teacherContext = await browser.newContext({ acceptDownloads: true });
	const secondContext = await browser.newContext();
	const teacher = await teacherContext.newPage();
	const first = await teacherContext.newPage();
	const sameContextSecond = await teacherContext.newPage();
	const second = await secondContext.newPage();
	let droppedClosedFrames = 0;

	await teacher.routeWebSocket(/\/socket\.io\//, (client) => {
		const server = client.connectToServer();
		client.onMessage((message) => server.send(message));
		server.onMessage((message) => {
			if (String(message).includes('"activity.closed"')) {
				droppedClosedFrames += 1;
				return;
			}
			client.send(message);
		});
	});

	try {
		const sourceWorkbook = new ExcelJS.Workbook();
		await sourceWorkbook.xlsx.readFile(fixturePath);
		const sourceMappings = parseGuidedNotesWorkbook(sourceWorkbook);
		await teacher.goto("/");
		await expect(
			teacher.getByRole("heading", { name: "匯入 Guided Notes" }),
		).toBeVisible();
		await teacher.getByLabel("Guided Notes 檔案").setInputFiles(fixturePath);
		await teacher.getByRole("button", { name: "上傳並預覽" }).click();
		await expect(teacher.getByText("匯入預覽")).toBeVisible();
		await expect(teacher.getByText("共 6 題")).toBeVisible();
		await expect(
			teacher.getByText(sourceMappings[0]!.displayNumber, { exact: true }),
		).toBeVisible();
		await expect(
			teacher.getByText(sourceMappings[0]!.promptText, { exact: true }),
		).toBeVisible();
		const confirmed = teacher.waitForResponse(
			(response) =>
				response.url().includes("/confirm") &&
				response.request().method() === "POST",
		);
		await teacher.getByRole("button", { name: "確認並建立活動" }).click();
		const confirmResponse = await confirmed;
		expect(confirmResponse.ok()).toBeTruthy();
		const activityId = (await confirmResponse.json()).activityId as string;
		await expect(
			teacher.getByRole("heading", { name: "設定搶答活動" }),
		).toBeVisible();

		await teacher.getByLabel("組別數量").fill("6");
		await teacher.getByRole("button", { name: "建立組別" }).click();
		for (let index = 1; index <= 6; index += 1) {
			await expect(
				teacher.getByText(`第 ${index} 組`, { exact: true }),
			).toBeVisible();
		}
		const summariesBeforeDraftRefresh = await teacherContext.request.get(
			"/api/teacher/activities",
		);
		const activityCountBeforeDraftRefresh = (
			(await summariesBeforeDraftRefresh.json()).activities as Array<{
				activityId: string;
			}>
		).filter((item) => item.activityId === activityId).length;
		await teacher.reload();
		await expect(
			teacher.getByRole("heading", { name: "設定搶答活動" }),
		).toBeVisible();
		await expect(teacher.getByLabel("組別數量")).toHaveValue("6");
		await expect(teacher.getByText("第 6 組", { exact: true })).toBeVisible();
		const summariesAfterDraftRefresh = await teacherContext.request.get(
			"/api/teacher/activities",
		);
		expect(
			(
				(await summariesAfterDraftRefresh.json()).activities as Array<{
					activityId: string;
				}>
			).filter((item) => item.activityId === activityId),
		).toHaveLength(activityCountBeforeDraftRefresh);
		await teacher.getByRole("button", { name: "開始搶答" }).click();
		await expect(
			teacher.getByRole("heading", { name: "搶答活動進行中" }),
		).toBeVisible();
		await expect(
			teacher.getByText("活動進行中：全部題目已同時開放，組別不可修改。"),
		).toBeVisible();
		await expect(teacher.getByText("組別數量：6")).toBeVisible();
		await expect(teacher.getByText("第 6 組", { exact: true })).toBeVisible();
		await expect(teacher.getByLabel("組別數量")).toHaveCount(0);
		await expect(
			teacher.getByRole("button", { name: /建立組別|重新產生組別/ }),
		).toHaveCount(0);

		await Promise.all([
			join(first, activityId, "第 1 組"),
			join(second, activityId, "第 2 組"),
		]);
		await expect(
			first.getByText(sourceMappings[0]!.promptText, { exact: true }),
		).toBeVisible();
		await expect(
			second.getByText(sourceMappings[0]!.promptText, { exact: true }),
		).toBeVisible();
		const sharedCookies = await teacherContext.cookies();
		expect(sharedCookies.map((cookie) => cookie.name)).toEqual(
			expect.arrayContaining([
				"classroom_buzzer_teacher_session",
				"classroom_buzzer_student_session",
			]),
		);

		await join(sameContextSecond, activityId, "第 2 組");
		await expect(first.getByRole("heading", { name: "第 1 組" })).toBeVisible();
		await first.locator(".question-grid button").first().click();
		await first.getByLabel("答案").fill("不可錯置到第二組的答案");
		const attemptsBeforeIdentityMismatch = submissionAttemptCount();
		await first.getByRole("button", { name: "提交答案" }).click();
		await expect(first.getByRole("alert")).toContainText(
			"此分頁的學生組別已在其他分頁變更",
		);
		expect(submissionAttemptCount()).toBe(attemptsBeforeIdentityMismatch);
		await sameContextSecond.close();
		await join(first, activityId, "第 1 組");

		await Promise.all([
			submit(first, 0, "第一組第一題秘密答案"),
			submit(second, 0, "第二組第一題秘密答案"),
		]);
		await Promise.all([
			submit(first, 1, "第一組第二題初稿"),
			submit(second, 2, "第二組第三題答案"),
		]);
		await submit(second, 0, "第二組第一題修改答案", true);
		await submit(first, 4, "第一組第五題初稿");
		await submit(second, 4, "第二組第五題答案");
		await submit(first, 4, "第一組第五題修改答案", true);

		await expect(teacher.getByText("第一組第一題秘密答案")).toBeVisible();
		await expect(teacher.getByText("第二組第一題修改答案")).toBeVisible();
		await expect(teacher.getByText("第一組第五題修改答案")).toBeVisible();
		const firstTeacherTime = teacher.locator(".live-monitor time").first();
		await expect(firstTeacherTime).toHaveText(
			/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/,
		);
		await expect(firstTeacherTime).toHaveAttribute("datetime", /Z$/);
		await expect(
			teacher.getByText(sourceMappings[0]!.promptText, { exact: true }),
		).toBeVisible();
		await expect(first.getByText("第二組第一題修改答案")).toHaveCount(0);
		await expect(second.getByText("第一組第一題秘密答案")).toHaveCount(0);

		const firstOpenSnapshot = await jsonFetch(
			first,
			`/api/student/activities/${activityId}/snapshot`,
		);
		expect(firstOpenSnapshot.status).toBe(200);
		const openSerialized = JSON.stringify(firstOpenSnapshot.body);
		expect(openSerialized).not.toContain("第二組第一題修改答案");
		expect(openSerialized).not.toContain("rankings");
		expect(openSerialized).not.toContain("receiveSequence");

		const duplicate = await first.evaluate(
			async ({ id }) => {
				const questionId = (
					await (await fetch(`/api/student/activities/${id}/snapshot`)).json()
				).questions[3].id;
				const request = () =>
					fetch(
						`/api/student/activities/${id}/questions/${questionId}/submission`,
						{
							method: "PUT",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								answer: "第一組第四題冪等答案",
								idempotencyKey: "e2e-duplicate",
							}),
						},
					).then(async (response) => ({
						status: response.status,
						body: await response.json(),
					}));
				return [await request(), await request()];
			},
			{ id: activityId },
		);
		expect(duplicate[0]).toEqual(duplicate[1]);

		await teacher.reload();
		await expect(
			teacher.getByRole("heading", { name: "搶答活動進行中" }),
		).toBeVisible();
		await expect(teacher.getByText("組別數量：6")).toBeVisible();
		await expect(teacher.getByText("第 6 組", { exact: true })).toBeVisible();
		await expect(teacher.getByLabel("組別數量")).toHaveCount(0);
		await expect(teacher.getByText("第一組第一題秘密答案")).toBeVisible();
		await expect(teacher.getByText("第二組第一題修改答案")).toBeVisible();
		const cookiesAfterTeacherRefresh = await teacherContext.cookies();
		expect(cookiesAfterTeacherRefresh.map((cookie) => cookie.name)).toEqual(
			expect.arrayContaining([
				"classroom_buzzer_teacher_session",
				"classroom_buzzer_student_session",
			]),
		);

		const secondImport = await teacherContext.request.post(
			"/api/teacher/imports",
			{
				multipart: {
					file: {
						name: "另一活動.xlsx",
						mimeType:
							"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
						buffer: await readFile(fixturePath),
					},
				},
			},
		);
		expect(secondImport.ok()).toBeTruthy();
		const draft = await secondImport.json();
		const secondConfirm = await teacherContext.request.post(
			`/api/teacher/imports/${draft.importId}/confirm`,
			{ data: { title: "另一活動" } },
		);
		expect(secondConfirm.ok()).toBeTruthy();
		const otherActivityId = (await secondConfirm.json()).activityId as string;
		const crossActivity = await teacherContext.request.get(
			`/api/student/activities/${otherActivityId}/snapshot`,
		);
		expect(crossActivity.status()).toBe(403);

		let closeRequests = 0;
		await teacher.route(
			`**/api/teacher/activities/${activityId}/close`,
			async (route) => {
				closeRequests += 1;
				await new Promise((resolve) => setTimeout(resolve, 200));
				await route.continue();
			},
		);
		teacher.once("dialog", (dialog) => dialog.accept());
		const closeButton = teacher.getByRole("button", { name: "結束活動" });
		await closeButton.click();
		await expect(
			teacher.getByRole("button", { name: "結束中…" }),
		).toBeDisabled();
		await expect(
			teacher.getByRole("heading", { name: "唯讀結果" }),
		).toBeVisible();
		await expect(teacher.getByText("組別數量：6")).toBeVisible();
		await expect(teacher.getByText("第 6 組", { exact: true })).toBeVisible();
		await expect(teacher.getByLabel("組別數量")).toHaveCount(0);
		expect(closeRequests).toBe(1);
		expect(droppedClosedFrames).toBeGreaterThan(0);
		const teacherResults = await jsonFetch(
			teacher,
			`/api/teacher/activities/${activityId}/results`,
		);
		expect(teacherResults.status).toBe(200);
		expect(teacherResults.body.questions[0].rankings).toMatchObject([
			{ rank: 1, answer: "第一組第一題秘密答案" },
			{ rank: 2, answer: "第二組第一題修改答案" },
		]);
		expect(teacherResults.body.questions[4].rankings).toMatchObject([
			{ rank: 1, answer: "第二組第五題答案" },
			{ rank: 2, answer: "第一組第五題修改答案" },
		]);
		const firstResultTime = teacher.locator(".question-result time").first();
		await expect(firstResultTime).toHaveText(
			/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/,
		);
		await expect(firstResultTime).toHaveAttribute("datetime", /Z$/);

		await expect(
			first.getByRole("heading", { name: "唯讀結果" }),
		).toBeVisible();
		await expect(
			second.getByRole("heading", { name: "唯讀結果" }),
		).toBeVisible();
		await expect(first.getByText("第一組第一題秘密答案")).toBeVisible();
		await expect(second.getByText("第二組第一題修改答案")).toBeVisible();
		expect(await first.locator("body").textContent()).not.toContain(
			"第二組第一題修改答案",
		);
		expect(await second.locator("body").textContent()).not.toContain(
			"第一組第一題秘密答案",
		);

		const studentResults = await jsonFetch(
			second,
			`/api/student/activities/${activityId}/results`,
		);
		expect(studentResults.status).toBe(200);
		const resultSerialized = JSON.stringify(studentResults.body);
		expect(studentResults.body.questions[0].ownResult).toMatchObject({
			status: "ANSWERED",
			answer: "第二組第一題修改答案",
			rank: 2,
		});
		expect(resultSerialized).not.toContain("第一組第一題秘密答案");
		expect(resultSerialized).not.toContain("serverReceivedAt");
		expect(resultSerialized).not.toContain("rankings");

		const closedSnapshot = await jsonFetch(
			first,
			`/api/student/activities/${activityId}/snapshot`,
		);
		const questionId = closedSnapshot.body.questions[0].id as string;
		const attemptsBeforeRejectedSubmit = submissionAttemptCount();
		const rejected = await jsonFetch(
			first,
			`/api/student/activities/${activityId}/questions/${questionId}/submission`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					answer: "截止後延遲答案",
					idempotencyKey: "after-close",
				}),
			},
		);
		expect(rejected.status).toBe(409);
		expect(submissionAttemptCount()).toBe(attemptsBeforeRejectedSubmit);
		await expect(first.getByLabel("答案")).toHaveCount(0);

		const downloadPromise = teacher.waitForEvent("download");
		await teacher
			.getByRole("button", { name: "下載已回填 Guided Notes" })
			.click();
		const download = await downloadPromise;
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const source = new ExcelJS.Workbook();
		await source.xlsx.readFile(fixturePath);
		const mappings = parseGuidedNotesWorkbook(source);
		source
			.getWorksheet(mappings[0]!.sheetName)!
			.getCell(mappings[0]!.answerAnchor).value = "第一組第一題秘密答案";
		source
			.getWorksheet(mappings[1]!.sheetName)!
			.getCell(mappings[1]!.answerAnchor).value = "第一組第二題初稿";
		source
			.getWorksheet(mappings[2]!.sheetName)!
			.getCell(mappings[2]!.answerAnchor).value = "第二組第三題答案";
		source
			.getWorksheet(mappings[3]!.sheetName)!
			.getCell(mappings[3]!.answerAnchor).value = "第一組第四題冪等答案";
		source
			.getWorksheet(mappings[4]!.sheetName)!
			.getCell(mappings[4]!.answerAnchor).value = "第二組第五題答案";
		const exported = new ExcelJS.Workbook();
		await exported.xlsx.readFile(downloadedPath!);
		expect(
			compareWorkbookSemantics(
				captureWorkbookSemantics(source),
				captureWorkbookSemantics(exported),
			),
		).toEqual([]);

		await teacher.reload();
		await expect(
			teacher.getByRole("heading", { name: "活動結果與匯出" }),
		).toBeVisible();
		await expect(teacher.getByText("組別數量：6")).toBeVisible();
		await expect(teacher.getByText("第 6 組", { exact: true })).toBeVisible();
		await expect(teacher.getByLabel("組別數量")).toHaveCount(0);
		await expect(teacher.getByText("第一組第一題秘密答案")).toBeVisible();
		const secondDownloadPromise = teacher.waitForEvent("download");
		await teacher
			.getByRole("button", { name: "下載已回填 Guided Notes" })
			.click();
		expect(await (await secondDownloadPromise).path()).not.toBeNull();
	} finally {
		await Promise.all([teacherContext.close(), secondContext.close()]);
	}
});
