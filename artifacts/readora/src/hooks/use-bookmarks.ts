import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface BookmarkDto {
  id: string;
  userId: number;
  bookId: number;
  chapterId: number;
  positionRaw: string;
  label: string | null;
  selectedText: string | null;
  createdAt: string;
}

async function fetchBookmarks(bookId: number): Promise<BookmarkDto[]> {
  const res = await fetch(`/api/books/${bookId}/bookmarks`, { credentials: "include" });
  if (!res.ok) throw new Error("Не удалось загрузить закладки");
  return res.json();
}

export function useBookmarks(bookId: number) {
  return useQuery({ queryKey: ["bookmarks", bookId], queryFn: () => fetchBookmarks(bookId), enabled: Number.isFinite(bookId) && bookId > 0 });
}

export function useCreateBookmark(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { chapterId: number; positionRaw: string; label?: string | null; selectedText?: string | null }) => {
      const res = await fetch(`/api/books/${bookId}/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Не удалось создать закладку");
      }
      return res.json() as Promise<BookmarkDto>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks", bookId] }),
  });
}

export function useDeleteBookmark(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bookmarkId: string) => {
      const res = await fetch(`/api/books/${bookId}/bookmarks/${bookmarkId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Не удалось удалить закладку");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks", bookId] }),
  });
}
