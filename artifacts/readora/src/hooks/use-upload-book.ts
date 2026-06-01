import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getListBooksQueryKey } from "@workspace/api-client-react";
import { useState } from "react";

export interface UploadJob {
  id: number;
  originalFilename: string;
  fileSize: number;
  format: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: "queued" | "validating" | "parsing" | "saving" | "completed" | "failed";
  progress: number;
  errorMessage: string | null;
  bookId: number | null;
}

export async function fetchUploadJob(jobId: number): Promise<UploadJob> {
  const res = await fetch(`/api/books/upload-jobs/${jobId}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "Не удалось получить статус обработки");
  }
  return data as UploadJob;
}

export function useUploadBook() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: async ({ file, cycleId, cycleName, cycleNumber }: { file: File, cycleId?: number, cycleName?: string, cycleNumber?: number }) => {
      setProgress(0);
      const formData = new FormData();
      formData.append("file", file);
      if (cycleId) formData.append("cycleId", String(cycleId));
      if (cycleName) formData.append("cycleName", cycleName);
      if (cycleNumber) formData.append("cycleNumber", String(cycleNumber));

      return new Promise<UploadJob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/books/upload");

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setProgress(Math.round((event.loaded / event.total) * 100));
        };

        xhr.onload = () => {
          let data: unknown = null;
          try {
            data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            // Сервер должен вернуть JSON, но не маскируем исходный HTTP-статус.
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve(data as UploadJob);
            return;
          }

          const message = data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : "Failed to upload book";
          reject(new Error(message));
        };

        xhr.onerror = () => reject(new Error("Не удалось загрузить файл"));
        xhr.onabort = () => reject(new Error("Загрузка отменена"));
        xhr.send(formData);
      });
    },
    onSettled: () => {
      setProgress(0);
    },
  });

  return {
    ...mutation,
    progress,
    invalidateBooks: () => queryClient.invalidateQueries({ queryKey: getListBooksQueryKey() }),
  };
}
