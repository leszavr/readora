import { useEffect, useState } from "react";
import {
  getListAdminCatalogEditionsQueryKey,
  useListAdminCatalogEditions,
  useListGenres,
  useReplaceCatalogEditionCover,
  useUpdateCatalogEdition,
  useWithdrawCatalogEdition,
  type CatalogAdminEdition,
  type CatalogEditionUpdateStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckSquare, ImagePlus, Landmark, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UploadBookDialog } from "@/components/UploadBookDialog";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<CatalogEditionUpdateStatus, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  hidden: "Скрыто",
  withdrawn: "Отозвано",
};

function errorMessage(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}

function EditionCover({ edition }: Readonly<{ edition: CatalogAdminEdition }>) {
  const [failed, setFailed] = useState(false);
  if (!edition.coverUrl || failed) {
    return <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-muted"><BookOpen className="h-6 w-6 text-muted-foreground" /></div>;
  }
  return <img src={edition.coverUrl} alt={`Обложка «${edition.title}»`} className="h-24 w-16 shrink-0 rounded bg-muted object-cover" onError={() => setFailed(true)} />;
}

export default function AdminCatalogEditions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogAdminEdition | null>(null);
  const [withdrawing, setWithdrawing] = useState<CatalogAdminEdition | null>(null);
  const { data: editions = [], isLoading, isError } = useListAdminCatalogEditions();
  const withdrawMutation = useWithdrawCatalogEdition();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminCatalogEditionsQueryKey() });
  };

  async function withdraw() {
    if (!withdrawing) return;
    try {
      await withdrawMutation.mutateAsync({ id: withdrawing.id });
      invalidate();
      setWithdrawing(null);
      toast({ title: "Издание отозвано из каталога" });
    } catch (error) {
      toast({ title: "Не удалось отозвать издание", description: errorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Каталог изданий</h2>
          <p className="text-sm text-muted-foreground">Канонические файлы не принадлежат личной библиотеке. Изменения влияют на каталог и новые выдачи.</p>
        </div>
        <Button className="shrink-0 gap-2" onClick={() => setUploadOpen(true)}><Plus className="h-4 w-4" /> Загрузить в каталог</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center rounded-xl border bg-card py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">Не удалось загрузить каталог.</div>
      ) : editions.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
          <Landmark className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Каталог пока пуст</p>
          <p className="mt-1 text-sm text-muted-foreground">Загрузите FB2 или EPUB: после обработки будет создан черновик издания.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {editions.map((edition) => (
            <article key={edition.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm">
              <EditionCover edition={edition} />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="truncate font-semibold">{edition.title}</h3><p className="truncate text-sm text-muted-foreground">{edition.author || "Автор не указан"}</p></div>
                  <Badge variant={edition.status === "published" ? "default" : "secondary"}>{STATUS_LABELS[edition.status]}</Badge>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{edition.description || "Без описания"}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{edition.format.toUpperCase()}</span><span>Копий: {edition.copiesCount}</span>
                  {edition.isLandingFeatured && <span className="text-primary">На витрине · #{edition.landingFeaturedSortOrder}</span>}
                  {edition.autoGrantOnSignup && <span className="text-primary">Выдаётся при регистрации</span>}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => setEditing(edition)}><Pencil className="h-4 w-4" /> Изменить</Button>
                  {edition.status !== "withdrawn" && <Button size="icon" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setWithdrawing(edition)} aria-label={`Отозвать «${edition.title}»`}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <UploadBookDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Загрузить каталожное издание"
        catalogSource
        onBookUploaded={() => {
          invalidate();
          toast({ title: "Черновик каталога создан", description: "Проверьте метаданные и опубликуйте издание." });
        }}
      />
      <EditCatalogEditionDialog edition={editing} onClose={() => setEditing(null)} onSaved={() => { invalidate(); setEditing(null); }} />
      <Dialog open={Boolean(withdrawing)} onOpenChange={(open) => !open && setWithdrawing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Отозвать издание из каталога?</DialogTitle><DialogDescription>Издание больше не будет доступно в каталоге. Уже добавленные пользователями книги и их прогресс сохранятся.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setWithdrawing(null)}>Отмена</Button><Button variant="destructive" onClick={() => void withdraw()} disabled={withdrawMutation.isPending}>{withdrawMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Отозвать</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditCatalogEditionDialog({ edition, onClose, onSaved }: Readonly<{ edition: CatalogAdminEdition | null; onClose: () => void; onSaved: () => void }>) {
  const { toast } = useToast();
  const { data: genres = [] } = useListGenres();
  const updateMutation = useUpdateCatalogEdition();
  const coverMutation = useReplaceCatalogEditionCover();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("");
  const [publicationYear, setPublicationYear] = useState("");
  const [genreIds, setGenreIds] = useState<number[]>([]);
  const [primaryGenreId, setPrimaryGenreId] = useState("");
  const [status, setStatus] = useState<CatalogEditionUpdateStatus>("draft");
  const [featured, setFeatured] = useState(false);
  const [featuredOrder, setFeaturedOrder] = useState("0");
  const [autoGrantOnSignup, setAutoGrantOnSignup] = useState(false);
  const [cover, setCover] = useState<File | null>(null);

  useEffect(() => {
    if (!edition) return;
    setTitle(edition.title);
    setAuthor(edition.author ?? "");
    setDescription(edition.description ?? "");
    setLanguage(edition.language ?? "");
    setPublicationYear(edition.publicationYear?.toString() ?? "");
    setGenreIds(edition.genres.map((genre) => genre.id));
    setPrimaryGenreId(edition.primaryGenre?.id?.toString() ?? "none");
    setStatus(edition.status);
    setFeatured(edition.isLandingFeatured);
    setFeaturedOrder(String(edition.landingFeaturedSortOrder));
    setAutoGrantOnSignup(edition.autoGrantOnSignup);
    setCover(null);
  }, [edition]);

  function toggleGenre(id: number, checked: boolean) {
    setGenreIds((current) => checked ? [...new Set([...current, id])] : current.filter((genreId) => genreId !== id));
  }

  async function save() {
    if (!edition || !title.trim()) return;
    const year = publicationYear.trim() === "" ? null : Number.parseInt(publicationYear, 10);
    const order = Number.parseInt(featuredOrder, 10);
    if ((year !== null && (!Number.isInteger(year) || year < 0 || year > 9999)) || !Number.isInteger(order) || order < 0 || order > 10_000) {
      toast({ title: "Проверьте год издания и порядок витрины", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: edition.id,
        data: {
          title: title.trim(),
          author: author.trim() || null,
          description: description.trim() || null,
          language: language.trim() || null,
          publicationYear: year,
          genreIds,
          primaryGenreId: primaryGenreId === "none" ? null : Number.parseInt(primaryGenreId, 10),
          status,
          isLandingFeatured: featured,
          landingFeaturedSortOrder: order,
          autoGrantOnSignup,
        },
      });
      if (cover) await coverMutation.mutateAsync({ id: edition.id, data: { cover } });
      toast({ title: "Издание сохранено" });
      onSaved();
    } catch (error) {
      toast({ title: "Не удалось сохранить издание", description: errorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  const saving = updateMutation.isPending || coverMutation.isPending;
  return (
    <Dialog open={Boolean(edition)} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Редактировать каталожное издание</DialogTitle><DialogDescription>Опубликованное издание появится в пользовательском каталоге. Уже выданные копии сохраняют свои метаданные.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="catalog-title">Название</Label><Input id="catalog-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} /></div>
          <div className="space-y-2"><Label htmlFor="catalog-author">Автор</Label><Input id="catalog-author" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={500} /></div>
          <div className="space-y-2"><Label htmlFor="catalog-language">Язык</Label><Input id="catalog-language" value={language} onChange={(event) => setLanguage(event.target.value)} maxLength={100} /></div>
          <div className="space-y-2"><Label htmlFor="catalog-year">Год издания</Label><Input id="catalog-year" type="number" min={0} max={9999} value={publicationYear} onChange={(event) => setPublicationYear(event.target.value)} /></div>
          <div className="space-y-2"><Label>Статус</Label><Select value={status} onValueChange={(value) => setStatus(value as CatalogEditionUpdateStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="catalog-description">Описание</Label><Textarea id="catalog-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={10000} rows={4} /></div>
          <div className="space-y-2"><Label>Основной жанр</Label><Select value={primaryGenreId} onValueChange={setPrimaryGenreId}><SelectTrigger><SelectValue placeholder="Не указан" /></SelectTrigger><SelectContent><SelectItem value="none">Не указан</SelectItem>{genres.map((genre) => <SelectItem key={genre.id} value={String(genre.id)}>{genre.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="catalog-cover">Новая обложка</Label><Input id="catalog-cover" type="file" accept="image/*" onChange={(event) => setCover(event.target.files?.[0] ?? null)} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Жанры</Label><div className="grid max-h-36 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-3">{genres.map((genre) => <label key={genre.id} className="flex items-center gap-2 text-sm"><Checkbox checked={genreIds.includes(genre.id)} onCheckedChange={(checked) => toggleGenre(genre.id, checked === true)} /><span className="truncate">{genre.name}</span></label>)}</div></div>
          <div className="flex items-center gap-2"><Switch id="catalog-featured" checked={featured} onCheckedChange={setFeatured} /><Label htmlFor="catalog-featured" className="flex items-center gap-1"><CheckSquare className="h-4 w-4" /> Показывать на витрине</Label></div>
          <div className="space-y-2"><Label htmlFor="catalog-featured-order">Порядок на витрине</Label><Input id="catalog-featured-order" type="number" min={0} max={10000} value={featuredOrder} onChange={(event) => setFeaturedOrder(event.target.value)} disabled={!featured} /></div>
          <div className="flex items-center gap-2 sm:col-span-2"><Switch id="catalog-auto-grant" checked={autoGrantOnSignup} onCheckedChange={setAutoGrantOnSignup} /><Label htmlFor="catalog-auto-grant">Выдавать при регистрации</Label></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button><Button onClick={() => void save()} disabled={saving || !title.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
