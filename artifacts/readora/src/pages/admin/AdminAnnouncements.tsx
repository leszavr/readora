import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAnnouncementsQueryKey,
  getListAdminAnnouncementsQueryKey,
  useCreateAdminAnnouncement,
  useDeleteAdminAnnouncement,
  useDeleteAdminAnnouncementsBulk,
  useListAdminAnnouncements,
  useToggleAdminAnnouncementArchive,
  useUpdateAdminAnnouncement,
} from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Eye,
  EyeOff,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NoteEditor } from "@/components/NoteEditor";
import { formatDate } from "@/components/AnnouncementBell";
import { AdminPaginationControls, useAdminListPagination } from "./AdminPagination";

const CARD_COLOR_CLASSES: Record<string, string> = {
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  purple: "bg-purple-500",
};

type Kind = "announcement" | "release";
type Severity = "info" | "warning";
type SortValue = "newest" | "oldest" | "title";
type GroupValue = "none" | "kind" | "status" | "month";

const KIND_LABELS: Record<Kind, string> = {
  announcement: "Оповещение",
  release: "Обновление",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  info: "Информация",
  warning: "Важно",
};

const MONTH_FORMAT = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

interface FormState {
  kind: Kind;
  severity: Severity;
  color: "yellow" | "green" | "blue" | "pink" | "purple";
  title: string;
  body: string;
}

const EMPTY_FORM: FormState = { kind: "announcement", severity: "info", color: "blue", title: "", body: "" };

export default function AdminAnnouncements() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | Kind>("all");
  const [sort, setSort] = useState<SortValue>("newest");
  const [group, setGroup] = useState<GroupValue>("none");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [saving, setSaving] = useState(false);

  const params = useMemo(
    () => ({
      search: search.trim() || undefined,
      kind: kindFilter,
      sort,
    }),
    [search, kindFilter, sort],
  );

  const { data, isError, isLoading, refetch, isFetching } = useListAdminAnnouncements(params, {
    query: { queryKey: getListAdminAnnouncementsQueryKey(params), retry: false },
  });

  const createMutation = useCreateAdminAnnouncement();
  const updateMutation = useUpdateAdminAnnouncement();
  const deleteOne = useDeleteAdminAnnouncement();
  const deleteBulk = useDeleteAdminAnnouncementsBulk();
  const toggleArchive = useToggleAdminAnnouncementArchive();

  const items = data?.items ?? [];
  const pagination = useAdminListPagination(items, "readora.admin.announcements.pageSize", `${search}|${kindFilter}|${sort}`);
  const pagedItems = pagination.visibleItems;

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListAdminAnnouncementsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetAnnouncementsQueryKey() }),
    ]);
  };

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(item: (typeof items)[number]) {
    setForm({ kind: item.kind, severity: item.severity, color: item.color, title: item.title, body: item.body });
    setEditingId(item.id);
    setFormOpen(true);
  }

type ColorValue = FormState["color"];

  async function handleSave(body: string, color: string) {
    setSaving(true);
    try {
      const payload = { ...form, body, color: color as ColorValue };
      if (editingId !== null) {
        await updateMutation.mutateAsync({ id: editingId, data: payload });
      } else {
        await createMutation.mutateAsync({ data: payload });
      }
      setFormOpen(false);
      await invalidate();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await deleteOne.mutateAsync({ id });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await invalidate();
  }

  async function handleDeleteBulk() {
    await deleteBulk.mutateAsync({ data: { ids: [...selected] } });
    setSelected(new Set());
    setConfirmBulk(false);
    await invalidate();
  }

  async function handleArchive(id: number) {
    await toggleArchive.mutateAsync({ id });
    await invalidate();
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", label: "", items: pagedItems }];
    const map = new Map<string, typeof pagedItems>();
    for (const item of pagedItems) {
      let key: string;
      if (group === "kind") key = item.kind;
      else if (group === "status") key = item.archivedAt ? "archived" : "active";
      else key = MONTH_FORMAT.format(new Date(item.publishedAt));
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return [...map.entries()].map(([key, groupItems]) => ({
      key,
      label:
        group === "kind"
          ? KIND_LABELS[key as Kind]
          : group === "status"
            ? key === "archived"
              ? "Архив"
              : "Активные"
            : key,
      items: groupItems,
    }));
  }, [group, pagedItems]);

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-muted" />;
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Не удалось загрузить оповещения</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>Повторите попытку позже.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Оповещения и Changelog</h2>
          <p className="text-sm text-muted-foreground">
            Сообщения пользователям. Записи с типом «Обновление» образуют Changelog платформы.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => void refetch()} disabled={isFetching} aria-label="Обновить список">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Создать
          </Button>
        </div>
      </div>

      {formOpen && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingId !== null ? "Редактирование оповещения" : "Новое оповещение"}
            </CardTitle>
            <CardDescription>
              Текст поддерживает **полужирный**, *курсив*, ~~зачёркнутый~~ и эмодзи.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Тип</p>
                <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v as Kind }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="announcement">{KIND_LABELS.announcement}</SelectItem>
                    <SelectItem value="release">{KIND_LABELS.release}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Важность</p>
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v as Severity }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">{SEVERITY_LABELS.info}</SelectItem>
                    <SelectItem value="warning">{SEVERITY_LABELS.warning}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Заголовок</p>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                maxLength={200}
                placeholder={form.kind === "release" ? "Обновление от 07.11.2026" : "Заголовок оповещения"}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Текст</p>
              <NoteEditor
                initialText={form.body}
                initialColor={form.color}
                saveLabel={editingId !== null ? "Сохранить" : "Опубликовать"}
                autoFocus
                onSave={(text, color) => void handleSave(text, color)}
                onCancel={() => setFormOpen(false)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Поиск</p>
          <div className="relative">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="По заголовку и тексту"
              className="pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Очистить поиск"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Тип</p>
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as "all" | Kind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              <SelectItem value="announcement">{KIND_LABELS.announcement}</SelectItem>
              <SelectItem value="release">{KIND_LABELS.release}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Сортировка</p>
          <Select value={sort} onValueChange={(v) => setSort(v as SortValue)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Сначала новые</SelectItem>
              <SelectItem value="oldest">Сначала старые</SelectItem>
              <SelectItem value="title">По заголовку</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Группировка</p>
          <Select value={group} onValueChange={(v) => setGroup(v as GroupValue)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без группировки</SelectItem>
              <SelectItem value="kind">По типу</SelectItem>
              <SelectItem value="status">По статусу</SelectItem>
              <SelectItem value="month">По месяцу</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">Оповещений нет</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search || kindFilter !== "all" ? "Ничего не найдено по текущим фильтрам." : "Создайте первое оповещение."}
          </p>
        </div>
      ) : (
        <>
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-4 py-2.5">
              <p className="text-sm">Выбрано: {selected.size}</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Снять выделение
                </Button>
                <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmBulk(true)}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Удалить выбранные
                  </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить выбранные оповещения?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Будут безвозвратно удалены {selected.size} записей вместе с отметками о прочтении
                        пользователей. Действие необратимо.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(event) => {
                          event.preventDefault();
                          void handleDeleteBulk();
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Удалить
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {groups.map(({ key, label, items: groupItems }) => (
              <div key={key || "all"} className="space-y-2">
                {label && (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-muted-foreground">{label}</p>
                    <span className="text-xs text-muted-foreground/70">{groupItems.length}</span>
                  </div>
                )}
                {groupItems.map((item) => {
                  const isSelected = selected.has(item.id);
                  const isArchived = item.archivedAt !== null;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "relative flex items-start gap-3 rounded-xl border p-4 transition-colors",
                        isSelected && "border-primary/50 bg-primary/5",
                        isArchived && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-0 top-0 h-full w-1 rounded-l-xl",
                          CARD_COLOR_CLASSES[item.color] ?? CARD_COLOR_CLASSES.blue,
                        )}
                      />
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(item.id)}
                        className="mt-1"
                        aria-label={`Выбрать «${item.title}»`}
                      />
                      {item.kind === "release" ? (
                        <Sparkles className={cn("mt-0.5 h-4 w-4 shrink-0", !isArchived && "text-primary")} />
                      ) : (
                        <Bell className={cn("mt-0.5 h-4 w-4 shrink-0", !isArchived && "text-primary")} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{item.title}</p>
                          <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
                          {item.severity === "warning" && (
                            <Badge variant="destructive">{SEVERITY_LABELS.warning}</Badge>
                          )}
                          {isArchived && (
                            <Badge variant="secondary">
                              <EyeOff className="mr-1 h-3 w-3" /> В архиве
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(item.publishedAt)}</p>
                        <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-wrap line-clamp-2">
                          {item.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={isArchived ? "Вернуть из архива" : "В архив"}
                          aria-label={isArchived ? "Вернуть из архива" : "В архив"}
                          onClick={() => void handleArchive(item.id)}
                        >
                          {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Редактировать"
                          aria-label="Редактировать"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Удалить"
                          aria-label="Удалить"
                          onClick={() => void handleDelete(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                     </div>
                   );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      <AdminPaginationControls pagination={pagination} />

      {saving && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Eye className="h-4 w-4 animate-spin" /> Сохранение…
        </p>
      )}
    </div>
  );
}
