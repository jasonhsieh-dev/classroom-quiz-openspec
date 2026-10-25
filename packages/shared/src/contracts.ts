import { z } from "zod";

export const ActivityStateSchema = z.enum(["DRAFT", "OPEN", "CLOSED"]);
export type ActivityState = z.infer<typeof ActivityStateSchema>;

export const RoleSchema = z.enum(["teacher", "student"]);
export type Role = z.infer<typeof RoleSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("classroom-buzzer-server"),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const TeacherSessionResponseSchema = z
  .object({
    role: z.literal("teacher"),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type TeacherSessionResponse = z.infer<
  typeof TeacherSessionResponseSchema
>;

export const GroupSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export type GroupSummary = z.infer<typeof GroupSummarySchema>;

export const GroupListResponseSchema = z
  .object({
    activityId: z.string().min(1),
    state: ActivityStateSchema,
    revision: z.number().int().nonnegative(),
    groups: z.array(GroupSummarySchema),
  })
  .strict();
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;

export const StudentSessionResponseSchema = z
  .object({
    role: z.literal("student"),
    activityId: z.string().min(1),
    group: GroupSummarySchema,
    expiresAt: z.string().datetime(),
  })
  .strict();
export type StudentSessionResponse = z.infer<typeof StudentSessionResponseSchema>;

export const QuestionSummarySchema = z
  .object({
    id: z.string().min(1),
    displayNumber: z.string().min(1),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
export type QuestionSummary = z.infer<typeof QuestionSummarySchema>;

export const ActivitySnapshotSchema = z
  .object({
    activityId: z.string().min(1),
    state: ActivityStateSchema,
    revision: z.number().int().nonnegative(),
    questions: z.array(QuestionSummarySchema),
  })
  .strict();
export type ActivitySnapshot = z.infer<typeof ActivitySnapshotSchema>;

export const TeacherVisibleSubmissionSchema = z.object({
  questionId: z.string().min(1),
  groupId: z.string().min(1),
  answer: z.string(),
  serverReceivedAt: z.string().datetime(),
}).strict();

export const StudentVisibleSubmissionSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
  serverReceivedAt: z.string().datetime(),
}).strict();

export const TeacherActivitySnapshotSchema = ActivitySnapshotSchema.extend({
  role: z.literal("teacher"),
  groups: z.array(GroupSummarySchema),
  submissions: z.array(TeacherVisibleSubmissionSchema),
  results: z.lazy(() => TeacherActivityResultsSchema).nullable(),
}).strict();
export type TeacherActivitySnapshot = z.infer<typeof TeacherActivitySnapshotSchema>;

export const StudentActivitySnapshotSchema = ActivitySnapshotSchema.extend({
  role: z.literal("student"),
  group: GroupSummarySchema,
  submissions: z.array(StudentVisibleSubmissionSchema),
  results: z.lazy(() => StudentActivityResultsSchema).nullable(),
}).strict();
export type StudentActivitySnapshot = z.infer<typeof StudentActivitySnapshotSchema>;

export const SubmissionResponseSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
  serverReceivedAt: z.string().datetime(),
}).strict();
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;

export const TeacherRankedResultSchema = z.object({
  group: GroupSummarySchema,
  rank: z.number().int().positive(),
  answer: z.string(),
  serverReceivedAt: z.string().datetime(),
}).strict();
export type TeacherRankedResult = z.infer<typeof TeacherRankedResultSchema>;

export const TeacherQuestionResultSchema = z.object({
  question: QuestionSummarySchema,
  winner: GroupSummarySchema.nullable(),
  rankings: z.array(TeacherRankedResultSchema),
}).strict();
export type TeacherQuestionResult = z.infer<typeof TeacherQuestionResultSchema>;

export const TeacherActivityResultsSchema = z.object({
  activityId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  closedAt: z.string().datetime(),
  questions: z.array(TeacherQuestionResultSchema),
}).strict();
export type TeacherActivityResults = z.infer<typeof TeacherActivityResultsSchema>;

export const StudentOwnResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_ANSWERED") }).strict(),
  z.object({
    status: z.literal("ANSWERED"),
    answer: z.string(),
    rank: z.number().int().positive(),
  }).strict(),
]);
export type StudentOwnResult = z.infer<typeof StudentOwnResultSchema>;

export const StudentQuestionResultSchema = z.object({
  question: QuestionSummarySchema,
  winner: GroupSummarySchema.nullable(),
  ownResult: StudentOwnResultSchema,
}).strict();
export type StudentQuestionResult = z.infer<typeof StudentQuestionResultSchema>;

export const StudentActivityResultsSchema = z.object({
  activityId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  closedAt: z.string().datetime(),
  group: GroupSummarySchema,
  questions: z.array(StudentQuestionResultSchema),
}).strict();
export type StudentActivityResults = z.infer<typeof StudentActivityResultsSchema>;

export const GuidedNotesPreviewQuestionSchema = z
  .object({
    displayNumber: z.string().min(1),
    sheetName: z.string().min(1),
    numberCell: z.string().min(1),
    answerRange: z.string().min(1),
    answerAnchor: z.string().min(1),
    originalAnswer: z.string().nullable(),
    willOverwrite: z.boolean(),
  })
  .strict();
export type GuidedNotesPreviewQuestion = z.infer<
  typeof GuidedNotesPreviewQuestionSchema
>;

export const ImportDraftPreviewSchema = z
  .object({
    importId: z.string().min(1),
    filename: z.string().min(1),
    expiresAt: z.string().datetime(),
    questionCount: z.number().int().positive(),
    questions: z.array(GuidedNotesPreviewQuestionSchema).min(1),
  })
  .strict();
export type ImportDraftPreview = z.infer<typeof ImportDraftPreviewSchema>;

export const ConfirmImportResponseSchema = z
  .object({
    activityId: z.string().min(1),
    title: z.string().min(1),
    state: z.literal("DRAFT"),
    questionCount: z.number().int().positive(),
  })
  .strict();
export type ConfirmImportResponse = z.infer<typeof ConfirmImportResponseSchema>;

const ActivityStateEventSchema = z
  .object({
    activityId: z.string().min(1),
    state: ActivityStateSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const ActivityOpenedEventSchema = ActivityStateEventSchema.extend({
  state: z.literal("OPEN"),
}).strict();
export type ActivityOpenedEvent = z.infer<typeof ActivityOpenedEventSchema>;

export const ActivityClosedEventSchema = ActivityStateEventSchema.extend({
  state: z.literal("CLOSED"),
}).strict();
export type ActivityClosedEvent = z.infer<typeof ActivityClosedEventSchema>;

export const TeacherSubmissionUpdatedEventSchema = z
  .object({
    activityId: z.string().min(1),
    questionId: z.string().min(1),
    groupId: z.string().min(1),
    answer: z.string(),
    serverReceivedAt: z.string().datetime(),
    revision: z.number().int().positive(),
  })
  .strict();
export type TeacherSubmissionUpdatedEvent = z.infer<
  typeof TeacherSubmissionUpdatedEventSchema
>;

export const StudentSubmissionUpdatedEventSchema = z
  .object({
    activityId: z.string().min(1),
    questionId: z.string().min(1),
    answer: z.string(),
    serverReceivedAt: z.string().datetime(),
    revision: z.number().int().positive(),
  })
  .strict();
export type StudentSubmissionUpdatedEvent = z.infer<
  typeof StudentSubmissionUpdatedEventSchema
>;

export interface ServerToClientEvents {
  "activity.opened": (event: ActivityOpenedEvent) => void;
  "activity.closed": (event: ActivityClosedEvent) => void;
  "submission.updated": (
    event: TeacherSubmissionUpdatedEvent | StudentSubmissionUpdatedEvent,
  ) => void;
  "snapshot.invalidated": (event: { activityId: string; revision: number }) => void;
}

export interface ClientToServerEvents {
  "connection.ready": (acknowledge: (result: { ready: true }) => void) => void;
}
