import { useState } from "react";
import {
  useListAdminUsers,
  useCreateAdminUser,
  useUpdateAdminUser,
  useDeleteAdminUser,
  useToggleBlockUser,
  AdminUserCreateRole,
  AdminUserUpdateRole,
  getListAdminUsersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Plus, MoreHorizontal, Ban, Unlock, Trash2, Pencil, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_LABELS: Record<string, string> = { admin: "Администратор", moderator: "Модератор", user: "Пользователь" };
const STATUS_LABELS: Record<string, string> = { active: "Активен", blocked: "Заблокирован" };

export default function AdminUsers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<null | { id: number; username: string; email: string; role: AdminUserUpdateRole }>(null);

  // Create form
  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AdminUserCreateRole>("user");

  const { data: users = [], isLoading } = useListAdminUsers({
    search: search || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });

  const { mutate: createUser, isPending: creating } = useCreateAdminUser({
    mutation: { onSuccess: () => { invalidate(); setCreateOpen(false); setNewEmail(""); setNewUsername(""); setNewPassword(""); setNewRole("user"); } },
  });

  const { mutate: updateUser, isPending: updating } = useUpdateAdminUser({
    mutation: { onSuccess: () => { invalidate(); setEditUser(null); } },
  });

  const { mutate: deleteUser } = useDeleteAdminUser({
    mutation: { onSuccess: invalidate },
  });

  const { mutate: toggleBlock } = useToggleBlockUser({
    mutation: { onSuccess: invalidate },
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-0 sm:flex-1 sm:flex-row">
          <div className="relative w-full sm:max-w-xs sm:flex-1 sm:min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="Роль" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все роли</SelectItem>
              <SelectItem value="admin">Администратор</SelectItem>
              <SelectItem value="moderator">Модератор</SelectItem>
              <SelectItem value="user">Пользователь</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="gap-2 w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Добавить
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Книг</TableHead>
                <TableHead>Регистрация</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Пользователи не найдены</TableCell>
                </TableRow>
              ) : (
                users.map((u: {
                  id: number; username: string; email: string; role: string;
                  status: string; bookCount?: number; createdAt: string;
                }) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{u.username}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={u.status === "active" ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {STATUS_LABELS[u.status] ?? u.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{u.bookCount ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("ru-RU")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2" onClick={() => setEditUser({ id: u.id, username: u.username, email: u.email, role: u.role as AdminUserUpdateRole })}>
                            <Pencil className="w-4 h-4" /> Изменить
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2" onClick={() => toggleBlock({ id: u.id })}>
                            {u.status === "active"
                              ? <><Ban className="w-4 h-4" /> Заблокировать</>
                              : <><Unlock className="w-4 h-4" /> Разблокировать</>}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => {
                            if (confirm(`Удалить пользователя ${u.username}?`)) deleteUser({ id: u.id });
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Добавить пользователя</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createUser({ data: { email: newEmail, username: newUsername, password: newPassword, role: newRole } }); }} className="space-y-4">
            <div className="space-y-2"><Label>Имя</Label><Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Пароль</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} /></div>
            <div className="space-y-2">
              <Label>Роль</Label>
                <Select value={newRole} onValueChange={(value) => setNewRole(value as AdminUserCreateRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Пользователь</SelectItem>
                  <SelectItem value="moderator">Модератор</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Создать</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Изменить пользователя</DialogTitle></DialogHeader>
          {editUser && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateUser({ id: editUser.id, data: { username: editUser.username, role: editUser.role } });
            }} className="space-y-4">
              <div className="space-y-2"><Label>Имя</Label><Input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} required /></div>
              <div className="space-y-2">
                <Label>Роль</Label>
                <Select value={editUser.role} onValueChange={(v) => setEditUser({ ...editUser, role: v as AdminUserUpdateRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Пользователь</SelectItem>
                    <SelectItem value="moderator">Модератор</SelectItem>
                    <SelectItem value="admin">Администратор</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Отмена</Button>
                <Button type="submit" disabled={updating}>{updating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Сохранить</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
