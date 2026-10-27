// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_QUESTION_PROMPT, QuestionPresentation } from "./QuestionPresentation.js";

afterEach(cleanup);

describe("共用題目呈現", () => {
  it("同時顯示題號、完整長題目、換行與特殊字元", () => {
    const promptText = "這是一段很長的完整題目，內容必須完整呈現。\n第二行保留 <>& 特殊字元。";
    render(<QuestionPresentation question={{ displayNumber: "章末-3", promptText }} />);
    expect(screen.getByRole("heading", { level: 4, name: "題號 章末-3" })).toBeInTheDocument();
    const prompt = document.querySelector(".question-prompt");
    expect(prompt).toHaveTextContent("這是一段很長的完整題目，內容必須完整呈現。");
    expect(prompt?.textContent).toBe(promptText);
  });

  it("歷史題目沒有保存文字時顯示固定 fallback 而不猜測內容", () => {
    render(<QuestionPresentation question={{ displayNumber: "7" }} compact />);
    expect(screen.getByText("題號 7")).toBeInTheDocument();
    expect(screen.getByText(LEGACY_QUESTION_PROMPT)).toBeInTheDocument();
  });
});
