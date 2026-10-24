import { afterEach, describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { GuidedNotesError } from "./errors.js";
import { GuidedNotesImportService } from "./import-service.js";
import { readGuidedNotesFixture } from "./test-fixtures.js";

const databases: TestDatabase[] = [];

afterEach(() => {
  for (const item of databases.splice(0)) item.cleanup();
});

function setup(options: ConstructorParameters<typeof GuidedNotesImportService>[2] = {}) {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  const runtimePaths = {
    data: join(testDatabase.directory, "data"),
    uploads: join(testDatabase.directory, "uploads"),
    exports: join(testDatabase.directory, "exports"),
  };
  return {
    testDatabase,
    runtimePaths,
    service: new GuidedNotesImportService(
      testDatabase.database,
      runtimePaths,
      options,
    ),
  };
}

async function createValidDraft(service: GuidedNotesImportService) {
  return service.createDraft({
    filename: "動態學習單.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await readGuidedNotesFixture("synthetic-moved-multiple.xlsx"),
  });
}

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("GuidedNotesImportService", () => {
  it("上傳只建立 draft，確認後才原子建立活動、題目 mapping 並保存原始檔", async () => {
    const ids = [
      "draft-1",
      "activity-1",
      "question-1",
      "question-2",
      "question-3",
    ];
    const { service, testDatabase } = setup({ idFactory: () => ids.shift()! });
    const source = await readGuidedNotesFixture("synthetic-moved-multiple.xlsx");

    const preview = await createValidDraft(service);
    expect(preview).toMatchObject({
      importId: "draft-1",
      questionCount: 3,
      questions: [
        { displayNumber: "1-1", answerRange: "J7:L7" },
        { displayNumber: "A1", answerRange: "J10:L10", willOverwrite: true },
        { displayNumber: "章末-3", answerRange: "J12:L12" },
      ],
    });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });

    const result = await service.confirmDraft(preview.importId, {
      title: "資料結構搶答",
    });
    expect(result).toMatchObject({
      activityId: "activity-1",
      title: "資料結構搶答",
      state: "DRAFT",
      questionCount: 3,
    });
    expect(await readFile(result.sourceFilePath)).toEqual(source);
    expect(
      testDatabase.database
        .prepare("SELECT source_file_path, source_sha256 FROM activities")
        .get(),
    ).toEqual({
      source_file_path: result.sourceFilePath,
      source_sha256: result.sourceSha256,
    });
    expect(
      testDatabase.database
        .prepare(
          `SELECT display_number, sheet_name, number_cell, answer_range,
                  answer_anchor, original_answer
           FROM questions ORDER BY sort_order`,
        )
        .all(),
    ).toEqual([
      {
        display_number: "1-1",
        sheet_name: "變形學習單",
        number_cell: "D7",
        answer_range: "J7:L7",
        answer_anchor: "J7",
        original_answer: null,
      },
      {
        display_number: "A1",
        sheet_name: "變形學習單",
        number_cell: "D10",
        answer_range: "J10:L10",
        answer_anchor: "J10",
        original_answer: "原有提示",
      },
      {
        display_number: "章末-3",
        sheet_name: "變形學習單",
        number_cell: "D12",
        answer_range: "J12:L12",
        answer_anchor: "J12",
        original_answer: null,
      },
    ]);
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM import_drafts").get(),
    ).toEqual({ count: 0 });
  });

  it("取消與過期清理會移除暫存檔，且完全不建立活動", async () => {
    let now = new Date("2026-10-23T01:00:00.000Z");
    const ids = ["draft-cancel", "draft-expired"];
    const { service, runtimePaths, testDatabase } = setup({
      idFactory: () => ids.shift()!,
      now: () => now,
      draftTtlMs: 60_000,
    });

    const cancelled = await createValidDraft(service);
    const cancelledPath = join(runtimePaths.uploads, "tmp", `${cancelled.importId}.xlsx`);
    await service.cancelDraft(cancelled.importId);
    await expectMissing(cancelledPath);

    const expired = await createValidDraft(service);
    const expiredPath = join(runtimePaths.uploads, "tmp", `${expired.importId}.xlsx`);
    now = new Date("2026-10-23T01:02:00.000Z");
    expect(await service.cleanupExpired()).toBe(1);
    await expectMissing(expiredPath);
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM import_drafts").get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });
  });

  it("確認途中題目寫入失敗時回滾活動與全部 mapping，並保留 draft 來源供重試", async () => {
    const ids = ["draft-atomic", "activity-atomic", "duplicate", "duplicate"];
    const { service, runtimePaths, testDatabase } = setup({
      idFactory: () => ids.shift()!,
    });
    const preview = await createValidDraft(service);

    await expect(
      service.confirmDraft(preview.importId, { title: "原子性測試" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM questions").get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM import_drafts").get(),
    ).toEqual({ count: 1 });
    await expect(
      access(join(runtimePaths.uploads, "tmp", "draft-atomic.xlsx")),
    ).resolves.toBeUndefined();
    await expectMissing(
      join(runtimePaths.uploads, "activities", "activity-atomic", "source.xlsx"),
    );
  });

  it("拒絕空白活動名稱，且不移動 draft 或建立活動", async () => {
    const ids = ["draft-title"];
    const { service, testDatabase } = setup({ idFactory: () => ids.shift()! });
    const preview = await createValidDraft(service);

    try {
      await service.confirmDraft(preview.importId, { title: "   " });
      throw new Error("預期確認失敗");
    } catch (error) {
      expect(error).toBeInstanceOf(GuidedNotesError);
      expect(error).toMatchObject({ code: "INVALID_ACTIVITY_TITLE" });
    }
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM import_drafts").get(),
    ).toEqual({ count: 1 });
  });
});
