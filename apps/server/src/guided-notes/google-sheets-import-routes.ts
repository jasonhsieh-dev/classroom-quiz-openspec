import { Router } from "express";
import { GoogleSheetsListRequestSchema, GoogleSheetsListResponseSchema, GoogleSheetsPreviewRequestSchema,
  GoogleSheetsConfirmRequestSchema, GoogleSheetsImportPreviewSchema, ConfirmImportResponseSchema } from "@classroom-buzzer/shared";
import type { AuthenticatedRequest } from "../auth/session-auth.js";
import { AppError } from "../errors.js";
import { GuidedNotesError } from "./errors.js";
import type { GoogleSheetsReader } from "./google-sheets-reader.js";
import type { GoogleSheetsImportService } from "./google-sheets-import-service.js";

function convertError(error: unknown): unknown {
  return error instanceof GuidedNotesError ? new AppError(422,error.code,error.message,error.details) : error;
}
export function createGoogleSheetsImportRouter(reader: GoogleSheetsReader, service: GoogleSheetsImportService): Router {
  const router = Router();
  router.post("/sheets", async (request,response,next) => {
    try {
      const input = GoogleSheetsListRequestSchema.safeParse(request.body);
      if (!input.success) throw new AppError(400,"GOOGLE_INPUT_INVALID","請提供 Google Sheets 網址。");
      const result = await reader.listSheets((request as unknown as AuthenticatedRequest).authSession,input.data.url);
      response.json(GoogleSheetsListResponseSchema.parse({ spreadsheetId: result.spreadsheetId,
        sheets: result.sheets.map(({ sheetId,title }) => ({ sheetId,title })) }));
    } catch (error) { next(convertError(error)); }
  });
  router.post("/", async (request,response,next) => {
    try {
      const input = GoogleSheetsPreviewRequestSchema.safeParse(request.body);
      if (!input.success) throw new AppError(400,"GOOGLE_INPUT_INVALID","請提供 Google Sheets 網址及有效分頁。");
      const result = await service.createDraft((request as unknown as AuthenticatedRequest).authSession,input.data.url,input.data.sheetId);
      response.status(201).json(GoogleSheetsImportPreviewSchema.parse({ sourceKind: "google-sheets", ...result }));
    } catch (error) { next(convertError(error)); }
  });
  router.post("/:id/confirm", async (request,response,next) => {
    try {
      const input = GoogleSheetsConfirmRequestSchema.safeParse(request.body);
      if (!input.success) throw new AppError(400,"INVALID_ACTIVITY_TITLE","活動名稱須為 1 至 200 字。");
      const activity = await service.confirmDraft((request as unknown as AuthenticatedRequest).authSession,request.params.id,input.data.title);
      // Never serialize ActivityRecord paths or cloud snapshot.
      response.status(201).json(ConfirmImportResponseSchema.parse({ activityId: activity.id,title: activity.title,state: activity.state,
        questionCount: service.questionCount(activity.id) }));
    } catch (error) { next(convertError(error)); }
  });
  router.delete("/:id", (request,response,next) => {
    try { service.cancelDraft((request as unknown as AuthenticatedRequest).authSession,request.params.id);response.status(204).end(); }
    catch (error) { next(convertError(error)); }
  });
  return router;
}
