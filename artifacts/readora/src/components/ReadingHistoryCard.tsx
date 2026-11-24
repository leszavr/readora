import type { ReactNode } from "react";
import { Link } from "wouter";
import type { ReadingHistoryEntry } from "@workspace/api-client-react";
import { BookOpen, BookX, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { NoteText } from "@/components/NoteEditor";
import { formatHistoryDate } from "@/lib/reading-history";

interface Props {
  entry: ReadingHistoryEntry;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (entry: ReadingHistoryEntry) => void;
  onCommentClick: (entry: ReadingHistoryEntry) => void;
}

function EntryLink({ entry, className, children }: Readonly<{ entry: ReadingHistoryEntry; className?: string; children: ReactNode }>) {
  if (entry.bookId === null) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link href={`/book/${entry.bookId}`} className={className}>
      {children}
    </Link>
  );
}

function HistoryCover({ entry, className }: Readonly<{ entry: ReadingHistoryEntry; className?: string }>) {
  return (
    <div className={cn("overflow-hidden rounded-md bg-muted", className)}>
      {entry.coverUrl ? (
        <img src={entry.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
          <BookOpen className="size-6 text-primary/40" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function selectionCheckboxClass(alwaysVisible: boolean) {
  return cn("bg-background", alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100");
}

export const HISTORY_CARD_ASPECT_CLASS = "h-[135px] sm:h-auto sm:aspect-[16/9]";

export function ReadingHistoryCard({ entry, selected, selectionMode, onToggleSelect, onCommentClick }: Readonly<Props>) {
  return (
    <div
      className={cn(
        "group relative flex w-full gap-2 rounded-lg border border-border bg-card p-1.5 transition-colors hover:border-primary/30",
        HISTORY_CARD_ASPECT_CLASS,
        selected && "border-primary ring-2 ring-primary",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggleSelect(entry)}
        aria-label={`Выбрать: ${entry.title}`}
        title="Выбрать запись"
        className={cn("absolute left-2.5 top-2.5 z-10 border-2", selectionCheckboxClass(selectionMode || selected))}
      />

      <EntryLink entry={entry} className="block h-full shrink-0">
        <HistoryCover entry={entry} className="h-full aspect-[2/3] transition-opacity group-hover:opacity-90" />
      </EntryLink>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5 pr-1">
        <EntryLink entry={entry} className="line-clamp-2 text-xs font-medium leading-tight hover:text-primary">
          {entry.title}
        </EntryLink>
        {entry.author && (
          <p className="line-clamp-1 text-[11px] leading-tight text-muted-foreground">{entry.author}</p>
        )}

        <div className="mt-auto">
          {entry.comment ? (
            <button
              type="button"
              onClick={() => onCommentClick(entry)}
              className="w-full rounded text-left text-[11px] leading-snug text-muted-foreground italic hover:text-foreground"
              title="Показать комментарий целиком"
            >
              <NoteText text={entry.comment} className="line-clamp-2" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCommentClick(entry)}
              className="inline-flex h-6 max-w-full items-center gap-1 overflow-hidden rounded border border-dashed px-2 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
              aria-label={`Добавить комментарий: ${entry.title}`}
              title="Добавить комментарий"
            >
              <MessageSquarePlus className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Комментарий</span>
            </button>
          )}

          <p className="mt-0.5 flex items-center justify-between gap-1 text-[10px] leading-4 text-muted-foreground">
            <span>{formatHistoryDate(entry.completedAt)}</span>
            {entry.bookId === null && (
              <BookX className="size-3 shrink-0" aria-label="Книга удалена из библиотеки">
                <title>Книга удалена из библиотеки</title>
              </BookX>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReadingHistoryListItem({ entry, selected, selectionMode, onToggleSelect, onCommentClick }: Readonly<Props>) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30",
        selected && "border-primary ring-2 ring-primary",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggleSelect(entry)}
        aria-label={`Выбрать: ${entry.title}`}
        title="Выбрать запись"
        className={selectionCheckboxClass(selectionMode || selected)}
      />
      <EntryLink entry={entry} className="shrink-0">
        <HistoryCover entry={entry} className="h-16 w-11" />
      </EntryLink>
      <div className="min-w-0 flex-1">
        <EntryLink entry={entry} className="block truncate text-sm font-medium hover:text-primary">
          {entry.title}
        </EntryLink>
        <p className="truncate text-xs text-muted-foreground">
          {entry.author ?? "Автор не указан"} · {formatHistoryDate(entry.completedAt)}
          {entry.bookId === null && " · книга удалена из библиотеки"}
        </p>
        {entry.comment ? (
          <button
            type="button"
            onClick={() => onCommentClick(entry)}
            className="mt-0.5 block w-full rounded text-left text-xs text-muted-foreground italic hover:text-foreground"
            title="Показать комментарий целиком"
          >
            <NoteText text={entry.comment} className="line-clamp-1" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onCommentClick(entry)}
            className="mt-0.5 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
          >
            <MessageSquarePlus className="size-3.5 shrink-0" aria-hidden="true" />
            Добавить комментарий
          </button>
        )}
      </div>
    </div>
  );
}
