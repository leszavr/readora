import { useEffect, useState } from "react";
import {
  useListAdminBooks,
  useDeleteAdminBook,
  useDeleteBulkAdminBooks,
  useToggleBlockBook,
  getListAdminBooksQueryKey,
} from "@workspace/api-client-react";
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
import { Search, MoreHorizontal, Ban, Unlock, Trash2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function AdminBooks() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<number>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: books = [], isLoading } = useListAdminBooks({ search: search || undefined });
  const invalidate = () => qc.invalidateQueries({ queryKey: getListAdminBooksQueryKey() });

  const { mutate: deleteBook } = useDeleteAdminBook({ mutation: { onSuccess: invalidate } });
  const deleteBooksMutation = useDeleteBulkAdminBooks();
  const { mutate: toggleBlock } = useToggleBlockBook({ mutation: { onSuccess: invalidate } });

  useEffect(() => {
    setSelectedBookIds(new Set());
  }, [search]);

  const allVisibleSelected = books.length > 0 && books.every((book) => selectedBookIds.has(book.id));
  const someVisibleSelected = books.some((book) => selectedBookIds.has(book.id));

  const toggleBookSelection = (bookId: number) => {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const toggleAllVisibleBooks = () => {
    setSelectedBookIds(allVisibleSelected ? new Set() : new Set(books.map((book) => book.id)));
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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Книги не найдены</TableCell>
                </TableRow>
              ) : (
                books.map((b: {
                  id: number; title: string; author?: string | null;
                  format: string; status: string; ownerUsername?: string | null;
                  fileSize?: number | null; uploadedAt: string;
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
