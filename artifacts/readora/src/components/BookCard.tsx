import { Link, useLocation } from "wouter";
import type { Book } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { BookOpen, Check, Circle, Landmark } from "lucide-react";

interface Props {
  book: Book;
  className?: string;
  /** Кнопка "Читать снова" вместо "Читать" (для книжной полки) */
  shelf?: boolean;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  reading: { label: "Читаю", variant: "default" },
  finished: { label: "Прочитано", variant: "secondary" },
  not_started: { label: "Не читал", variant: "outline" },
  abandoned: { label: "Заброшено", variant: "destructive" },
};

const STATUS_ICON: Record<string, typeof Check> = {
  reading: BookOpen,
  finished: Check,
  not_started: Circle,
  abandoned: Circle,
};

export function BookCard({ book, className, shelf = false }: Readonly<Props>) {
  const [, navigate] = useLocation();

  const status = book.readingStatus ? STATUS_LABELS[book.readingStatus] : STATUS_LABELS.not_started;
  const StatusIcon = STATUS_ICON[book.readingStatus ?? "not_started"] ?? Circle;
  const hasCycleNumber = typeof book.cycleNumber === "number";
  const cycleBadgeTitle = book.cycleName
    ? hasCycleNumber
      ? `${book.cycleName} • #${book.cycleNumber}`
      : book.cycleName
    : undefined;

  const handleRead = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/reader/${book.id}`);
  };

  return (
    <Link href={`/book/${book.id}`} className="block h-full">
      <div className={cn(
        "group bg-card border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex flex-col self-start",
        className,
      )}>
        {/* Cover */}
        <div className="aspect-[2/3] shrink-0 bg-muted relative overflow-hidden">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
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

          {book.isGiftEdition && (
            <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]">
              <span
                className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm"
                title="Подарочное издание из категории «Мировое достояние». Не учитывается в квоте хранилища."
              >
                <Landmark className="size-3" aria-hidden="true" />
                <span className="truncate">Мировое достояние</span>
              </span>
            </div>
          )}

          {/* Format badge */}
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm"
              title={status.label}
              aria-label={status.label}
            >
              <StatusIcon className="size-3" aria-hidden="true" />
              <span className="hidden sm:inline">{status.label}</span>
            </span>
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
            {book.progressPercent != null && book.progressPercent > 0 ? (
              <span className="text-xs text-muted-foreground ml-auto">{Math.round(book.progressPercent)}%</span>
            ) : (
              <span className="text-xs text-muted-foreground">{status.label}</span>
            )}
          </div>

          {book.progressPercent != null && book.progressPercent > 0 && (
            <Progress value={book.progressPercent} className="h-1" />
          )}

          <Button
            type="button"
            size="sm"
            className="mt-1 w-full h-8 text-xs font-medium"
            onClick={handleRead}
            aria-label={`${shelf ? "Читать снова" : "Читать"}: ${book.title}`}
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
            {shelf ? "Читать снова" : "Читать"}
          </Button>
        </div>
      </div>
    </Link>
  );
}

export function BookListItem({
  book,
  selected = false,
  onSelect,
  showCheckbox = false,
  shelf = false,
}: Readonly<{
  book: Book;
  selected?: boolean;
  onSelect?: () => void;
  showCheckbox?: boolean;
  shelf?: boolean;
}>) {
  const [, navigate] = useLocation();

  const handleRead = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/reader/${book.id}`);
  };

  return (
    <div className={`flex items-center gap-4 p-4 rounded-lg border bg-card transition-colors ${selected ? "ring-2 ring-primary" : ""}`}>
      {showCheckbox && onSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <Link href={`/book/${book.id}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-md hover:bg-accent/50">
        <div className="relative w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-muted">
          {book.coverUrl && (
            <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
          )}
          {typeof book.cycleNumber === "number" && (
            <span
              className="absolute left-1 top-1 inline-flex items-center rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm backdrop-blur-sm"
              title={book.cycleName ? `${book.cycleName} • #${book.cycleNumber}` : `#${book.cycleNumber}`}
            >
              #{book.cycleNumber}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{book.title}</h3>
          <p className="text-sm text-muted-foreground truncate">{book.author || "Неизвестный автор"}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {book.isGiftEdition && (
              <span className="inline-flex shrink-0 items-center gap-1" title="Подарочное издание. Не учитывается в квоте хранилища.">
                <Landmark className="size-3" aria-hidden="true" />
                Мировое достояние
              </span>
            )}
            {book.genres && book.genres.length > 0 && (
              <span className="truncate">{book.genres[0].name}</span>
            )}
            {book.progressPercent != null && book.progressPercent > 0 && (
              <span>{Math.round(book.progressPercent)}% прочитано</span>
            )}
          </div>
        </div>
      </Link>
      <Button type="button" size="sm" className="shrink-0 gap-2" onClick={handleRead}>
        <BookOpen className="size-3.5" aria-hidden="true" />
        <span>{shelf ? "Читать снова" : "Читать"}</span>
      </Button>
    </div>
  );
}
