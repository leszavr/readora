import { X, Trash2, Edit2, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { NoteDto } from "@/hooks/use-notes";

interface Props {
  notes: NoteDto[];
  chapters: Array<{ id: number; title: string }>;
  onClose: () => void;
  onNavigate: (chapterIndex: number, positionRaw: string, highlightedText: string | null) => void;
  onDelete: (noteId: string) => void;
  onUpdate: (noteId: string, noteText: string, color: string) => void;
}

const COLOR_OPTIONS = [
  { value: "yellow", label: "Желтый", class: "bg-yellow-100 dark:bg-yellow-900/30" },
  { value: "green", label: "Зеленый", class: "bg-green-100 dark:bg-green-900/30" },
  { value: "blue", label: "Синий", class: "bg-blue-100 dark:bg-blue-900/30" },
  { value: "pink", label: "Розовый", class: "bg-pink-100 dark:bg-pink-900/30" },
  { value: "purple", label: "Фиолетовый", class: "bg-purple-100 dark:bg-purple-900/30" },
];

export function NotesPanel({ notes, chapters, onClose, onNavigate, onDelete, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editColor, setEditColor] = useState("yellow");

  const handleEdit = (note: NoteDto) => {
    setEditingId(note.id);
    setEditText(note.noteText);
    setEditColor(note.color);
  };

  const handleSave = (noteId: string) => {
    onUpdate(noteId, editText.trim(), editColor);
    setEditingId(null);
  };

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
              const chTitle = chIdx >= 0 ? chapters[chIdx].title : `Глава ${note.chapterId}`;
              const colorClass = COLOR_OPTIONS.find((c) => c.value === note.color)?.class ?? COLOR_OPTIONS[0].class;
              const isEditing = editingId === note.id;

              return (
                <div
                  key={note.id}
                  className={cn("rounded-lg border p-3 transition-colors", colorClass)}
                >
                  <button
                    className="w-full text-left mb-2"
                    onClick={() => {
                      if (!isEditing && chIdx >= 0) {
                        onNavigate(chIdx, note.positionRaw, note.highlightedText);
                        onClose();
                      }
                    }}
                  >
                    <span className="text-xs opacity-60 block">
                      {chIdx >= 0 ? `Глава ${chIdx + 1}` : ""} {chTitle}
                    </span>
                    {note.highlightedText && (
                      <p className="text-sm italic text-muted-foreground line-clamp-2 mt-1">
                        «{note.highlightedText}»
                      </p>
                    )}
                  </button>

                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="min-h-[80px] text-sm"
                        maxLength={2000}
                      />
                      <div className="flex gap-1 flex-wrap">
                        {COLOR_OPTIONS.map((c) => (
                          <button
                            key={c.value}
                            onClick={() => setEditColor(c.value)}
                            className={cn("size-6 rounded-full border-2", c.class, editColor === c.value && "ring-2 ring-primary")}
                            title={c.label}
                            aria-label={c.label}
                          />
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => handleSave(note.id)}>
                          <Check className="size-4" /> Сохранить
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap">{note.noteText}</p>
                      <div className="flex gap-1 mt-2 items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {new Date(note.updatedAt).toLocaleDateString("ru-RU")}
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(note)} aria-label="Редактировать">
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
