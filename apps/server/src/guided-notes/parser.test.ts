import { describe, expect, it } from "vitest";
import { GuidedNotesError } from "./errors.js";
import {
  createGuidedNotesPreview,
  parseGuidedNotesWorkbook,
} from "./parser.js";
import { loadGuidedNotesFixture } from "./test-fixtures.js";

async function expectFixtureError(
  filename: string,
  code: string,
): Promise<void> {
  const workbook = await loadGuidedNotesFixture(filename);
  try {
    parseGuidedNotesWorkbook(workbook);
    throw new Error("預期 Guided Notes 解析失敗");
  } catch (error) {
    expect(error).toBeInstanceOf(GuidedNotesError);
    expect(error).toMatchObject({ code });
  }
}

describe("Guided Notes 動態解析", () => {
  it("依真實範本表頭與 merge 動態建立全部 mapping", async () => {
    const workbook = await loadGuidedNotesFixture(
      "reference-single-template.xlsx",
    );
    const mappings = parseGuidedNotesWorkbook(workbook);

    expect(mappings).toHaveLength(6);
    expect(mappings[0]).toEqual({
      displayNumber: "1",
      sheetName: "學習單",
      numberCell: "B5",
      answerRange: "G5:H5",
      answerAnchor: "G5",
      originalAnswer: null,
    });
    expect(mappings.at(-1)).toMatchObject({
      displayNumber: "6",
      numberCell: "B15",
      answerRange: "G15:H15",
      answerAnchor: "G15",
    });
  });

  it("支援移動列欄、不同題數、文字題號與空白分隔列", async () => {
    const workbook = await loadGuidedNotesFixture(
      "synthetic-moved-multiple.xlsx",
    );
    const mappings = parseGuidedNotesWorkbook(workbook);

    expect(mappings.map(({ displayNumber }) => displayNumber)).toEqual([
      "1-1",
      "A1",
      "章末-3",
    ]);
    expect(mappings.map(({ numberCell }) => numberCell)).toEqual([
      "D7",
      "D10",
      "D12",
    ]);
    expect(mappings.map(({ answerRange }) => answerRange)).toEqual([
      "J7:L7",
      "J10:L10",
      "J12:L12",
    ]);
    expect(mappings.map(({ answerAnchor }) => answerAnchor)).toEqual([
      "J7",
      "J10",
      "J12",
    ]);
  });

  it("拒絕缺少表頭與跨工作表多重候選", async () => {
    await expectFixtureError("invalid-missing-header.xlsx", "HEADER_NOT_FOUND");
    await expectFixtureError(
      "invalid-multiple-candidates.xlsx",
      "HEADER_AMBIGUOUS",
    );
  });

  it("拒絕正規化後重複題號、缺少答案位置及重疊答案範圍", async () => {
    await expectFixtureError(
      "invalid-duplicate-question.xlsx",
      "DUPLICATE_QUESTION_NUMBER",
    );
    await expectFixtureError(
      "invalid-missing-answer.xlsx",
      "INVALID_ANSWER_MAPPING",
    );
    await expectFixtureError(
      "invalid-overlapping-answer.xlsx",
      "OVERLAPPING_ANSWER_RANGES",
    );
  });

  it("產生題數、mapping、原內容及覆蓋警告 preview", async () => {
    const workbook = await loadGuidedNotesFixture(
      "synthetic-moved-multiple.xlsx",
    );
    const preview = createGuidedNotesPreview(
      parseGuidedNotesWorkbook(workbook),
    );

    expect(preview).toMatchInlineSnapshot(`
      {
        "questionCount": 3,
        "questions": [
          {
            "answerAnchor": "J7",
            "answerRange": "J7:L7",
            "displayNumber": "1-1",
            "numberCell": "D7",
            "originalAnswer": null,
            "sheetName": "變形學習單",
            "willOverwrite": false,
          },
          {
            "answerAnchor": "J10",
            "answerRange": "J10:L10",
            "displayNumber": "A1",
            "numberCell": "D10",
            "originalAnswer": "原有提示",
            "sheetName": "變形學習單",
            "willOverwrite": true,
          },
          {
            "answerAnchor": "J12",
            "answerRange": "J12:L12",
            "displayNumber": "章末-3",
            "numberCell": "D12",
            "originalAnswer": null,
            "sheetName": "變形學習單",
            "willOverwrite": false,
          },
        ],
      }
    `);
  });
});
