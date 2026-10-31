import { useState } from "react";
import { Link } from "wouter";
import { Search, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAllNotes, useAllBookmarks, type AnnotationBookmarkDto, type AnnotationNoteDto } from "@/hooks/use-all-annotations";
import { NoteText, noteColorClass } from "@/components/reader/NoteEditor";
import { setReaderJumpIntent } from "@/lib/reader-jump";

type AnnotationTab = "notes" | "bookmarks";

function annotationSourceLine(item: AnnotationNoteDto | AnnotationBookmarkDto): string {
  const parts: string[] = [];
  if (item.bookAuthor) parts.push(item.bookAuthor);
  parts.push(item.bookTitle ?? "Книга");
  return parts.join(" · ");
}

function annotationChapterLine(item: AnnotationNoteDto | AnnotationBookmarkDto): string {
  const chapterParts: string[] = [];
  if (typeof item.chapterIndex === "number") chapterParts.push(`Глава ${item.chapterIndex + 1}`);
  if (item.chapterTitle) chapterParts.push(item.chapterTitle);
  return chapterParts.join(" · ");
}

function NoteCard({ note }: { note: AnnotationNoteDto }) {
  return (
    <Link
      href={`/reader/${note.bookId}`}
      onClick={() =>
        setReaderJumpIntent({
          bookId: note.bookId,
          chapterId: note.chapterId,
          positionRaw: note.positionRaw,
          highlightedText: note.highlightedText,
        })
      }
      className={cn("block rounded-lg border p-3 transition-colors hover:border-primary/40", noteColorClass(note.color))}
    >
      <div className="flex items-start gap-2 mb-1">
        <span className="text-xs font-medium line-clamp-1 flex-1">{annotationSourceLine(note)}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {new Date(note.updatedAt).toLocaleDateString("ru-RU")}
        </span>
      </div>
      <NoteText className="text-sm" text={note.noteText} />
      {note.highlightedText && (
        <p className="text-sm italic text-muted-foreground line-clamp-2 mt-1">«{note.highlightedText}»</p>
      )}
      <p className="text-xs text-muted-foreground mt-1">{annotationChapterLine(note)}</p>
    </Link>
  );
}

function BookmarkCard({ bookmark }: { bookmark: AnnotationBookmarkDto }) {
  return (
    <Link
      href={`/reader/${bookmark.bookId}`}
      onClick={() =>
        setReaderJumpIntent({
          bookId: bookmark.bookId,
          chapterId: bookmark.chapterId,
          positionRaw: bookmark.positionRaw,
          highlightedText: bookmark.selectedText,
        })
      }
      className="block rounded-lg border p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start gap-2 mb-1">
        <span className="text-xs font-medium line-clamp-1 flex-1">{annotationSourceLine(bookmark)}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {new Date(bookmark.createdAt).toLocaleDateString("ru-RU")}
        </span>
      </div>
      {bookmark.label && <p className="text-sm font-medium line-clamp-1">{bookmark.label}</p>}
      {bookmark.selectedText && (
        <p className="text-sm italic text-muted-foreground line-clamp-2 mt-0.5">«{bookmark.selectedText}»</p>
      )}
      <p className="text-xs text-muted-foreground mt-1">{annotationChapterLine(bookmark)}</p>
    </Link>
  );
}

export function AnnotationsView() {
  const [tab, setTab] = useState<AnnotationTab>("notes");
  const [search, setSearch] = useState("");
  const q = search.trim();

  const notesQuery = useAllNotes(q, tab === "notes");
  const bookmarksQuery = useAllBookmarks(q, tab === "bookmarks");
  const isLoading = tab === "notes" ? notesQuery.isLoading : bookmarksQuery.isLoading;
  const items = tab === "notes" ? (notesQuery.data ?? []) : (bookmarksQuery.data ?? []);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 rounded-lg border p-1">
          <Button
            type="button"
            size="sm"
            variant={tab === "notes" ? "secondary" : "ghost"}
            onClick={() => setTab("notes")}
            className="h-8"
          >
            Заметки
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "bookmarks" ? "secondary" : "ghost"}
            onClick={() => setTab("bookmarks")}
            className="h-8"
          >
            Закладки
          </Button>
        </div>

        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={tab === "notes" ? "Поиск по заметкам и книгам…" : "Поиск по закладкам и книгам…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <BookOpen className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg mb-1">
            {q ? "Ничего не найдено" : tab === "notes" ? "Заметок пока нет" : "Закладок пока нет"}
          </h3>
          <p className="text-muted-foreground text-sm">
            {q ? "Попробуйте изменить поиск." : "Выделите текст в книге при чтении, чтобы создать заметку или закладку."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tab === "notes"
            ? (items as AnnotationNoteDto[]).map((note) => <NoteCard key={note.id} note={note} />)
            : (items as AnnotationBookmarkDto[]).map((bookmark) => <BookmarkCard key={bookmark.id} bookmark={bookmark} />)}
        </div>
      )}
    </div>
  );
}
