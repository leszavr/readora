import { useEffect, useState } from "react";
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
import { Search, MoreHorizontal, Ban, Unlock, Trash2, Loader2, Download, CopyX, ChevronDown, ChevronRight, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AdminPaginationControls, useAdminListPagination } from "./AdminPagination";

export default function AdminBooks() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<number>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [keepOverrides, setKeepOverrides] = useState<Record<string, number>>({});
  const [mergingGroup, setMergingGroup] = useState<string | null>(null);

  const { data: books = [], isLoading } = useListAdminBooks({ search: search || undefined });
  const { data: duplicatesData, isLoading: duplicatesLoading, refetch: refetchDuplicates } = useListAdminBookDuplicates({
    query: { queryKey: getListAdminBookDuplicatesQueryKey(), retry: false },
  });
  const deduplicateMutation = useDeduplicateAdminBooks();
  const duplicateGroups = duplicatesData?.groups ?? [];
  const pagination = useAdminListPagination(books, "readora.admin.books.pageSize", search);
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
  }, [search]);

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
                <TableHead>Название</TableHead>
                <TableHead>Формат</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Размер</TableHead>
                <TableHead>Загружена</TableHead>
                <TableHead title="Подарочное издание («Мировое достояние»)">Подарочное</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Книги не найдены</TableCell>
                </TableRow>
              ) : (
                visibleBooks.map((b: {
                  id: number; title: string; author?: string | null;
                  format: string; status: string; ownerUsername?: string | null;
                  fileSize?: number | null; uploadedAt: string; giftEditionId?: number | null;
                  }) => (
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
                      <Switch
                        checked={Boolean(b.giftEditionId)}
                        disabled={pendingGiftBookId === b.id || b.status !== "active"}
                        onCheckedChange={(checked) => void toggleGiftEdition(b, checked)}
                        aria-label={`Подарочное издание: ${b.title}`}
                      />
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
                ))
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
