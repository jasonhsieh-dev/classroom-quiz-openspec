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
