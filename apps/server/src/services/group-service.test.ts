import { afterEach, describe, expect, it } from "vitest";
import { ActivityRepository, GroupRepository, SessionRepository } from "../db/repositories/index.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { GroupService } from "./group-service.js";

const databases: TestDatabase[] = [];
const now = "2026-10-27T02:00:00.000Z";

afterEach(() => {
  for (const item of databases.splice(0)) item.cleanup();
});

function setup(idFactory?: () => string) {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  new ActivityRepository(testDatabase.database).create({
    id: "a1", title: "測試活動", sourceFilePath: "a1/source.xlsx",
    sourceSha256: "synthetic", createdAt: now,
  });
  let sequence = 0;
  const service = new GroupService(testDatabase.database, {
    now: () => now,
    idFactory: idFactory ?? (() => `group-${++sequence}`),
  });
  return { testDatabase, service };
}

describe("組別批次設定 service", () => {
  it("在單一交易建立自動命名清單並只遞增一次 revision", () => {
    const { testDatabase, service } = setup();
    const result = service.replace("a1", 6);
    expect(result.groups.map((group) => group.name)).toEqual([
      "第 1 組", "第 2 組", "第 3 組", "第 4 組", "第 5 組", "第 6 組",
    ]);
    expect(result.revision).toBe(1);
    expect(new ActivityRepository(testDatabase.database).getById("a1").revision).toBe(1);
  });

  it("接受 1 與 100 的邊界，拒絕非整數及超出範圍且不改變資料", () => {
    const { testDatabase, service } = setup();
    expect(service.replace("a1", 1).groups).toHaveLength(1);
    expect(service.replace("a1", 100).groups).toHaveLength(100);
    const before = new GroupRepository(testDatabase.database).listByActivity("a1");
    const revision = new ActivityRepository(testDatabase.database).getById("a1").revision;
    for (const invalid of [0, 101, 1.5, Number.NaN]) {
      expect(() => service.replace("a1", invalid)).toThrowError(expect.objectContaining({
        status: 400, code: "GROUP_COUNT_INVALID",
      }));
      expect(new GroupRepository(testDatabase.database).listByActivity("a1")).toEqual(before);
      expect(new ActivityRepository(testDatabase.database).getById("a1").revision).toBe(revision);
    }
  });

  it("中途建立失敗時回滾刪除、部分新增與 revision", () => {
    const { testDatabase } = setup();
    const groups = new GroupRepository(testDatabase.database);
    groups.create({ id: "old-1", activityId: "a1", name: "舊甲組", createdAt: now });
    groups.create({ id: "old-2", activityId: "a1", name: "舊乙組", createdAt: now });
    const failing = new GroupService(testDatabase.database, {
      now: () => now,
      idFactory: () => "duplicate-id",
    });

    expect(() => failing.replace("a1", 3)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(groups.listByActivity("a1").map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "old-1", name: "舊甲組" },
      { id: "old-2", name: "舊乙組" },
    ]);
    expect(new ActivityRepository(testDatabase.database).getById("a1").revision).toBe(0);
  });

  it("DRAFT 尚無學生 session 時可用全新 id 重設完整清單", () => {
    const { testDatabase, service } = setup();
    const first = service.replace("a1", 3);
    const second = service.replace("a1", 2);
    expect(second.groups.map((group) => group.name)).toEqual(["第 1 組", "第 2 組"]);
    expect(second.groups.map((group) => group.id)).not.toEqual(first.groups.slice(0, 2).map((group) => group.id));
    expect(new GroupRepository(testDatabase.database).listByActivity("a1")).toEqual(second.groups);
    expect(second.revision).toBe(2);
  });

  it("已有學生 session 時拒絕重設並保留原組別 id、session 綁定與 revision", () => {
    const { testDatabase, service } = setup();
    const original = service.replace("a1", 2);
    const sessions = new SessionRepository(testDatabase.database);
    sessions.create({
      id: "student", role: "student", activityId: "a1", groupId: original.groups[0]!.id,
      createdAt: now, expiresAt: "2026-10-27T10:00:00.000Z",
    });

    expect(() => service.replace("a1", 3)).toThrowError(expect.objectContaining({
      status: 409, code: "GROUPS_IN_USE",
    }));
    expect(new GroupRepository(testDatabase.database).listByActivity("a1")).toEqual(original.groups);
    expect(sessions.getById("student")).toMatchObject({ activityId: "a1", groupId: original.groups[0]!.id });
    expect(new ActivityRepository(testDatabase.database).getById("a1").revision).toBe(1);
  });
});
