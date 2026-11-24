import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListReadingHistoryQueryKey,
  useClearReadingHistory,
  useDeleteBulkReadingHistory,
  useListReadingHistory,
  type ListReadingHistoryGroupBy,
  type ListReadingHistorySortBy,
  type ListReadingHistorySortDir,
  type ReadingHistoryEntry,
} from "@workspace/api-client-react";
import { AlertCircle, History, Layers, LayoutGrid, List, Loader2, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HISTORY_CARD_ASPECT_CLASS, ReadingHistoryCard, ReadingHistoryListItem } from "@/components/ReadingHistoryCard";
import { ReadingHistoryCommentDialog } from "@/components/ReadingHistoryCommentDialog";
import { AdminPaginationControls, useAdminListPagination } from "@/components/ListPagination";
import { HISTORY_GRID_CLASS } from "@/components/cardGrid";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { useToast } from "@/hooks/use-toast";
import { groupHistoryEntries, planHistoryDeletion } from "@/lib/reading-history";

type ViewMode = "grid" | "list";
type SortBy = ListReadingHistorySortBy;
type SortDir = ListReadingHistorySortDir;
type GroupBy = ListReadingHistoryGroupBy;

const DEFAULT_SORT_BY: SortBy = "completedAt";
const DEFAULT_SORT_DIR: Record<SortBy, SortDir> = { completedAt: "desc", title: "asc", author: "asc" };
const DEFAULT_GROUP_BY: GroupBy = "none";

const SORT_OPTIONS: ReadonlyArray<{ value: SortBy; label: string }> = [
  { value: "completedAt", label: "По дате завершения" },
  { value: "title", label: "По названию" },
  { value: "author", label: "По автору" },
];

const GROUP_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "none", label: "Без группировки" },
  { value: "date", label: "По месяцам" },
  { value: "author", label: "По авторам" },
  { value: "genre", label: "По жанрам" },
  { value: "cycle", label: "По циклам" },
];

function sortDirLabel(sortBy: SortBy, sortDir: SortDir): string {
  if (sortBy === "completedAt") return sortDir === "desc" ? "Сначала новые" : "Сначала старые";
  return sortDir === "asc" ? "От А до Я" : "От Я до А";
}

const SKELETON_KEYS = Array.from({ length: 12 }, (_, index) => `history-skeleton-${index}`);

function ViewModeToggle({ viewMode, onChange }: Readonly<{ viewMode: ViewMode; onChange: (mode: ViewMode) => void }>) {
  return (
    <div className="flex gap-1 rounded-md border p-1">
      <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("grid")} className="h-8 w-8 p-0" aria-label="Сетка">
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("list")} className="h-8 w-8 p-0" aria-label="Список">
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ReadingHistoryView() {
  const [search, setSearch] = useLocalStorageState("readora.history.search", "");
  const [sortBy, setSortBy] = useLocalStorageState<SortBy>("readora.history.sortBy", DEFAULT_SORT_BY);
  const [sortDir, setSortDir] = useLocalStorageState<SortDir>("readora.history.sortDir", "desc");
  const [groupBy, setGroupBy] = useLocalStorageState<GroupBy>("readora.history.groupBy", DEFAULT_GROUP_BY);
  const [viewMode, setViewMode] = useLocalStorageState<ViewMode>("readora.history.viewMode", "grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [commentEntry, setCommentEntry] = useState<ReadingHistoryEntry | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteBulk = useDeleteBulkReadingHistory();
  const clearHistory = useClearReadingHistory();

  const trimmedSearch = search.trim();
  const historyQuery = useListReadingHistory({ search: trimmedSearch || undefined, sortBy, sortDir, groupBy });
  const entries = useMemo(() => (Array.isArray(historyQuery.data) ? historyQuery.data : []), [historyQuery.data]);

  const pagination = useAdminListPagination(entries, "readora.history.pageSize", `${trimmedSearch}|${sortBy}|${sortDir}|${groupBy}`);
  const visibleEntries = pagination.visibleItems;

  const groups = useMemo(
    () => (groupBy === "none" ? [{ key: "all", label: "", items: visibleEntries }] : groupHistoryEntries(visibleEntries, groupBy)),
    [groupBy, visibleEntries],
  );

  const activeFilterCount = [
    trimmedSearch.length > 0,
    sortBy !== DEFAULT_SORT_BY,
    sortDir !== DEFAULT_SORT_DIR[sortBy],
    groupBy !== DEFAULT_GROUP_BY,
  ].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;
  const deleting = deleteBulk.isPending || clearHistory.isPending;
  const allSelected = entries.length > 0 && selected.size === entries.length;

  const resetFilters = () => {
    setSearch("");
    setSortBy(DEFAULT_SORT_BY);
    setSortDir(DEFAULT_SORT_DIR[DEFAULT_SORT_BY]);
    setGroupBy(DEFAULT_GROUP_BY);
  };

  const changeSortBy = (value: SortBy) => {
    setSortBy(value);
    setSortDir(DEFAULT_SORT_DIR[value]);
  };

  const toggleSelect = (entry: ReadingHistoryEntry) => {
    if (!selectionMode) setSelectionMode(true);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(entry.id)) {
        next.delete(entry.id);
      } else {
        next.add(entry.id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)));
  };

  const exitSelection = () => {
    setSelected(new Set());
    setSelectionMode(false);
  };

  const handleDeleteSelected = async () => {
    const plan = planHistoryDeletion([...selected], entries.length);
    let deleted = 0;

    try {
      if (plan.mode === "clear") {
        deleted = (await clearHistory.mutateAsync()).deleted;
      } else {
        for (const batch of plan.batches) {
          deleted += (await deleteBulk.mutateAsync({ data: { ids: batch } })).deleted;
          setSelected((previous) => {
            const next = new Set(previous);
            for (const id of batch) next.delete(id);
            return next;
          });
        }
      }
      toast({ title: "Записи удалены из истории", description: `Удалено записей: ${deleted}` });
      exitSelection();
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Failed to delete reading history entries:", error);
      toast({ title: "Ошибка", description: "Не удалось удалить записи из истории", variant: "destructive" });
    } finally {
      void queryClient.invalidateQueries({ queryKey: getListReadingHistoryQueryKey() });
    }
  };

  const openComment = (entry: ReadingHistoryEntry) => setCommentEntry(entry);

  const renderFilterControls = (mobile = false) => (
    <>
      <Select value={sortBy} onValueChange={(value) => changeSortBy(value as SortBy)}>
        <SelectTrigger className={mobile ? "w-full" : "w-48"} aria-label="Сортировка">
          <SlidersHorizontal className="mr-1 h-3 w-3" />
          <SelectValue placeholder="Сортировка" />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sortDir} onValueChange={(value) => setSortDir(value as SortDir)}>
        <SelectTrigger className={mobile ? "w-full" : "w-44"} aria-label="Направление сортировки">
          <SelectValue placeholder="Направление" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">{sortDirLabel(sortBy, "desc")}</SelectItem>
          <SelectItem value="asc">{sortDirLabel(sortBy, "asc")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
        <SelectTrigger className={mobile ? "w-full" : "w-40"} aria-label="Группировка">
          <Layers className="mr-1 h-3 w-3" />
          <SelectValue placeholder="Группировка" />
        </SelectTrigger>
        <SelectContent>
          {GROUP_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  const selectionButton = selectionMode ? (
    <Button variant="outline" size="sm" onClick={toggleSelectAll}>
      {allSelected ? "Снять выделение" : "Выбрать все"}
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)} disabled={entries.length === 0}>
      Выбрать
    </Button>
  );

  let content: ReactNode;

  if (historyQuery.isLoading) {
    content = (
      <div className={viewMode === "grid" ? HISTORY_GRID_CLASS : "space-y-2"}>
        {SKELETON_KEYS.map((key) => (
          <div key={key} className={cn("animate-pulse", viewMode === "grid" ? cn("flex gap-2 p-1.5", HISTORY_CARD_ASPECT_CLASS) : "h-[88px] rounded-lg bg-muted")}>
            {viewMode === "grid" ? (
              <>
                <div className="aspect-[2/3] h-full rounded-md bg-muted" />
                <div className="flex flex-1 flex-col gap-2 py-1">
                  <div className="h-3 rounded bg-muted" />
                  <div className="h-2 w-2/3 rounded bg-muted" />
                  <div className="mt-auto h-2 w-1/2 rounded bg-muted" />
                </div>
              </>
            ) : (
              <div className="h-[88px] rounded-lg bg-muted" />
            )}
          </div>
        ))}
      </div>
    );
  } else if (historyQuery.isError) {
    content = (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">Не удалось загрузить историю</h3>
        <p className="mb-6 text-sm text-muted-foreground">Попробуйте ещё раз.</p>
        <Button onClick={() => void historyQuery.refetch()} className="gap-2">Повторить</Button>
      </div>
    );
  } else if (entries.length === 0) {
    content = (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <History className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">{hasFilters ? "В истории ничего не найдено" : "История чтения пуста"}</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          {hasFilters ? "Попробуйте изменить поиск или фильтры." : "Отмечайте книги как «Прочитано» — они появятся здесь."}
        </p>
        {hasFilters && (
          <Button variant="outline" onClick={resetFilters}>Сбросить фильтры</Button>
        )}
      </div>
    );
  } else {
    content = (
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.key}>
            {group.label && (
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Layers className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="truncate">{group.label}</span>
                <span className="shrink-0 text-sm font-normal text-muted-foreground">({group.items.length})</span>
              </h2>
            )}
            <div className={viewMode === "grid" ? HISTORY_GRID_CLASS : "space-y-2"}>
              {group.items.map((entry) => (
                viewMode === "grid" ? (
                  <div key={entry.id} className="self-start">
                    <ReadingHistoryCard entry={entry} selected={selected.has(entry.id)} selectionMode={selectionMode} onToggleSelect={toggleSelect} onCommentClick={openComment} />
                  </div>
                ) : (
                  <ReadingHistoryListItem key={entry.id} entry={entry} selected={selected.has(entry.id)} selectionMode={selectionMode} onToggleSelect={toggleSelect} onCommentClick={openComment} />
                )
              ))}
            </div>
          </section>
        ))}
        <AdminPaginationControls pagination={pagination} />
      </div>
    );
  }

  return (
    <div className={cn(selectionMode && "pb-20")}>
      <div className="mb-6">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="pl-9"
            placeholder="Поиск по названию или автору..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Поиск в истории"
          />
        </div>

        <div className="mt-3 flex items-center gap-2 sm:hidden">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          {selectionButton}
        </div>

        <div className="mt-3 hidden flex-wrap items-center gap-3 sm:flex">
          {renderFilterControls()}
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          {selectionButton}
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="bottom" className="rounded-t-xl p-4">
            <SheetHeader className="pr-8 text-left">
              <SheetTitle>Фильтры</SheetTitle>
              <SheetDescription>Настройте отображение истории чтения.</SheetDescription>
            </SheetHeader>
            <div className="grid gap-3 py-4">
              {renderFilterControls(true)}
            </div>
            <SheetFooter className="gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={resetFilters} disabled={!hasFilters}>
                Сбросить
              </Button>
              <SheetClose asChild>
                <Button type="button">Готово</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {content}

      <ReadingHistoryCommentDialog entry={commentEntry} onOpenChange={(open) => { if (!open) setCommentEntry(null); }} />

      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => { if (!deleting) setShowDeleteDialog(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить записи из истории?</AlertDialogTitle>
            <AlertDialogDescription>
              Записей к удалению: {selected.size}. Книги останутся в библиотеке, статус «Прочитано» не изменится. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || selected.size === 0}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteSelected();
              }}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectionMode && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border bg-card/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur">
            <span className="whitespace-nowrap text-sm text-muted-foreground">Выбрано: {selected.size}</span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="gap-2 rounded-full"
              disabled={selected.size === 0 || deleting}
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Удалить
            </Button>
            <Button type="button" size="sm" variant="ghost" className="gap-2 rounded-full" onClick={exitSelection} disabled={deleting}>
              <X className="h-4 w-4" aria-hidden="true" />
              Готово
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
