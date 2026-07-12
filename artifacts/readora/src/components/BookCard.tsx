import { Link } from "wouter";
import {
  getGetBookQueryKey,
  getGetProgressQueryKey,
  getListBooksQueryKey,
  useSaveProgress,
} from "@workspace/api-client-react";
import type { Book } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BookOpen } from "lucide-react";

interface Props {
  book: Book;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  reading: { label: "Читаю", variant: "default" },
  finished: { label: "Прочитано", variant: "secondary" },
  not_started: { label: "Не читал", variant: "outline" },
  abandoned: { label: "Заброшено", variant: "destructive" },
};

export function BookCard({ book }: Readonly<Props>) {
  const qc = useQueryClient();
  const { mutate: saveProgress, isPending: isUpdatingStatus } = useSaveProgress({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBooksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBookQueryKey(book.id) });
        qc.invalidateQueries({ queryKey: getGetProgressQueryKey(book.id) });
      },
    },
  });

  const status = book.readingStatus ? STATUS_LABELS[book.readingStatus] : STATUS_LABELS.not_started;
  const hasCycleNumber = typeof book.cycleNumber === "number";
  const cycleBadgeTitle = book.cycleName
    ? hasCycleNumber
      ? `${book.cycleName} • #${book.cycleNumber}`
      : book.cycleName
    : undefined;

  const setQuickStatus = (
    event: React.MouseEvent<HTMLButtonElement>,
    readingStatus: "finished" | "not_started",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    saveProgress({
      id: book.id,
      data: {
        readingStatus,
        progressPercent: readingStatus === "finished" ? 100 : 0,
      },
    });
  };

  return (
    <Link href={`/book/${book.id}`}>
      <div className="group bg-card border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex flex-col h-full">
        {/* Cover */}
        <div className="aspect-[2/3] bg-muted relative overflow-hidden">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/10 to-primary/5 p-4">
              <BookOpen className="w-10 h-10 text-primary/40" />
              <p className="text-xs text-center text-muted-foreground line-clamp-3 font-medium">{book.title}</p>
            </div>
          )}

          {hasCycleNumber && (
            <div className="absolute left-2 top-2 max-w-[calc(100%-4.5rem)]">
              <span
                className="inline-flex items-center rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm"
                title={cycleBadgeTitle}
              >
                #{book.cycleNumber}
              </span>
            </div>
          )}

          {/* Format badge */}
          <div className="absolute top-2 right-2">
            <span className="bg-black/60 text-white text-xs font-mono px-1.5 py-0.5 rounded uppercase">
              {book.format}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="p-3 flex flex-col gap-1.5 flex-1">
          <h3 className="font-semibold text-sm line-clamp-2 leading-tight">{book.title}</h3>
          {book.author && (
            <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
          )}

          <div className="mt-auto pt-2 flex items-center justify-between gap-2">
            <Badge variant={status.variant} className="text-xs">
              {status.label}
            </Badge>
            {book.progressPercent != null && book.progressPercent > 0 && (
              <span className="text-xs text-muted-foreground">{Math.round(book.progressPercent)}%</span>
            )}
          </div>

          {book.progressPercent != null && book.progressPercent > 0 && (
            <Progress value={book.progressPercent} className="h-1" />
          )}

          <div className="grid grid-cols-2 gap-2 pt-1 min-w-0">
            <Button
              type="button"
              size="sm"
              variant={book.readingStatus === "finished" ? "secondary" : "outline"}
              className="h-7 text-[11px] min-w-0 whitespace-nowrap"
              disabled={isUpdatingStatus}
              onClick={(event) => setQuickStatus(event, "finished")}
            >
              Прочитано
            </Button>
            <Button
              type="button"
              size="sm"
              variant={book.readingStatus === "not_started" || !book.readingStatus ? "secondary" : "outline"}
              className="h-7 text-[11px] min-w-0 whitespace-nowrap"
              disabled={isUpdatingStatus}
              onClick={(event) => setQuickStatus(event, "not_started")}
            >
              Не читал
            </Button>
          </div>
        </div>
      </div>
    </Link>
  );
}
