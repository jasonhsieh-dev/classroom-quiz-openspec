import type { WritebackPlan } from "./google-sheets-writeback-plan.js";
import { vi } from "vitest";
import { createTestDatabase } from "../db/test-database.js";
import { GroupService } from "../services/group-service.js";
import { ActivityLifecycleService } from "../services/activity-lifecycle.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { SubmissionService } from "../services/submission-service.js";
import { SessionRepository, QuestionRepository } from "../db/repositories/index.js";
import { GoogleSheetsImportService } from "./google-sheets-import-service.js";
import { setup, sheet, teacher, url } from "./google-sheets-test-fixtures.js";
import { GoogleSheetsWritebackPlanner } from "./google-sheets-writeback-plan.js";
export { teacher };
export async function writebackFixture(options: { noAnswers?: boolean; formula?: boolean } = {}) {
  const db = createTestDatabase();
  const source = sheet();
  if (options.formula) source.data![0]!.rowData![1]!.values![1] = { userEnteredValue: { formulaValue: '=IF(TRUE,"","")' },formattedValue: "",userEnteredFormat: { backgroundColor: { red: 1 } } };
  const cloud = setup(source);
  const readMock = cloud.execute.getMockImplementation()!;
  cloud.execute.mockImplementation(async (session,input) => structuredClone(await readMock(session,input)));
  const imports = new GoogleSheetsImportService(db.database,cloud.reader);
  const draft = await imports.createDraft(teacher,url,0);
  const activity = await imports.confirmDraft(teacher,draft.importId,"雲端搶答");
  const groups = new GroupService(db.database);
  const sessions = new SessionRepository(db.database);
  const students = ["甲","乙"].map((name) => {
    const group = groups.create(activity.id,name);
    return sessions.create({ id: name,role: "student",activityId: activity.id,groupId: group.id,createdAt: new Date().toISOString(),expiresAt: "2099-01-01" });
  });
  new ActivityLifecycleService(db.database).open(activity.id);
  const questions = new QuestionRepository(db.database).listByActivity(activity.id);
  if (!options.noAnswers) {
    const submit = new SubmissionService(db.database);
    submit.submit(students[0]!,{ questionId: questions[0]!.id,answer: "=答案文字",idempotencyKey: "a" });
    submit.submit(students[1]!,{ questionId: questions[0]!.id,answer: "第二名",idempotencyKey: "b" });
    submit.submit(students[1]!,{ questionId: questions[1]!.id,answer: "第二題答案",idempotencyKey: "c" });
  }
  new ActivityCloseService(db.database).close(activity.id);
  function apply(plan: WritebackPlan) {
    for (const target of plan.targets) {
      const row = Number(target.anchor.match(/[0-9]+$/)![0]);
      const old = source.data![0]!.rowData![row-3]!.values![1]!;
      source.data![0]!.rowData![row-3]!.values![1] = { ...old,userEnteredValue: { stringValue: target.answer },formattedValue: target.answer };
    }
  }
  return { db,...cloud,apply,activityId: activity.id,planner: new GoogleSheetsWritebackPlanner(db.database,cloud.reader),
    batch: vi.fn(),questions };
}
