// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleSheetsWriteback } from "./GoogleSheetsWriteback.js";
const state = (value = "NOT_PREPARED",overrides = {}) => ({ activityId: "a1",operationId: value === "NOT_PREPARED" ? null : "op",state: value,
  spreadsheetId: "synthetic",sheetId: 0,sheetTitle: "學習單",resultVersion: 3,
  targets: [{ displayNumber: "1",anchor: "C2",answer: "=文字",originalValue: null }],
  errorCode: null,canRetry: value === "FAILED",message: ({ SUCCEEDED: "寫回成功，已讀回核對。",FAILED: "尚未寫入，可確認重試。",UNKNOWN: "結果不明，請核對。" } as Record<string,string>)[value] ?? "待寫回",...overrides });
const response = (body: unknown,ok = true) => ({ ok,json: async () => body }) as Response;
afterEach(() => { cleanup();vi.unstubAllGlobals(); });
it("預覽目標與字串答案，明確確認且忙碌期間防重複；成功不再提供寫入", async () => {
  let finish!: (value: Response) => void;const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const fetchMock = vi.fn().mockResolvedValueOnce(response(state())).mockResolvedValueOnce(response(state("PREPARED"))).mockReturnValueOnce(pending);
  vi.stubGlobal("fetch",fetchMock);const user = userEvent.setup();render(<GoogleSheetsWriteback activityId="a1" />);
  await user.click(await screen.findByRole("button",{ name: "寫回 Google Sheets" }));
  expect(await screen.findByText("C2")).toBeInTheDocument();expect(screen.getByText("=文字")).toBeInTheDocument();expect(screen.getByText(/外部共編競態/)).toBeInTheDocument();
  await user.dblClick(screen.getByRole("button",{ name: "確認寫回 Google Sheets" }));
  expect(fetchMock).toHaveBeenCalledTimes(3);expect(screen.getByRole("button",{ name: "確認寫回 Google Sheets" })).toBeDisabled();
  expect(fetchMock).toHaveBeenLastCalledWith("/api/teacher/activities/a1/writeback/confirm",expect.objectContaining({ body: JSON.stringify({ operationId: "op",confirmed: true }) }));
  await act(async () => finish(response(state("SUCCEEDED"))));
  expect(await screen.findByText("寫回成功，已讀回核對。")).toBeInTheDocument();expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("結果不明只能核對，核對未寫後才出現確認重試", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response(state("UNKNOWN"))).mockResolvedValueOnce(response(state("FAILED"))).mockResolvedValueOnce(response(state("SUCCEEDED")));
  vi.stubGlobal("fetch",fetchMock);const user = userEvent.setup();render(<GoogleSheetsWriteback activityId="a1" />);
  await user.click(await screen.findByRole("button",{ name: "核對寫回狀態" }));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/teacher/activities/a1/writeback/reconcile",expect.objectContaining({ body: JSON.stringify({ operationId: "op" }) }));
  await user.click(await screen.findByRole("button",{ name: "確認重試寫回" }));
  await screen.findByText("寫回成功，已讀回核對。");
});
it("HTTP 回應遺失顯示不明，禁止盲目再次確認", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response(state("PREPARED"))).mockRejectedValueOnce(new Error("連線中斷"));
  vi.stubGlobal("fetch",fetchMock);const user = userEvent.setup();render(<GoogleSheetsWriteback activityId="a1" />);
  await user.click(await screen.findByRole("button",{ name: "確認寫回 Google Sheets" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("連線中斷");
  expect(screen.queryByRole("button",{ name: "確認寫回 Google Sheets" })).not.toBeInTheDocument();
  expect(screen.getByRole("button",{ name: "核對寫回狀態" })).toBeEnabled();
});
it.each(["NO_ANSWERS","CONFLICT"])("%s 不提供寫回或重試", async (value) => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(state(value))));render(<GoogleSheetsWriteback activityId="a1" />);
  await screen.findByRole("link");expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
