import ExcelJS from "exceljs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { SESSION_COOKIE_NAME, SessionService } from "../auth/session-auth.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { ActivityRepository, GroupRepository, QuestionRepository, SessionRepository } from "../db/repositories/index.js";
import { ActivityStateService } from "../services/activity-state.js";
import { SubmissionService } from "../services/submission-service.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { guidedNotesFixturePath } from "./test-fixtures.js";
import { parseGuidedNotesWorkbook } from "./parser.js";

const databases: TestDatabase[] = [];
afterEach(() => { for (const item of databases.splice(0)) item.cleanup(); });
const now = "2026-10-25T04:00:00.000Z";
const cookie = (id: string) => `${SESSION_COOKIE_NAME}=${id}`;

async function setup() {
  const test = createTestDatabase(); databases.push(test);
  const paths = { data: join(test.directory, "data"), uploads: join(test.directory, "uploads"), exports: join(test.directory, "exports") };
  const sourcePath = join(paths.uploads, "activities", "a1", "source.xlsx"); await mkdir(join(paths.uploads, "activities", "a1"), { recursive: true });
  const source = await readFile(guidedNotesFixturePath("reference-single-template.xlsx")); await writeFile(sourcePath, source);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(sourcePath); const mappings = parseGuidedNotesWorkbook(workbook);
  new ActivityRepository(test.database).create({ id: "a1", title: "路由匯出", sourceFilePath: sourcePath, sourceSha256: createHash("sha256").update(source).digest("hex"), createdAt: now });
  const questions = new QuestionRepository(test.database);
  mappings.forEach((mapping, index) => { questions.create({ id: `q${index + 1}`, activityId: "a1", sortOrder: index, ...mapping }); });
  new GroupRepository(test.database).create({ id: "g1", activityId: "a1", name: "第一組", createdAt: now });
  const sessions = new SessionRepository(test.database);
  const student = sessions.create({ id: "student", role: "student", activityId: "a1", groupId: "g1", createdAt: now, expiresAt: "2026-10-26T00:00:00.000Z" });
  sessions.create({ id: "teacher", role: "teacher", activityId: null, groupId: null, createdAt: now, expiresAt: "2026-10-26T00:00:00.000Z" });
  new ActivityStateService(test.database, () => now).transition("a1", "OPEN");
  new SubmissionService(test.database, { clock: () => now }).submit(student, { questionId: "q1", answer: "下載答案", idempotencyKey: "once" });
  const sessionService = new SessionService(test.database, { now: () => new Date(now) });
  const app = createApp({ registerRoutes(instance) { registerApplicationRoutes(instance, test.database, paths, { sessions: sessionService }); } });
  return { app, test };
}

describe("老師 Guided Notes 匯出 API", () => {
  it("只有老師可下載 CLOSED 活動的 XLSX", async () => {
    const { app, test } = await setup(); new ActivityCloseService(test.database, () => now).close("a1");
    await request(app).post("/api/teacher/activities/a1/exports").expect(401);
    await request(app).post("/api/teacher/activities/a1/exports").set("Cookie", cookie("student")).expect(403);
    const response = await request(app).post("/api/teacher/activities/a1/exports").set("Cookie", cookie("teacher"));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["x-export-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(response.headers["content-length"])).toBeGreaterThan(0);
  });

  it("OPEN 活動禁止下載", async () => {
    const { app } = await setup();
    const response = await request(app).post("/api/teacher/activities/a1/exports").set("Cookie", cookie("teacher")).expect(409);
    expect(response.body.error.code).toBe("ACTIVITY_NOT_CLOSED");
  });
});
