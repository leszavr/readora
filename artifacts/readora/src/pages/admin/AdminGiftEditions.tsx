import { useRef, useState } from "react";
import {
  getListAdminBooksQueryKey,
  getListGiftEditionsQueryKey,
  useCreateGiftEdition,
  useDeleteGiftEdition,
  useListGiftEditions,
  useUpdateGiftEdition,
  type GiftEdition,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Gift, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { UploadBookDialog } from "@/components/UploadBookDialog";

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

  const { data: editions = [], isLoading, isError } = useListGiftEditions();
  const createMutation = useCreateGiftEdition();
  const updateMutation = useUpdateGiftEdition();
  const deleteMutation = useDeleteGiftEdition();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListGiftEditionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminBooksQueryKey() });
  };

  async function markUploadedBook(bookId: number) {
    if (handledBookIds.current.has(bookId)) return;
    handledBookIds.current.add(bookId);
    try {
      const nextOrder = editions.reduce((max, edition) => Math.max(max, edition.sortOrder), -1) + 1;
      const edition = await createMutation.mutateAsync({ data: { bookId, sortOrder: Math.min(nextOrder, 10000), isPublished: true } });
      invalidate();
      toast({ title: "Подарочное издание добавлено", description: `«${edition.title}» будет выдаваться новым пользователям.` });
    } catch (error) {
      toast({ title: "Книга загружена, но не отмечена как подарочная", description: getErrorMessage(error, "Отметьте её в разделе «Книги»."), variant: "destructive" });
    }
  }

  async function updateEdition(edition: GiftEdition, data: { sortOrder?: number; isPublished?: boolean }) {
    try {
      await updateMutation.mutateAsync({ id: edition.id, data });
      invalidate();
    } catch (error) {
      toast({ title: "Не удалось сохранить изменения", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  function saveSortOrder(edition: GiftEdition, value: string) {
    const sortOrder = Number(value);
    if (sortOrder === edition.sortOrder) return;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      toast({ title: "Некорректный порядок", description: "Укажите целое число от 0 до 10000.", variant: "destructive" });
      return;
    }
    void updateEdition(edition, { sortOrder });
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
            Отметить уже загруженную книгу можно в разделе «Книги». Название, описание и обложку эталона меняйте на странице книги в своей библиотеке — изменения увидят только те, кто получит книгу после этого.
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
          <p className="mt-1 text-sm text-muted-foreground">Нажмите «Добавить книгу» и загрузите FB2 или EPUB из public domain — или отметьте уже загруженную книгу в разделе «Книги».</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {editions.map((edition) => (
            <article key={edition.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm">
              <GiftCover edition={edition} />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold" title={edition.title}>{edition.title}</h3>
                    <p className="truncate text-sm text-muted-foreground">{edition.author || "Автор не указан"}</p>
                  </div>
                  <Badge variant={edition.isPublished ? "default" : "secondary"}>{edition.isPublished ? "Выдаётся" : "Снята"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{edition.format.toUpperCase()} · в библиотеках: {edition.copiesCount}</p>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`gift-order-${edition.id}`} className="text-xs text-muted-foreground">Порядок</Label>
                  <div className="w-20">
                    <Input
                      id={`gift-order-${edition.id}`}
                      key={`${edition.id}-${edition.sortOrder}`}
                      type="number"
                      min={0}
                      max={10000}
                      defaultValue={edition.sortOrder}
                      onBlur={(event) => saveSortOrder(edition, event.target.value)}
                    />
                  </div>
                  <div className="ml-auto flex items-center">
                    <Switch
                      checked={edition.isPublished}
                      disabled={updateMutation.isPending}
                      onCheckedChange={(isPublished) => void updateEdition(edition, { isPublished })}
                      aria-label="Выдавать пользователям"
                    />
                  </div>
                  <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive" onClick={() => setDeleteEdition(edition)} aria-label={`Убрать «${edition.title}»`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <UploadBookDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Загрузить подарочное издание"
        onBookUploaded={(bookId) => void markUploadedBook(bookId)}
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
