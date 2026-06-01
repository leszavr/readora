import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ListBooksStatus, useListBooks, useListGenres, useDeleteBook } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BookCard } from "@/components/BookCard";
import { UploadBookDialog } from "@/components/UploadBookDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Upload, Search, BookOpen, SlidersHorizontal, LayoutGrid, 
  List, Trash2, X, Layers
} from "lucide-react";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "grid" | "list";
type SortOption = "uploadedAt" | "title" | "author" | "progress" | "lastReadAt";
type GroupOption = "none" | "genre" | "author" | "cycle";

export default function LibraryPage() {
  const [location] = useLocation();
  const [uploadOpen, setUploadOpen] = useState(location.includes("upload=1"));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListBooksStatus | "all">("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortOption>("uploadedAt");
  const [sortDir] = useState<"asc" | "desc">("desc");
  const [groupBy, setGroupBy] = useState<GroupOption>("none");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBooks, setSelectedBooks] = useState<Set<number>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { toast } = useToast();

  const { data: books = [], isLoading, refetch } = useListBooks({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    genreId: genreFilter === "all" ? undefined : Number.parseInt(genreFilter, 10),
    sortBy,
    sortDir,
    groupBy: groupBy === "none" ? undefined : groupBy,
  });

  const { data: genres = [] } = useListGenres();
  const deleteBookMutation = useDeleteBook();

  const bookItems = Array.isArray(books) ? books : [];
  const genreItems = Array.isArray(genres) ? genres : [];
  const isGrouped = groupBy !== "none" && books && typeof books === "object" && "grouped" in books;

  useEffect(() => {
    if (location.includes("upload=1")) setUploadOpen(true);
  }, [location]);

  const toggleBookSelection = (bookId: number) => {
    const newSelection = new Set(selectedBooks);
    if (newSelection.has(bookId)) {
      newSelection.delete(bookId);
    } else {
      newSelection.add(bookId);
    }
    setSelectedBooks(newSelection);
  };

  const selectAll = () => {
    if (isGrouped) return;
    const allIds = new Set(bookItems.map((b: any) => b.id));
    setSelectedBooks(allIds);
  };

  const clearSelection = () => {
    setSelectedBooks(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedBooks.size === 0) return;
    
    try {
      // Delete books one by one
      for (const bookId of selectedBooks) {
        await deleteBookMutation.mutateAsync({ id: bookId });
      }
      
      toast({
        title: "Книги удалены",
        description: `Успешно удалено книг: ${selectedBooks.size}`,
      });
      
      setSelectedBooks(new Set());
      setShowDeleteDialog(false);
      refetch();
    } catch (error) {
      console.error("Failed to delete books:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось удалить некоторые книги",
        variant: "destructive",
      });
    }
  };

  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold">Моя библиотека</h1>
              <p className="text-muted-foreground text-sm">
                {isGrouped 
                  ? `${Object.keys((books as any).grouped).length} групп` 
                  : `${bookItems.length} книг`}
              </p>
            </div>
            <div className="flex gap-2">
              {selectedBooks.size > 0 && (
                <>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={() => setShowDeleteDialog(true)}
                    className="gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалить ({selectedBooks.size})
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={clearSelection}
                    className="gap-2"
                  >
                    <X className="w-4 h-4" />
                    Отменить
                  </Button>
                </>
              )}
              <Button onClick={() => setUploadOpen(true)} className="gap-2">
                <Upload className="w-4 h-4" />
                Добавить книгу
              </Button>
            </div>
          </div>

          {/* Filters and View Controls */}
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Поиск по названию или автору..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ListBooksStatus | "all")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="reading">Читаю</SelectItem>
                <SelectItem value="finished">Прочитано</SelectItem>
                <SelectItem value="not_started">Не читал</SelectItem>
              </SelectContent>
            </Select>

            {genreItems.length > 0 && (
              <Select value={genreFilter} onValueChange={setGenreFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Жанр" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все жанры</SelectItem>
                  {genreItems.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-44">
                <SlidersHorizontal className="w-3 h-3 mr-1" />
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uploadedAt">По дате загрузки</SelectItem>
                <SelectItem value="title">По названию</SelectItem>
                <SelectItem value="author">По автору</SelectItem>
                <SelectItem value="progress">По прогрессу</SelectItem>
                <SelectItem value="lastReadAt">По дате чтения</SelectItem>
              </SelectContent>
            </Select>

            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupOption)}>
              <SelectTrigger className="w-36">
                <Layers className="w-3 h-3 mr-1" />
                <SelectValue placeholder="Группировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без группировки</SelectItem>
                <SelectItem value="genre">По жанрам</SelectItem>
                <SelectItem value="author">По авторам</SelectItem>
                <SelectItem value="cycle">По циклам</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-1 border rounded-md p-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="h-8 w-8 p-0"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="h-8 w-8 p-0"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            {!isGrouped && bookItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={selectedBooks.size === bookItems.length ? clearSelection : selectAll}
              >
                {selectedBooks.size === bookItems.length ? "Снять выделение" : "Выбрать все"}
              </Button>
            )}
          </div>

          {/* Content */}
          <LibraryContent 
            isLoading={isLoading}
            bookItems={bookItems}
            isGrouped={isGrouped}
            books={books}
            search={search}
            statusFilter={statusFilter}
            genreFilter={genreFilter}
            viewMode={viewMode}
            selectedBooks={selectedBooks}
            toggleBookSelection={toggleBookSelection}
            setUploadOpen={setUploadOpen}
          />
        </div>

        <UploadBookDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить книги?</AlertDialogTitle>
              <AlertDialogDescription>
                Вы уверены, что хотите удалить {selectedBooks.size} книг(и)? 
                Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Layout>
    </ProtectedRoute>
  );
}

// Helper components to reduce complexity
function LibraryContent({
  isLoading,
  bookItems,
  isGrouped,
  books,
  search,
  statusFilter,
  genreFilter,
  viewMode,
  selectedBooks,
  toggleBookSelection,
  setUploadOpen,
}: Readonly<{
  isLoading: boolean;
  bookItems: any[];
  isGrouped: boolean;
  books: any;
  search: string;
  statusFilter: string;
  genreFilter: string;
  viewMode: ViewMode;
  selectedBooks: Set<number>;
  toggleBookSelection: (id: number) => void;
  setUploadOpen: (open: boolean) => void;
}>) {
  if (isLoading) {
    return <LoadingState viewMode={viewMode} />;
  }
  
  if (bookItems.length === 0 && !isGrouped) {
    const hasFilters = !!(search || statusFilter !== "all" || genreFilter !== "all");
    return <EmptyState hasFilters={hasFilters} onUploadClick={() => setUploadOpen(true)} />;
  }
  
  if (isGrouped) {
    return <GroupedBooksView books={books} viewMode={viewMode} />;
  }
  
  return (
    <BooksGridView 
      bookItems={bookItems}
      viewMode={viewMode}
      selectedBooks={selectedBooks}
      onToggleSelection={toggleBookSelection}
    />
  );
}

// Generate stable skeleton keys once
const SKELETON_KEYS = Array.from({ length: 12 }, (_, i) => `skeleton-loader-${i}-${Date.now()}`);

function LoadingState({ viewMode }: Readonly<{ viewMode: ViewMode }>) {
  return (
    <div className={viewMode === "grid" 
      ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
      : "space-y-2"
    }>
      {SKELETON_KEYS.map((key) => (
        <div key={key} className="animate-pulse">
          {viewMode === "grid" ? (
            <>
              <div className="aspect-[2/3] bg-muted rounded-xl mb-3" />
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </>
          ) : (
            <div className="h-20 bg-muted rounded-lg" />
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasFilters, onUploadClick }: Readonly<{ hasFilters: boolean; onUploadClick: () => void }>) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <BookOpen className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-lg mb-2">
        {hasFilters ? "Книги не найдены" : "Библиотека пуста"}
      </h3>
      <p className="text-muted-foreground text-sm mb-6">
        {hasFilters 
          ? "Попробуйте изменить фильтры поиска" 
          : "Добавьте первую книгу в формате FB2 или EPUB"}
      </p>
      {!hasFilters && (
        <Button onClick={onUploadClick} className="gap-2">
          <Upload className="w-4 h-4" /> Загрузить книгу
        </Button>
      )}
    </div>
  );
}

function GroupedBooksView({ books, viewMode }: Readonly<{ books: any; viewMode: ViewMode }>) {
  return (
    <div className="space-y-8">
      {Object.entries(books.grouped).map(([groupName, groupBooks]: [string, any[]]) => (
        <div key={groupName}>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5" />
            {groupName}
            <span className="text-sm text-muted-foreground font-normal">
              ({groupBooks.length})
            </span>
          </h2>
          <div className={viewMode === "grid"
            ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
            : "space-y-2"
          }>
            {groupBooks.map((book) => (
              <div key={book.id} className="relative">
                {viewMode === "grid" ? (
                  <BookCard book={book} />
                ) : (
                  <BookListItem book={book} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BooksGridView({ 
  bookItems, 
  viewMode, 
  selectedBooks, 
  onToggleSelection 
}: Readonly<{ 
  bookItems: any[]; 
  viewMode: ViewMode; 
  selectedBooks: Set<number>; 
  onToggleSelection: (id: number) => void;
}>) {
  return (
    <div className={viewMode === "grid"
      ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
      : "space-y-2"
    }>
      {bookItems.map((book: any) => (
        <div key={book.id} className="relative">
          {selectedBooks.size > 0 && (
            <div className="absolute top-2 left-2 z-10">
              <Checkbox
                checked={selectedBooks.has(book.id)}
                onCheckedChange={() => onToggleSelection(book.id)}
                className="bg-background border-2"
              />
            </div>
          )}
          {viewMode === "grid" ? (
            <BookCard book={book} />
          ) : (
            <BookListItem 
              book={book} 
              selected={selectedBooks.has(book.id)}
              onSelect={() => onToggleSelection(book.id)}
              showCheckbox={selectedBooks.size > 0}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// List view component for books
function BookListItem({ 
  book, 
  selected, 
  onSelect, 
  showCheckbox 
}: Readonly<{ 
  book: any; 
  selected?: boolean; 
  onSelect?: () => void; 
  showCheckbox?: boolean;
}>) {
  const [, navigate] = useLocation();
  
  const handleClick = () => {
    navigate(`/books/${book.id}`);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(`/books/${book.id}`);
    }
  };
  
  return (
    <button
      type="button"
      className={`flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-left w-full ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {showCheckbox && onSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-muted">
        {book.coverUrl && (
          <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{book.title}</h3>
        <p className="text-sm text-muted-foreground truncate">{book.author || "Неизвестный автор"}</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {book.genres && book.genres.length > 0 && (
            <span className="truncate">{book.genres[0].name}</span>
          )}
          {book.progressPercent != null && book.progressPercent > 0 && (
            <span>{Math.round(book.progressPercent)}% прочитано</span>
          )}
        </div>
      </div>
    </button>
  );
}
