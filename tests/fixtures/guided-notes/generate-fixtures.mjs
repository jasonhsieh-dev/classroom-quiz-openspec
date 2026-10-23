import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = dirname(fileURLToPath(import.meta.url));

const headerStyle = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } },
  alignment: { horizontal: "center", vertical: "middle" },
  border: {
    top: { style: "thin", color: { argb: "FFFFFFFF" } },
    left: { style: "thin", color: { argb: "FFFFFFFF" } },
    bottom: { style: "thin", color: { argb: "FFFFFFFF" } },
    right: { style: "thin", color: { argb: "FFFFFFFF" } },
  },
};

const answerStyle = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } },
  border: {
    top: { style: "thin", color: { argb: "FF808080" } },
    left: { style: "thin", color: { argb: "FF808080" } },
    bottom: { style: "thin", color: { argb: "FF808080" } },
    right: { style: "thin", color: { argb: "FF808080" } },
  },
};

async function save(filename, build) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenSpec 合成測試";
  workbook.created = new Date("2026-01-01T00:00:00.000Z");
  build(workbook);
  await workbook.xlsx.writeFile(`${outputDirectory}/${filename}`);
}

function addHeaders(sheet, row, numberColumn, answerColumn) {
  const numberCell = sheet.getCell(row, numberColumn);
  const answerCell = sheet.getCell(row, answerColumn);
  numberCell.value = "題號";
  answerCell.value = "作答";
  numberCell.style = headerStyle;
  answerCell.style = headerStyle;
}

await mkdir(outputDirectory, { recursive: true });

await save("synthetic-single.xlsx", (workbook) => {
  const sheet = workbook.addWorksheet("學習單");
  sheet.mergeCells("B2:H2");
  sheet.getCell("B2").value = "合成單題學習單";
  addHeaders(sheet, 4, 2, 7);
  sheet.mergeCells("C4:F4");
  sheet.getCell("C4").value = "題目";
  sheet.mergeCells("G4:H4");
  sheet.getCell("G4").style = headerStyle;
  sheet.getCell("B5").value = 1;
  sheet.mergeCells("C5:F5");
  sheet.getCell("C5").value = "這是一道不含真實個資的合成題目。";
  sheet.mergeCells("G5:H5");
  sheet.getCell("G5").style = answerStyle;
});

await save("synthetic-moved-multiple.xlsx", (workbook) => {
  workbook.addWorksheet("說明").getCell("A1").value = "合成測試說明";
  const sheet = workbook.addWorksheet("變形學習單");
  addHeaders(sheet, 6, 4, 10);
  sheet.mergeCells("E6:I6");
  sheet.getCell("E6").value = "題目";
  sheet.mergeCells("J6:L6");
  sheet.getCell("J6").style = headerStyle;
  const questions = [
    { row: 7, number: "1-1", answer: null },
    { row: 10, number: "A1", answer: "原有提示" },
    { row: 12, number: "章末-3", answer: null },
  ];
  for (const question of questions) {
    sheet.getCell(question.row, 4).value = question.number;
    sheet.mergeCells(question.row, 5, question.row, 9);
    sheet.getCell(question.row, 5).value = `合成題目 ${question.number}`;
    sheet.mergeCells(question.row, 10, question.row, 12);
    sheet.getCell(question.row, 10).value = question.answer;
    sheet.getCell(question.row, 10).style = answerStyle;
  }
});

await save("synthetic-semantic-rich.xlsx", (workbook) => {
  const sheet = workbook.addWorksheet("學習單");
  addHeaders(sheet, 5, 3, 8);
  sheet.getCell("C6").value = "S1";
  sheet.mergeCells("H6:J6");
  sheet.getCell("H6").style = answerStyle;
  sheet.getCell("C9").value = "S2";
  sheet.getCell("H9").value = "既有合成答案";
  sheet.getCell("H9").style = answerStyle;
  sheet.getRow(5).height = 28;
  sheet.getCell("L8").value = "隱藏分隔列";
  sheet.getRow(8).hidden = true;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(7).hidden = true;

  const reference = workbook.addWorksheet("參考資料", { state: "hidden" });
  reference.getCell("A1").value = "合成數值";
  reference.getCell("A2").value = 21;
  reference.getCell("B2").value = { formula: "A2*2", result: 42 };
  reference.getCell("B2").numFmt = "0";
  reference.getCell("B2").font = { bold: true, color: { argb: "FF006100" } };
  reference.getCell("B2").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFC6EFCE" },
  };
  reference.mergeCells("A4:C4");
  reference.getCell("A4").value = "合成合併內容";
  reference.getRow(4).height = 31;
  reference.getCell("A6").value = "隱藏合成列";
  reference.getRow(6).hidden = true;
  reference.getColumn(1).width = 22;
  reference.getColumn(4).hidden = true;
});

await save("invalid-missing-header.xlsx", (workbook) => {
  const sheet = workbook.addWorksheet("缺表頭");
  sheet.getCell("B2").value = "題號";
  sheet.getCell("B3").value = "1";
});

await save("invalid-multiple-candidates.xlsx", (workbook) => {
  for (const name of ["候選甲", "候選乙"]) {
    const sheet = workbook.addWorksheet(name);
    addHeaders(sheet, 2, 1, 3);
    sheet.getCell("A3").value = "1";
    sheet.getCell("C3").style = answerStyle;
  }
});

await save("invalid-duplicate-question.xlsx", (workbook) => {
  const sheet = workbook.addWorksheet("重複題號");
  addHeaders(sheet, 2, 1, 3);
  sheet.getCell("A3").value = "A1";
  sheet.getCell("C3").style = answerStyle;
  sheet.getCell("A4").value = " Ａ１ ";
  sheet.getCell("C4").style = answerStyle;
});

await save("invalid-missing-answer.xlsx", (workbook) => {
  const sheet = workbook.addWorksheet("缺答案格");
  addHeaders(sheet, 2, 1, 4);
  sheet.getCell("A3").value = "1";
});

await save("invalid-overlapping-answer.xlsx", (workbook) => {
  const sheet = workbook.addWorksheet("重疊答案格");
  addHeaders(sheet, 2, 1, 4);
  sheet.getCell("A3").value = "1";
  sheet.getCell("A4").value = "2";
  sheet.mergeCells("D3:F4");
  sheet.getCell("D3").style = answerStyle;
});
