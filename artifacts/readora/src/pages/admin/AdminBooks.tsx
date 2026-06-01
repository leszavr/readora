import { useState } from "react";
import { useListAdminBooks, useDeleteAdminBook, useToggleBlockBook } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, MoreHorizontal, Ban, Unlock, Trash2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAdminBooksQueryKey } from "@workspace/api-client-react";

export default function AdminBooks() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: books = [], isLoading } = useListAdminBooks({ search: search || undefined });
  const invalidate = () => qc.invalidateQueries({ queryKey: getListAdminBooksQueryKey() });

  const { mutate: deleteBook } = useDeleteAdminBook({ mutation: { onSuccess: invalidate } });
  const { mutate: toggleBlock } = useToggleBlockBook({ mutation: { onSuccess: invalidate } });

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Поиск книг..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="border rounded-xl overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Формат</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Размер</TableHead>
                <TableHead>Загружена</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Книги не найдены</TableCell>
                </TableRow>
              ) : (
                books.map((b: {
                  id: number; title: string; author?: string | null;
                  format: string; status: string; ownerUsername?: string | null;
                  fileSize?: number | null; uploadedAt: string;
                }) => (
                  <TableRow key={b.id}>
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
    </div>
  );
}
