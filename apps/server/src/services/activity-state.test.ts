import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import {
  ActivityRepository,
  RepositoryError,
} from "../db/repositories/index.js";
import {
  ActivityStateService,
  ActivityStateTransitionError,
} from "./activity-state.js";

const databases: TestDatabase[] = [];
const timestamps = [
  "2026-10-23T01:00:00.000Z",
  "2026-10-23T02:00:00.000Z",
];

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup();
});

function createSubject() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  const activities = new ActivityRepository(testDatabase.database);
  activities.create({
    id: "activity-1",
    title: "狀態測試",
    sourceFilePath: "source.xlsx",
    sourceSha256: "synthetic-sha256",
    createdAt: "2026-10-23T00:00:00.000Z",
  });
  let clockIndex = 0;
  const service = new ActivityStateService(
    testDatabase.database,
    () => timestamps[clockIndex++] ?? "2026-10-23T03:00:00.000Z",
  );
  return { testDatabase, activities, service };
}

describe("ActivityStateService", () => {
  it("只按 DRAFT -> OPEN -> CLOSED 合法順序轉換並逐次增加 revision", () => {
    const { service } = createSubject();

    const opened = service.transition("activity-1", "OPEN");
    expect(opened).toMatchObject({
      state: "OPEN",
      revision: 1,
      openedAt: timestamps[0],
      closedAt: null,
    });

    const closed = service.transition("activity-1", "CLOSED");
    expect(closed).toMatchObject({
      state: "CLOSED",
      revision: 2,
      openedAt: timestamps[0],
      closedAt: timestamps[1],
    });
  });

  it("拒絕 DRAFT 直接跳到 CLOSED 且不改變狀態、時間或 revision", () => {
    const { activities, service } = createSubject();

    expect(() => service.transition("activity-1", "CLOSED")).toThrowError(
      ActivityStateTransitionError,
    );
    expect(activities.getById("activity-1")).toMatchObject({
      state: "DRAFT",
      revision: 0,
      openedAt: null,
      closedAt: null,
    });
  });

  it("拒絕 OPEN 反轉為 DRAFT 與 CLOSED 重新開放", () => {
    const { activities, service } = createSubject();
    service.transition("activity-1", "OPEN");

    expect(() => service.transition("activity-1", "DRAFT")).toThrowError(
      ActivityStateTransitionError,
    );
    expect(activities.getById("activity-1")).toMatchObject({
      state: "OPEN",
      revision: 1,
    });

    service.transition("activity-1", "CLOSED");
    expect(() => service.transition("activity-1", "OPEN")).toThrowError(
      ActivityStateTransitionError,
    );
    expect(activities.getById("activity-1")).toMatchObject({
      state: "CLOSED",
      revision: 2,
    });
  });

  it("重複 close 為冪等，不重設 closedAt 或 revision", () => {
    const { service } = createSubject();
    service.transition("activity-1", "OPEN");
    const firstClose = service.transition("activity-1", "CLOSED");

    const repeatedClose = service.transition("activity-1", "CLOSED");

    expect(repeatedClose).toEqual(firstClose);
    expect(repeatedClose.revision).toBe(2);
    expect(repeatedClose.closedAt).toBe(timestamps[1]);
  });

  it("由伺服器工具增加 revision，不允許呼叫端指定新值", () => {
    const { service } = createSubject();

    expect(service.incrementRevision("activity-1").revision).toBe(1);
    expect(service.incrementRevision("activity-1").revision).toBe(2);
  });

  it("對不存在活動回傳可判斷的 NOT_FOUND 錯誤", () => {
    const { service } = createSubject();

    try {
      service.incrementRevision("missing");
      throw new Error("預期 revision 操作失敗");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryError);
      expect(error).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(() => service.transition("missing", "OPEN")).toThrowError(
      RepositoryError,
    );
  });
});
