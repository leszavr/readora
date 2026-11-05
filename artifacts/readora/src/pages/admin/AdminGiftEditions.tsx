import { useRef, useState } from "react";
import {
  getGetBookQueryKey,
  getListAdminBooksQueryKey,
  getListGiftEditionsQueryKey,
  useCreateGiftEdition,
  useDeleteGiftEdition,
  useListGiftEditions,
  useUpdateGiftEdition,
  type GiftEdition,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Gift, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { UploadBookDialog } from "@/components/UploadBookDialog";
import { useAuth } from "@/hooks/use-auth";
import { AdminPaginationControls, useAdminListPagination } from "./AdminPagination";
import { EditGiftEditionDialog } from "./EditGiftEditionDialog";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function GiftCover({ edition }: Readonly<{ edition: GiftEdition }>) {
  const [failed, setFailed] = useState(false);
  if (!edition.coverUrl || failed) {
    return (
      <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-muted">
        <BookOpen className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  return <img src={edition.coverUrl} alt={`Обложка «${edition.title}»`} onError={() => setFailed(true)} className="h-24 w-16 shrink-0 rounded bg-muted object-cover" />;
}

export default function AdminGiftEditions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const handledBookIds = useRef(new Set<number>());
  const [deleteEdition, setDeleteEdition] = useState<GiftEdition | null>(null);
  const [editEdition, setEditEdition] = useState<GiftEdition | null>(null);
  const { user } = useAuth();

  const { data: editions = [], isLoading, isError } = useListGiftEditions();
  const createMutation = useCreateGiftEdition();
  const updateMutation = useUpdateGiftEdition();
  const deleteMutation = useDeleteGiftEdition();
  const pagination = useAdminListPagination(editions, "readora.admin.giftEditions.pageSize");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListGiftEditionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminBooksQueryKey() });
  };

  async function markUploadedBook(bookId: number) {
    if (handledBookIds.current.has(bookId)) return;
    handledBookIds.current.add(bookId);
    try {
      const edition = await createMutation.mutateAsync({ data: { bookId, isPublished: true } });
      invalidate();
      toast({ title: "Подарочное издание добавлено", description: `«${edition.title}» будет выдаваться новым пользователям.` });
    } catch (error) {
      toast({ title: "Книга загружена, но не отмечена как подарочная", description: getErrorMessage(error, "Отметьте её в разделе «Книги»."), variant: "destructive" });
    }
  }

  async function updateEdition(edition: GiftEdition, data: { isPublished?: boolean }) {
    try {
      await updateMutation.mutateAsync({ id: edition.id, data });
      invalidate();
    } catch (error) {
      toast({ title: "Не удалось сохранить изменения", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  async function removeEdition() {
    if (!deleteEdition) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteEdition.id });
      invalidate();
      setDeleteEdition(null);
      toast({ title: "Книга убрана из подарочных изданий" });
    } catch (error) {
      toast({ title: "Не удалось убрать книгу", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Подарочные издания · Мировое достояние</h2>
          <p className="text-sm text-muted-foreground">
            Опубликованные книги автоматически добавляются новым пользователям. Остальные могут добавить их из библиотеки.
            Отметить уже загруженную книгу можно в разделе «Книги». Правки названия, описания и обложки увидят только те, кто получит книгу после этого.
          </p>
        </div>
        <Button className="shrink-0 gap-2" onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4" /> Добавить книгу
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center rounded-xl border bg-card py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">Не удалось загрузить подарочные издания.</div>
      ) : editions.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
          <Gift className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Подарочных изданий пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground">Нажмите «Добавить книгу» и загрузите книгу из public domain — или отметьте уже загруженную книгу в разделе «Книги».</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pagination.visibleItems.map((edition) => (
            <article key={edition.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
              <GiftCover edition={edition} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold" title={edition.title}>{edition.title}</h3>
                    <p className="truncate text-sm text-muted-foreground">{edition.author || "Автор не указан"}</p>
                  </div>
                  <Badge variant={edition.isPublished ? "default" : "secondary"} className="shrink-0">{edition.isPublished ? "Выдаётся" : "Снята"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{edition.format.toUpperCase()} · в библиотеках: {edition.copiesCount}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
                <div className="flex min-w-0 items-center gap-2">
                  <Switch
                    id={`gift-published-${edition.id}`}
                    checked={edition.isPublished}
                    disabled={updateMutation.isPending}
                    onCheckedChange={(isPublished) => void updateEdition(edition, { isPublished })}
                    aria-label="Выдавать пользователям"
                  />
                  <Label htmlFor={`gift-published-${edition.id}`} className="whitespace-nowrap text-xs font-normal text-muted-foreground">Выдавать</Label>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    disabled={edition.ownerUserId !== user?.id}
                    title={edition.ownerUserId === user?.id ? "Редактировать" : "Редактировать может только владелец эталона"}
                    onClick={() => setEditEdition(edition)}
                    aria-label={`Редактировать «${edition.title}»`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => setDeleteEdition(edition)} aria-label={`Убрать «${edition.title}»`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
          <AdminPaginationControls pagination={pagination} />
        </div>
      )}

      <UploadBookDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Загрузить подарочное издание"
        onBookUploaded={(bookId) => void markUploadedBook(bookId)}
      />

      <EditGiftEditionDialog
        edition={editEdition}
        onClose={() => setEditEdition(null)}
        onSaved={() => {
          invalidate();
          if (editEdition) void queryClient.invalidateQueries({ queryKey: getGetBookQueryKey(editEdition.bookId) });
          setEditEdition(null);
          toast({ title: "Подарочное издание обновлено" });
        }}
        onError={(message) => toast({ title: "Не удалось сохранить изменения", description: message, variant: "destructive" })}
      />

      <Dialog open={Boolean(deleteEdition)} onOpenChange={(open) => !open && setDeleteEdition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Убрать из подарочных изданий?</DialogTitle>
            <DialogDescription>
              «{deleteEdition?.title}» перестанет выдаваться. Уже выданные копии ({deleteEdition?.copiesCount ?? 0}) останутся у пользователей,
              а книга — в вашей библиотеке. Чтобы временно прекратить выдачу, достаточно выключить переключатель.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEdition(null)}>Отмена</Button>
            <Button variant="destructive" onClick={removeEdition} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Убрать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
