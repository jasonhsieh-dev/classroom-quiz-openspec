import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { Server as SocketIOServer } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import type { ClientToServerEvents, ServerToClientEvents } from "@classroom-buzzer/shared";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { SESSION_COOKIE_NAME, SessionService } from "../auth/session-auth.js";
import { createTestDatabase } from "../db/test-database.js";
import { ActivityRepository, GroupRepository, QuestionRepository, SessionRepository } from "../db/repositories/index.js";
import {
  configureSocketServer,
  type ActivityEventPublisher,
  type ClassroomSocketServer,
} from "./socket-server.js";

const time = "2026-10-24T02:00:00.000Z";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function cookie(id: string): string {
  return `${SESSION_COOKIE_NAME}=${id}`;
}

async function setup() {
  const testDatabase = createTestDatabase();
  const activities = new ActivityRepository(testDatabase.database);
  const groups = new GroupRepository(testDatabase.database);
  const questions = new QuestionRepository(testDatabase.database);
  const sessionsRepository = new SessionRepository(testDatabase.database);
  for (const id of ["a1", "a2"]) {
    activities.create({ id, title: id, sourceFilePath: `${id}/source.xlsx`, sourceSha256: "synthetic", createdAt: time });
    groups.create({ id: `${id}-g1`, activityId: id, name: `${id} 第一組`, createdAt: time });
    questions.create({ id: `${id}-q1`, activityId: id, displayNumber: "1", sortOrder: 0, sheetName: "學習單", numberCell: "A2", answerRange: "B2", answerAnchor: "B2", originalAnswer: null });
  }
  groups.create({ id: "a1-g2", activityId: "a1", name: "a1 第二組", createdAt: time });
  sessionsRepository.create({ id: "teacher", role: "teacher", activityId: null, groupId: null, createdAt: time, expiresAt: "2026-10-24T10:00:00.000Z" });
  sessionsRepository.create({ id: "s1", role: "student", activityId: "a1", groupId: "a1-g1", createdAt: time, expiresAt: "2026-10-24T10:00:00.000Z" });
  sessionsRepository.create({ id: "s1b", role: "student", activityId: "a1", groupId: "a1-g1", createdAt: time, expiresAt: "2026-10-24T10:00:00.000Z" });
  sessionsRepository.create({ id: "s2", role: "student", activityId: "a1", groupId: "a1-g2", createdAt: time, expiresAt: "2026-10-24T10:00:00.000Z" });
  sessionsRepository.create({ id: "expired", role: "student", activityId: "a1", groupId: "a1-g1", createdAt: time, expiresAt: "2026-10-24T01:00:00.000Z" });
  const sessions = new SessionService(testDatabase.database, { now: () => new Date(time) });
  let publisher: ActivityEventPublisher | undefined;
  const relay: ActivityEventPublisher = {
    opened: (event) => publisher?.opened(event),
    closed: (event) => publisher?.closed(event),
    submission: (event) => publisher?.submission(event),
  };
  const app = createApp({ registerRoutes(instance) {
    registerApplicationRoutes(instance, testDatabase.database, {
      data: join(testDatabase.directory, "data"), uploads: join(testDatabase.directory, "uploads"), exports: join(testDatabase.directory, "exports"),
    }, { sessions, events: relay });
  } });
  const httpServer = createServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer) as ClassroomSocketServer;
  publisher = configureSocketServer(io, testDatabase.database, sessions);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const clients: ClientSocket[] = [];
  cleanups.push(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if ((httpServer as HttpServer).listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    testDatabase.cleanup();
  });
  return { app, url, clients, testDatabase };
}

function client(url: string, clients: ClientSocket[], sessionId: string | null, activityId: string, extraAuth: Record<string, unknown> = {}): ClientSocket {
  const socket = createClient(url, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { activityId, ...extraAuth },
    ...(sessionId ? { extraHeaders: { Cookie: cookie(sessionId) } } : {}),
  });
  clients.push(socket);
  return socket;
}

function connect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    socket.connect();
  });
}

function connectError(socket: ClientSocket): Promise<Error & { data?: { code?: string } }> {
  return new Promise((resolve) => {
    socket.once("connect_error", (error) => resolve(error as Error & { data?: { code?: string } }));
    socket.connect();
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待 Socket.IO 事件逾時。");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Socket.IO session、room 與事件裁切", () => {
  it("handshake 拒絕缺少、過期與跨活動 session，且客戶端無法宣告老師 room", async () => {
    const { url, clients } = await setup();
    await expect(connectError(client(url, clients, null, "a1"))).resolves.toMatchObject({ data: { code: "SESSION_REQUIRED" } });
    await expect(connectError(client(url, clients, "expired", "a1"))).resolves.toMatchObject({ data: { code: "SESSION_EXPIRED" } });
    await expect(connectError(client(url, clients, "s1", "a2"))).resolves.toMatchObject({ data: { code: "ACTIVITY_SCOPE_FORBIDDEN" } });
    const student = client(url, clients, "s1", "a1", { role: "teacher", room: "activity:a1:teacher", groupId: "a1-g2" });
    await connect(student);
    await expect(new Promise<{ ready: true }>((resolve) => student.emit("connection.ready", resolve))).resolves.toEqual({ ready: true });
  });

  it("成功交易才推播，老師取得完整提交，學生只取得本組裁切 payload", async () => {
    const { app, url, clients } = await setup();
    const teacher = client(url, clients, "teacher", "a1");
    const firstGroup = client(url, clients, "s1", "a1");
    const secondGroup = client(url, clients, "s2", "a1");
    await Promise.all([connect(teacher), connect(firstGroup), connect(secondGroup)]);
    const teacherSubmissions: unknown[] = [];
    const firstSubmissions: unknown[] = [];
    const secondSubmissions: unknown[] = [];
    const teacherOpened: unknown[] = [];
    const firstOpened: unknown[] = [];
    const secondOpened: unknown[] = [];
    const teacherClosed: unknown[] = [];
    const firstClosed: unknown[] = [];
    const secondClosed: unknown[] = [];
    teacher.on("submission.updated", (event) => teacherSubmissions.push(event));
    firstGroup.on("submission.updated", (event) => firstSubmissions.push(event));
    secondGroup.on("submission.updated", (event) => secondSubmissions.push(event));
    teacher.on("activity.opened", (event) => teacherOpened.push(event));
    firstGroup.on("activity.opened", (event) => firstOpened.push(event));
    secondGroup.on("activity.opened", (event) => secondOpened.push(event));
    teacher.on("activity.closed", (event) => teacherClosed.push(event));
    firstGroup.on("activity.closed", (event) => firstClosed.push(event));
    secondGroup.on("activity.closed", (event) => secondClosed.push(event));

    await request(app).post("/api/teacher/activities/a1/open").set("Cookie", cookie("teacher")).expect(200);
    await waitFor(() => teacherOpened.length === 1 && firstOpened.length === 1 && secondOpened.length === 1);
    expect(teacherOpened[0]).toEqual({ activityId: "a1", state: "OPEN", revision: 1 });
    expect(firstOpened[0]).toEqual(teacherOpened[0]);
    expect(secondOpened[0]).toEqual(teacherOpened[0]);

    await request(app).put("/api/student/activities/a1/questions/a1-q1/submission")
      .set("Cookie", cookie("s1")).send({ answer: "第一版", idempotencyKey: "first" }).expect(200);
    await waitFor(() => teacherSubmissions.length === 1 && firstSubmissions.length === 1);
    expect(teacherSubmissions[0]).toMatchObject({ activityId: "a1", questionId: "a1-q1", groupId: "a1-g1", answer: "第一版", revision: 2 });
    expect(firstSubmissions[0]).toMatchObject({ activityId: "a1", questionId: "a1-q1", answer: "第一版", revision: 2 });
    expect(firstSubmissions[0]).not.toHaveProperty("groupId");
    expect(firstSubmissions[0]).not.toHaveProperty("receiveSequence");
    expect(firstSubmissions[0]).not.toHaveProperty("rank");
    expect(secondSubmissions).toEqual([]);

    await request(app).put("/api/student/activities/a1/questions/a1-q1/submission")
      .set("Cookie", cookie("s1")).send({ answer: "不同 payload", idempotencyKey: "first" }).expect(409);
    await request(app).put("/api/student/activities/a1/questions/a1-q1/submission")
      .set("Cookie", cookie("s1")).send({ answer: "第一版", idempotencyKey: "first" }).expect(200);
    expect(teacherSubmissions).toHaveLength(1);
    expect(firstSubmissions).toHaveLength(1);

    await request(app).put("/api/student/activities/a1/questions/a1-q1/submission")
      .set("Cookie", cookie("s1b")).send({ answer: "修改版", idempotencyKey: "modified" }).expect(200);
    await waitFor(() => teacherSubmissions.length === 2 && firstSubmissions.length === 2);
    expect(teacherSubmissions[1]).toMatchObject({ answer: "修改版", revision: 3 });
    expect(firstSubmissions[1]).toMatchObject({ answer: "修改版", revision: 3 });

    await request(app).put("/api/student/activities/a1/questions/a1-q1/submission")
      .set("Cookie", cookie("s1")).send({ answer: "   ", idempotencyKey: "invalid" }).expect(400);
    expect(teacherSubmissions).toHaveLength(2);
    expect(firstSubmissions).toHaveLength(2);

    await request(app).post("/api/teacher/activities/a1/close").set("Cookie", cookie("teacher")).expect(200);
    await waitFor(() => teacherClosed.length === 1 && firstClosed.length === 1 && secondClosed.length === 1);
    expect(teacherClosed[0]).toEqual({ activityId: "a1", state: "CLOSED", revision: 4 });
    expect(firstClosed[0]).toEqual(teacherClosed[0]);
    expect(secondClosed[0]).toEqual(teacherClosed[0]);
    expect(teacherClosed[0]).not.toHaveProperty("answer");
    expect(teacherClosed[0]).not.toHaveProperty("results");
    await request(app).post("/api/teacher/activities/a1/close").set("Cookie", cookie("teacher")).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(teacherClosed).toHaveLength(1);
    expect(firstClosed).toHaveLength(1);
    expect(secondClosed).toHaveLength(1);
  });
});
