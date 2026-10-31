import { afterEach, describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import {
  ActivityRepository,
  GroupRepository,
  QuestionRepository,
  ResultRepository,
  SessionRepository,
  SubmissionRepository,
} from "../db/repositories/index.js";
import { ActivityStateService } from "../services/activity-state.js";

const databases: TestDatabase[] = [];
const time = "2026-10-24T02:00:00.000Z";
afterEach(() => { for (const item of databases.splice(0)) item.cleanup(); });

interface WorkerAction {
  filename: string;
  action: "submit" | "close";
  activityId: string;
  sessionId?: string;
  questionId?: string;
  answer?: string;
  idempotencyKey?: string;
  timestamp?: string;
  startGate?: SharedArrayBuffer;
  holdGate?: SharedArrayBuffer;
}

interface WorkerResult {
  kind: "result";
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string; status?: number; code?: string };
}

function setup(): TestDatabase {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  new ActivityRepository(testDatabase.database).create({
    id: "a1", title: "並行測試", sourceFilePath: "a1/source.xlsx", sourceSha256: "synthetic", createdAt: time,
  });
  const groups = new GroupRepository(testDatabase.database);
  groups.create({ id: "g1", activityId: "a1", name: "第一組", createdAt: time });
  groups.create({ id: "g2", activityId: "a1", name: "第二組", createdAt: time });
  const questions = new QuestionRepository(testDatabase.database);
  for (const [index, id] of ["q1", "q2", "q3"].entries()) {
    questions.create({
      id, activityId: "a1", displayNumber: id, promptText: `完整題目 ${id}`, promptRange: `C${index + 2}`, sortOrder: index, sheetName: "學習單",
      numberCell: `A${index + 2}`, answerRange: `B${index + 2}`, answerAnchor: `B${index + 2}`, originalAnswer: null,
    });
  }
  const sessions = new SessionRepository(testDatabase.database);
  sessions.create({ id: "s1", role: "student", activityId: "a1", groupId: "g1", createdAt: time, expiresAt: "2026-10-25T00:00:00.000Z" });
  sessions.create({ id: "s2", role: "student", activityId: "a1", groupId: "g2", createdAt: time, expiresAt: "2026-10-25T00:00:00.000Z" });
  new ActivityStateService(testDatabase.database, () => time).transition("a1", "OPEN");
  return testDatabase;
}

function spawnAction(action: WorkerAction): {
  result: Promise<WorkerResult>;
  locked: Promise<void>;
} {
  const worker = new Worker(new URL("./transaction-worker.test-helper.ts", import.meta.url), {
    workerData: { timestamp: "2026-10-24T02:01:00.000Z", ...action },
    execArgv: ["--import", "tsx"],
  });
  let resolveLocked!: () => void;
  const locked = new Promise<void>((resolve) => { resolveLocked = resolve; });
  const result = new Promise<WorkerResult>((resolve, reject) => {
    worker.on("message", (message: WorkerResult | { kind: "locked" }) => {
      if (message.kind === "locked") resolveLocked();
      else resolve(message);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`交易測試 worker 異常結束：${code}`));
    });
  });
  return { result, locked };
}

async function waitForReady(gate: Int32Array, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Atomics.load(gate, 0) < expected) {
    if (Date.now() > deadline) throw new Error("等待並行交易 barrier 逾時。");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function release(gate: Int32Array, index = 1): void {
  Atomics.store(gate, index, 1);
  Atomics.notify(gate, index);
}

describe("SQLite 真正並行交易", () => {
  it("以同步 barrier 驗證兩組同題及不同題提交不遺失且 receive_sequence 唯一", async () => {
    const database = setup();
    const sameGate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
    const same = [
      spawnAction({ filename: database.filename, action: "submit", activityId: "a1", sessionId: "s1", questionId: "q1", answer: "甲", idempotencyKey: "same-1", startGate: sameGate.buffer as SharedArrayBuffer }),
      spawnAction({ filename: database.filename, action: "submit", activityId: "a1", sessionId: "s2", questionId: "q1", answer: "乙", idempotencyKey: "same-2", startGate: sameGate.buffer as SharedArrayBuffer }),
    ];
    await waitForReady(sameGate, 2);
    release(sameGate);
    expect((await Promise.all(same.map((item) => item.result))).every((item) => item.ok)).toBe(true);

    const differentGate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
    const different = [
      spawnAction({ filename: database.filename, action: "submit", activityId: "a1", sessionId: "s1", questionId: "q2", answer: "甲二", idempotencyKey: "different-1", startGate: differentGate.buffer as SharedArrayBuffer }),
      spawnAction({ filename: database.filename, action: "submit", activityId: "a1", sessionId: "s2", questionId: "q3", answer: "乙三", idempotencyKey: "different-2", startGate: differentGate.buffer as SharedArrayBuffer }),
    ];
    await waitForReady(differentGate, 2);
    release(differentGate);
    expect((await Promise.all(different.map((item) => item.result))).every((item) => item.ok)).toBe(true);

    const attempts = new SubmissionRepository(database.database).listAttemptsByActivity("a1");
    expect(attempts).toHaveLength(4);
    expect(new Set(attempts.map((attempt) => attempt.receiveSequence)).size).toBe(4);
    expect(attempts.map((attempt) => attempt.receiveSequence).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(database.database.prepare("SELECT COUNT(*) AS count FROM current_submissions WHERE activity_id = 'a1'").get()).toEqual({ count: 4 });
  });

  it.each(["首次", "修改", "未變更"])("同組不同 session 並行相同答案：%s", async (mode) => {
    const database = setup();
    new SessionRepository(database.database).create({ id: "s1b", role: "student", activityId: "a1", groupId: "g1", createdAt: time, expiresAt: "2026-10-25T00:00:00.000Z" });
    const repository = new SubmissionRepository(database.database);
    if (mode !== "首次") {
      const seed = spawnAction({ filename: database.filename, action: "submit", activityId: "a1", sessionId: "s1", questionId: "q1", answer: mode === "修改" ? "舊答案" : "相同答案", idempotencyKey: "seed" });
      expect((await seed.result).ok).toBe(true);
    }
    const before = new ActivityRepository(database.database).getById("a1");
    const beforeAttempts = repository.listAttemptsByActivity("a1");
    const beforeCurrent = repository.findCurrent("q1", "g1");
    const gate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
    const workers = ["s1", "s1b"].map((sessionId) => spawnAction({ filename: database.filename, action: "submit", activityId: "a1", sessionId, questionId: "q1", answer: "相同答案", idempotencyKey: `parallel-${sessionId}`, timestamp: "2026-10-24T02:02:00.000Z", startGate: gate.buffer as SharedArrayBuffer }));
    await waitForReady(gate, 2);
    release(gate);
    const results = await Promise.all(workers.map((worker) => worker.result));
    const added = mode === "未變更" ? 0 : 1;
    expect(results.filter((result) => result.ok)).toHaveLength(added);
    for (const result of results.filter((result) => !result.ok)) expect(result.error).toMatchObject({ status: 409, code: "ANSWER_UNCHANGED" });
    expect(repository.listAttemptsByActivity("a1")).toHaveLength(beforeAttempts.length + added);
    expect(new ActivityRepository(database.database).getById("a1")).toMatchObject({ nextReceiveSequence: before.nextReceiveSequence + added, revision: before.revision + added });
    if (added) expect(repository.findCurrent("q1", "g1")).toMatchObject({ answer: "相同答案", receiveSequence: before.nextReceiveSequence + 1, serverReceivedAt: "2026-10-24T02:02:00.000Z" });
    else expect(repository.findCurrent("q1", "g1")).toEqual(beforeCurrent);
  });

  it("提交交易先取得寫入鎖時提交完整納入截止結果", async () => {
    const database = setup();
    const hold = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const submit = spawnAction({
      filename: database.filename, action: "submit", activityId: "a1", sessionId: "s1", questionId: "q1",
      answer: "先完成", idempotencyKey: "submit-first", holdGate: hold.buffer as SharedArrayBuffer,
    });
    await submit.locked;
    const close = spawnAction({ filename: database.filename, action: "close", activityId: "a1" });
    release(hold, 0);
    const [submitResult, closeResult] = await Promise.all([submit.result, close.result]);
    expect(submitResult.ok).toBe(true);
    expect(closeResult.ok).toBe(true);
    expect(new SubmissionRepository(database.database).listAttemptsByActivity("a1")).toHaveLength(1);
    expect(new ResultRepository(database.database).listByActivity("a1")).toMatchObject([
      { questionId: "q1", groupId: "g1", rank: 1 },
    ]);
    expect(new ActivityRepository(database.database).getById("a1")).toMatchObject({ state: "CLOSED", revision: 3, nextReceiveSequence: 1 });
  });

  it("截止交易先取得寫入鎖時拒絕提交且不留下部分寫入", async () => {
    const database = setup();
    const hold = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const close = spawnAction({
      filename: database.filename, action: "close", activityId: "a1", holdGate: hold.buffer as SharedArrayBuffer,
    });
    await close.locked;
    const submit = spawnAction({
      filename: database.filename, action: "submit", activityId: "a1", sessionId: "s1", questionId: "q1",
      answer: "太晚", idempotencyKey: "close-first",
    });
    release(hold, 0);
    const [closeResult, submitResult] = await Promise.all([close.result, submit.result]);
    expect(closeResult.ok).toBe(true);
    expect(submitResult).toMatchObject({ ok: false, error: { status: 409, code: "ACTIVITY_CLOSED" } });
    expect(new SubmissionRepository(database.database).listAttemptsByActivity("a1")).toEqual([]);
    expect(new ResultRepository(database.database).listByActivity("a1")).toEqual([]);
    expect(database.database.prepare("SELECT COUNT(*) AS count FROM current_submissions WHERE activity_id = 'a1'").get()).toEqual({ count: 0 });
    expect(new ActivityRepository(database.database).getById("a1")).toMatchObject({ state: "CLOSED", revision: 2, nextReceiveSequence: 0 });
  });
});
