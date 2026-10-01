import { boolean, index, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { booksTable } from "./books";

export const giftEditionsTable = pgTable(
  "gift_editions",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id").notNull().unique().references(() => booksTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("gift_editions_published_sort_order_idx").on(t.isPublished, t.sortOrder)],
);

export type GiftEdition = typeof giftEditionsTable.$inferSelect;
