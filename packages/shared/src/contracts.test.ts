import { describe, expect, it } from "vitest";
import {
  ActivitySnapshotSchema,
  ApiErrorSchema,
  ConfirmImportResponseSchema,
  ImportDraftPreviewSchema,
  RoleSchema,
  StudentSubmissionUpdatedEventSchema,
  StudentActivitySnapshotSchema,
  TeacherActivitySnapshotSchema,
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
        questions: [{ id: "question-1", displayNumber: "1-1", sortOrder: 0 }],
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
      questions: [{ id: "q1", displayNumber: "1", sortOrder: 0 }],
    };
    expect(TeacherActivitySnapshotSchema.parse({
      ...base, role: "teacher", groups: [{ id: "g1", name: "第一組" }],
      submissions: [{ questionId: "q1", groupId: "g1", answer: "答案", serverReceivedAt: "2026-10-24T02:00:00.000Z" }],
    }).submissions[0]).toHaveProperty("groupId", "g1");
    expect(StudentActivitySnapshotSchema.parse({
      ...base, role: "student", group: { id: "g1", name: "第一組" },
      submissions: [{ questionId: "q1", answer: "答案", serverReceivedAt: "2026-10-24T02:00:00.000Z" }],
    }).submissions[0]).not.toHaveProperty("groupId");
    expect(StudentActivitySnapshotSchema.safeParse({
      ...base, role: "student", group: { id: "g1", name: "第一組" },
      groups: [{ id: "g2", name: "第二組" }], submissions: [],
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
});
