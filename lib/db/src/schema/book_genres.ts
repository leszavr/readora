import { index, pgTable, integer, primaryKey } from "drizzle-orm/pg-core";
import { booksTable } from "./books";
import { genresTable } from "./genres";

export const bookGenresTable = pgTable("book_genres", {
  bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
  genreId: integer("genre_id").notNull().references(() => genresTable.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.bookId, t.genreId] }),
  index("book_genres_genre_id_book_id_idx").on(t.genreId, t.bookId),
]);
