import { describe, expect, it } from "vitest";
import { formatTaipeiDateTime } from "./date-time.js";

describe("台灣日期時間顯示", () => {
	it("將標準 UTC 時間顯示為 Asia/Taipei 且保留後端原值供 dateTime 使用", () => {
		expect(formatTaipeiDateTime("2026-10-27T11:14:02.172Z")).toBe(
			"2026/10/27 19:14:02",
		);
	});

	it("無效時間不臆測轉換", () => {
		expect(formatTaipeiDateTime("未知時間")).toBe("未知時間");
	});
});
