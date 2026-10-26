import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../test-database.js";
import {
  ActivityRepository,
  GroupRepository,
  QuestionRepository,
  RepositoryError,
  SessionRepository,
} from "./index.js";

const databases: TestDatabase[] = [];
const createdAt = "2026-10-23T01:00:00.000Z";

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup();
});

function createRepositories() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  return {
    testDatabase,
    activities: new ActivityRepository(testDatabase.database),
    groups: new GroupRepository(testDatabase.database),
    sessions: new SessionRepository(testDatabase.database),
    questions: new QuestionRepository(testDatabase.database),
  };
}

function createActivity(activities: ActivityRepository, id = "activity-1") {
  return activities.create({
    id,
    title: `活動 ${id}`,
    sourceFilePath: `${id}/source.xlsx`,
    sourceSha256: `sha256-${id}`,
    createdAt,
  });
}

function createGroup(
  groups: GroupRepository,
  activityId = "activity-1",
  id = "group-1",
  name = "第一組",
) {
  return groups.create({ id, activityId, name, createdAt });
}

function expectRepositoryCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("預期 repository 操作失敗");
  } catch (error) {
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({ code });
  }
}

describe("ActivityRepository", () => {
  it("建立、查詢、列出及更新活動，且狀態與 revision 使用 schema 預設值", () => {
    const { activities } = createRepositories();
    const created = createActivity(activities);

    expect(created).toMatchObject({
      state: "DRAFT",
      revision: 0,
      nextReceiveSequence: 0,
      openedAt: null,
      closedAt: null,
    });
    expect(activities.findById(created.id)).toEqual(created);
    expect(activities.list()).toEqual([created]);
    expect(activities.rename(created.id, "更新後活動").title).toBe(
      "更新後活動",
    );
  });

  it("將重複主鍵與不存在資料分別轉成穩定錯誤", () => {
    const { activities } = createRepositories();
    createActivity(activities);

    expectRepositoryCode(() => createActivity(activities), "CONFLICT");
    expect(activities.findById("missing")).toBeUndefined();
    expectRepositoryCode(() => activities.getById("missing"), "NOT_FOUND");
    expectRepositoryCode(
      () => activities.rename("missing", "不存在"),
      "NOT_FOUND",
    );
  });

  it("以最新優先列出 DRAFT/OPEN/CLOSED 摘要及正確題數", () => {
    const { testDatabase, activities, questions } = createRepositories();
    activities.create({
      id: "draft", title: "草稿", sourceFilePath: "draft.xlsx",
      sourceSha256: "draft-sha", createdAt: "2026-10-23T01:00:00.000Z",
    });
    activities.create({
      id: "open", title: "進行中", sourceFilePath: "open.xlsx",
      sourceSha256: "open-sha", createdAt: "2026-10-23T02:00:00.000Z",
    });
    activities.create({
      id: "closed", title: "已結束", sourceFilePath: "closed.xlsx",
      sourceSha256: "closed-sha", createdAt: "2026-10-23T03:00:00.000Z",
    });
    testDatabase.database.prepare(
      "UPDATE activities SET state = 'OPEN', revision = 1, opened_at = ? WHERE id = 'open'",
    ).run("2026-10-23T02:30:00.000Z");
    testDatabase.database.prepare(
      "UPDATE activities SET state = 'CLOSED', revision = 2, opened_at = ?, closed_at = ? WHERE id = 'closed'",
    ).run("2026-10-23T03:30:00.000Z", "2026-10-23T04:00:00.000Z");
    for (let index = 0; index < 2; index += 1) {
      questions.create({
        id: `closed-q${index + 1}`, activityId: "closed",
        displayNumber: String(index + 1), sortOrder: index,
        sheetName: "學習單", numberCell: `A${index + 2}`,
        answerRange: `B${index + 2}`, answerAnchor: `B${index + 2}`,
        originalAnswer: null,
      });
    }
    questions.create({
      id: "open-q1", activityId: "open", displayNumber: "1", sortOrder: 0,
      sheetName: "學習單", numberCell: "A2", answerRange: "B2",
      answerAnchor: "B2", originalAnswer: null,
    });

    expect(activities.listSummaries()).toEqual([
      {
        activityId: "closed", title: "已結束", state: "CLOSED", revision: 2,
        createdAt: "2026-10-23T03:00:00.000Z",
        openedAt: "2026-10-23T03:30:00.000Z",
        closedAt: "2026-10-23T04:00:00.000Z", questionCount: 2,
      },
      {
        activityId: "open", title: "進行中", state: "OPEN", revision: 1,
        createdAt: "2026-10-23T02:00:00.000Z",
        openedAt: "2026-10-23T02:30:00.000Z",
        closedAt: null, questionCount: 1,
      },
      {
        activityId: "draft", title: "草稿", state: "DRAFT", revision: 0,
        createdAt: "2026-10-23T01:00:00.000Z",
        openedAt: null, closedAt: null, questionCount: 0,
      },
    ]);
  });
});

describe("GroupRepository", () => {
  it("建立、依活動查詢及重新命名組別並由 repository 維護正規化名稱", () => {
    const { activities, groups } = createRepositories();
    createActivity(activities);

    const group = createGroup(groups, "activity-1", "group-1", "  第一組  ");
    expect(group).toMatchObject({ name: "第一組", normalizedName: "第一組" });
    expect(groups.listByActivity("activity-1")).toEqual([group]);
    expect(groups.rename(group.id, "第二組")).toMatchObject({
      name: "第二組",
      normalizedName: "第二組",
    });
  });

  it("拒絕空白、同活動重複名稱與不存在的 activity foreign key", () => {
    const { activities, groups } = createRepositories();
    createActivity(activities);
    createGroup(groups);

    expectRepositoryCode(
      () => createGroup(groups, "activity-1", "group-empty", "   "),
      "INVALID_DATA",
    );
    expectRepositoryCode(
      () => createGroup(groups, "activity-1", "group-2", " 第一組 "),
      "CONFLICT",
    );
    expectRepositoryCode(
      () => createGroup(groups, "missing", "group-3", "第三組"),
      "FOREIGN_KEY_VIOLATION",
    );
    expectRepositoryCode(() => groups.getById("missing"), "NOT_FOUND");
  });
});

describe("SessionRepository", () => {
  it("建立老師與學生 session、查詢並更新到期時間", () => {
    const { activities, groups, sessions } = createRepositories();
    createActivity(activities);
    createGroup(groups);

    const teacher = sessions.create({
      id: "teacher-session",
      role: "teacher",
      activityId: null,
      groupId: null,
      createdAt,
      expiresAt: "2026-10-23T02:00:00.000Z",
    });
    const student = sessions.create({
      id: "student-session",
      role: "student",
      activityId: "activity-1",
      groupId: "group-1",
      createdAt,
      expiresAt: "2026-10-23T02:00:00.000Z",
    });

    expect(teacher).toMatchObject({ activityId: null, groupId: null });
    expect(sessions.listByActivity("activity-1")).toEqual([student]);
    expect(
      sessions.updateExpiration(
        student.id,
        "2026-10-23T03:00:00.000Z",
      ).expiresAt,
    ).toBe("2026-10-23T03:00:00.000Z");
  });

  it("拒絕角色與組別不一致、跨活動組別及不存在資料", () => {
    const { activities, groups, sessions } = createRepositories();
    createActivity(activities, "activity-1");
    createActivity(activities, "activity-2");
    createGroup(groups, "activity-1");

    expectRepositoryCode(
      () =>
        sessions.create({
          id: "scoped-teacher",
          role: "teacher",
          activityId: "activity-1",
          groupId: null,
          createdAt,
          expiresAt: createdAt,
        }),
      "INVALID_DATA",
    );
    expectRepositoryCode(
      () =>
        sessions.create({
          id: "student-without-group",
          role: "student",
          activityId: "activity-1",
          groupId: null,
          createdAt,
          expiresAt: createdAt,
        }),
      "INVALID_DATA",
    );
    expectRepositoryCode(
      () =>
        sessions.create({
          id: "student-without-activity",
          role: "student",
          activityId: null,
          groupId: "group-1",
          createdAt,
          expiresAt: createdAt,
        }),
      "INVALID_DATA",
    );
    expectRepositoryCode(
      () =>
        sessions.create({
          id: "cross-activity",
          role: "student",
          activityId: "activity-2",
          groupId: "group-1",
          createdAt,
          expiresAt: createdAt,
        }),
      "FOREIGN_KEY_VIOLATION",
    );
    expectRepositoryCode(() => sessions.getById("missing"), "NOT_FOUND");
    expectRepositoryCode(
      () => sessions.updateExpiration("missing", createdAt),
      "NOT_FOUND",
    );
  });
});

describe("QuestionRepository", () => {
  it("建立、排序查詢及更新動態 mapping，不依賴固定儲存格", () => {
    const { activities, questions } = createRepositories();
    createActivity(activities);
    const second = questions.create({
      id: "question-2",
      activityId: "activity-1",
      displayNumber: "A2",
      sortOrder: 1,
      sheetName: "工作表甲",
      numberCell: "D18",
      answerRange: "F18:H18",
      answerAnchor: "F18",
      originalAnswer: null,
    });
    const first = questions.create({
      id: "question-1",
      activityId: "activity-1",
      displayNumber: "1-1",
      sortOrder: 0,
      promptText: "請比較兩種方法。",
      promptRange: "C7:E7",
      sheetName: "工作表乙",
      numberCell: "B7",
      answerRange: "G7",
      answerAnchor: "G7",
      originalAnswer: "原內容",
    });

    expect(questions.listByActivity("activity-1")).toEqual([first, second]);
    expect(first).toMatchObject({
      promptText: "請比較兩種方法。",
      promptRange: "C7:E7",
    });
    expect(
      questions.updateMapping(first.id, {
        sheetName: "移動後",
        numberCell: "J21",
        answerRange: "L21:N21",
        answerAnchor: "L21",
        originalAnswer: "更新內容",
      }),
    ).toMatchObject({
      sheetName: "移動後",
      numberCell: "J21",
      answerRange: "L21:N21",
      answerAnchor: "L21",
      originalAnswer: "更新內容",
      promptText: "請比較兩種方法。",
      promptRange: "C7:E7",
    });
    expect(
      questions.updateMetadata(first.id, {
        promptText: "更新後的完整題目",
        promptRange: "C7:F8",
      }),
    ).toEqual({
      ...first,
      promptText: "更新後的完整題目",
      promptRange: "C7:F8",
      sheetName: "移動後",
      numberCell: "J21",
      answerRange: "L21:N21",
      answerAnchor: "L21",
      originalAnswer: "更新內容",
    });
  });

  it("拒絕題號、排序重複及不存在的 activity foreign key", () => {
    const { activities, questions } = createRepositories();
    createActivity(activities);
    const input = {
      id: "question-1",
      activityId: "activity-1",
      displayNumber: "1",
      sortOrder: 0,
      sheetName: "學習單",
      numberCell: "A2",
      answerRange: "B2",
      answerAnchor: "B2",
      originalAnswer: null,
    };
    questions.create(input);

    expectRepositoryCode(
      () => questions.create({ ...input, id: "duplicate-number", sortOrder: 1 }),
      "CONFLICT",
    );
    expectRepositoryCode(
      () =>
        questions.create({
          ...input,
          id: "duplicate-order",
          displayNumber: "2",
        }),
      "CONFLICT",
    );
    expectRepositoryCode(
      () =>
        questions.create({
          ...input,
          id: "missing-activity",
          activityId: "missing",
        }),
      "FOREIGN_KEY_VIOLATION",
    );
    expectRepositoryCode(() => questions.getById("missing"), "NOT_FOUND");
    expectRepositoryCode(
      () =>
        questions.updateMapping("missing", {
          sheetName: "學習單",
          numberCell: "A3",
          answerRange: "B3",
          answerAnchor: "B3",
          originalAnswer: null,
        }),
      "NOT_FOUND",
    );
    expectRepositoryCode(
      () => questions.updateMetadata("missing", {
        promptText: "不存在",
        promptRange: "C3",
      }),
      "NOT_FOUND",
    );
  });

  it("刪除 activity 時由 foreign key cascade 維持關聯資料一致", () => {
    const { testDatabase, activities, groups, sessions, questions } =
      createRepositories();
    createActivity(activities);
    createGroup(groups);
    sessions.create({
      id: "student-session",
      role: "student",
      activityId: "activity-1",
      groupId: "group-1",
      createdAt,
      expiresAt: createdAt,
    });
    questions.create({
      id: "question-1",
      activityId: "activity-1",
      displayNumber: "1",
      sortOrder: 0,
      sheetName: "學習單",
      numberCell: "A2",
      answerRange: "B2",
      answerAnchor: "B2",
      originalAnswer: null,
    });

    testDatabase.database
      .prepare("DELETE FROM activities WHERE id = ?")
      .run("activity-1");

    expect(groups.listByActivity("activity-1")).toEqual([]);
    expect(sessions.listByActivity("activity-1")).toEqual([]);
    expect(questions.listByActivity("activity-1")).toEqual([]);
  });
});
