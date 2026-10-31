import { useQuery } from "@tanstack/react-query";

interface AnnotationBase {
  id: string;
  bookId: number;
  chapterId: number;
  positionRaw: string;
  createdAt: string;
  bookTitle: string | null;
  bookAuthor: string | null;
  cycleName: string | null;
  chapterTitle: string | null;
  chapterIndex: number | null;
}

export interface AnnotationNoteDto extends AnnotationBase {
  highlightedText: string | null;
  noteText: string;
  color: string;
  updatedAt: string;
}

export interface AnnotationBookmarkDto extends AnnotationBase {
  label: string | null;
  selectedText: string | null;
}

export function useAllNotes(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["annotations", "notes", q],
    queryFn: async (): Promise<AnnotationNoteDto[]> => {
      const res = await fetch(`/api/annotations/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить заметки");
      return res.json();
    },
    enabled,
  });
}

export function useAllBookmarks(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["annotations", "bookmarks", q],
    queryFn: async (): Promise<AnnotationBookmarkDto[]> => {
      const res = await fetch(`/api/annotations/bookmarks${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить закладки");
      return res.json();
    },
    enabled,
  });
}
