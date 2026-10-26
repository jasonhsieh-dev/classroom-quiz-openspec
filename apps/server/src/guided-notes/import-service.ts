import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  ConfirmImportResponse,
  ImportDraftPreview,
} from "@classroom-buzzer/shared";
import {
  ActivityRepository,
  ImportDraftRepository,
  QuestionRepository,
  type ImportDraftRecord,
} from "../db/repositories/index.js";
import type { RuntimePaths } from "../config/runtime-paths.js";
import { GuidedNotesError } from "./errors.js";
import {
  DEFAULT_MAX_GUIDED_NOTES_BYTES,
  loadGuidedNotesWorkbook,
  type GuidedNotesFileInput,
} from "./file-validation.js";
import {
  createGuidedNotesPreview,
  parseGuidedNotesWorkbook,
  type GuidedNotesQuestionMapping,
} from "./parser.js";

const DEFAULT_DRAFT_TTL_MS = 30 * 60 * 1_000;

interface ImportServiceOptions {
  draftTtlMs?: number;
  maxFileBytes?: number;
  now?: () => Date;
  idFactory?: () => string;
}

interface ConfirmImportInput {
  title?: string;
}

interface ConfirmImportResult extends ConfirmImportResponse {
  sourceFilePath: string;
  sourceSha256: string;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function defaultTitle(filename: string): string {
  return basename(filename, extname(filename)).trim();
}

function parseMappings(draft: ImportDraftRecord): GuidedNotesQuestionMapping[] {
  try {
    const value: unknown = JSON.parse(draft.mappingJson);
    if (!Array.isArray(value) || value.length === 0) throw new Error("empty");
    for (const mapping of value) {
      if (
        typeof mapping !== "object" ||
        mapping === null ||
        !("displayNumber" in mapping) ||
        typeof mapping.displayNumber !== "string" ||
        !mapping.displayNumber.trim() ||
        !("promptText" in mapping) ||
        typeof mapping.promptText !== "string" ||
        !mapping.promptText.trim() ||
        !("promptRange" in mapping) ||
        typeof mapping.promptRange !== "string" ||
        !mapping.promptRange.trim() ||
        !("sheetName" in mapping) ||
        typeof mapping.sheetName !== "string" ||
        !mapping.sheetName.trim() ||
        !("numberCell" in mapping) ||
        typeof mapping.numberCell !== "string" ||
        !mapping.numberCell.trim() ||
        !("answerRange" in mapping) ||
        typeof mapping.answerRange !== "string" ||
        !mapping.answerRange.trim() ||
        !("answerAnchor" in mapping)
        || typeof mapping.answerAnchor !== "string"
        || !mapping.answerAnchor.trim()
        || !("originalAnswer" in mapping)
        || (mapping.originalAnswer !== null && typeof mapping.originalAnswer !== "string")
      ) {
        throw new Error("invalid");
      }
    }
    return value as GuidedNotesQuestionMapping[];
  } catch (error) {
    throw new GuidedNotesError(
      "IMPORT_DRAFT_CORRUPT",
      "匯入草稿內容不完整，請重新上傳 Guided Notes。",
      undefined,
      { cause: error },
    );
  }
}

export class GuidedNotesImportService {
  private readonly drafts: ImportDraftRepository;
  private readonly activities: ActivityRepository;
  private readonly questions: QuestionRepository;
  private readonly draftTtlMs: number;
  private readonly maxFileBytes: number;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: Database.Database,
    private readonly runtimePaths: RuntimePaths,
    options: ImportServiceOptions = {},
  ) {
    this.drafts = new ImportDraftRepository(database);
    this.activities = new ActivityRepository(database);
    this.questions = new QuestionRepository(database);
    this.draftTtlMs = options.draftTtlMs ?? DEFAULT_DRAFT_TTL_MS;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_GUIDED_NOTES_BYTES;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async createDraft(input: GuidedNotesFileInput): Promise<ImportDraftPreview> {
    await this.cleanupExpired();
    const workbook = await loadGuidedNotesWorkbook(input, {
      maxBytes: this.maxFileBytes,
    });
    const mappings = parseGuidedNotesWorkbook(workbook);
    const preview = createGuidedNotesPreview(mappings);
    const id = this.idFactory();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.draftTtlMs);
    const temporaryDirectory = join(this.runtimePaths.uploads, "tmp");
    const temporaryPath = join(temporaryDirectory, `${id}.xlsx`);
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(temporaryPath, input.buffer, { flag: "wx" });

    try {
      this.drafts.create({
        id,
        originalFilename: basename(input.filename),
        tempFilePath: temporaryPath,
        sourceSha256: sha256(input.buffer),
        mappingJson: JSON.stringify(mappings),
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      await unlinkIfPresent(temporaryPath);
      throw error;
    }

    return {
      importId: id,
      filename: basename(input.filename),
      expiresAt: expiresAt.toISOString(),
      ...preview,
    };
  }

  async cancelDraft(id: string): Promise<void> {
    await this.cleanupExpired();
    const draft = this.findActiveDraft(id);
    await unlinkIfPresent(draft.tempFilePath);
    this.drafts.delete(id);
  }

  async cleanupExpired(): Promise<number> {
    const expired = this.drafts.listExpired(this.now().toISOString());
    for (const draft of expired) {
      await unlinkIfPresent(draft.tempFilePath);
      this.drafts.delete(draft.id);
    }
    return expired.length;
  }

  async confirmDraft(
    id: string,
    input: ConfirmImportInput = {},
  ): Promise<ConfirmImportResult> {
    await this.cleanupExpired();
    const draft = this.findActiveDraft(id);
    const mappings = parseMappings(draft);
    const title = (input.title ?? defaultTitle(draft.originalFilename)).trim();
    if (!title) {
      throw new GuidedNotesError(
        "INVALID_ACTIVITY_TITLE",
        "活動名稱不可空白。",
      );
    }

    const activityId = this.idFactory();
    const activityDirectory = join(
      this.runtimePaths.uploads,
      "activities",
      activityId,
    );
    const sourceFilePath = join(activityDirectory, "source.xlsx");
    await mkdir(activityDirectory, { recursive: true });
    await copyFile(draft.tempFilePath, sourceFilePath);

    const activity = await (async () => {
      try {
        const savedHash = sha256(await readFile(sourceFilePath));
        if (savedHash !== draft.sourceSha256) {
          throw new GuidedNotesError(
            "SOURCE_FILE_MISMATCH",
            "Guided Notes 來源檔案驗證失敗，請重新上傳。",
          );
        }

        const createdAt = this.now().toISOString();
        const persist = this.database.transaction(() => {
          const activity = this.activities.create({
            id: activityId,
            title,
            sourceFilePath,
            sourceSha256: draft.sourceSha256,
            createdAt,
          });
          mappings.forEach((mapping, sortOrder) => {
            this.questions.create({
              id: this.idFactory(),
              activityId,
              sortOrder,
              ...mapping,
            });
          });
          if (!this.drafts.delete(id)) {
            throw new GuidedNotesError(
              "IMPORT_DRAFT_NOT_FOUND",
              "找不到匯入草稿，請重新上傳 Guided Notes。",
            );
          }
          return activity;
        });
        return persist();
      } catch (error) {
        await rm(activityDirectory, { recursive: true, force: true });
        throw error;
      }
    })();

    // DB 已提交後，來源副本才是權威；暫存檔清理失敗不可刪除已保存來源。
    await unlinkIfPresent(draft.tempFilePath).catch(() => undefined);
    return {
      activityId: activity.id,
      title: activity.title,
      state: "DRAFT",
      questionCount: mappings.length,
      sourceFilePath,
      sourceSha256: draft.sourceSha256,
    };
  }

  private findActiveDraft(id: string): ImportDraftRecord {
    const draft = this.drafts.findById(id);
    if (!draft) {
      throw new GuidedNotesError(
        "IMPORT_DRAFT_NOT_FOUND",
        "找不到匯入草稿，可能已取消或過期。",
      );
    }
    if (draft.expiresAt <= this.now().toISOString()) {
      throw new GuidedNotesError(
        "IMPORT_DRAFT_EXPIRED",
        "匯入草稿已過期，請重新上傳 Guided Notes。",
      );
    }
    return draft;
  }
}
