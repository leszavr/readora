import type { Book } from "@workspace/api-client-react";
import { BookCard } from "@/components/BookCard";
import { CycleStack } from "@/components/CycleStack";
import { CARD_GRID_CLASS, CARD_ITEM_HEIGHT_CLASS } from "@/components/cardGrid";

type ViewMode = "grid" | "list";

interface ShelfViewProps {
  books: Book[];
  viewMode: ViewMode;
  useStacks?: boolean; // when true, render cycle stacks inline in the grid
}

function getCycleGroupsAndSingleBooks(books: Book[]) {
  const groupedByCycle: Record<string, Book[]> = {};
  const singleBooks: Book[] = [];

  for (const book of books) {
    const cycleName = book.cycleName?.trim();

    if (!cycleName) {
      singleBooks.push(book);
      continue;
    }

    if (!groupedByCycle[cycleName]) {
      groupedByCycle[cycleName] = [];
    }

    groupedByCycle[cycleName].push(book);
  }

  const cycleGroups = Object.entries(groupedByCycle)
    .filter(([, groupBooks]) => groupBooks.length >= 2)
    .map(([cycleName, groupBooks]) => ({
      cycleName,
      books: [...groupBooks].sort((a, b) => {
        const aNum = typeof a.cycleNumber === "number" ? a.cycleNumber : Number.POSITIVE_INFINITY;
        const bNum = typeof b.cycleNumber === "number" ? b.cycleNumber : Number.POSITIVE_INFINITY;
        return aNum - bNum;
      }),
    }));

  const oneBookCycles = Object.entries(groupedByCycle)
    .filter(([, groupBooks]) => groupBooks.length === 1)
    .flatMap(([, groupBooks]) => groupBooks);

  return {
    cycleGroups,
    singleBooks: [...singleBooks, ...oneBookCycles],
  };
}

export function ShelfView({ books, viewMode, useStacks = false }: ShelfViewProps) {
  const { cycleGroups, singleBooks } = getCycleGroupsAndSingleBooks(books);

  if (viewMode !== "grid") {
    return (
      <div className="space-y-2">
        {books.map((book) => (
          <div key={book.id} className="rounded-lg border bg-card p-4">
            <p className="font-medium">{book.title}</p>
            {book.author && <p className="text-sm text-muted-foreground">{book.author}</p>}
          </div>
        ))}
      </div>
    );
  }

  // When useStacks is true we want to render cycle stacks inline with single books
  if (useStacks) {
    // Build a unified list of items where each cycleGroup is one item (a stack)
    type Item = { type: "cycle"; cycleName: string; books: Book[] } | { type: "book"; book: Book };
    const items: Item[] = [];

    for (const cg of cycleGroups) {
      items.push({ type: "cycle", cycleName: cg.cycleName, books: cg.books });
    }

    for (const b of singleBooks) {
      items.push({ type: "book", book: b });
    }

    if (items.length === 0) {
      return (
        <div className="flex items-center justify-center py-20 text-center text-muted-foreground">
          На полке пока нет книг
        </div>
      );
    }

    return (
      <div className={CARD_GRID_CLASS}>
        {items.map((item, idx) => (
          <div key={idx} className={`relative self-start ${CARD_ITEM_HEIGHT_CLASS}`}>
            {item.type === "cycle" ? (
              <CycleStack cycleName={item.cycleName} books={item.books} className="h-full" />
            ) : (
              <BookCard book={item.book} className="h-full" />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {cycleGroups.map(({ cycleName, books: cycleBooks }) => (
        <CycleStack key={cycleName} cycleName={cycleName} books={cycleBooks} />
      ))}

      {singleBooks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Одиночные книги</h2>
          <div className={CARD_GRID_CLASS}>
            {singleBooks.map((book) => (
              <div key={book.id} className={`self-start ${CARD_ITEM_HEIGHT_CLASS}`}>
                <BookCard book={book} className="h-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {cycleGroups.length === 0 && singleBooks.length === 0 && (
        <div className="flex items-center justify-center py-20 text-center text-muted-foreground">
          На полке пока нет книг
        </div>
      )}
    </div>
  );
}
