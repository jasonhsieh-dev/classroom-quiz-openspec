import { describe, expect, it } from "vitest";
import request from "supertest";
import { HealthResponseSchema } from "@classroom-buzzer/shared";
import { createApp } from "./app.js";
import { AppError } from "./errors.js";

describe("Express 基礎架構", () => {
  it("回傳可驗證的健康檢查結果", async () => {
    const response = await request(createApp()).get("/api/health").expect(200);
    expect(HealthResponseSchema.parse(response.body)).toEqual({
      status: "ok",
      service: "classroom-buzzer-server",
    });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("以繁體中文回傳找不到資源", async () => {
    const response = await request(createApp()).get("/api/missing").expect(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "找不到要求的資源。" },
    });
  });

  it("不在未預期錯誤回應洩漏 stack、絕對路徑或原始訊息", async () => {
    const app = createApp({
      registerRoutes(instance) {
        instance.get("/api/failure", () => {
          throw new Error("C:\\Users\\teacher\\secret.xlsx");
        });
      },
    });

    const response = await request(app).get("/api/failure").expect(500);
    const serialized = JSON.stringify(response.body);
    expect(response.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "伺服器發生未預期錯誤。" },
    });
    expect(serialized).not.toContain("secret.xlsx");
    expect(serialized).not.toContain("stack");
  });

  it("保留可預期應用錯誤的穩定 code 與 details", async () => {
    const app = createApp({
      registerRoutes(instance) {
        instance.get("/api/invalid", () => {
          throw new AppError(400, "INVALID_INPUT", "輸入資料不正確。", {
            field: "title",
          });
        });
      },
    });

    const response = await request(app).get("/api/invalid").expect(400);
    expect(response.body).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "輸入資料不正確。",
        details: { field: "title" },
      },
    });
  });
});
