import { X, Trash2, Edit2, BookOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { NoteDto } from "@/hooks/use-notes";
import { NoteEditor, NoteText, noteColorClass } from "./NoteEditor";

interface Props {
  notes: NoteDto[];
  chapters: Array<{ id: number; title: string }>;
  currentBookId: number;
  onClose: () => void;
  onNavigate: (target: { bookId: number; chapterId: number; positionRaw: string; highlightedText: string | null }) => void;
  onDelete: (noteId: string) => void;
  onUpdate: (noteId: string, noteText: string, color: string) => void;
}

export function NotesPanel({ notes, chapters, currentBookId, onClose, onNavigate, onDelete, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="fixed right-2 top-14 z-50 flex h-[calc(100vh-4rem)] w-[calc(100vw-1rem)] max-w-md flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl sm:right-4">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Заметки</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 overscroll-contain p-2">
        <div className="space-y-2 pr-2">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Нет заметок. Выделите текст в книге — появится меню для создания заметки.
            </p>
          ) : (
            notes.map((note) => {
              const chIdx = chapters.findIndex((c) => c.id === note.chapterId);
              const isSameBook = note.bookId === currentBookId;
              const isEditing = editingId === note.id;

              return (
                <div
                  key={note.id}
                  className={cn("rounded-lg border p-3 transition-colors", noteColorClass(note.color))}
                >
                  <button
                    className="w-full text-left mb-2"
                    onClick={() => {
                      if (!isEditing && (!isSameBook || chIdx >= 0)) {
                        onNavigate({
                          bookId: note.bookId,
                          chapterId: note.chapterId,
                          positionRaw: note.positionRaw,
                          highlightedText: note.highlightedText,
                        });
                        onClose();
                      }
                    }}
                  >
                    {isSameBook ? (
                      <span className="text-xs opacity-60 block">
                        {chIdx >= 0 ? `Глава ${chIdx + 1}` : ""} {chIdx >= 0 ? chapters[chIdx].title : ""}
                      </span>
                    ) : (
                      <span className="text-xs opacity-60 block flex items-center gap-1">
                        <BookOpen className="size-3 shrink-0" />
                        <span className="line-clamp-1">{note.bookTitle ?? "Другая книга цикла"}</span>
                      </span>
                    )}
                    {note.highlightedText && (
                      <p className="text-sm italic text-muted-foreground line-clamp-2 mt-1">
                        «{note.highlightedText}»
                      </p>
                    )}
                  </button>

                  {isEditing ? (
                    <NoteEditor
                      key={note.id}
                      initialText={note.noteText}
                      initialColor={note.color}
                      autoFocus
                      onSave={(noteText, color) => {
                        onUpdate(note.id, noteText, color);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <NoteText className="text-sm" text={note.noteText} />
                      <div className="flex gap-1 mt-2 items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {new Date(note.updatedAt).toLocaleDateString("ru-RU")}
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(note.id)} aria-label="Редактировать">
                            <Edit2 className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(note.id)} aria-label="Удалить">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
