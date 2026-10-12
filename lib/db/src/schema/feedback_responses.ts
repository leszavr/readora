import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const feedbackResponsesTable = pgTable(
  "feedback_responses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    sessionId: varchar("session_id", { length: 64 }),
    rating: integer("rating").notNull(),
    painPoints: jsonb("pain_points").$type<string[]>().notNull().default([]),
    missingFeature: text("missing_feature"),
    wantsContact: boolean("wants_contact").notNull().default(false),
    contactInfo: text("contact_info"),
    pageUrl: text("page_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("feedback_responses_rating_check", sql`${t.rating} >= 1 and ${t.rating} <= 5`),
    index("feedback_responses_created_at_idx").on(t.createdAt),
    index("feedback_responses_pain_points_idx").using("gin", t.painPoints),
  ],
);

export type FeedbackResponse = typeof feedbackResponsesTable.$inferSelect;
