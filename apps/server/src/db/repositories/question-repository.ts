import type Database from "better-sqlite3";
import {
  entityNotFound,
  rethrowRepositoryError,
} from "./errors.js";

export interface QuestionRecord {
  id: string;
  activityId: string;
  displayNumber: string;
  sortOrder: number;
  sheetName: string;
  numberCell: string;
  answerRange: string;
  answerAnchor: string;
  originalAnswer: string | null;
}

interface QuestionRow {
  id: string;
  activity_id: string;
  display_number: string;
  sort_order: number;
  sheet_name: string;
  number_cell: string;
  answer_range: string;
  answer_anchor: string;
  original_answer: string | null;
}

export interface CreateQuestionInput {
  id: string;
  activityId: string;
  displayNumber: string;
  sortOrder: number;
  sheetName: string;
  numberCell: string;
  answerRange: string;
  answerAnchor: string;
  originalAnswer: string | null;
}

export interface UpdateQuestionMappingInput {
  sheetName: string;
  numberCell: string;
  answerRange: string;
  answerAnchor: string;
  originalAnswer: string | null;
}

function toQuestionRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    displayNumber: row.display_number,
    sortOrder: row.sort_order,
    sheetName: row.sheet_name,
    numberCell: row.number_cell,
    answerRange: row.answer_range,
    answerAnchor: row.answer_anchor,
    originalAnswer: row.original_answer,
  };
}

export class QuestionRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: CreateQuestionInput): QuestionRecord {
    try {
      this.database
        .prepare(
          `INSERT INTO questions (
            id, activity_id, display_number, sort_order, sheet_name,
            number_cell, answer_range, answer_anchor, original_answer
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.activityId,
          input.displayNumber,
          input.sortOrder,
          input.sheetName,
          input.numberCell,
          input.answerRange,
          input.answerAnchor,
          input.originalAnswer,
        );
      return this.getById(input.id);
    } catch (error) {
      rethrowRepositoryError(error, "題目");
    }
  }

  findById(id: string): QuestionRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM questions WHERE id = ?")
      .get(id) as QuestionRow | undefined;
    return row ? toQuestionRecord(row) : undefined;
  }

  getById(id: string): QuestionRecord {
    const question = this.findById(id);
    if (!question) throw entityNotFound("題目", id);
    return question;
  }

  listByActivity(activityId: string): QuestionRecord[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM questions
           WHERE activity_id = ?
           ORDER BY sort_order, id`,
        )
        .all(activityId) as QuestionRow[]
    ).map(toQuestionRecord);
  }

  updateMapping(
    id: string,
    input: UpdateQuestionMappingInput,
  ): QuestionRecord {
    try {
      const result = this.database
        .prepare(
          `UPDATE questions SET
            sheet_name = ?, number_cell = ?, answer_range = ?,
            answer_anchor = ?, original_answer = ?
           WHERE id = ?`,
        )
        .run(
          input.sheetName,
          input.numberCell,
          input.answerRange,
          input.answerAnchor,
          input.originalAnswer,
          id,
        );
      if (result.changes === 0) throw entityNotFound("題目", id);
      return this.getById(id);
    } catch (error) {
      rethrowRepositoryError(error, "題目");
    }
  }
}
