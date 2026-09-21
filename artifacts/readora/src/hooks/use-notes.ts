import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface NoteDto {
  id: string;
  userId: number;
  bookId: number;
  chapterId: number;
  positionRaw: string;
  highlightedText: string | null;
  noteText: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

async function fetchNotes(bookId: number): Promise<NoteDto[]> {
  const res = await fetch(`/api/books/${bookId}/notes`, { credentials: "include" });
  if (!res.ok) throw new Error("Не удалось загрузить заметки");
  return res.json();
}

export function useNotes(bookId: number) {
  return useQuery({ queryKey: ["notes", bookId], queryFn: () => fetchNotes(bookId), enabled: Number.isFinite(bookId) && bookId > 0 });
}

export function useCreateNote(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { chapterId: number; positionRaw: string; highlightedText?: string | null; noteText: string; color?: string }) => {
      const res = await fetch(`/api/books/${bookId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Не удалось создать заметку");
      }
      return res.json() as Promise<NoteDto>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", bookId] }),
  });
}

export function useUpdateNote(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, noteText, color }: { noteId: string; noteText?: string; color?: string }) => {
      const res = await fetch(`/api/books/${bookId}/notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ noteText, color }),
      });
      if (!res.ok) throw new Error("Не удалось обновить заметку");
      return res.json() as Promise<NoteDto>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", bookId] }),
  });
}

export function useDeleteNote(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => {
      const res = await fetch(`/api/books/${bookId}/notes/${noteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Не удалось удалить заметку");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", bookId] }),
  });
}
