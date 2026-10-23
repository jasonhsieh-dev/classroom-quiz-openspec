import { describe, expect, it } from "vitest";
import {
  ActivitySnapshotSchema,
  ApiErrorSchema,
  RoleSchema,
  StudentSubmissionUpdatedEventSchema,
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
});
