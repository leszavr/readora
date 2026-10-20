import { useState } from "react";
import {
  getListAdminCatalogEditionsQueryKey,
  getListGiftEditionsQueryKey,
  useCreateGiftEdition,
  useDeleteGiftEdition,
  useListAdminCatalogEditions,
  useListGiftEditions,
  useUpdateGiftEdition,
  type GiftEdition,
  type GiftEditionUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ru } from "date-fns/locale";
import { BookOpen, CalendarDays, Gift, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function toLocalDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(value: string | null | undefined): string {
  const date = toLocalDate(value);
  return date ? date.toLocaleDateString("ru-RU") : "Выберите дату";
}

function formatTime(value: string | null | undefined): string {
  const date = toLocalDate(value);
  return date ? date.toTimeString().slice(0, 5) : "";
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

function AvailabilityControl({
  edition,
  field,
  label,
  disabled,
  onChange,
}: Readonly<{
  edition: GiftEdition;
  field: "availableFrom" | "availableUntil";
  label: string;
  disabled: boolean;
  onChange: (value: string | null) => void;
}>) {
  const [open, setOpen] = useState(false);
  const value = edition[field];
  const selectedDate = toLocalDate(value);

  function selectDate(day: Date | undefined) {
    if (!day) return;
    const current = selectedDate ?? new Date();
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), current.getHours(), current.getMinutes());
    setOpen(false);
    onChange(next.toISOString());
  }

  function saveTime(time: string) {
    if (!selectedDate || !time) return;
    const [hours, minutes] = time.split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return;
    const next = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes);
    onChange(next.toISOString());
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="space-y-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="w-full justify-start font-normal" disabled={disabled}>
              <CalendarDays className="h-4 w-4" />
              <span className="truncate">{formatDate(value)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={selectedDate} onSelect={selectDate} locale={ru} initialFocus />
          </PopoverContent>
        </Popover>
        <div className="flex gap-2">
          <Input
            aria-label={`${label}: время`}
            className="w-full"
            key={`${edition.id}-${field}-${value}`}
            type="time"
            defaultValue={formatTime(value)}
            disabled={disabled || !selectedDate}
            onBlur={(event) => saveTime(event.target.value)}
          />
          {value && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
              Сбросить
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminGiftEditions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteEdition, setDeleteEdition] = useState<GiftEdition | null>(null);
  const [selectedCatalogEditionId, setSelectedCatalogEditionId] = useState("");

  const { data: editions = [], isLoading, isError } = useListGiftEditions();
  const { data: catalogEditions = [] } = useListAdminCatalogEditions();
  const createMutation = useCreateGiftEdition();
  const updateMutation = useUpdateGiftEdition();
  const deleteMutation = useDeleteGiftEdition();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListGiftEditionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminCatalogEditionsQueryKey() });
  };

  async function addToRotation() {
    const catalogEditionId = Number.parseInt(selectedCatalogEditionId, 10);
    if (!Number.isSafeInteger(catalogEditionId) || catalogEditionId <= 0) return;
    try {
      const nextOrder = editions.reduce((max, edition) => Math.max(max, edition.sortOrder), -1) + 1;
      const edition = await createMutation.mutateAsync({ data: { catalogEditionId, sortOrder: Math.min(nextOrder, 10_000), isPublished: true } });
      invalidate();
      setSelectedCatalogEditionId("");
      toast({ title: "Подарочное издание добавлено", description: `«${edition.title}» будет выдаваться новым пользователям.` });
    } catch (error) {
      toast({ title: "Не удалось добавить в выдачу", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  async function updateEdition(edition: GiftEdition, data: GiftEditionUpdate) {
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
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
      toast({ title: "Некорректный порядок", description: "Укажите целое число от 0 до 10000.", variant: "destructive" });
      return;
    }
    void updateEdition(edition, { sortOrder });
  }

  function saveAvailability(edition: GiftEdition, field: "availableFrom" | "availableUntil", value: string | null) {
    if (value && Number.isNaN(new Date(value).getTime())) {
      toast({ title: "Некорректная дата", description: "Укажите дату и время выдачи.", variant: "destructive" });
      return;
    }
    if (value === edition[field]) return;
    void updateEdition(edition, { [field]: value });
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

  const availableCatalogEditions = catalogEditions.filter(
    (edition) => edition.status === "published" && !editions.some((offer) => offer.catalogEditionId === edition.id),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Подарочные издания · Мировое достояние</h2>
          <p className="text-sm text-muted-foreground">
            Добавьте опубликованное каталожное издание в ротацию. Оно автоматически выдаётся новым пользователям;
            уже выданные копии останутся у читателей после отключения или удаления предложения.
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Select value={selectedCatalogEditionId} onValueChange={setSelectedCatalogEditionId}>
            <SelectTrigger className="min-w-0 sm:w-64"><SelectValue placeholder="Издание каталога" /></SelectTrigger>
            <SelectContent>
              {availableCatalogEditions.map((edition) => (
                <SelectItem key={edition.id} value={String(edition.id)}>{edition.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="shrink-0 gap-2" onClick={() => void addToRotation()} disabled={!selectedCatalogEditionId || createMutation.isPending}>
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center rounded-xl border bg-card py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">Не удалось загрузить подарочные издания.</div>
      ) : editions.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
          <Gift className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Подарочных изданий пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground">Сначала создайте и опубликуйте издание в разделе «Каталог», затем добавьте его в ротацию.</p>
        </div>
      ) : (
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          {editions.map((edition) => (
            <article key={edition.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row">
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
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`gift-order-${edition.id}`} className="text-xs text-muted-foreground">Порядок</Label>
                    <div className="w-16 shrink-0">
                      <Input id={`gift-order-${edition.id}`} key={`${edition.id}-${edition.sortOrder}`} type="number" min={0} max={10000} defaultValue={edition.sortOrder} onBlur={(event) => saveSortOrder(edition, event.target.value)} />
                      </div>
                  </div>
                  <div className="space-y-2">
                    <AvailabilityControl edition={edition} field="availableFrom" label="Начало выдачи" disabled={updateMutation.isPending} onChange={(value) => saveAvailability(edition, "availableFrom", value)} />
                    <AvailabilityControl edition={edition} field="availableUntil" label="Окончание выдачи" disabled={updateMutation.isPending} onChange={(value) => saveAvailability(edition, "availableUntil", value)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <div className="flex items-center gap-2">
                      <Switch id={`gift-published-${edition.id}`} checked={edition.isPublished} disabled={updateMutation.isPending} onCheckedChange={(isPublished) => void updateEdition(edition, { isPublished })} aria-label="Выдавать пользователям" />
                      <Label htmlFor={`gift-published-${edition.id}`} className="text-xs font-normal text-muted-foreground">Выдавать</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id={`gift-autogrant-${edition.id}`} checked={edition.autoGrantOnSignup} disabled={updateMutation.isPending} onCheckedChange={(autoGrantOnSignup) => void updateEdition(edition, { autoGrantOnSignup })} aria-label="Выдавать при регистрации" />
                      <Label htmlFor={`gift-autogrant-${edition.id}`} className="text-xs font-normal text-muted-foreground">При регистрации</Label>
                    </div>
                    <div className="ml-auto">
                      <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => setDeleteEdition(edition)} aria-label={`Убрать «${edition.title}»`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={Boolean(deleteEdition)} onOpenChange={(open) => !open && setDeleteEdition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Убрать из подарочных изданий?</DialogTitle>
            <DialogDescription>
              «{deleteEdition?.title}» перестанет выдаваться. Уже выданные копии ({deleteEdition?.copiesCount ?? 0}) останутся у пользователей,
              а каноническое издание останется в каталоге. Чтобы временно прекратить выдачу, достаточно выключить переключатель.
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
