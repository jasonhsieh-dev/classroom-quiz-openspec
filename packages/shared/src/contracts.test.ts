import { describe, expect, it } from "vitest";
import {
  ActivitySnapshotSchema,
  ActivitySummaryListResponseSchema,
  ApiErrorSchema,
  CloseActivityResponseSchema,
  ConfirmImportResponseSchema,
  ImportDraftPreviewSchema,
  RoleSchema,
  StudentSubmissionUpdatedEventSchema,
  StudentActivitySnapshotSchema,
  StudentActivityResultsSchema,
  TeacherActivitySnapshotSchema,
  TeacherActivityResultsSchema,
  SubmissionResponseSchema,
  TeacherSessionResponseSchema,
} from "./contracts.js";

describe("共用契約", () => {
  it("接受合法的活動快照與 API 錯誤", () => {
    expect(
      ActivitySnapshotSchema.parse({
        activityId: "activity-1",
        state: "DRAFT",
        revision: 0,
        questions: [{ id: "question-1", displayNumber: "1-1", promptText: "完整題目", sortOrder: 0 }],
      }),
    ).toMatchObject({ activityId: "activity-1", state: "DRAFT" });

    expect(
      ApiErrorSchema.parse({
        error: { code: "INVALID_INPUT", message: "輸入資料不正確" },
      }),
    ).toMatchObject({ error: { code: "INVALID_INPUT" } });
  });

  it("拒絕非法角色、revision 與多餘的學生事件欄位", () => {
    expect(RoleSchema.safeParse("admin").success).toBe(false);
    expect(
      ActivitySnapshotSchema.safeParse({
        activityId: "activity-1",
        state: "OPEN",
        revision: -1,
        questions: [],
      }).success,
    ).toBe(false);
    expect(ActivitySnapshotSchema.safeParse({
      activityId: "activity-1", state: "OPEN", revision: 1,
      questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }],
    }).success).toBe(false);
    expect(
      StudentSubmissionUpdatedEventSchema.safeParse({
        activityId: "activity-1",
        questionId: "question-1",
        answer: "答案",
        serverReceivedAt: "2026-10-23T08:00:00.000Z",
        revision: 1,
        groupId: "不應出現在學生事件中的其他組識別碼",
      }).success,
    ).toBe(false);
  });

  it("驗證 Guided Notes preview 與確認匯入回應", () => {
    expect(
      ImportDraftPreviewSchema.parse({
        importId: "draft-1",
        filename: "學習單.xlsx",
        expiresAt: "2026-10-23T08:30:00.000Z",
        questionCount: 1,
        questions: [
          {
            displayNumber: "A1",
            promptText: "請說明 A1 的概念。",
            promptRange: "E7:I7",
            sheetName: "學習單",
            numberCell: "D7",
            answerRange: "J7:L7",
            answerAnchor: "J7",
            originalAnswer: "原內容",
            willOverwrite: true,
          },
        ],
      }),
    ).toMatchObject({ questionCount: 1 });
    expect(
      ConfirmImportResponseSchema.parse({
        activityId: "activity-1",
        title: "測試活動",
        state: "DRAFT",
        questionCount: 1,
      }),
    ).toMatchObject({ state: "DRAFT" });
  });

  it("只接受伺服器建立的老師 session 回應形狀", () => {
    expect(
      TeacherSessionResponseSchema.parse({
        role: "teacher",
        expiresAt: "2026-10-23T10:00:00.000Z",
      }),
    ).toEqual({
      role: "teacher",
      expiresAt: "2026-10-23T10:00:00.000Z",
    });
    expect(
      TeacherSessionResponseSchema.safeParse({
        role: "student",
        expiresAt: "2026-10-23T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("以 strict DTO 區分老師完整資料與學生本組資料", () => {
    const base = {
      activityId: "activity-1", state: "OPEN" as const, revision: 2,
      questions: [{ id: "q1", displayNumber: "1", promptText: "第一題完整題目", sortOrder: 0 }],
    };
    expect(TeacherActivitySnapshotSchema.parse({
      ...base, title: "測試活動", role: "teacher", groups: [{ id: "g1", name: "第一組" }],
      submissions: [{ questionId: "q1", groupId: "g1", answer: "答案", serverReceivedAt: "2026-10-24T02:00:00.000Z" }],
      results: null,
    }).submissions[0]).toHaveProperty("groupId", "g1");
    expect(TeacherActivitySnapshotSchema.safeParse({
      ...base, role: "teacher", groups: [], submissions: [], results: null,
    }).success).toBe(false);
    expect(StudentActivitySnapshotSchema.parse({
      ...base, role: "student", group: { id: "g1", name: "第一組" },
      submissions: [{ questionId: "q1", answer: "答案", serverReceivedAt: "2026-10-24T02:00:00.000Z" }],
      results: null,
    }).submissions[0]).not.toHaveProperty("groupId");
    expect(StudentActivitySnapshotSchema.safeParse({
      ...base, role: "student", group: { id: "g1", name: "第一組" },
      groups: [{ id: "g2", name: "第二組" }], submissions: [], results: null,
    }).success).toBe(false);
  });

  it("以獨立結果 DTO 在後端裁切老師與學生欄位", () => {
    const question = { id: "q1", displayNumber: "1", promptText: "第一題完整題目", sortOrder: 0 };
    const winner = { id: "g2", name: "第二組" };
    expect(TeacherActivityResultsSchema.parse({
      activityId: "a1", revision: 5, closedAt: "2026-10-24T03:00:00.000Z",
      questions: [{ question, winner, rankings: [{ group: winner, rank: 1, answer: "成功答案", serverReceivedAt: "2026-10-24T02:00:00.000Z" }] }],
    }).questions[0]?.rankings[0]).toHaveProperty("serverReceivedAt");
    const student = StudentActivityResultsSchema.parse({
      activityId: "a1", revision: 5, closedAt: "2026-10-24T03:00:00.000Z", group: { id: "g1", name: "第一組" },
      questions: [{ question, winner, ownResult: { status: "ANSWERED", answer: "本組答案", rank: 2 } }],
    });
    expect(JSON.stringify(student)).not.toContain("成功答案");
    expect(JSON.stringify(student)).not.toContain("serverReceivedAt");
    expect(StudentActivityResultsSchema.safeParse({
      ...student,
      questions: [{ ...student.questions[0], otherGroupAnswer: "不可公開" }],
    }).success).toBe(false);
  });

  it("提交回應不公開全域接收序號或其他組別身分", () => {
    const response = {
      questionId: "q1",
      answer: "答案",
      serverReceivedAt: "2026-10-24T02:00:00.000Z",
    };
    expect(SubmissionResponseSchema.parse(response)).toEqual(response);
    expect(SubmissionResponseSchema.safeParse({
      ...response,
      receiveSequence: 7,
      groupId: "g1",
    }).success).toBe(false);
  });

  it("驗證活動摘要與 close 權威回應，並拒絕缺少必要欄位", () => {
    const summaries = ActivitySummaryListResponseSchema.parse({
      activities: [{
        activityId: "a1", title: "活動一", state: "CLOSED", revision: 4,
        createdAt: "2026-10-24T01:00:00.000Z",
        openedAt: "2026-10-24T02:00:00.000Z",
        closedAt: "2026-10-24T03:00:00.000Z", questionCount: 3,
      }],
    });
    expect(summaries.activities[0]).toMatchObject({ activityId: "a1", questionCount: 3 });

    expect(CloseActivityResponseSchema.parse({
      activityId: "a1", state: "CLOSED", revision: 4,
      closedAt: "2026-10-24T03:00:00.000Z", resultCount: 3,
    })).toMatchObject({ state: "CLOSED", revision: 4 });

    expect(ActivitySummaryListResponseSchema.safeParse({
      activities: [{ activityId: "a1", title: "活動一", state: "DRAFT", revision: 0 }],
    }).success).toBe(false);
    expect(CloseActivityResponseSchema.safeParse({
      activityId: "a1", state: "CLOSED", revision: 1,
      closedAt: "2026-10-24T03:00:00.000Z",
    }).success).toBe(false);
  });

  it("學生結果只允許公開題目、成功組別與自己組別結果", () => {
    const payload = {
      activityId: "a1", revision: 5, closedAt: "2026-10-24T03:00:00.000Z",
      group: { id: "g1", name: "第一組" },
      questions: [{
        question: { id: "q1", displayNumber: "1", promptText: "完整題目", sortOrder: 0 },
        winner: { id: "g2", name: "第二組" },
        ownResult: { status: "NOT_ANSWERED" },
        otherGroupAnswer: "不可公開",
      }],
    };
    expect(StudentActivityResultsSchema.safeParse(payload).success).toBe(false);
  });
});
