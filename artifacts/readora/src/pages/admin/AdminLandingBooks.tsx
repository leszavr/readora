import { useState, type FormEvent } from "react";
import {
  getListLandingBooksQueryKey,
  useCreateLandingBook,
  useDeleteLandingBook,
  useListLandingBooks,
  useUpdateLandingBook,
  useUpdateLandingBookCover,
  type LandingBook,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function LandingBookForm({
  book,
  onSubmit,
  isPending,
}: Readonly<{
  book: LandingBook;
  onSubmit: (data: { title: string; author: string; description: string; sortOrder: string; isPublished: boolean }) => void;
  isPending: boolean;
}>) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [description, setDescription] = useState(book.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(book.sortOrder));
  const [isPublished, setIsPublished] = useState(book.isPublished);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ title, author, description, sortOrder, isPublished });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="landing-book-title">Название *</Label>
        <Input id="landing-book-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={320} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="landing-book-author">Автор</Label>
        <Input id="landing-book-author" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={320} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="landing-book-description">Описание</Label>
        <Textarea id="landing-book-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={5} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="landing-book-sort-order">Порядок показа</Label>
          <Input id="landing-book-sort-order" type="number" min={0} max={10000} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} required />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:mb-0">
          <Label htmlFor="landing-book-published">Показывать на лендинге</Label>
          <Switch id="landing-book-published" checked={isPublished} onCheckedChange={setIsPublished} />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending || !title.trim()}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function AdminLandingBooks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editBook, setEditBook] = useState<LandingBook | null>(null);
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [replacementCover, setReplacementCover] = useState<File | null>(null);
  const [deleteBook, setDeleteBook] = useState<LandingBook | null>(null);

  const { data: books = [], isLoading, isError } = useListLandingBooks();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListLandingBooksQueryKey() });
  const createMutation = useCreateLandingBook();
  const updateMutation = useUpdateLandingBook();
  const coverMutation = useUpdateLandingBookCover();
  const deleteMutation = useDeleteLandingBook();

  async function createBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookFile || !coverFile) return;

    try {
      await createMutation.mutateAsync({ data: { bookFile, cover: coverFile } });
      invalidate();
      setCreateOpen(false);
      setBookFile(null);
      setCoverFile(null);
      toast({ title: "Карточка создана", description: "Метаданные извлечены, файл книги не сохранён." });
    } catch (error) {
      toast({ title: "Не удалось создать карточку", description: getErrorMessage(error, "Проверьте файлы и повторите попытку."), variant: "destructive" });
    }
  }

  async function saveBook(data: { title: string; author: string; description: string; sortOrder: string; isPublished: boolean }) {
    if (!editBook) return;
    const sortOrder = Number(data.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      toast({ title: "Некорректный порядок", description: "Укажите целое число от 0 до 10000.", variant: "destructive" });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: editBook.id,
        data: {
          title: data.title.trim(),
          author: data.author.trim() || null,
          description: data.description.trim() || null,
          sortOrder,
          isPublished: data.isPublished,
        },
      });
      invalidate();
      setEditBook(null);
      toast({ title: "Карточка сохранена" });
    } catch (error) {
      toast({ title: "Не удалось сохранить карточку", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  async function replaceCover() {
    if (!editBook || !replacementCover) return;
    try {
      const updatedBook = await coverMutation.mutateAsync({ id: editBook.id, data: { cover: replacementCover } });
      invalidate();
      setEditBook(updatedBook);
      setReplacementCover(null);
      toast({ title: "Обложка заменена" });
    } catch (error) {
      toast({ title: "Не удалось заменить обложку", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  async function removeBook() {
    if (!deleteBook) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteBook.id });
      invalidate();
      setDeleteBook(null);
      toast({ title: "Карточка удалена" });
    } catch (error) {
      toast({ title: "Не удалось удалить карточку", description: getErrorMessage(error, "Повторите попытку."), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Книги лендинга</h2>
          <p className="text-sm text-muted-foreground">Файл FB2 или EPUB нужен только для извлечения метаданных и не сохраняется.</p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Добавить книгу
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center rounded-xl border bg-card py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">Не удалось загрузить книги лендинга.</div>
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
          <ImagePlus className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Подборка пока пуста</p>
          <p className="mt-1 text-sm text-muted-foreground">Добавьте книгу с готовой обложкой, чтобы подготовить её к публикации.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <article key={book.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <img src={book.coverUrl} alt={`Обложка «${book.title}»`} className="aspect-[2/3] w-full bg-muted object-cover" />
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold" title={book.title}>{book.title}</h3>
                    <p className="truncate text-sm text-muted-foreground">{book.author || "Автор не указан"}</p>
                  </div>
                  <Badge variant={book.isPublished ? "default" : "secondary"}>{book.isPublished ? "Опубликована" : "Черновик"}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Порядок: {book.sortOrder}</span>
                  <span>{new Date(book.updatedAt).toLocaleDateString("ru-RU")}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-2" onClick={() => setEditBook(book)}>
                    <Pencil className="h-4 w-4" /> Изменить
                  </Button>
                  <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteBook(book)} aria-label={`Удалить «${book.title}»`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) {
          setBookFile(null);
          setCoverFile(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить книгу лендинга</DialogTitle>
            <DialogDescription>Загрузите файл книги для метаданных и отдельную готовую обложку. Текст и исходный файл книги не сохраняются.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createBook} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="landing-book-file">Файл книги (FB2 или EPUB) *</Label>
              <Input id="landing-book-file" type="file" accept=".fb2,.epub" onChange={(event) => setBookFile(event.target.files?.[0] ?? null)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landing-cover-file">Готовая обложка *</Label>
              <Input id="landing-cover-file" type="file" accept="image/*" onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={!bookFile || !coverFile || createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Извлечь метаданные
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editBook)} onOpenChange={(open) => !open && setEditBook(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Изменить книгу лендинга</DialogTitle>
          </DialogHeader>
          {editBook && (
            <>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <img src={editBook.coverUrl} alt="Текущая обложка" className="h-20 w-14 rounded object-cover" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="replacement-landing-cover">Заменить готовую обложку</Label>
                  <div className="flex gap-2">
                    <Input id="replacement-landing-cover" type="file" accept="image/*" onChange={(event) => setReplacementCover(event.target.files?.[0] ?? null)} />
                    <Button type="button" variant="outline" size="icon" disabled={!replacementCover || coverMutation.isPending} onClick={replaceCover} aria-label="Заменить обложку">
                      {coverMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <LandingBookForm key={editBook.id} book={editBook} onSubmit={saveBook} isPending={updateMutation.isPending} />
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteBook)} onOpenChange={(open) => !open && setDeleteBook(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить карточку?</DialogTitle>
            <DialogDescription>Будет удалена карточка «{deleteBook?.title}» и её обложка, если она больше не используется другой карточкой.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBook(null)}>Отмена</Button>
            <Button variant="destructive" onClick={removeBook} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
