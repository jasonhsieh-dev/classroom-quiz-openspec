import { describe, expect, it } from "vitest";
import { GuidedNotesError } from "./errors.js";
import { loadGuidedNotesWorkbook } from "./file-validation.js";
import { readGuidedNotesFixture } from "./test-fixtures.js";

const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function expectErrorCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
    throw new Error("預期 Guided Notes 驗證失敗");
  } catch (error) {
    expect(error).toBeInstanceOf(GuidedNotesError);
    expect(error).toMatchObject({ code });
  }
}

describe("Guided Notes XLSX 檔案驗證", () => {
  it("接受副檔名、MIME、大小及內容皆合法的 XLSX", async () => {
    const buffer = await readGuidedNotesFixture("synthetic-single.xlsx");
    const workbook = await loadGuidedNotesWorkbook({
      filename: "學習單.xlsx",
      mimeType: xlsxMime,
      buffer,
    });
    expect(workbook.getWorksheet("學習單")).toBeDefined();
  });

  it("拒絕非 XLSX 副檔名及錯誤 MIME", async () => {
    const buffer = await readGuidedNotesFixture("synthetic-single.xlsx");
    await expectErrorCode(
      () =>
        loadGuidedNotesWorkbook({
          filename: "學習單.xls",
          mimeType: xlsxMime,
          buffer,
        }),
      "INVALID_FILE_TYPE",
    );
    await expectErrorCode(
      () =>
        loadGuidedNotesWorkbook({
          filename: "偽裝.xlsx",
          mimeType: "text/plain",
          buffer,
        }),
      "INVALID_FILE_TYPE",
    );
  });

  it("拒絕偽造副檔名、損毀內容及超過大小限制的檔案", async () => {
    await expectErrorCode(
      () =>
        loadGuidedNotesWorkbook({
          filename: "偽裝.xlsx",
          mimeType: xlsxMime,
          buffer: Buffer.from("這不是 XLSX"),
        }),
      "INVALID_XLSX",
    );
    await expectErrorCode(
      () =>
        loadGuidedNotesWorkbook({
          filename: "損毀.xlsx",
          mimeType: xlsxMime,
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
        }),
      "INVALID_XLSX",
    );

    const buffer = await readGuidedNotesFixture("synthetic-single.xlsx");
    await expectErrorCode(
      () =>
        loadGuidedNotesWorkbook(
          { filename: "過大.xlsx", mimeType: xlsxMime, buffer },
          { maxBytes: buffer.byteLength - 1 },
        ),
      "FILE_TOO_LARGE",
    );
  });
});
