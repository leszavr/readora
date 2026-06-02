import { useState, useEffect, useMemo } from "react";
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
import { useLocalStorageState } from "@/hooks/use-local-storage-state";

type ViewMode = "grid" | "list";
type SortOption = "uploadedAt" | "title" | "author" | "progress" | "lastReadAt" | "cycleNumber";
type GroupOption = "none" | "genre" | "author" | "cycle";
type LibrarySection = "library" | "shelf";

function isFinishedBook(book: any): boolean {
  return book?.readingStatus === "finished";
}

function getEffectiveStatus(section: LibrarySection, statusFilter: ListBooksStatus | "all"): ListBooksStatus | undefined {
  if (section === "shelf") return "finished";
  if (statusFilter === "all") return undefined;
  return statusFilter;
}

function filterBooksBySection(books: any[], section: LibrarySection): any[] {
  if (section === "shelf") return books.filter(isFinishedBook);
  return books.filter((book) => !isFinishedBook(book));
}

function filterGroupedBySection(groupedSource: Record<string, any[]>, section: LibrarySection): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};

  for (const [groupName, groupBooks] of Object.entries(groupedSource)) {
    const filtered = filterBooksBySection(groupBooks, section);
    if (filtered.length > 0) {
      grouped[groupName] = filtered;
    }
  }

  return grouped;
}

async function deleteSelectedBooks(
  selectedBooks: Set<number>,
  mutateAsync: (params: { id: number }) => Promise<unknown>,
  refetch: () => void,
  toast: (args: { title: string; description: string; variant?: "destructive" }) => void,
  onSuccess: () => void,
): Promise<void> {
  try {
    for (const bookId of selectedBooks) {
      await mutateAsync({ id: bookId });
    }

    toast({
      title: "Книги удалены",
      description: `Успешно удалено книг: ${selectedBooks.size}`,
    });

    onSuccess();
    refetch();
  } catch (error) {
    console.error("Failed to delete books:", error);
    toast({
      title: "Ошибка",
      description: "Не удалось удалить некоторые книги",
      variant: "destructive",
    });
  }
}

export default function LibraryPage() {
  const [location] = useLocation();
  const [uploadOpen, setUploadOpen] = useState(location.includes("upload=1"));
  const [search, setSearch] = useLocalStorageState("readora.library.search", "");
  const [statusFilter, setStatusFilter] = useLocalStorageState<ListBooksStatus | "all">("readora.library.statusFilter", "all");
  const [genreFilter, setGenreFilter] = useLocalStorageState("readora.library.genreFilter", "all");
  const [sortBy, setSortBy] = useLocalStorageState<SortOption>("readora.library.sortBy", "uploadedAt");
  const [sortDir, setSortDir] = useLocalStorageState<"asc" | "desc">("readora.library.sortDir", "desc");
  const [groupBy, setGroupBy] = useLocalStorageState<GroupOption>("readora.library.groupBy", "none");
  const [librarySection, setLibrarySection] = useLocalStorageState<LibrarySection>("readora.library.section", "library");
  const [viewMode, setViewMode] = useLocalStorageState<ViewMode>("readora.library.viewMode", "grid");
  const [selectedBooks, setSelectedBooks] = useState<Set<number>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { toast } = useToast();

  const apiSortBy = sortBy === "cycleNumber" ? undefined : sortBy;
  const effectiveStatus = getEffectiveStatus(librarySection, statusFilter);

  const { data: books = [], isLoading, refetch } = useListBooks({
    search: search || undefined,
    status: effectiveStatus,
    genreId: genreFilter === "all" ? undefined : Number.parseInt(genreFilter, 10),
    sortBy: apiSortBy,
    sortDir,
    groupBy: groupBy === "none" ? undefined : groupBy,
  });

  const { data: genres = [] } = useListGenres();
  const deleteBookMutation = useDeleteBook();

  const bookItems = Array.isArray(books) ? books : [];
  const genreItems = Array.isArray(genres) ? genres : [];
  const isGrouped = groupBy !== "none" && books && typeof books === "object" && "grouped" in books;

  const compareByCycleNumber = (a: any, b: any) => {
    const aValue = typeof a?.cycleNumber === "number" ? a.cycleNumber : Number.POSITIVE_INFINITY;
    const bValue = typeof b?.cycleNumber === "number" ? b.cycleNumber : Number.POSITIVE_INFINITY;
    return sortDir === "desc" ? bValue - aValue : aValue - bValue;
  };

  const sortedBookItems = useMemo(() => {
    if (sortBy !== "cycleNumber") return bookItems;
    return [...bookItems].sort(compareByCycleNumber);
  }, [bookItems, sortBy, sortDir]);

  const sortedGroupedBooks = useMemo(() => {
    if (!isGrouped || sortBy !== "cycleNumber") return books;
    const groupedSource = (books as { grouped: Record<string, any[]> }).grouped;
    const grouped: Record<string, any[]> = {};
    for (const [groupName, groupBooks] of Object.entries(groupedSource)) {
      grouped[groupName] = [...groupBooks].sort(compareByCycleNumber);
    }
    return {
      ...(books as Record<string, unknown>),
      grouped,
    };
  }, [books, isGrouped, sortBy, sortDir]);

  const sectionBookItems = useMemo(() => {
    return filterBooksBySection(sortedBookItems, librarySection);
  }, [sortedBookItems, librarySection]);

  const sectionGroupedBooks = useMemo(() => {
    if (!isGrouped || !sortedGroupedBooks || typeof sortedGroupedBooks !== "object" || !("grouped" in sortedGroupedBooks)) {
      return sortedGroupedBooks;
    }

    const groupedSource = (sortedGroupedBooks as { grouped: Record<string, any[]> }).grouped;
    const grouped = filterGroupedBySection(groupedSource, librarySection);

    return {
      ...(sortedGroupedBooks as Record<string, unknown>),
      grouped,
    };
  }, [isGrouped, sortedGroupedBooks, librarySection]);

  const groupedSectionCount = isGrouped && sectionGroupedBooks && typeof sectionGroupedBooks === "object" && "grouped" in sectionGroupedBooks
    ? Object.keys((sectionGroupedBooks as { grouped: Record<string, any[]> }).grouped).length
    : 0;

  const hasVisibleGroups = groupedSectionCount > 0;
  const showGrouped = isGrouped && hasVisibleGroups;

  useEffect(() => {
    if (location.includes("upload=1")) setUploadOpen(true);
  }, [location]);

  useEffect(() => {
    setSelectedBooks(new Set());
    if (librarySection === "shelf" && statusFilter !== "finished") {
      setStatusFilter("finished");
      return;
    }
    if (librarySection === "library" && statusFilter === "finished") {
      setStatusFilter("all");
    }
  }, [librarySection, statusFilter]);

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
    if (showGrouped) return;
    const allIds = new Set(sectionBookItems.map((b: any) => b.id));
    setSelectedBooks(allIds);
  };

  const clearSelection = () => {
    setSelectedBooks(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedBooks.size === 0) return;

    await deleteSelectedBooks(
      selectedBooks,
      deleteBookMutation.mutateAsync,
      refetch,
      toast,
      () => {
        setSelectedBooks(new Set());
        setShowDeleteDialog(false);
      },
    );
  };

  return (
    <LibraryPageLayout
      uploadOpen={uploadOpen}
      setUploadOpen={setUploadOpen}
      showGrouped={showGrouped}
      groupedSectionCount={groupedSectionCount}
      sectionBookItems={sectionBookItems}
      selectedBooks={selectedBooks}
      setShowDeleteDialog={setShowDeleteDialog}
      clearSelection={clearSelection}
      librarySection={librarySection}
      setLibrarySection={setLibrarySection}
      search={search}
      setSearch={setSearch}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      genreItems={genreItems}
      genreFilter={genreFilter}
      setGenreFilter={setGenreFilter}
      sortBy={sortBy}
      setSortBy={setSortBy}
      sortDir={sortDir}
      setSortDir={setSortDir}
      groupBy={groupBy}
      setGroupBy={setGroupBy}
      viewMode={viewMode}
      setViewMode={setViewMode}
      selectAll={selectAll}
      isLoading={isLoading}
      sectionGroupedBooks={sectionGroupedBooks}
      showDeleteDialog={showDeleteDialog}
      handleBulkDelete={handleBulkDelete}
      toggleBookSelection={toggleBookSelection}
    />
  );
}

function LibraryPageLayout({
  uploadOpen,
  setUploadOpen,
  showGrouped,
  groupedSectionCount,
  sectionBookItems,
  selectedBooks,
  setShowDeleteDialog,
  clearSelection,
  librarySection,
  setLibrarySection,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  genreItems,
  genreFilter,
  setGenreFilter,
  sortBy,
  setSortBy,
  sortDir,
  setSortDir,
  groupBy,
  setGroupBy,
  viewMode,
  setViewMode,
  selectAll,
  isLoading,
  sectionGroupedBooks,
  showDeleteDialog,
  handleBulkDelete,
  toggleBookSelection,
}: Readonly<{
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
  showGrouped: boolean;
  groupedSectionCount: number;
  sectionBookItems: any[];
  selectedBooks: Set<number>;
  setShowDeleteDialog: (open: boolean) => void;
  clearSelection: () => void;
  librarySection: LibrarySection;
  setLibrarySection: (section: LibrarySection) => void;
  search: string;
  setSearch: (value: string) => void;
  statusFilter: ListBooksStatus | "all";
  setStatusFilter: (value: ListBooksStatus | "all") => void;
  genreItems: any[];
  genreFilter: string;
  setGenreFilter: (value: string) => void;
  sortBy: SortOption;
  setSortBy: (value: SortOption) => void;
  sortDir: "asc" | "desc";
  setSortDir: (value: "asc" | "desc") => void;
  groupBy: GroupOption;
  setGroupBy: (value: GroupOption) => void;
  viewMode: ViewMode;
  setViewMode: (value: ViewMode) => void;
  selectAll: () => void;
  isLoading: boolean;
  sectionGroupedBooks: any;
  showDeleteDialog: boolean;
  handleBulkDelete: () => void;
  toggleBookSelection: (id: number) => void;
}>) {
  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <LibraryHeader
            showGrouped={showGrouped}
            groupedSectionCount={groupedSectionCount}
            sectionBookItems={sectionBookItems}
            selectedBooks={selectedBooks}
            setShowDeleteDialog={setShowDeleteDialog}
            clearSelection={clearSelection}
            setUploadOpen={setUploadOpen}
          />

          <LibrarySectionSwitch
            librarySection={librarySection}
            setLibrarySection={setLibrarySection}
          />

          <LibraryFiltersBar
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            librarySection={librarySection}
            genreItems={genreItems}
            genreFilter={genreFilter}
            setGenreFilter={setGenreFilter}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDir={sortDir}
            setSortDir={setSortDir}
            groupBy={groupBy}
            setGroupBy={setGroupBy}
            viewMode={viewMode}
            setViewMode={setViewMode}
            showGrouped={showGrouped}
            sectionBookItems={sectionBookItems}
            selectedBooks={selectedBooks}
            clearSelection={clearSelection}
            selectAll={selectAll}
          />

          <LibraryContent
            isLoading={isLoading}
            bookItems={sectionBookItems}
            isGrouped={showGrouped}
            books={sectionGroupedBooks}
            search={search}
            statusFilter={statusFilter}
            genreFilter={genreFilter}
            section={librarySection}
            viewMode={viewMode}
            selectedBooks={selectedBooks}
            toggleBookSelection={toggleBookSelection}
            setUploadOpen={setUploadOpen}
          />
        </div>

        <UploadBookDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />

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

function LibraryHeader({
  showGrouped,
  groupedSectionCount,
  sectionBookItems,
  selectedBooks,
  setShowDeleteDialog,
  clearSelection,
  setUploadOpen,
}: Readonly<{
  showGrouped: boolean;
  groupedSectionCount: number;
  sectionBookItems: any[];
  selectedBooks: Set<number>;
  setShowDeleteDialog: (open: boolean) => void;
  clearSelection: () => void;
  setUploadOpen: (open: boolean) => void;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold">Моя библиотека</h1>
        <p className="text-muted-foreground text-sm">
          {showGrouped ? `${groupedSectionCount} групп` : `${sectionBookItems.length} книг`}
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
  );
}

function LibrarySectionSwitch({
  librarySection,
  setLibrarySection,
}: Readonly<{
  librarySection: LibrarySection;
  setLibrarySection: (section: LibrarySection) => void;
}>) {
  return (
    <div className="inline-flex rounded-lg border p-1 mb-6">
      <Button
        type="button"
        size="sm"
        variant={librarySection === "library" ? "secondary" : "ghost"}
        onClick={() => setLibrarySection("library")}
        className="h-8"
      >
        Библиотека
      </Button>
      <Button
        type="button"
        size="sm"
        variant={librarySection === "shelf" ? "secondary" : "ghost"}
        onClick={() => setLibrarySection("shelf")}
        className="h-8"
      >
        Книжная полка
      </Button>
    </div>
  );
}

function LibraryFiltersBar({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  librarySection,
  genreItems,
  genreFilter,
  setGenreFilter,
  sortBy,
  setSortBy,
  sortDir,
  setSortDir,
  groupBy,
  setGroupBy,
  viewMode,
  setViewMode,
  showGrouped,
  sectionBookItems,
  selectedBooks,
  clearSelection,
  selectAll,
}: Readonly<{
  search: string;
  setSearch: (value: string) => void;
  statusFilter: ListBooksStatus | "all";
  setStatusFilter: (value: ListBooksStatus | "all") => void;
  librarySection: LibrarySection;
  genreItems: any[];
  genreFilter: string;
  setGenreFilter: (value: string) => void;
  sortBy: SortOption;
  setSortBy: (value: SortOption) => void;
  sortDir: "asc" | "desc";
  setSortDir: (value: "asc" | "desc") => void;
  groupBy: GroupOption;
  setGroupBy: (value: GroupOption) => void;
  viewMode: ViewMode;
  setViewMode: (value: ViewMode) => void;
  showGrouped: boolean;
  sectionBookItems: any[];
  selectedBooks: Set<number>;
  clearSelection: () => void;
  selectAll: () => void;
}>) {
  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <div className="relative w-full sm:flex-1 sm:min-w-48">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Поиск по названию или автору..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ListBooksStatus | "all")}>
        <SelectTrigger className="w-full sm:w-40">
          <SelectValue placeholder="Статус" />
        </SelectTrigger>
        <SelectContent>
          {librarySection === "shelf" ? (
            <SelectItem value="finished">Прочитано</SelectItem>
          ) : (
            <>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="reading">Читаю</SelectItem>
              <SelectItem value="not_started">Не читал</SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      {genreItems.length > 0 && (
        <Select value={genreFilter} onValueChange={setGenreFilter}>
          <SelectTrigger className="w-full sm:w-44">
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
        <SelectTrigger className="w-full sm:w-44">
          <SlidersHorizontal className="w-3 h-3 mr-1" />
          <SelectValue placeholder="Сортировка" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="uploadedAt">По дате загрузки</SelectItem>
          <SelectItem value="title">По названию</SelectItem>
          <SelectItem value="author">По автору</SelectItem>
          <SelectItem value="progress">По прогрессу</SelectItem>
          <SelectItem value="lastReadAt">По дате чтения</SelectItem>
          <SelectItem value="cycleNumber">По номеру в цикле</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortDir} onValueChange={(value) => setSortDir(value as "asc" | "desc")}>
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue placeholder="Направление" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">По возрастанию</SelectItem>
          <SelectItem value="desc">По убыванию</SelectItem>
        </SelectContent>
      </Select>

      <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupOption)}>
        <SelectTrigger className="w-full sm:w-36">
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

      {!showGrouped && sectionBookItems.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={selectedBooks.size === sectionBookItems.length ? clearSelection : selectAll}
        >
          {selectedBooks.size === sectionBookItems.length ? "Снять выделение" : "Выбрать все"}
        </Button>
      )}
    </div>
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
  section,
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
  section: LibrarySection;
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
    return <EmptyState section={section} hasFilters={hasFilters} onUploadClick={() => setUploadOpen(true)} />;
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

function EmptyState({ section, hasFilters, onUploadClick }: Readonly<{ section: LibrarySection; hasFilters: boolean; onUploadClick: () => void }>) {
  if (section === "shelf") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <BookOpen className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-lg mb-2">
          {hasFilters ? "На полке ничего не найдено" : "Книжная полка пуста"}
        </h3>
        <p className="text-muted-foreground text-sm mb-6">
          {hasFilters
            ? "Попробуйте изменить параметры поиска или фильтры."
            : "Отмечайте книги как \"Прочитано\", чтобы они попадали на полку."}
        </p>
      </div>
    );
  }

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
          {book.cycleName && (
            <span className="truncate">
              {book.cycleName}
              {typeof book.cycleNumber === "number" ? ` • #${book.cycleNumber}` : ""}
            </span>
          )}
          {book.progressPercent != null && book.progressPercent > 0 && (
            <span>{Math.round(book.progressPercent)}% прочитано</span>
          )}
        </div>
      </div>
    </button>
  );
}
