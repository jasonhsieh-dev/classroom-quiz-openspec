import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { SessionRepository } from "../db/repositories/index.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { SubmissionService } from "../services/submission-service.js";

interface WorkerInput {
  filename: string;
  action: "submit" | "close";
  activityId: string;
  sessionId?: string;
  questionId?: string;
  answer?: string;
  idempotencyKey?: string;
  timestamp: string;
  startGate?: SharedArrayBuffer;
  holdGate?: SharedArrayBuffer;
}

const input = workerData as WorkerInput;
const port = parentPort;
if (!port) throw new Error("交易測試 worker 缺少 parent port。");

const database = new Database(input.filename);
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");
database.pragma("journal_mode = WAL");

function clock(): string {
  if (input.holdGate) {
    const gate = new Int32Array(input.holdGate);
    port!.postMessage({ kind: "locked" });
    Atomics.wait(gate, 0, 0);
  }
  return input.timestamp;
}

try {
  if (input.startGate) {
    const gate = new Int32Array(input.startGate);
    Atomics.add(gate, 0, 1);
    Atomics.notify(gate, 0);
    Atomics.wait(gate, 1, 0);
  }

  const value = input.action === "submit"
    ? new SubmissionService(database, { clock }).submit(
        new SessionRepository(database).getById(input.sessionId!),
        {
          questionId: input.questionId!,
          answer: input.answer,
          idempotencyKey: input.idempotencyKey,
        },
      )
    : new ActivityCloseService(database, clock).close(input.activityId);
  port.postMessage({ kind: "result", ok: true, value });
} catch (error) {
  const candidate = error as Error & { status?: number; code?: string };
  port.postMessage({
    kind: "result",
    ok: false,
    error: {
      name: candidate.name,
      message: candidate.message,
      status: candidate.status,
      code: candidate.code,
    },
  });
} finally {
  database.close();
}
