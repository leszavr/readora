import { index, pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { booksTable } from "./books";

export const readEventsTable = pgTable(
  "read_events",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("read_events_book_id_created_at_idx").on(t.bookId, t.createdAt),
    index("read_events_user_id_created_at_idx").on(t.userId, t.createdAt),
  ],
);
