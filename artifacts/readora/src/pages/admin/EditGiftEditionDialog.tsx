import { useEffect, useState } from "react";
import { getGetBookQueryKey, useGetBook, type GiftEdition } from "@workspace/api-client-react";
import { BookOpen, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = Readonly<{
  edition: GiftEdition | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}>;

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  } catch {
    // Оставляем сообщение по умолчанию.
  }
  return "Не удалось сохранить изменения";
}

export function EditGiftEditionDialog({ edition, onClose, onSaved, onError }: Props) {
  const bookId = edition?.bookId ?? 0;
  const { data: book, isLoading } = useGetBook(bookId, { query: { enabled: Boolean(edition), queryKey: getGetBookQueryKey(bookId) } });
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!edition) return;
    setTitle(book?.title ?? edition.title);
    setAuthor(book?.author ?? edition.author ?? "");
    setDescription(book?.description ?? "");
    setCoverFile(null);
    setCoverPreview(null);
  }, [edition, book]);

  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  function pickCover(file: File | undefined) {
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  async function save() {
    if (!edition || !title.trim()) return;
    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("author", author.trim());
    formData.append("description", description.trim());
    if (coverFile) formData.append("cover", coverFile);

    setSaving(true);
    try {
      const response = await fetch(`/api/books/${edition.bookId}`, { method: "PATCH", credentials: "include", body: formData });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  const coverSrc = coverPreview ?? edition?.coverUrl ?? null;

  return (
    <Dialog open={Boolean(edition)} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактировать подарочное издание</DialogTitle>
          <DialogDescription>
            Изменения применятся к эталону и новым выдачам. Уже выданные копии ({edition?.copiesCount ?? 0}) сохранят прежние название, описание и обложку.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-2">
              {coverSrc ? (
                <img src={coverSrc} alt="Обложка" className="h-36 w-24 rounded bg-muted object-cover" />
              ) : (
                <div className="flex h-36 w-24 items-center justify-center rounded bg-muted"><BookOpen className="h-8 w-8 text-muted-foreground" /></div>
              )}
              <input id="gift-cover-upload" type="file" accept="image/*" className="hidden" onChange={(event) => pickCover(event.target.files?.[0])} />
              <Button asChild variant="outline" size="sm" className="gap-1">
                <label htmlFor="gift-cover-upload" className="cursor-pointer"><ImagePlus className="h-4 w-4" /> Обложка</label>
              </Button>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="gift-title">Название</Label>
                <Input id="gift-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gift-author">Автор</Label>
                <Input id="gift-author" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={500} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gift-description">Описание</Label>
                <Textarea id="gift-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Краткое описание книги" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={save} disabled={saving || isLoading || !title.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
