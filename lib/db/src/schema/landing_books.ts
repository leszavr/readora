import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const landingBooksTable = pgTable(
  "landing_books",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author"),
    description: text("description"),
    coverPath: text("cover_path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("landing_books_published_sort_order_idx").on(t.isPublished, t.sortOrder),
  ],
);

export type LandingBook = typeof landingBooksTable.$inferSelect;
