import { Router, type RequestHandler } from "express";
import multer from "multer";
import { AppError } from "../errors.js";
import { GuidedNotesError } from "./errors.js";
import { DEFAULT_MAX_GUIDED_NOTES_BYTES } from "./file-validation.js";
import { GuidedNotesImportService } from "./import-service.js";

function toAppError(error: unknown): Error {
  if (error instanceof AppError) return error;
  if (error instanceof GuidedNotesError) {
    const status =
      error.code === "IMPORT_DRAFT_NOT_FOUND" ||
      error.code === "IMPORT_DRAFT_EXPIRED"
        ? 404
        : 400;
    return new AppError(status, error.code, error.message, error.details);
  }
  return error instanceof Error ? error : new Error("未知匯入錯誤");
}

function decodeMultipartFilename(filename: string): string {
  const decoded = Buffer.from(filename, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? filename : decoded;
}

function uploadMiddleware(maxBytes: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: maxBytes },
  }).single("file");

  return (request, response, next) => {
    upload(request, response, (error) => {
      if (error instanceof multer.MulterError) {
        const message =
          error.code === "LIMIT_FILE_SIZE"
            ? `Guided Notes 超過允許的 ${maxBytes} bytes。`
            : "Guided Notes 上傳格式不正確。";
        next(new AppError(400, error.code, message));
        return;
      }
      next(error);
    });
  };
}

export function createGuidedNotesImportRouter(
  service: GuidedNotesImportService,
  maxBytes = DEFAULT_MAX_GUIDED_NOTES_BYTES,
): Router {
  const router = Router();

  router.post("/", uploadMiddleware(maxBytes), async (request, response, next) => {
    try {
      if (!request.file) {
        throw new AppError(
          400,
          "FILE_REQUIRED",
          "請選擇要上傳的 Guided Notes .xlsx 檔案。",
        );
      }
      const result = await service.createDraft({
        filename: decodeMultipartFilename(request.file.originalname),
        mimeType: request.file.mimetype,
        buffer: request.file.buffer,
      });
      response.status(201).json(result);
    } catch (error) {
      next(toAppError(error));
    }
  });

  router.post("/:id/confirm", async (request, response, next) => {
    try {
      const title =
        typeof request.body?.title === "string" ? request.body.title : undefined;
      const result = await service.confirmDraft(request.params.id, { title });
      const { sourceFilePath: _path, sourceSha256: _sha, ...body } = result;
      response.status(201).json(body);
    } catch (error) {
      next(toAppError(error));
    }
  });

  router.delete("/:id", async (request, response, next) => {
    try {
      await service.cancelDraft(request.params.id);
      response.status(204).end();
    } catch (error) {
      next(toAppError(error));
    }
  });

  return router;
}
