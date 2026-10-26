// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, StudentActivityView, StudentJoin, StudentResultsPage, TeacherGroupManager, TeacherResultsPage } from "./App.js";
import type { ActivitySocket, ActivitySocketFactory } from "./use-activity-sync.js";

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

class MockActivitySocket {
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  on(name: string, listener: (event?: unknown) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return this;
  }

  off(name: string, listener: (event?: unknown) => void) {
    this.listeners.get(name)?.delete(listener);
    return this;
  }

  disconnect() { return this; }

  dispatch(name: string, event?: unknown) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function socketFactory(socket: MockActivitySocket): ActivitySocketFactory {
  return () => socket as unknown as ActivitySocket;
}

const preview = {
  importId: "draft-1",
  filename: "演算法學習單.xlsx",
  expiresAt: "2026-10-23T02:00:00.000Z",
  questionCount: 2,
  questions: [
    {
      displayNumber: "1-1",
      promptText: "這是一段很長的合成完整題目，必須在匯入預覽中完整顯示。\n第二行保留換行與特殊符號 <>&。",
      promptRange: "E7:I8",
      sheetName: "學習單",
      numberCell: "D7",
      answerRange: "J7:L7",
      answerAnchor: "J7",
      originalAnswer: null,
      willOverwrite: false,
    },
    {
      displayNumber: "A1",
      promptText: "第二道合成題目",
      promptRange: "E10:I10",
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
  it("老師完整結果頁顯示成功組別與所有順位，但沒有判分、取消或遞補操作", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true, {
      activityId: "a1", revision: 6, closedAt: "2026-10-25T03:00:00.000Z",
      questions: [
        {
          question: { id: "q1", displayNumber: "1", sortOrder: 0 }, winner: { id: "g1", name: "第一組" },
          rankings: [
            { group: { id: "g1", name: "第一組" }, rank: 1, answer: "第一名答案", serverReceivedAt: "2026-10-25T02:01:00.000Z" },
            { group: { id: "g2", name: "第二組" }, rank: 2, answer: "第二名答案", serverReceivedAt: "2026-10-25T02:02:00.000Z" },
          ],
        },
        { question: { id: "q2", displayNumber: "2", sortOrder: 1 }, winner: null, rankings: [] },
      ],
    })));
    render(<TeacherResultsPage activityId="a1" />);
    expect(await screen.findByText("第一名答案")).toBeInTheDocument();
    expect(screen.getByText("第二名答案")).toBeInTheDocument();
    expect(screen.getByText("成功組別：無人作答")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /正確|錯誤|取消|遞補/ })).not.toBeInTheDocument();
  });

  it("老師下載回填檔時顯示等待狀態，成功後觸發 XLSX 下載", async () => {
    let finishExport!: (value: Response) => void;
    const exportResponse = new Promise<Response>((resolve) => { finishExport = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, { activityId: "a1", revision: 6, closedAt: "2026-10-25T04:00:00.000Z", questions: [] }))
      .mockReturnValueOnce(exportResponse);
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:export"); const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<TeacherResultsPage activityId="a1" />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "下載已回填 Guided Notes" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "產生匯出檔中…" })).toBeDisabled();
    finishExport({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(["xlsx"])),
      headers: new Headers({ "content-disposition": "attachment; filename*=UTF-8''result.xlsx" }),
    } as unknown as Response);
    expect(await screen.findByRole("button", { name: "下載已回填 Guided Notes" })).toBeEnabled();
    expect(createObjectURL).toHaveBeenCalled(); expect(click).toHaveBeenCalled(); expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("老師匯出失敗時顯示伺服器錯誤且不觸發下載", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(true, { activityId: "a1", revision: 6, closedAt: "2026-10-25T04:00:00.000Z", questions: [] }))
      .mockResolvedValueOnce(response(false, { error: { code: "EXPORT_SEMANTIC_MISMATCH", message: "匯出檔保真驗證失敗。" } })));
    render(<TeacherResultsPage activityId="a1" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "下載已回填 Guided Notes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("匯出檔保真驗證失敗。");
  });

  it("學生結果頁只保存並顯示成功組別識別與本組結果", () => {
    const safeResults = {
      activityId: "a1", revision: 6, closedAt: "2026-10-25T03:00:00.000Z", group: { id: "g2", name: "第二組" },
      questions: [
        {
          question: { id: "q1", displayNumber: "1", sortOrder: 0 }, winner: { id: "g1", name: "第一組" },
          ownResult: { status: "ANSWERED" as const, answer: "本組第二名答案", rank: 2 },
        },
        {
          question: { id: "q2", displayNumber: "2", sortOrder: 1 }, winner: null,
          ownResult: { status: "NOT_ANSWERED" as const },
        },
      ],
    };
    render(<StudentResultsPage activityId="a1" initialResults={safeResults} />);
    expect(screen.getByText("成功組別：第一組")).toBeInTheDocument();
    expect(screen.getByText("本組第二名答案")).toBeInTheDocument();
    expect(screen.getByText("本組未作答")).toBeInTheDocument();
    const dom = document.body.textContent ?? "";
    expect(dom).not.toContain("第一組的秘密答案");
    expect(dom).not.toContain("2026-10-25T02:01:00.000Z");
    expect(JSON.stringify(safeResults)).not.toContain("serverReceivedAt");
    expect(JSON.stringify(safeResults)).not.toContain("rankings");
  });

  it("顯示題數、題號、完整長題目、工作表、答案範圍與原內容警告，確認後顯示 DRAFT 活動", async () => {
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
    expect(screen.getByRole("columnheader", { name: "完整題目" })).toBeInTheDocument();
    const prompt = screen.getByText((_, element) => Boolean(
      element?.classList.contains("prompt-text")
      && (element.textContent ?? "").includes("第二行保留換行與特殊符號 <>&。"),
    ));
    expect(prompt).toHaveTextContent("這是一段很長的合成完整題目");
    expect(prompt).toHaveClass("prompt-text");
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

  it("學生可自由選題、提交多題並確認修改，只顯示本組狀態", async () => {
    const session = { role: "student" as const, activityId: "a1", group: { id: "g1", name: "第一組" }, expiresAt: "2026-10-24T10:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, {
        role: "student", activityId: "a1", state: "OPEN", revision: 1, group: session.group,
        questions: [{ id: "q1", displayNumber: "1-1", sortOrder: 0 }, { id: "q2", displayNumber: "2", sortOrder: 1 }],
        submissions: [],
      }))
      .mockResolvedValueOnce(response(true, { questionId: "q1", answer: "甲答案", serverReceivedAt: "2026-10-24T02:01:00.000Z" }))
      .mockResolvedValueOnce(response(true, { questionId: "q2", answer: "第二題", serverReceivedAt: "2026-10-24T02:02:00.000Z" }))
      .mockResolvedValueOnce(response(true, { questionId: "q1", answer: "甲修改", serverReceivedAt: "2026-10-24T02:03:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<StudentActivityView session={session} />);

    await user.click(await screen.findByRole("button", { name: "1-1" }));
    await user.type(screen.getByLabelText("答案"), "甲答案");
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    expect(await screen.findByText(/最後有效時間：2026-10-24T02:01/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    await user.type(screen.getByLabelText("答案"), "第二題");
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    await user.click(screen.getByRole("button", { name: "1-1" }));
    await user.clear(screen.getByLabelText("答案"));
    await user.type(screen.getByLabelText("答案"), "甲修改");
    await user.click(screen.getByRole("button", { name: "修改答案" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("更新有效提交時間與順位"));
    expect(await screen.findByDisplayValue("甲修改")).toBeInTheDocument();

    const rendered = JSON.stringify(document.body.textContent);
    expect(rendered).not.toContain("第二組答案");
    expect(rendered).not.toContain("receiveSequence");
    expect(rendered).not.toContain("順位");
  });

  it("提交失敗可用相同 idempotency key 重送，截止回應立即切換唯讀", async () => {
    const session = { role: "student" as const, activityId: "a1", group: { id: "g1", name: "第一組" }, expiresAt: "2026-10-24T10:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, {
        role: "student", activityId: "a1", state: "OPEN", revision: 1, group: session.group,
        questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [],
      }))
      .mockResolvedValueOnce(response(false, { error: { code: "TEMPORARY", message: "暫時失敗" } }))
      .mockResolvedValueOnce(response(true, { questionId: "q1", answer: "重送答案", serverReceivedAt: "2026-10-24T02:01:00.000Z" }))
      .mockResolvedValueOnce(response(false, { error: { code: "ACTIVITY_CLOSED", message: "活動已結束，不得再提交或修改答案。" } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StudentActivityView session={session} />);
    await user.click(await screen.findByRole("button", { name: "1" }));
    await user.type(screen.getByLabelText("答案"), "重送答案");
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時失敗");
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    const firstBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as { idempotencyKey: string };
    const retryBody = JSON.parse(fetchMock.mock.calls[2]![1].body as string) as { idempotencyKey: string };
    expect(retryBody.idempotencyKey).toBe(firstBody.idempotencyKey);

    await user.clear(screen.getByLabelText("答案"));
    await user.type(screen.getByLabelText("答案"), "截止後修改");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "修改答案" }));
    expect(await screen.findByText("唯讀結果")).toBeInTheDocument();
    expect(screen.queryByLabelText("答案")).not.toBeInTheDocument();
  });

  it("socket 重連以權威 snapshot 取代本組答案並恢復截止狀態", async () => {
    const session = { role: "student" as const, activityId: "a1", group: { id: "g1", name: "第一組" }, expiresAt: "2026-10-24T10:00:00.000Z" };
    const socket = new MockActivitySocket();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(true, { role: "student", activityId: "a1", state: "OPEN", revision: 2, group: session.group, questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [{ questionId: "q1", answer: "舊答案", serverReceivedAt: "2026-10-24T02:00:00.000Z" }] }))
      .mockResolvedValueOnce(response(true, { role: "student", activityId: "a1", state: "OPEN", revision: 5, group: session.group, questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [{ questionId: "q1", answer: "另一個同組 session 的新答案", serverReceivedAt: "2026-10-24T02:05:00.000Z" }] }))
      .mockResolvedValueOnce(response(true, { role: "student", activityId: "a1", state: "CLOSED", revision: 6, group: session.group, questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [{ questionId: "q1", answer: "另一個同組 session 的新答案", serverReceivedAt: "2026-10-24T02:05:00.000Z" }], results: { activityId: "a1", revision: 6, closedAt: "2026-10-24T03:00:00.000Z", group: session.group, questions: [{ question: { id: "q1", displayNumber: "1", sortOrder: 0 }, winner: { id: "g1", name: "第一組" }, ownResult: { status: "ANSWERED", answer: "另一個同組 session 的新答案", rank: 1 } }] } })));
    const user = userEvent.setup();
    render(<StudentActivityView session={session} socketFactory={socketFactory(socket)} />);
    await user.click(await screen.findByRole("button", { name: "1" }));
    expect(screen.getByDisplayValue("舊答案")).toBeInTheDocument();
    act(() => socket.dispatch("disconnect"));
    expect(screen.getByRole("button", { name: "修改答案" })).toBeDisabled();
    act(() => socket.dispatch("connect"));
    expect(await screen.findByDisplayValue("另一個同組 session 的新答案")).toBeInTheDocument();
    act(() => socket.dispatch("disconnect"));
    act(() => socket.dispatch("connect"));
    expect(await screen.findByText("唯讀結果")).toBeInTheDocument();
    expect(screen.queryByLabelText("答案")).not.toBeInTheDocument();
  });

  it("學生收到截止 socket 通知後只經受限 results API 顯示成功組別與本組順位", async () => {
    const session = { role: "student" as const, activityId: "a1", group: { id: "g2", name: "第二組" }, expiresAt: "2026-10-25T10:00:00.000Z" };
    const socket = new MockActivitySocket();
    const restrictedResults = {
      activityId: "a1", revision: 5, closedAt: "2026-10-25T03:00:00.000Z", group: session.group,
      questions: [{ question: { id: "q1", displayNumber: "1", sortOrder: 0 }, winner: { id: "g1", name: "第一組" }, ownResult: { status: "ANSWERED", answer: "本組提交內容", rank: 2 } }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, { role: "student", activityId: "a1", state: "OPEN", revision: 4, group: session.group, questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [{ questionId: "q1", answer: "本組答案", serverReceivedAt: "2026-10-25T02:02:00.000Z" }], results: null }))
      .mockResolvedValueOnce(response(true, restrictedResults));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentActivityView session={session} socketFactory={socketFactory(socket)} />);
    expect(await screen.findByText("全部題目已開放，可自由選擇題號。")).toBeInTheDocument();
    act(() => socket.dispatch("activity.closed", { activityId: "a1", state: "CLOSED", revision: 5 }));
    expect(await screen.findByText("成功組別：第一組")).toBeInTheDocument();
    expect(screen.getByText("本組提交內容")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(JSON.stringify(restrictedResults)).not.toContain("serverReceivedAt");
    expect(document.body.textContent).not.toContain("其他組答案");
  });

  it("重連 snapshot 失敗時標示尚未同步、停用寫入並可重試", async () => {
    const session = { role: "student" as const, activityId: "a1", group: { id: "g1", name: "第一組" }, expiresAt: "2026-10-24T10:00:00.000Z" };
    const socket = new MockActivitySocket();
    const openSnapshot = { role: "student", activityId: "a1", state: "OPEN", revision: 2, group: session.group, questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [] };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(true, openSnapshot))
      .mockResolvedValueOnce(response(false, { error: { code: "TEMPORARY", message: "暫時失敗" } }))
      .mockResolvedValueOnce(response(true, { ...openSnapshot, revision: 3 })));
    const user = userEvent.setup();
    render(<StudentActivityView session={session} socketFactory={socketFactory(socket)} />);
    await user.click(await screen.findByRole("button", { name: "1" }));
    await user.type(screen.getByLabelText("答案"), "尚未送出");
    act(() => socket.dispatch("disconnect"));
    act(() => socket.dispatch("connect"));
    expect(await screen.findByRole("alert")).toHaveTextContent("即時狀態尚未同步");
    expect(screen.getByRole("button", { name: "提交答案" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重試同步" }));
    expect(await screen.findByRole("button", { name: "提交答案" })).toBeEnabled();
  });

  it("老師監看畫面以 socket 事件顯示首次提交並以修改答案取代舊值", async () => {
    const socket = new MockActivitySocket();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true, {
      role: "teacher", activityId: "a1", state: "OPEN", revision: 1,
      groups: [{ id: "g1", name: "第一組" }], questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }], submissions: [],
    })));
    render(<TeacherGroupManager activity={{ activityId: "a1", title: "測試", state: "OPEN" as never, questionCount: 1 }} socketFactory={socketFactory(socket)} />);
    expect(await screen.findByText("尚無組別提交")).toBeInTheDocument();
    act(() => socket.dispatch("submission.updated", { activityId: "a1", questionId: "q1", groupId: "g1", answer: "第一版", serverReceivedAt: "2026-10-24T02:01:00.000Z", revision: 2 }));
    expect(await screen.findByText("第一版")).toBeInTheDocument();
    expect(screen.getByText("第一組")).toBeInTheDocument();
    act(() => socket.dispatch("submission.updated", { activityId: "a1", questionId: "q1", groupId: "g1", answer: "修改版", serverReceivedAt: "2026-10-24T02:02:00.000Z", revision: 3 }));
    expect(await screen.findByText("修改版")).toBeInTheDocument();
    expect(screen.queryByText("第一版")).not.toBeInTheDocument();
  });

  it("老師開始後顯示結束控制；確認後防重複並切換唯讀結果", async () => {
    let resolveClose!: (value: Response) => void;
    const closePromise = new Promise<Response>((resolve) => { resolveClose = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, { activityId: "a1", state: "OPEN", revision: 2 }))
      .mockResolvedValueOnce(response(true, { role: "teacher", activityId: "a1", state: "OPEN", revision: 2, groups: [], questions: [], submissions: [] }))
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
      .mockResolvedValueOnce(response(true, { role: "teacher", activityId: "a1", state: "OPEN", revision: 2, groups: [], questions: [], submissions: [] }))
      .mockResolvedValueOnce(response(false, { error: { code: "API_FAILURE", message: "暫時無法結束" } }))
      .mockResolvedValueOnce(response(false, { error: { code: "ACTIVITY_ALREADY_CLOSED", message: "活動已結束" } }));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<TeacherGroupManager activity={{ activityId: "a1", title: "測試", state: "DRAFT", questionCount: 2 }} />);
    await user.click(screen.getByRole("button", { name: "開始搶答" }));
    await user.click(await screen.findByRole("button", { name: "結束活動" }));
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
            message: "找不到同一列中的「題號」、「題目」與「作答」表頭。",
          },
        })),
    );
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: "上傳並預覽" });

    await uploadFile(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "找不到同一列中的「題號」、「題目」與「作答」表頭。",
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
