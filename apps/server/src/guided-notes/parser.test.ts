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
      promptText: "電腦系統中負責執行程式指令、處理資料的核心硬體元件，通常被稱為電腦的大腦，它的英文縮寫是什麼？",
      promptRange: "C5:F5",
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
    expect(mappings.map(({ promptText }) => promptText)).toEqual([
      "合成題目 1-1",
      "合成題目 A1",
      "合成題目 章末-3",
    ]);
    expect(mappings.map(({ promptRange }) => promptRange)).toEqual([
      "E7:I7",
      "E10:I10",
      "E12:I12",
    ]);
  });

  it("以唯一三表頭候選解析並拒絕缺漏、重複及跨工作表多重候選", async () => {
    await expectFixtureError("invalid-missing-header.xlsx", "HEADER_NOT_FOUND");
    await expectFixtureError(
      "invalid-duplicate-prompt-header.xlsx",
      "HEADER_AMBIGUOUS",
    );
    await expectFixtureError(
      "invalid-multiple-candidates.xlsx",
      "HEADER_AMBIGUOUS",
    );
  });

  it("讀取跨列 master cell 的富文字、換行及公式顯示結果且不建立延伸列題目", async () => {
    const workbook = await loadGuidedNotesFixture("synthetic-semantic-rich.xlsx");
    const mappings = parseGuidedNotesWorkbook(workbook);
    expect(mappings).toHaveLength(2);
    expect(mappings[0]).toMatchObject({
      displayNumber: "S1",
      promptText: "合成富文字題目：特殊符號 <>&\n第二行",
      promptRange: "D6:G7",
      numberCell: "C6",
      answerRange: "H6:J6",
    });
    expect(mappings[1]).toMatchObject({
      displayNumber: "S2",
      promptText: "合成公式題目結果",
      promptRange: "D9:G9",
      originalAnswer: "既有合成答案",
    });
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

  it("拒絕空白題目與多題共用的合併題目範圍", async () => {
    await expectFixtureError("invalid-blank-prompt.xlsx", "INVALID_PROMPT");
    await expectFixtureError(
      "invalid-shared-prompt-range.xlsx",
      "AMBIGUOUS_PROMPT_MAPPING",
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
            "promptRange": "E7:I7",
            "promptText": "合成題目 1-1",
            "sheetName": "變形學習單",
            "willOverwrite": false,
          },
          {
            "answerAnchor": "J10",
            "answerRange": "J10:L10",
            "displayNumber": "A1",
            "numberCell": "D10",
            "originalAnswer": "原有提示",
            "promptRange": "E10:I10",
            "promptText": "合成題目 A1",
            "sheetName": "變形學習單",
            "willOverwrite": true,
          },
          {
            "answerAnchor": "J12",
            "answerRange": "J12:L12",
            "displayNumber": "章末-3",
            "numberCell": "D12",
            "originalAnswer": null,
            "promptRange": "E12:I12",
            "promptText": "合成題目 章末-3",
            "sheetName": "變形學習單",
            "willOverwrite": false,
          },
        ],
      }
    `);
  });
});
