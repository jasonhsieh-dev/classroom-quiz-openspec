import { JWT } from "google-auth-library";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { SessionRecord } from "../db/repositories/session-repository.js";
import { AppError } from "../errors.js";

const scope = "https://www.googleapis.com/auth/spreadsheets";
const tokenUrl = "https://oauth2.googleapis.com/token";
export interface SheetsRequest {
  spreadsheetId: string;
  action: "get" | "batchUpdate";
  fields?: string;
  ranges?: string[];
  data?: Record<string, unknown>;
  /** Trusted backend guard, never part of the JSON payload or a public API parameter. */
  beforeUpdate?: () => void;
}
export interface AuthorizedTransport {
  request<T>(options: { url: string; method: "GET" | "POST"; data?: Record<string, unknown>;
    timeout: number; retry: false; maxRedirects: number; beforeSend?: () => void }): Promise<{ data: T }>;
}
/** Acquire headers first, then call the transporter directly: bypass OAuth2 requestAsync re-auth replay. */
export function serviceAccountTransport(client: JWT): AuthorizedTransport {
  return { async request<T>(options: Parameters<AuthorizedTransport["request"]>[0]) {
    const { beforeSend,...request } = options;
    if (options.method === "POST") {
      const headers = await client.getRequestHeaders(options.url);
      beforeSend?.(); // Recheck fencing after asynchronous token acquisition, immediately before HTTP.
      return client.transporter.request<T>({ ...request,headers,retry: false,maxRedirects: 0 });
    }
    return client.request<T>(request);
  } };
}
export type ServiceAccountFactory = (credentials: { email: string; key: string; scopes: string[] }) => AuthorizedTransport;

export function googleSheetsError(error: unknown): AppError {
  const value = error as { response?: { status?: number }; code?: string | number } | null;
  const status = value?.response?.status ?? (typeof value?.code === "number" ? value.code : undefined);
  if (status === 400) return new AppError(400, "GOOGLE_REQUEST_REJECTED", "Google 拒絕批次請求，請檢查來源範圍與資料。");
  if (status === 401) return new AppError(502, "GOOGLE_AUTH_FAILED", "Google 授權失敗，請檢查服務帳號設定。");
  if (status === 403) return new AppError(403, "GOOGLE_PERMISSION_DENIED", "Google 權限不足，請檢查編輯分享及保護範圍。");
  if (status === 404) return new AppError(404, "GOOGLE_DOCUMENT_UNAVAILABLE", "文件不存在或無權存取。");
  if (status === 429) return new AppError(429, "GOOGLE_QUOTA_EXCEEDED", "Google API 配額限制，請稍後重試。");
  if (["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ECONNABORTED", "ABORT_ERR", "ERR_CANCELED"].includes(String(value?.code))) {
    return new AppError(503, "GOOGLE_CONNECTION_FAILED", "無法連線 Google，請檢查網路；寫入結果可能需要核對。");
  }
  return new AppError(502, "GOOGLE_API_FAILED", "Google API 操作失敗，請稍後核對狀態。");
}

/** Backend-only transport foundation. No application route or cloud workflow is enabled here. */
export class GoogleSheetsAuthorization {
  private transport: Promise<AuthorizedTransport> | undefined;
  constructor(
    private readonly credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS,
    private readonly factory: ServiceAccountFactory = (credentials) => serviceAccountTransport(new JWT(credentials)),
  ) {}

  private async loadTransport(): Promise<AuthorizedTransport> {
    if (!this.credentialPath || !isAbsolute(this.credentialPath)) {
      throw new AppError(503, "GOOGLE_NOT_CONFIGURED", "請設定後端 GOOGLE_APPLICATION_CREDENTIALS 絕對路徑。");
    }
    try {
      const json = JSON.parse(await readFile(this.credentialPath, "utf8"));
      // Do not accept external-account configs, impersonation or caller-selected token servers.
      if (json.type !== "service_account" || typeof json.client_email !== "string" ||
          !json.client_email.endsWith(".gserviceaccount.com") ||
          typeof json.private_key !== "string" || !json.private_key.startsWith("-----BEGIN PRIVATE KEY-----") ||
          json.token_uri !== tokenUrl) throw new Error("invalid service account");
      return this.factory({ email: json.client_email, key: json.private_key, scopes: [scope] });
    } catch {
      throw new AppError(503, "GOOGLE_CREDENTIALS_INVALID", "無法載入有效服務帳號憑證，請檢查後端設定。");
    }
  }

  async execute<T>(session: SessionRecord, input: SheetsRequest): Promise<T> {
    if (session.role !== "teacher" || session.expiresAt <= new Date().toISOString()) {
      throw new AppError(403, "ROLE_FORBIDDEN", "需要有效老師 Session。");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(input.spreadsheetId) ||
        !["get", "batchUpdate"].includes(input.action)) {
      throw new AppError(400, "GOOGLE_REQUEST_INVALID", "Google 文件識別或操作無效。");
    }
    this.transport ??= this.loadTransport().catch((error: unknown) => { this.transport = undefined; throw error; });
    const client = await this.transport;
    let url = `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}${input.action === "batchUpdate" ? ":batchUpdate" : ""}`;
    if (input.action === "get" && (input.fields || input.ranges)) {
      const query = new URLSearchParams();
      if (input.fields) query.set("fields", input.fields);
      for (const range of input.ranges ?? []) query.append("ranges", range);
      url += `?${query.toString()}`;
    }
    try {
      const result = await client.request<T>({ url, method: input.action === "get" ? "GET" : "POST",
        ...(input.action === "batchUpdate" ? { data: input.data } : {}),
        ...(input.action === "batchUpdate" && input.beforeUpdate ? { beforeSend: input.beforeUpdate } : {}),
        timeout: 15_000, retry: false, maxRedirects: 0 });
      return result.data;
    } catch (error) { throw googleSheetsError(error); }
  }
}
