import { Router } from "express";
import { GoogleWritebackRuntimeStatusSchema, GoogleWritebackResponseSchema, GoogleWritebackConfirmRequestSchema, GoogleWritebackOperationRequestSchema } from "@classroom-buzzer/shared";
import type { AuthenticatedRequest } from "../auth/session-auth.js";
import { AppError } from "../errors.js";
import type { GoogleSheetsWritebackService } from "./google-sheets-writeback-service.js";
export function createGoogleSheetsWritebackRouter(service: GoogleSheetsWritebackService) {
  const router = Router({ mergeParams: true });
  router.get("/runtime",(request,response,next) => {
    try {
      response.setHeader("Cache-Control","no-store");
      response.json(GoogleWritebackRuntimeStatusSchema.parse(service.runtimeStatus((request as unknown as AuthenticatedRequest).authSession)));
    } catch (error) { next(error); }
  });
  router.get("/",(request,response,next) => {
    try { response.json(GoogleWritebackResponseSchema.parse(service.status((request as unknown as AuthenticatedRequest).authSession,(request.params as Record<string,string>).activityId!))); }
    catch (error) { next(error); }
  });
  router.post("/preview",async (request,response,next) => {
    try { response.json(GoogleWritebackResponseSchema.parse(await service.preview((request as unknown as AuthenticatedRequest).authSession,(request.params as Record<string,string>).activityId!))); }
    catch (error) { next(error); }
  });
  for (const action of ["confirm","reconcile","renew"] as const) router.post(`/${action}`,async (request,response,next) => {
    try {
      const input = (action !== "reconcile" ? GoogleWritebackConfirmRequestSchema : GoogleWritebackOperationRequestSchema).safeParse(request.body);
      if (!input.success) throw new AppError(400,"WRITEBACK_CONFIRMATION_REQUIRED","請使用操作預覽並明確確認寫回。");
      response.json(GoogleWritebackResponseSchema.parse(await service[action]((request as unknown as AuthenticatedRequest).authSession,(request.params as Record<string,string>).activityId!,input.data.operationId)));
    } catch (error) { next(error); }
  });
  return router;
}
