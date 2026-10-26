import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  guidedNotesFixtureDirectory,
  loadGuidedNotesFixture,
} from "./test-fixtures.js";

interface FixtureManifest {
  fixtures: Array<{
    filename: string;
    kind: "reference" | "valid" | "invalid";
    description: string;
  }>;
}

describe("Guided Notes 合成 fixtures", () => {
  it("manifest 完整列出所有 XLSX 且只含合成或已審查的 reference 資料", async () => {
    const manifest = JSON.parse(
      await readFile(`${guidedNotesFixtureDirectory}manifest.json`, "utf8"),
    ) as FixtureManifest;
    const files = (await readdir(guidedNotesFixtureDirectory))
      .filter((filename) => filename.endsWith(".xlsx"))
      .sort();

    expect(manifest.fixtures.map(({ filename }) => filename).sort()).toEqual(
      files,
    );
    expect(new Set(manifest.fixtures.map(({ filename }) => filename)).size).toBe(
      manifest.fixtures.length,
    );
    expect(manifest.fixtures.every(({ description }) => description.length > 0)).toBe(
      true,
    );

    for (const fixture of manifest.fixtures) {
      const workbook = await loadGuidedNotesFixture(fixture.filename);
      expect(workbook.worksheets.length).toBeGreaterThan(0);
      expect(workbook.creator ?? "").not.toMatch(/@|密碼|金鑰|token/i);
      const visibleText: string[] = [];
      for (const worksheet of workbook.worksheets) {
        worksheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (
              cell.value != null &&
              (!cell.isMerged || cell.master.address === cell.address)
            ) {
              visibleText.push(cell.text);
            }
          }),
        );
      }
      expect(visibleText.join(" ")).not.toMatch(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/i,
      );
    }
  });

  it("完整語意 fixture 含多工作表、公式、格式、合併與尺寸／隱藏狀態", async () => {
    const workbook = await loadGuidedNotesFixture(
      "synthetic-semantic-rich.xlsx",
    );
    const sheet = workbook.getWorksheet("學習單")!;
    const reference = workbook.getWorksheet("參考資料")!;

    expect(workbook.worksheets.map(({ name }) => name)).toEqual([
      "學習單",
      "參考資料",
    ]);
    expect(sheet.model.merges).toContain("H6:J6");
    expect(sheet.model.merges).toContain("D6:G7");
    expect(sheet.getCell("D6").text).toBe("合成富文字題目：特殊符號 <>&\n第二行");
    expect(sheet.getCell("D9").text).toBe("合成公式題目結果");
    expect(sheet.getRow(5).height).toBe(28);
    expect(sheet.getRow(8).hidden).toBe(true);
    expect(sheet.getColumn(3).width).toBe(14);
    expect(sheet.getColumn(7).hidden).toBe(true);
    expect(reference.state).toBe("hidden");
    expect(reference.getCell("B2").value).toEqual({
      formula: "A2*2",
      result: 42,
    });
    expect(Object.keys(reference.getCell("B2").style).length).toBeGreaterThan(0);
    expect(reference.model.merges).toContain("A4:C4");
    expect(reference.getRow(4).height).toBe(31);
    expect(reference.getColumn(1).width).toBe(22);
  });

  it("fixtures 涵蓋三表頭、跨列題目及題目缺漏與歧義案例", async () => {
    const valid = await loadGuidedNotesFixture("synthetic-semantic-rich.xlsx");
    const sheet = valid.getWorksheet("學習單")!;
    expect([sheet.getCell("C5").text, sheet.getCell("D5").text, sheet.getCell("H5").text]).toEqual([
      "題號", "題目", "作答",
    ]);

    for (const filename of [
      "invalid-missing-header.xlsx",
      "invalid-blank-prompt.xlsx",
      "invalid-shared-prompt-range.xlsx",
      "invalid-duplicate-prompt-header.xlsx",
    ]) {
      expect((await loadGuidedNotesFixture(filename)).worksheets).toHaveLength(1);
    }
  });
});
