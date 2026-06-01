import { pgEnum, pgTable, serial, integer, text, timestamp, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { booksTable } from "./books";

export const bookUploadJobStatusEnum = pgEnum("book_upload_job_status", ["queued", "processing", "completed", "failed"]);
export const bookUploadJobStageEnum = pgEnum("book_upload_job_stage", ["queued", "validating", "parsing", "saving", "completed", "failed"]);

export const bookUploadJobsTable = pgTable("book_upload_jobs", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  bookId: integer("book_id").references(() => booksTable.id, { onDelete: "set null" }),
  originalFilename: text("original_filename").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  format: text("format").notNull(),
  tempStorageKey: text("temp_storage_key").notNull(),
  status: bookUploadJobStatusEnum("status").notNull().default("queued"),
  stage: bookUploadJobStageEnum("stage").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  errorMessage: text("error_message"),
  cycleId: integer("cycle_id"),
  cycleName: text("cycle_name"),
  cycleNumber: real("cycle_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type BookUploadJob = typeof bookUploadJobsTable.$inferSelect;
