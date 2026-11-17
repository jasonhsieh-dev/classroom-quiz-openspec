import type { JWT } from "google-auth-library";
import { serviceAccountTransport } from "./google-sheets-authorization.js";
import { GoogleSheetsReader } from "./google-sheets-reader.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleSheetsAuthorization, type AuthorizedTransport, googleSheetsError } from "./google-sheets-authorization.js";
import type { SessionRecord } from "../db/repositories/session-repository.js";
const teacher: SessionRecord = { id: "teacher", role: "teacher", activityId: null, groupId: null, createdAt: "2026-01-01", expiresAt: "2099-01-01" };
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function credentialFile(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "classroom-google-auth-")); directories.push(dir);
  const file = join(dir, "synthetic.json");
  // Deliberately invalid cryptographic material: injected transport only; never authenticates.
  writeFileSync(file, JSON.stringify({ type: "service_account", client_email: "synthetic@demo.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----SYNTHETIC-NOT-A-KEY", token_uri: "https://oauth2.googleapis.com/token", ...overrides }));
  return file;
}
it("固定 Sheets v4 端點、最小 scope、不自動重試與不跟隨轉址", async () => {
  const request = vi.fn().mockResolvedValue({ data: { ok: true } });
  const factory = vi.fn(() => ({ request } as AuthorizedTransport));
  const auth = new GoogleSheetsAuthorization(credentialFile(), factory);
  await expect(auth.execute(teacher, { spreadsheetId: "synthetic-id", action: "get" })).resolves.toEqual({ ok: true });
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] }));
  expect(request).toHaveBeenCalledWith({ url: "https://sheets.googleapis.com/v4/spreadsheets/synthetic-id", method: "GET", timeout: 15000, retry: false, maxRedirects: 0 });
  await auth.execute(teacher, { spreadsheetId: "synthetic-id", action: "batchUpdate", data: { requests: [] } });
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://sheets.googleapis.com/v4/spreadsheets/synthetic-id:batchUpdate", method: "POST" }));
  expect(factory).toHaveBeenCalledTimes(1);
});
it("學生、過期 Session 及注入 URL 不建立授權或發送請求", async () => {
  const factory = vi.fn(); const auth = new GoogleSheetsAuthorization("", factory);
  await expect(auth.execute({ ...teacher, role: "student" }, { spreadsheetId: "id", action: "get" })).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
  await expect(auth.execute({ ...teacher, expiresAt: "2000-01-01" }, { spreadsheetId: "id", action: "get" })).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
  await expect(auth.execute(teacher, { spreadsheetId: "https://evil.invalid", action: "get" })).rejects.toMatchObject({ code: "GOOGLE_REQUEST_INVALID" });
  expect(factory).not.toHaveBeenCalled();
});
it("未設定、檔案不存在與非服務帳號不回傳路徑或原始錯誤", async () => {
  for (const file of ["", "relative.json"]) {
    await expect(new GoogleSheetsAuthorization(file).execute(teacher, { spreadsheetId: "id", action: "get" })).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
  }
  for (const file of [join(tmpdir(), "missing-credential.json"), credentialFile({ type: "external_account" }), credentialFile({ token_uri: "https://evil.invalid" })]) {
    await expect(new GoogleSheetsAuthorization(file).execute(teacher, { spreadsheetId: "id", action: "get" })).rejects.toMatchObject({ code: "GOOGLE_CREDENTIALS_INVALID", details: undefined });
  }
});
it.each([[401,"GOOGLE_AUTH_FAILED"],[403,"GOOGLE_PERMISSION_DENIED"],[404,"GOOGLE_DOCUMENT_UNAVAILABLE"],[429,"GOOGLE_QUOTA_EXCEEDED"],[500,"GOOGLE_API_FAILED"]])("去敏映射 HTTP %s", async (status, code) => {
  const error = { response: { status }, message: "SECRET-TOKEN", config: { headers: { Authorization: "SECRET-TOKEN" } } };
  const request = vi.fn().mockRejectedValue(error);
  const auth = new GoogleSheetsAuthorization(credentialFile(), () => ({ request } as AuthorizedTransport));
  try { await auth.execute(teacher, { spreadsheetId: "id", action: "get" }); throw new Error("expected failure"); }
  catch (result) { expect(result).toMatchObject({ code }); expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN"); expect(String(result)).not.toContain("SECRET-TOKEN"); }
  expect(request).toHaveBeenCalledTimes(1);
});
it("網路失敗與逾時明確回報連線問題", () => {
  expect(googleSheetsError({ code: "ETIMEDOUT", message: "secret" })).toMatchObject({ code: "GOOGLE_CONNECTION_FAILED" });
});

it.each([[403,"GOOGLE_PERMISSION_DENIED"],[404,"GOOGLE_DOCUMENT_UNAVAILABLE"],["ENOTFOUND","GOOGLE_CONNECTION_FAILED"]])("讀取服務沿用授權錯誤 %s", async (status,code) => {
  const request = vi.fn().mockRejectedValue(typeof status === "number" ? { response: { status },message: "secret" } : { code: status,message: "secret" });
  const reader = new GoogleSheetsReader(new GoogleSheetsAuthorization(credentialFile(),() => ({ request } as AuthorizedTransport)));
  await expect(reader.read(teacher,"https://docs.google.com/spreadsheets/d/synthetic/edit",0)).rejects.toMatchObject({ code });
  expect(request).toHaveBeenCalledTimes(1);
});
it("GET fields 與多個 ranges 安全編碼且端點固定", async () => {
  const request = vi.fn().mockResolvedValue({ data: {} });
  const auth = new GoogleSheetsAuthorization(credentialFile(),() => ({ request } as AuthorizedTransport));
  await auth.execute(teacher,{ spreadsheetId: "synthetic",action: "get",fields: "sheets(data)",ranges: ["'Notes 中文'!A1:D9"] });
  const called = new URL(request.mock.calls[0]![0].url);
  expect(called.origin).toBe("https://sheets.googleapis.com");
  expect(called.searchParams.get("fields")).toBe("sheets(data)");
  expect(called.searchParams.getAll("ranges")).toEqual(["'Notes 中文'!A1:D9"]);
});

it.each([401,403,429,500,503])("更新 HTTP %s 不進入 OAuth 重播或 Gaxios 重試", async (status) => {
  const raw = vi.fn().mockRejectedValue({ response: { status } });const wrapped = vi.fn();
  const headers = vi.fn().mockResolvedValue(new Headers());
  const client = { getRequestHeaders: headers,transporter: { request: raw },request: wrapped } as unknown as JWT;
  await expect(serviceAccountTransport(client).request({ url: "https://sheets.googleapis.com/v4/spreadsheets/id:batchUpdate",method: "POST",data: { requests: [] },timeout: 15000,retry: false,maxRedirects: 0 })).rejects.toBeDefined();
  expect(raw).toHaveBeenCalledTimes(1);expect(wrapped).not.toHaveBeenCalled();
  expect(raw).toHaveBeenCalledWith(expect.objectContaining({ retry: false,maxRedirects: 0 }));
});

it("Token 等待後才核對操作權，失效時不發送更新 HTTP",async () => {
  let release!: () => void;
  const gate = new Promise<Headers>((resolve) => { release = () => resolve(new Headers()); });
  const raw = vi.fn();const guard = vi.fn(() => { throw new Error("lost ownership"); });
  const client = { getRequestHeaders: vi.fn(() => gate),transporter: { request: raw } } as unknown as JWT;
  const request = serviceAccountTransport(client).request({ url: "https://sheets.googleapis.com/v4/spreadsheets/id:batchUpdate",method: "POST",timeout: 15000,retry: false,maxRedirects: 0,beforeSend: guard });
  expect(guard).not.toHaveBeenCalled();release();
  await expect(request).rejects.toThrow("lost ownership");
  expect(guard).toHaveBeenCalledTimes(1);expect(raw).not.toHaveBeenCalled();
});
