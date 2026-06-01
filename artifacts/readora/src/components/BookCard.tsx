import { Link } from "wouter";
import type { Book } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BookOpen, FileText, Clock } from "lucide-react";

interface Props {
  book: Book;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  reading: { label: "Читаю", variant: "default" },
  finished: { label: "Прочитано", variant: "secondary" },
  not_started: { label: "Не читал", variant: "outline" },
  abandoned: { label: "Заброшено", variant: "destructive" },
};

export function BookCard({ book }: Props) {
  const status = book.readingStatus ? STATUS_LABELS[book.readingStatus] : STATUS_LABELS.not_started;

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
        </div>
      </div>
    </Link>
  );
}
