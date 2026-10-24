import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { createApp } from "../app.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { createGuidedNotesImportRouter } from "./import-routes.js";
import { GuidedNotesImportService } from "./import-service.js";
import { readGuidedNotesFixture } from "./test-fixtures.js";

const databases: TestDatabase[] = [];

afterEach(() => {
  for (const item of databases.splice(0)) item.cleanup();
});

function createImportApp() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  const service = new GuidedNotesImportService(
    testDatabase.database,
    {
      data: join(testDatabase.directory, "data"),
      uploads: join(testDatabase.directory, "uploads"),
      exports: join(testDatabase.directory, "exports"),
    },
  );
  return {
    testDatabase,
    app: createApp({
      registerRoutes(app) {
        app.use("/api/teacher/imports", createGuidedNotesImportRouter(service));
      },
    }),
  };
}

describe("老師 Guided Notes 匯入 API", () => {
  it("上傳回傳 preview，確認後才建立 DRAFT 活動", async () => {
    const { app, testDatabase } = createImportApp();
    const upload = await request(app)
      .post("/api/teacher/imports")
      .attach(
        "file",
        await readGuidedNotesFixture("synthetic-moved-multiple.xlsx"),
        {
          filename: "課堂學習單.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      )
      .expect(201);

    expect(upload.body).toMatchObject({
      filename: "課堂學習單.xlsx",
      questionCount: 3,
      questions: [
        { displayNumber: "1-1", answerRange: "J7:L7" },
        { displayNumber: "A1", willOverwrite: true },
        { displayNumber: "章末-3" },
      ],
    });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });

    const confirmed = await request(app)
      .post(`/api/teacher/imports/${upload.body.importId}/confirm`)
      .send({ title: "演算法搶答" })
      .expect(201);
    expect(confirmed.body).toMatchObject({
      title: "演算法搶答",
      state: "DRAFT",
      questionCount: 3,
    });
    expect(confirmed.body).not.toHaveProperty("sourceFilePath");
    expect(confirmed.body).not.toHaveProperty("sourceSha256");
  });

  it("取消 preview 後不留下活動或 draft", async () => {
    const { app, testDatabase } = createImportApp();
    const upload = await request(app)
      .post("/api/teacher/imports")
      .attach("file", await readGuidedNotesFixture("synthetic-single.xlsx"), {
        filename: "取消測試.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(201);

    await request(app)
      .delete(`/api/teacher/imports/${upload.body.importId}`)
      .expect(204);
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM import_drafts").get(),
    ).toEqual({ count: 0 });
  });

  it("將缺檔案及解析錯誤轉成繁體中文 API 錯誤，且不建立部分資料", async () => {
    const { app, testDatabase } = createImportApp();
    const missing = await request(app).post("/api/teacher/imports").expect(400);
    expect(missing.body).toEqual({
      error: {
        code: "FILE_REQUIRED",
        message: "請選擇要上傳的 Guided Notes .xlsx 檔案。",
      },
    });

    const invalid = await request(app)
      .post("/api/teacher/imports")
      .attach("file", await readGuidedNotesFixture("invalid-missing-header.xlsx"), {
        filename: "無效.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(400);
    expect(invalid.body).toMatchObject({
      error: {
        code: "HEADER_NOT_FOUND",
        message: "找不到同一列中的「題號」與「作答」表頭。",
      },
    });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM activities").get(),
    ).toEqual({ count: 0 });
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM import_drafts").get(),
    ).toEqual({ count: 0 });
  });
});
