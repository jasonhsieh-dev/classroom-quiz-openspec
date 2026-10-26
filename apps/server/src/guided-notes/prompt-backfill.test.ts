import { afterEach, describe, expect, it } from "vitest";
import {
  ActivityRepository,
  QuestionRepository,
} from "../db/repositories/index.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { parseGuidedNotesWorkbook } from "./parser.js";
import { backfillQuestionPrompts } from "./prompt-backfill.js";
import {
  guidedNotesFixturePath,
  loadGuidedNotesFixture,
} from "./test-fixtures.js";

const databases: TestDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup();
});

function createDatabase(): TestDatabase {
  const database = createTestDatabase();
  databases.push(database);
  return database;
}

async function seedActivity(
  testDatabase: TestDatabase,
  activityId: string,
  fixture: string,
  sourceFilePath = guidedNotesFixturePath(fixture),
): Promise<void> {
  const workbook = await loadGuidedNotesFixture(fixture);
  const mappings = parseGuidedNotesWorkbook(workbook);
  const activities = new ActivityRepository(testDatabase.database);
  const questions = new QuestionRepository(testDatabase.database);
  activities.create({
    id: activityId,
    title: activityId,
    sourceFilePath,
    sourceSha256: `sha-${activityId}`,
    createdAt: `2026-10-23T01:00:0${databases.length}.000Z`,
  });
  mappings.forEach((mapping, index) => {
    const { promptText: _promptText, promptRange: _promptRange, ...legacyMapping } = mapping;
    questions.create({
      id: `${activityId}-q${index + 1}`,
      activityId,
      sortOrder: index,
      ...legacyMapping,
    });
  });
}

describe("歷史 activity 題目文字回填", () => {
  it("核對題號與答案 mapping 後以單一活動交易回填題目文字", async () => {
    const testDatabase = createDatabase();
    await seedActivity(testDatabase, "success", "reference-single-template.xlsx");

    const report = await backfillQuestionPrompts(testDatabase.database);
    const records = new QuestionRepository(testDatabase.database).listByActivity("success");
    expect(report).toMatchObject({ updatedActivityIds: ["success"], failures: [] });
    expect(records).toHaveLength(6);
    expect(records[0]).toMatchObject({
      displayNumber: "1",
      promptText: expect.stringContaining("電腦系統中負責執行程式指令"),
      promptRange: "C5:F5",
      numberCell: "B5",
      answerRange: "G5:H5",
      answerAnchor: "G5",
    });
  });

  it("來源檔遺失時保留 nullable 題目資料且不中止流程", async () => {
    const testDatabase = createDatabase();
    await seedActivity(
      testDatabase,
      "missing-source",
      "reference-single-template.xlsx",
      `${testDatabase.directory}/missing.xlsx`,
    );

    const report = await backfillQuestionPrompts(testDatabase.database);
    expect(report.failures).toEqual([
      expect.objectContaining({ activityId: "missing-source" }),
    ]);
    expect(new QuestionRepository(testDatabase.database)
      .listByActivity("missing-source")
      .every((question) => question.promptText === null)).toBe(true);
  });

  it("舊格式缺少題目表頭時不猜測內容也不部分更新", async () => {
    const testDatabase = createDatabase();
    new ActivityRepository(testDatabase.database).create({
      id: "old-format",
      title: "old-format",
      sourceFilePath: guidedNotesFixturePath("invalid-missing-header.xlsx"),
      sourceSha256: "sha-old-format",
      createdAt: "2026-10-23T01:00:00.000Z",
    });
    new QuestionRepository(testDatabase.database).create({
      id: "old-format-q1",
      activityId: "old-format",
      displayNumber: "1",
      sortOrder: 0,
      sheetName: "缺表頭",
      numberCell: "B3",
      answerRange: "D3",
      answerAnchor: "D3",
      originalAnswer: null,
    });

    const report = await backfillQuestionPrompts(testDatabase.database);
    expect(report.failures[0]).toMatchObject({ activityId: "old-format" });
    expect(report.failures[0]?.reason).toContain("找不到唯一");
    expect(new QuestionRepository(testDatabase.database)
      .listByActivity("old-format")
      .every((question) => question.promptText === null)).toBe(true);
  });

  it("單場失敗不阻止下一場活動成功回填", async () => {
    const testDatabase = createDatabase();
    await seedActivity(
      testDatabase,
      "bad",
      "reference-single-template.xlsx",
      `${testDatabase.directory}/missing.xlsx`,
    );
    await seedActivity(testDatabase, "good", "synthetic-moved-multiple.xlsx");

    const report = await backfillQuestionPrompts(testDatabase.database);
    expect(report.failures).toEqual([expect.objectContaining({ activityId: "bad" })]);
    expect(report.updatedActivityIds).toEqual(["good"]);
    const questions = new QuestionRepository(testDatabase.database);
    expect(questions.listByActivity("bad").every((question) => question.promptText === null)).toBe(true);
    expect(questions.listByActivity("good").map((question) => question.promptText)).toEqual([
      "合成題目 1-1",
      "合成題目 A1",
      "合成題目 章末-3",
    ]);
  });
});
