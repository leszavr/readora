import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const feedbackPromptStatesTable = pgTable("feedback_prompt_states", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  visitCount: integer("visit_count").notNull().default(0),
  lastVisitAt: timestamp("last_visit_at", { withTimezone: true }).notNull().defaultNow(),
  lastShownAt: timestamp("last_shown_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export type FeedbackPromptState = typeof feedbackPromptStatesTable.$inferSelect;
