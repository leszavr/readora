import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetBook,
  useUpdateBook,
  useDeleteBook,
  useListGenres,
  useListCycles,
  useGetProgress,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BookOpen, Edit2, Trash2, ArrowLeft, Calendar, Globe,
  Layers, FileText, Tag, Loader2, AlertCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListBooksQueryKey } from "@workspace/api-client-react";

const STATUS_LABELS: Record<string, string> = {
  reading: "Читаю",
  finished: "Прочитано",
  not_started: "Не читал",
  abandoned: "Заброшено",
};

export default function BookPage() {
  const [, params] = useRoute("/book/:id");
  const bookId = parseInt(params?.id ?? "0", 10);
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: book, isLoading, error } = useGetBook(bookId);
  const { data: progress } = useGetProgress(bookId);
  const { data: genres = [] } = useListGenres();
  const { data: cycles = [] } = useListCycles();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLang, setEditLang] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editGenreIds, setEditGenreIds] = useState<number[]>([]);

  const { mutate: updateBook, isPending: updating } = useUpdateBook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBooksQueryKey() });
        setEditOpen(false);
      },
    },
  });

  const { mutate: deleteBook, isPending: deleting } = useDeleteBook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBooksQueryKey() });
        navigate("/library");
      },
    },
  });

  // Wrap delete to match {id} signature
  function handleDelete() {
    deleteBook({ id: bookId });
  }

  function openEdit() {
    if (!book) return;
    setEditTitle(book.title ?? "");
    setEditAuthor(book.author ?? "");
    setEditDesc(book.description ?? "");
    setEditLang(book.language ?? "");
    setEditYear(book.publicationYear ? String(book.publicationYear) : "");
    setEditGenreIds(book.genres?.map((g: { id: number }) => g.id) ?? []);
    setEditOpen(true);
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    updateBook({
      id: bookId,
      data: {
        title: editTitle,
        author: editAuthor || undefined,
        description: editDesc || undefined,
        language: editLang || undefined,
        publicationYear: editYear ? parseInt(editYear) : undefined,
        genreIds: editGenreIds,
      },
    });
  }

  function toggleGenre(id: number) {
    setEditGenreIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  if (isLoading) {
    return (
      <ProtectedRoute>
        <Layout>
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </Layout>
      </ProtectedRoute>
    );
  }

  if (error || !book) {
    return (
      <ProtectedRoute>
        <Layout>
          <div className="max-w-2xl mx-auto px-4 py-16 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Книга не найдена</h2>
            <Link href="/library">
              <Button variant="outline">Вернуться в библиотеку</Button>
            </Link>
          </div>
        </Layout>
      </ProtectedRoute>
    );
  }

  const readStatus = progress?.readingStatus ?? "not_started";
  const progressPct = progress?.progressPercent ?? 0;

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  };

  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Back */}
          <Link href="/library">
            <Button variant="ghost" size="sm" className="gap-2 mb-6 -ml-2">
              <ArrowLeft className="w-4 h-4" /> Назад в библиотеку
            </Button>
          </Link>

          <div className="flex flex-col md:flex-row gap-8">
            {/* Cover */}
            <div className="md:w-56 shrink-0">
              <div className="aspect-[2/3] bg-muted rounded-xl overflow-hidden shadow-md">
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                    <BookOpen className="w-12 h-12 text-primary/40" />
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 mb-1">
                <h1 className="text-2xl font-bold leading-tight">{book.title}</h1>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="icon" onClick={openEdit}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {book.author && (
                <p className="text-muted-foreground mb-4">{book.author}</p>
              )}

              {/* Meta */}
              <div className="flex flex-wrap gap-3 mb-4">
                <Badge variant="outline" className="gap-1">
                  <FileText className="w-3 h-3" />
                  {book.format?.toUpperCase()}
                </Badge>
                {book.language && (
                  <Badge variant="outline" className="gap-1">
                    <Globe className="w-3 h-3" />
                    {book.language}
                  </Badge>
                )}
                {book.publicationYear && (
                  <Badge variant="outline" className="gap-1">
                    <Calendar className="w-3 h-3" />
                    {book.publicationYear}
                  </Badge>
                )}
                {book.chapterCount != null && (
                  <Badge variant="outline" className="gap-1">
                    <Layers className="w-3 h-3" />
                    {book.chapterCount} глав
                  </Badge>
                )}
                {book.fileSize && (
                  <Badge variant="outline">
                    {formatFileSize(book.fileSize)}
                  </Badge>
                )}
              </div>

              {/* Genres */}
              {(book.genres ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {(book.genres ?? []).map((g: { id: number; name: string }) => (
                    <Badge key={g.id} className="gap-1 text-xs">
                      <Tag className="w-3 h-3" />{g.name}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Reading progress */}
              <div className="bg-muted/50 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Прогресс чтения</span>
                  <span className="text-sm text-muted-foreground">{STATUS_LABELS[readStatus]}</span>
                </div>
                {progressPct > 0 ? (
                  <>
                    <Progress value={progressPct} className="h-2 mb-1" />
                    <p className="text-xs text-muted-foreground">{Math.round(progressPct)}% прочитано</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Чтение не начато</p>
                )}
              </div>

              {/* Description */}
              {book.description && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-4">{book.description}</p>
              )}

              {/* Cycle */}
              {book.cycleName && (
                <p className="text-sm text-muted-foreground mb-4">
                  Цикл: <span className="font-medium text-foreground">{book.cycleName}</span>
                  {book.cycleNumber ? ` (#${book.cycleNumber})` : ""}
                </p>
              )}

              {/* Read button */}
              <Link href={`/reader/${book.id}`}>
                <Button className="gap-2" size="lg">
                  <BookOpen className="w-5 h-5" />
                  {readStatus === "not_started" ? "Начать читать" : "Продолжить чтение"}
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Edit dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Редактировать книгу</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Автор</Label>
                <Input value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} placeholder="Имя автора" />
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} placeholder="Краткое описание книги" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Язык</Label>
                  <Input value={editLang} onChange={(e) => setEditLang(e.target.value)} placeholder="ru" maxLength={5} />
                </div>
                <div className="space-y-2">
                  <Label>Год издания</Label>
                  <Input value={editYear} onChange={(e) => setEditYear(e.target.value)} placeholder="2024" type="number" min="1000" max="2100" />
                </div>
              </div>
              {genres.length > 0 && (
                <div className="space-y-2">
                  <Label>Жанры</Label>
                  <div className="flex flex-wrap gap-2">
                    {genres.map((g: { id: number; name: string }) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggleGenre(g.id)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          editGenreIds.includes(g.id)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary/50"
                        }`}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
                <Button type="submit" disabled={updating}>
                  {updating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete dialog */}
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Удалить книгу?</DialogTitle>
              <DialogDescription>
                Книга "{book.title}" будет удалена из библиотеки. Это действие нельзя отменить.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Отмена</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Удалить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Layout>
    </ProtectedRoute>
  );
}
