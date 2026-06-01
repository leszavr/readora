import { useState } from "react";
import { useListGenres, customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, MoreHorizontal, Pencil, Trash2, Loader2 } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

type Genre = { id: number; code: string; name: string; description?: string | null; isActive: boolean };

export default function AdminGenres() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editGenre, setEditGenre] = useState<null | Genre>(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsActive, setNewIsActive] = useState(true);

  const { data: genres = [], isLoading } = useListGenres();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["genres"] });

  const { mutate: createGenre, isPending: creating } = useMutation({
    mutationFn: async (data: { code: string; name: string; description?: string; isActive: boolean }) => {
      return await customFetch("/admin/genres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setNewCode("");
      setNewName("");
      setNewDescription("");
      setNewIsActive(true);
    },
  });

  const { mutate: updateGenre, isPending: updating } = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; code: string; name: string; description?: string; isActive: boolean }) => {
      return await customFetch(`/admin/genres/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      invalidate();
      setEditGenre(null);
    },
  });

  const { mutate: deleteGenre } = useMutation({
    mutationFn: async (id: number) => {
      await customFetch(`/admin/genres/${id}`, { method: "DELETE" });
    },
    onSuccess: invalidate,
  });

  const filtered = (genres as Genre[]).filter((g) => 
    !search || 
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    g.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-3 items-center justify-between">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Поиск жанров..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Добавить жанр
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    {search ? "Жанры не найдены" : "Нет жанров"}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono text-sm text-muted-foreground">{g.code}</TableCell>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {g.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={g.isActive ? "default" : "secondary"} className="text-xs">
                        {g.isActive ? "Активен" : "Неактивен"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2" onClick={() => setEditGenre(g)}>
                            <Pencil className="w-4 h-4" /> Изменить
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="gap-2 text-destructive focus:text-destructive" 
                            onClick={() => {
                              if (confirm(`Удалить жанр "${g.name}"?`)) deleteGenre(g.id);
                            }}
                          >
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить жанр</DialogTitle>
          </DialogHeader>
          <form 
            onSubmit={(e) => { 
              e.preventDefault(); 
              if (newCode.trim() && newName.trim()) {
                createGenre({ 
                  code: newCode.trim(), 
                  name: newName.trim(), 
                  description: newDescription.trim() || undefined,
                  isActive: newIsActive
                }); 
              }
            }} 
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Код жанра *</Label>
              <Input 
                value={newCode} 
                onChange={(e) => setNewCode(e.target.value)} 
                placeholder="fiction"
                required 
              />
              <p className="text-xs text-muted-foreground">Латиница, без пробелов</p>
            </div>
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input 
                value={newName} 
                onChange={(e) => setNewName(e.target.value)} 
                placeholder="Фантастика"
                required 
              />
            </div>
            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea 
                value={newDescription} 
                onChange={(e) => setNewDescription(e.target.value)} 
                placeholder="Описание жанра (опционально)"
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Активен</Label>
              <Switch checked={newIsActive} onCheckedChange={setNewIsActive} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={creating || !newCode.trim() || !newName.trim()}>
                {creating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editGenre} onOpenChange={(o) => !o && setEditGenre(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Изменить жанр</DialogTitle>
          </DialogHeader>
          {editGenre && (
            <form 
              onSubmit={(e) => { 
                e.preventDefault(); 
                if (editGenre.code.trim() && editGenre.name.trim()) {
                  updateGenre({ 
                    id: editGenre.id, 
                    code: editGenre.code.trim(), 
                    name: editGenre.name.trim(),
                    description: editGenre.description?.trim() || undefined,
                    isActive: editGenre.isActive
                  }); 
                }
              }} 
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Код жанра *</Label>
                <Input 
                  value={editGenre.code} 
                  onChange={(e) => setEditGenre({ ...editGenre, code: e.target.value })} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input 
                  value={editGenre.name} 
                  onChange={(e) => setEditGenre({ ...editGenre, name: e.target.value })} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea 
                  value={editGenre.description || ""} 
                  onChange={(e) => setEditGenre({ ...editGenre, description: e.target.value })} 
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Активен</Label>
                <Switch 
                  checked={editGenre.isActive} 
                  onCheckedChange={(checked) => setEditGenre({ ...editGenre, isActive: checked })} 
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditGenre(null)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={updating || !editGenre.code.trim() || !editGenre.name.trim()}>
                  {updating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
