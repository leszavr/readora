import { useEffect, useMemo, useState } from "react";
import {
  useListAdminBooks,
  useDeleteAdminBook,
  useDeleteBulkAdminBooks,
  useToggleBlockBook,
  useCreateGiftEdition,
  useDeleteGiftEdition,
  useListAdminBookDuplicates,
  useDeduplicateAdminBooks,
  getListAdminBooksQueryKey,
  getListGiftEditionsQueryKey,
  getListAdminBookDuplicatesQueryKey,
} from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Search, MoreHorizontal, Ban, Unlock, Trash2, Loader2, Download, CopyX, ChevronDown, ChevronRight, Check, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Layers, UserRound, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { AdminPaginationControls, useAdminListPagination } from "./AdminPagination";

type BookSortField = "title" | "format" | "owner" | "status" | "size" | "uploadedAt" | "gift";
type BookFilterField = "format" | "owner" | "status" | "gift";
type BookGroupField = "none" | "format" | "owner" | "status" | "gift";

interface AdminBookRow {
  id: number;
  title: string;
  author?: string | null;
  format: string;
  status: string;
  ownerUsername?: string | null;
  ownerId?: number | null;
  fileSize?: number | null;
  uploadedAt: string;
  giftEditionId?: number | null;
}

const SORT_LABELS: Record<BookSortField, string> = {
  title: "Название",
  format: "Формат",
  owner: "Владелец",
  status: "Статус",
  size: "Размер",
  uploadedAt: "Загружена",
  gift: "Подарочное",
};

const FILTER_LABELS: Record<BookFilterField, string> = {
  format: "Формат",
  owner: "Владелец",
  status: "Статус",
  gift: "Подарочное",
};

const GROUP_LABELS: Record<BookGroupField, string> = {
  none: "Без группировки",
  format: "Формат",
  owner: "Владелец",
  status: "Статус",
  gift: "Подарочное",
};

function bookFieldValue(book: AdminBookRow, field: BookSortField | BookGroupField | BookFilterField): string {
  switch (field) {
    case "title":
      return book.title.toLowerCase();
    case "format":
      return book.format.toUpperCase();
    case "owner":
      return (book.ownerUsername ?? "").toLowerCase();
    case "status":
      return book.status;
    case "size":
      return String(book.fileSize ?? 0);
    case "uploadedAt":
      return book.uploadedAt;
    case "gift":
      return book.giftEditionId ? "1" : "0";
    default:
      return "";
  }
}

function compareBooks(a: AdminBookRow, b: AdminBookRow, field: BookSortField): number {
  if (field === "size") {
    return (a.fileSize ?? 0) - (b.fileSize ?? 0);
  }
  const av = bookFieldValue(a, field);
  const bv = bookFieldValue(b, field);
  return av < bv ? -1 : av > bv ? 1 : a.id - b.id;
}

function OwnerFilterCombobox({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 w-44 justify-start gap-1.5 font-normal",
              !value && "text-muted-foreground",
            )}
            aria-label="Фильтр: Владелец"
          >
            <UserRound className="w-3.5 h-3.5 text-muted-foreground" />
            {value ? value : "Владелец: все"}
            <ChevronDown className="ml-auto w-3.5 h-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Поиск владельца..." />
            <CommandList>
              <CommandEmpty>Владелец не найден</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-1 h-3.5 w-3.5", !value ? "opacity-100" : "opacity-0")} />
                  Все владельцы
                </CommandItem>
                {options.map((owner) => (
                  <CommandItem
                    key={owner}
                    value={owner}
                    onSelect={() => {
                      onChange(owner);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-1 h-3.5 w-3.5", value === owner ? "opacity-100" : "opacity-0")} />
                    {owner}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => onChange(null)}
          aria-label="Сбросить фильтр по владельцу"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function AdminBooks() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<number>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [keepOverrides, setKeepOverrides] = useState<Record<string, number>>({});
  const [mergingGroup, setMergingGroup] = useState<string | null>(null);

  const [sortField, setSortField] = useState<BookSortField>("uploadedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupField, setGroupField] = useState<BookGroupField>("none");
  const [filters, setFilters] = useState<Partial<Record<BookFilterField, string>>>({});

  const { data: books = [], isLoading } = useListAdminBooks({ search: search || undefined });
  const { data: duplicatesData, isLoading: duplicatesLoading, refetch: refetchDuplicates } = useListAdminBookDuplicates({
    query: { queryKey: getListAdminBookDuplicatesQueryKey(), retry: false },
  });
  const deduplicateMutation = useDeduplicateAdminBooks();
  const duplicateGroups = duplicatesData?.groups ?? [];

  const filterOptions = useMemo(() => {
    const options: Record<BookFilterField, string[]> = { format: [], owner: [], status: [], gift: [] };
    const formats = new Set<string>();
    const owners = new Set<string>();
    const statuses = new Set<string>();
    const gifts = new Set<string>();
    for (const book of books as AdminBookRow[]) {
      formats.add(book.format.toUpperCase());
      if (book.ownerUsername) owners.add(book.ownerUsername);
      statuses.add(book.status);
      gifts.add(book.giftEditionId ? "Подарочное" : "Обычная");
    }
    options.format = [...formats].sort();
    options.owner = [...owners].sort((a, b) => a.localeCompare(b, "ru"));
    options.status = [...statuses].sort();
    options.gift = [...gifts].sort();
    return options;
  }, [books]);

  const filteredBooks = useMemo(() => {
    let result = books as AdminBookRow[];
    for (const field of ["format", "owner", "status", "gift"] as const) {
      const value = filters[field];
      if (!value) continue;
      if (field === "gift") {
        const isGift = value === "Подарочное";
        result = result.filter((b) => Boolean(b.giftEditionId) === isGift);
      } else if (field === "format") {
        result = result.filter((b) => b.format.toUpperCase() === value);
      } else if (field === "owner") {
        result = result.filter((b) => b.ownerUsername === value);
      } else {
        result = result.filter((b) => b.status === value);
      }
    }
    return result;
  }, [books, filters]);

  const sortedBooks = useMemo(() => {
    const result = [...filteredBooks].sort((a, b) => compareBooks(a, b, sortField));
    if (sortDir === "desc") result.reverse();
    return result;
  }, [filteredBooks, sortField, sortDir]);

  const groupedBooks = useMemo(() => {
    if (groupField === "none") return [{ key: null as string | null, label: null as string | null, items: sortedBooks }];
    const groups = new Map<string, AdminBookRow[]>();
    for (const book of sortedBooks) {
      let key: string;
      if (groupField === "gift") key = book.giftEditionId ? "Подарочное" : "Обычная";
      else if (groupField === "format") key = book.format.toUpperCase();
      else if (groupField === "owner") key = book.ownerUsername ?? "—";
      else key = book.status === "active" ? "Активна" : "Заблокирована";
      const list = groups.get(key) ?? [];
      list.push(book);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ru"))
      .map(([key, items]) => ({ key, label: key, items }));
  }, [sortedBooks, groupField]);

  const pagination = useAdminListPagination(sortedBooks, "readora.admin.books.pageSize", `${search}|${JSON.stringify(filters)}|${groupField}`);
  const visibleBooks = pagination.visibleItems;
  const invalidate = () => qc.invalidateQueries({ queryKey: getListAdminBooksQueryKey() });

  const { mutate: deleteBook } = useDeleteAdminBook({ mutation: { onSuccess: invalidate } });
  const deleteBooksMutation = useDeleteBulkAdminBooks();
  const { mutate: toggleBlock } = useToggleBlockBook({ mutation: { onSuccess: invalidate } });
  const createGiftMutation = useCreateGiftEdition();
  const deleteGiftMutation = useDeleteGiftEdition();
  const [pendingGiftBookId, setPendingGiftBookId] = useState<number | null>(null);

  const toggleGiftEdition = async (book: { id: number; title: string; giftEditionId?: number | null }, enabled: boolean) => {
    setPendingGiftBookId(book.id);
    try {
      if (enabled) {
        await createGiftMutation.mutateAsync({ data: { bookId: book.id, isPublished: true } });
        toast({ title: "Подарочное издание добавлено", description: `«${book.title}» будет выдаваться новым пользователям.` });
      } else if (book.giftEditionId) {
        await deleteGiftMutation.mutateAsync({ id: book.giftEditionId });
        toast({ title: "Книга убрана из подарочных изданий", description: "Уже выданные копии остаются у пользователей." });
      }
      void invalidate();
      void qc.invalidateQueries({ queryKey: getListGiftEditionsQueryKey() });
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Повторите попытку.";
      toast({ title: "Не удалось изменить подарочное издание", description: message, variant: "destructive" });
    } finally {
      setPendingGiftBookId(null);
    }
  };

  useEffect(() => {
    setSelectedBookIds(new Set());
  }, [search, filters]);

  const toggleSort = (field: BookSortField) => {
    if (sortField === field) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "uploadedAt" || field === "size" ? "desc" : "asc");
    }
  };

  const setFilter = (field: BookFilterField, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value === "all" ? undefined : value }));
  };

  const activeFiltersCount = Object.values(filters).filter(Boolean).length;

  const allVisibleSelected = visibleBooks.length > 0 && visibleBooks.every((book) => selectedBookIds.has(book.id));
  const someVisibleSelected = visibleBooks.some((book) => selectedBookIds.has(book.id));

  const toggleBookSelection = (bookId: number) => {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const toggleAllVisibleBooks = () => {
    setSelectedBookIds(allVisibleSelected ? new Set() : new Set(visibleBooks.map((book) => book.id)));
  };

  const deleteSelectedBooks = async () => {
    if (selectedBookIds.size === 0) return;

    try {
      const result = await deleteBooksMutation.mutateAsync({ data: { ids: [...selectedBookIds] } });
      toast({
        title: "Книги удалены",
        description: `Успешно удалено книг: ${result.deleted}`,
      });
      setSelectedBookIds(new Set());
      setShowDeleteDialog(false);
      invalidate();
    } catch (error) {
      console.error("Failed to delete books:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось удалить выбранные книги",
        variant: "destructive",
      });
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  };

  const renderBookRow = (b: AdminBookRow) => (
    <TableRow key={b.id}>
      <TableCell>
        <Checkbox
          checked={selectedBookIds.has(b.id)}
          onCheckedChange={() => toggleBookSelection(b.id)}
          aria-label={`Выбрать книгу ${b.title}`}
        />
      </TableCell>
      <TableCell>
        <div>
          <p className="font-medium text-sm">{b.title}</p>
          {b.author && <p className="text-xs text-muted-foreground">{b.author}</p>}
        </div>
      </TableCell>
      <TableCell>
        <span className="text-xs font-mono font-bold uppercase text-muted-foreground">{b.format}</span>
      </TableCell>
      <TableCell className="text-sm">{b.ownerUsername ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={b.status === "active" ? "default" : "destructive"} className="text-xs">
          {b.status === "active" ? "Активна" : "Заблокирована"}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatSize(b.fileSize ?? null)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(b.uploadedAt).toLocaleDateString("ru-RU")}
      </TableCell>
      <TableCell>
        {b.ownerId === user?.id ? (
          <Switch
            checked={Boolean(b.giftEditionId)}
            disabled={pendingGiftBookId === b.id || b.status !== "active"}
            onCheckedChange={(checked) => void toggleGiftEdition(b, checked)}
            aria-label={`Подарочное издание: ${b.title}`}
          />
        ) : (
          <span className="text-xs text-muted-foreground" title="Подарочным изданием можно сделать только книгу из библиотеки администратора">
            {b.giftEditionId ? "Да" : "—"}
          </span>
        )}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a className="gap-2" href={`/api/admin/books/${b.id}/download`} download>
                <Download className="w-4 h-4" /> Скачать файл
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => toggleBlock({ id: b.id })}>
              {b.status === "active"
                ? <><Ban className="w-4 h-4" /> Заблокировать</>
                : <><Unlock className="w-4 h-4" /> Разблокировать</>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => {
              if (confirm(`Удалить книгу "${b.title}"?`)) deleteBook({ id: b.id });
            }}>
              <Trash2 className="w-4 h-4" /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  const mergeGroup = async (group: (typeof duplicateGroups)[number]) => {
    const keepId = keepOverrides[`${group.ownerId}/${group.fileHash}`] ?? group.keepId;
    const removeIds = group.candidates.filter((c) => c.id !== keepId).map((c) => c.id);
    if (removeIds.length === 0) return;
    setMergingGroup(`${group.ownerId}/${group.fileHash}`);
    try {
      await deduplicateMutation.mutateAsync({
        data: { keepId, removeIds },
      });
      toast({
        title: "Дубликаты объединены",
        description: `«${group.title}»: оставлена книга #${keepId}, прогресс, закладки и заметки перенесены.`,
      });
      await Promise.all([
        refetchDuplicates(),
        qc.invalidateQueries({ queryKey: getListAdminBooksQueryKey() }),
      ]);
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Не удалось объединить дубликаты";
      toast({ title: "Ошибка объединения", description: message, variant: "destructive" });
    } finally {
      setMergingGroup(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs sm:flex-1 sm:min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Поиск книг..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {selectedBookIds.size > 0 && (
          <Button variant="destructive" size="sm" className="gap-2" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-4 h-4" />
            Удалить ({selectedBookIds.size})
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupField} onValueChange={(v) => setGroupField(v as BookGroupField)}>
          <SelectTrigger className="w-44 h-9" aria-label="Группировка">
            <Layers className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GROUP_LABELS) as BookGroupField[]).map((field) => (
              <SelectItem key={field} value={field}>{GROUP_LABELS[field]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(["format", "status", "gift"] as BookFilterField[]).map((field) => (
          <Select
            key={field}
            value={filters[field] ?? "all"}
            onValueChange={(v) => setFilter(field, v)}
          >
            <SelectTrigger className="w-40 h-9" aria-label={`Фильтр: ${FILTER_LABELS[field]}`}>
              <SelectValue placeholder={FILTER_LABELS[field]} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{FILTER_LABELS[field]}: все</SelectItem>
              {filterOptions[field].map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <OwnerFilterCombobox
          value={filters.owner}
          options={filterOptions.owner}
          onChange={(value) => setFilter("owner", value ?? "all")}
        />
        {activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={() => setFilters({})}
          >
            Сбросить фильтры ({activeFiltersCount})
          </Button>
        )}
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setDuplicatesOpen((v) => !v)}
            className="flex flex-1 items-center gap-2 text-left hover:opacity-80"
            aria-expanded={duplicatesOpen}
          >
            {duplicatesOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <CopyX className="w-4 h-4 text-destructive" />
            <span className="text-sm font-medium">Дубликаты книг</span>
            {duplicatesLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant={duplicateGroups.length > 0 ? "destructive" : "secondary"} className="text-xs">
                {duplicateGroups.length}
              </Badge>
            )}
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            disabled={duplicatesLoading}
            onClick={() => void refetchDuplicates()}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", duplicatesLoading && "animate-spin")} />
            Проверить
          </Button>
        </div>
        {duplicatesOpen && (
          <div className="space-y-3 border-t px-4 py-4">
            <p className="text-xs text-muted-foreground">
              Группы книг с одинаковым файлом у одного владельца. При объединении прогресс
              чтения, закладки и заметки переносятся на сохраняемую книгу.
            </p>
            {duplicatesLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : duplicateGroups.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Дубликаты не найдены</p>
            ) : (
              duplicateGroups.map((group) => {
                  const key = `${group.ownerId}/${group.fileHash}`;
                  const keepId = keepOverrides[key] ?? group.keepId;
                  return (
                    <div key={key} className="rounded-lg border p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{group.title}</p>
                        {group.author && <p className="text-xs text-muted-foreground">{group.author}</p>}
                        <Badge variant="outline" className="text-xs">{group.ownerUsername ?? `user #${group.ownerId}`}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto gap-1.5"
                          disabled={mergingGroup === key}
                          onClick={() => void mergeGroup(group)}
                        >
                          {mergingGroup === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CopyX className="w-3.5 h-3.5" />}
                          Объединить ({group.candidates.length - 1} дубл.)
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        {group.candidates.map((c) => (
                          <label
                            key={c.id}
                            className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                          >
                            <input
                              type="radio"
                              name={key}
                              checked={keepId === c.id}
                              onChange={() => setKeepOverrides((prev) => ({ ...prev, [key]: c.id }))}
                              className="h-4 w-4 accent-[hsl(var(--primary))]"
                            />
                            <span className="font-mono text-xs text-muted-foreground">#{c.id}</span>
                            <span className="text-xs text-muted-foreground">
                              загружена {new Date(c.uploadedAt).toLocaleDateString("ru-RU")}
                            </span>
                            <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                              {c.readingStatus && (
                                <Badge variant="secondary" className="text-[11px]">
                                  {c.readingStatus === "finished" ? "Прочитана" : c.readingStatus === "reading" ? `Читается ${Math.round(c.progressPercent ?? 0)}%` : "Не читана"}
                                </Badge>
                              )}
                              {c.bookmarkCount > 0 && <Badge variant="outline" className="text-[11px]">🔖 {c.bookmarkCount}</Badge>}
                              {c.noteCount > 0 && <Badge variant="outline" className="text-[11px]">📝 {c.noteCount}</Badge>}
                              {keepId === c.id && <Check className="w-4 h-4 text-primary" />}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
              })
            )}
          </div>
        )}
      </div>

      <div className="border rounded-xl overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAllVisibleBooks}
                    aria-label="Выбрать все книги"
                  />
                </TableHead>
                {(["title", "format", "owner", "status", "size", "uploadedAt", "gift"] as BookSortField[]).map((field) => {
                  const isActive = sortField === field;
                  const Icon = isActive ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <TableHead key={field} className={field === "gift" ? "" : undefined}>
                      <button
                        type="button"
                        onClick={() => toggleSort(field)}
                        className={cn(
                          "inline-flex items-center gap-1 text-left hover:text-foreground transition-colors",
                          isActive && "text-foreground font-semibold",
                        )}
                        title={field === "gift" ? "Подарочное издание («Мировое достояние»)" : undefined}
                        aria-label={`Сортировать: ${SORT_LABELS[field]}`}
                      >
                        {field === "gift" ? "Подарочное" : SORT_LABELS[field]}
                        <Icon className={cn("w-3.5 h-3.5", !isActive && "opacity-40")} />
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Книги не найдены</TableCell>
                </TableRow>
              ) : sortedBooks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Нет книг, подходящих под фильтры</TableCell>
                </TableRow>
              ) : groupField === "none" ? (
                visibleBooks.map(renderBookRow)
              ) : (
                groupedBooks.map((group) => {
                  const groupVisible = group.items.filter((b) => visibleBooks.some((v) => v.id === b.id));
                  if (groupVisible.length === 0) return null;
                  return [
                    <TableRow key={`group-${group.key}`} className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={9} className="py-2">
                        <span className="flex items-center gap-2 text-xs font-semibold">
                          {group.label}
                          <Badge variant="secondary" className="text-[11px]">{group.items.length}</Badge>
                        </span>
                      </TableCell>
                    </TableRow>,
                    ...groupVisible.map(renderBookRow),
                  ];
                })
              )}
            </TableBody>
           </Table>
         )}
       </div>

      <AdminPaginationControls pagination={pagination} />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить выбранные книги?</AlertDialogTitle>
            <AlertDialogDescription>
              Будет удалено книг: {selectedBookIds.size}. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelectedBooks}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
