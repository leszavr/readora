import { Router } from "express";
import { eq, and, ilike, or, desc } from "drizzle-orm";
import { db, notesTable, bookmarksTable, booksTable, chaptersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import type { Request } from "express";
import type { usersTable } from "@workspace/db";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };

function parseSearch(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

// GET /annotations/notes?q= — все заметки пользователя для вкладки в библиотеке
router.get("/annotations/notes", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const q = parseSearch(req.query.q);
  const searchPattern = `%${q}%`;

  const rows = await db
    .select({
      id: notesTable.id,
      bookId: notesTable.bookId,
      chapterId: notesTable.chapterId,
      positionRaw: notesTable.positionRaw,
      highlightedText: notesTable.highlightedText,
      noteText: notesTable.noteText,
      color: notesTable.color,
      createdAt: notesTable.createdAt,
      updatedAt: notesTable.updatedAt,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      cycleName: booksTable.cycleName,
      chapterTitle: chaptersTable.title,
      chapterIndex: chaptersTable.index,
    })
    .from(notesTable)
    .innerJoin(booksTable, eq(notesTable.bookId, booksTable.id))
    .leftJoin(chaptersTable, eq(notesTable.chapterId, chaptersTable.id))
    .where(
      q
        ? and(
            eq(notesTable.userId, user.id),
            eq(booksTable.ownerUserId, user.id),
            or(
              ilike(notesTable.noteText, searchPattern),
              ilike(notesTable.highlightedText, searchPattern),
              ilike(booksTable.title, searchPattern)
            )
          )
        : and(eq(notesTable.userId, user.id), eq(booksTable.ownerUserId, user.id))
    )
    .orderBy(desc(notesTable.updatedAt))
    .limit(500);

  res.json(rows);
});

// GET /annotations/bookmarks?q= — все закладки пользователя для вкладки в библиотеке
router.get("/annotations/bookmarks", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const q = parseSearch(req.query.q);
  const searchPattern = `%${q}%`;

  const rows = await db
    .select({
      id: bookmarksTable.id,
      bookId: bookmarksTable.bookId,
      chapterId: bookmarksTable.chapterId,
      positionRaw: bookmarksTable.positionRaw,
      label: bookmarksTable.label,
      selectedText: bookmarksTable.selectedText,
      createdAt: bookmarksTable.createdAt,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      cycleName: booksTable.cycleName,
      chapterTitle: chaptersTable.title,
      chapterIndex: chaptersTable.index,
    })
    .from(bookmarksTable)
    .innerJoin(booksTable, eq(bookmarksTable.bookId, booksTable.id))
    .leftJoin(chaptersTable, eq(bookmarksTable.chapterId, chaptersTable.id))
    .where(
      q
        ? and(
            eq(bookmarksTable.userId, user.id),
            eq(booksTable.ownerUserId, user.id),
            or(
              ilike(bookmarksTable.label, searchPattern),
              ilike(bookmarksTable.selectedText, searchPattern),
              ilike(booksTable.title, searchPattern)
            )
          )
        : and(eq(bookmarksTable.userId, user.id), eq(booksTable.ownerUserId, user.id))
    )
    .orderBy(desc(bookmarksTable.createdAt))
    .limit(500);

  res.json(rows);
});

export default router;
