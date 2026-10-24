// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, StudentActivityView, StudentJoin, TeacherGroupManager } from "./App.js";

const preview = {
  importId: "draft-1",
  filename: "演算法學習單.xlsx",
  expiresAt: "2026-10-23T02:00:00.000Z",
  questionCount: 2,
  questions: [
    {
      displayNumber: "1-1",
      sheetName: "學習單",
      numberCell: "D7",
      answerRange: "J7:L7",
      answerAnchor: "J7",
      originalAnswer: null,
      willOverwrite: false,
    },
    {
      displayNumber: "A1",
      sheetName: "學習單",
      numberCell: "D10",
      answerRange: "J10:L10",
      answerAnchor: "J10",
      originalAnswer: "原有提示",
      willOverwrite: true,
    },
  ],
};

function response(ok: boolean, body?: unknown): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function teacherSessionResponse() {
  return response(true, {
    role: "teacher",
    expiresAt: "2026-10-23T10:00:00.000Z",
  });
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(["synthetic"], "演算法學習單.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await user.upload(screen.getByLabelText("Guided Notes 檔案"), file);
  await user.click(screen.getByRole("button", { name: "上傳並預覽" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("老師 Guided Notes 匯入介面", () => {
  it("顯示題數、題號、工作表、答案範圍與原內容警告，確認後顯示 DRAFT 活動", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(teacherSessionResponse())
      .mockResolvedValueOnce(response(true, preview))
      .mockResolvedValueOnce(
        response(true, {
          activityId: "activity-1",
          title: "演算法搶答",
          state: "DRAFT",
          questionCount: 2,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: "上傳並預覽" });

    await uploadFile(user);
    expect(await screen.findByText("共 2 題")).toBeInTheDocument();
    expect(screen.getByText("1-1")).toBeInTheDocument();
    expect(screen.getAllByText("學習單")).toHaveLength(2);
    expect(screen.getByText("J10:L10")).toBeInTheDocument();
    expect(
      screen.getByText("已有「原有提示」；有成功組別時將覆蓋"),
    ).toBeInTheDocument();
    expect(screen.getByText("空白，不需覆蓋")).toBeInTheDocument();

    const title = screen.getByLabelText("活動名稱");
    await user.clear(title);
    await user.type(title, "演算法搶答");
    await user.click(screen.getByRole("button", { name: "確認並建立活動" }));

    expect(await screen.findByText("活動狀態：DRAFT")).toBeInTheDocument();
    expect(screen.getByText("本活動共 2 題。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/teacher/imports/draft-1/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "演算法搶答" }),
      }),
    );
  });

  it("老師在 DRAFT 可新增、重新命名與刪除組別，並顯示欄位及伺服器錯誤", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(true, { id: "g1", name: "第一組" }))
      .mockResolvedValueOnce(response(false, { error: { code: "CONFLICT", message: "組別名稱重複。" } }))
      .mockResolvedValueOnce(response(true, { id: "g1", name: "甲組" }))
      .mockResolvedValueOnce(response(true));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "prompt").mockReturnValue("甲組");
    const user = userEvent.setup();
    render(<TeacherGroupManager activity={{ activityId: "a1", title: "測試", state: "DRAFT", questionCount: 2 }} />);

    await user.click(screen.getByRole("button", { name: "新增組別" }));
    expect(screen.getByRole("alert")).toHaveTextContent("組別名稱不可空白");
    await user.type(screen.getByLabelText("組別名稱"), "第一組");
    await user.click(screen.getByRole("button", { name: "新增組別" }));
    expect(await screen.findByText("第一組")).toBeInTheDocument();
    await user.type(screen.getByLabelText("組別名稱"), "第一組");
    await user.click(screen.getByRole("button", { name: "新增組別" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("組別名稱重複");
    await user.click(screen.getByRole("button", { name: "重新命名" }));
    expect(await screen.findByText("甲組")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刪除" }));
    expect(screen.queryByText("甲組")).not.toBeInTheDocument();
  });

  it("非 DRAFT 活動停用組別修改", () => {
    render(<TeacherGroupManager activity={{ activityId: "a1", title: "測試", state: "OPEN" as never, questionCount: 2 }} />);
    expect(screen.getByRole("button", { name: "新增組別" })).toBeDisabled();
    expect(screen.getByText("活動進行中：全部題目已同時開放，組別不可修改。")).toBeInTheDocument();
  });

  it("學生查詢活動、選擇組別並建立 session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(true, { activityId: "a1", state: "DRAFT", revision: 1, groups: [{ id: "g1", name: "第一組" }, { id: "g2", name: "第二組" }] }))
      .mockResolvedValueOnce(response(true, { role: "student", activityId: "a1", group: { id: "g2", name: "第二組" }, expiresAt: "2026-10-24T10:00:00.000Z" }))
      .mockResolvedValueOnce(response(true, { role: "student", activityId: "a1", state: "DRAFT", revision: 1, group: { id: "g2", name: "第二組" }, questions: [], submissions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StudentJoin />);
    await user.type(screen.getByLabelText("活動識別碼"), "a1");
    await user.click(screen.getByRole("button", { name: "查詢活動" }));
    await user.selectOptions(await screen.findByLabelText("選擇組別"), "g2");
    await user.click(screen.getByRole("button", { name: "進入活動" }));
    expect(await screen.findByText("等待老師開始搶答。")).toBeInTheDocument();
    expect(screen.getByText("第二組")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/student/session", expect.objectContaining({ body: JSON.stringify({ activityId: "a1", groupId: "g2" }) }));
  });

  it("學生畫面依 DRAFT、OPEN、CLOSED 權威快照切換操作", async () => {
    const session = { role: "student" as const, activityId: "a1", group: { id: "g1", name: "第一組" }, expiresAt: "2026-10-24T10:00:00.000Z" };
    for (const [state, expected] of [["DRAFT", "等待老師開始搶答。"], ["OPEN", "全部題目已開放，可自由選擇題號。"], ["CLOSED", "唯讀結果"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true, { role: "student", activityId: "a1", state, revision: 2, group: session.group, questions: [{ id: "q1", displayNumber: "1-1", sortOrder: 0 }], submissions: [] })));
      const rendered = render(<StudentActivityView session={session} />);
      expect(await screen.findByText(expected)).toBeInTheDocument();
      if (state === "OPEN") expect(screen.getByRole("button", { name: "1-1" })).toBeEnabled();
      rendered.unmount();
    }
  });

  it("老師開始後顯示結束控制；確認後防重複並切換唯讀結果", async () => {
    let resolveClose!: (value: Response) => void;
    const closePromise = new Promise<Response>((resolve) => { resolveClose = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, { activityId: "a1", state: "OPEN", revision: 2 }))
      .mockReturnValueOnce(closePromise);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<TeacherGroupManager activity={{ activityId: "a1", title: "測試", state: "DRAFT", questionCount: 2 }} />);
    await user.click(screen.getByRole("button", { name: "開始搶答" }));
    const close = await screen.findByRole("button", { name: "結束活動" });
    await user.click(close);
    expect(screen.getByRole("button", { name: "結束中…" })).toBeDisabled();
    resolveClose(response(true, { activityId: "a1", state: "CLOSED" }));
    expect(await screen.findByText("唯讀結果")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "結束活動" })).not.toBeInTheDocument();
  });

  it("老師取消結束、已結束回覆與 API 失敗皆有明確處理", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, { activityId: "a1", state: "OPEN", revision: 2 }))
      .mockResolvedValueOnce(response(false, { error: { code: "API_FAILURE", message: "暫時無法結束" } }))
      .mockResolvedValueOnce(response(false, { error: { code: "ACTIVITY_ALREADY_CLOSED", message: "活動已結束" } }));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<TeacherGroupManager activity={{ activityId: "a1", title: "測試", state: "DRAFT", questionCount: 2 }} />);
    await user.click(screen.getByRole("button", { name: "開始搶答" }));
    await user.click(await screen.findByRole("button", { name: "結束活動" }));
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "結束活動" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時無法結束");
    expect(screen.getByRole("button", { name: "結束活動" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "結束活動" }));
    expect(await screen.findByText("唯讀結果")).toBeInTheDocument();
  });

  it("取消預覽後回到上傳畫面", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(teacherSessionResponse())
      .mockResolvedValueOnce(response(true, preview))
      .mockResolvedValueOnce(response(true));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: "上傳並預覽" });

    await uploadFile(user);
    await screen.findByText("匯入預覽");
    await user.click(screen.getByRole("button", { name: "取消匯入" }));

    expect(await screen.findByRole("button", { name: "上傳並預覽" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/teacher/imports/draft-1",
      { method: "DELETE", credentials: "same-origin" },
    );
  });

  it("清楚顯示伺服器提供的檔案驗證錯誤", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(teacherSessionResponse())
        .mockResolvedValueOnce(response(false, {
          error: {
            code: "HEADER_NOT_FOUND",
            message: "找不到同一列中的「題號」與「作答」表頭。",
          },
        })),
    );
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: "上傳並預覽" });

    await uploadFile(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "找不到同一列中的「題號」與「作答」表頭。",
    );
    expect(screen.getByRole("button", { name: "上傳並預覽" })).toBeEnabled();
  });

  it("先由伺服器建立老師 session，失敗時可重試且不顯示匯入操作", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(false, {
          error: { code: "CSRF_REJECTED", message: "老師入口不可用。" },
        }),
      )
      .mockResolvedValueOnce(teacherSessionResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("老師入口不可用。");
    expect(screen.queryByRole("button", { name: "上傳並預覽" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(await screen.findByRole("button", { name: "上傳並預覽" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/teacher/session", {
      method: "POST",
      credentials: "same-origin",
    });
  });
});
