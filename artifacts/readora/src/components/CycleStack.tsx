import React from "react";
import type { Book } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BookCard } from "./BookCard";
import { cn } from "@/lib/utils";

interface Props {
  cycleName: string;
  books: Book[];
}

const PREVIEW_COUNT = 3;

export function CycleStack({ cycleName, books }: Props) {
  const [open, setOpen] = React.useState(false);

  const preview = books.slice(0, PREVIEW_COUNT);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full text-left"
        aria-label={`Открыть цикл ${cycleName}`}
      >
        <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex flex-col h-full">
          <div className="aspect-[2/3] bg-muted relative overflow-hidden flex items-center justify-center">
            {preview.map((book, i) => {
              const z = preview.length - i;
              // visibility / left offset per layer: layer0 always visible, layer1 visible from sm, layer2 visible from md
              const visibilityClass = i === 0 ? "" : i === 1 ? "hidden sm:block" : "hidden md:block";
              const leftClass = i === 0 ? "left-0" : i === 1 ? "left-2 sm:left-3 md:left-4" : "left-4 sm:left-6 md:left-8";

              return (
                <div
                  key={book.id}
                  className={cn(
                    "absolute top-0 overflow-hidden rounded-sm shadow-sm transition-transform duration-200 group-hover:scale-105",
                    visibilityClass,
                    leftClass,
                  )}
                  style={{
                    zIndex: z,
                    width: `calc(100% - ${i * 8}px)`,
                    height: "100%",
                    transform: i === 0 ? undefined : i % 2 === 0 ? "rotate(-2deg)" : "rotate(2deg)",
                  }}
                >
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground p-2">
                      {book.title}
                    </div>
                  )}
                </div>
              );
            })}

            {books.length > PREVIEW_COUNT && (
              <div className="absolute right-2 bottom-2 rounded-full bg-black/70 text-white text-xs font-semibold px-2 py-0.5">
                +{books.length - PREVIEW_COUNT}
              </div>
            )}
          </div>

          <div className="p-3 flex flex-col gap-1.5">
            <h3 className="font-semibold text-sm line-clamp-1 leading-tight">{cycleName}</h3>
            <p className="text-xs text-muted-foreground">{books.length} {getBooksCountSuffix(books.length)}</p>
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{cycleName}</DialogTitle>
            <DialogDescription>{books.length} {getBooksCountSuffix(books.length)}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {books.map((b) => (
              <div key={b.id} className="h-full min-w-0">
                <BookCard book={b} />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getBooksCountSuffix(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return "книга";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return "книги";
  return "книг";
}

export default CycleStack;
