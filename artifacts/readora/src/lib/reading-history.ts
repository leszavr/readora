import type { ReadingHistoryEntry } from "@workspace/api-client-react";

export type HistoryGroupBy = "none" | "date" | "author" | "genre" | "cycle";

export const HISTORY_DELETE_BATCH_SIZE = 500;

export const HISTORY_COMMENT_MAX_LENGTH = 255;

export interface HistoryGroup {
  key: string;
  label: string;
  items: ReadingHistoryEntry[];
}

export type HistoryDeletionPlan = { mode: "clear" } | { mode: "bulk"; batches: number[][] };

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function toLocalDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatHistoryMonthLabel(completedAt: string): string {
  const date = toLocalDate(completedAt);
  return date ? `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}` : "";
}

export function formatHistoryDate(completedAt: string): string {
  const date = toLocalDate(completedAt);
  return date ? `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}` : "";
}

function resolveGroup(entry: ReadingHistoryEntry, groupBy: Exclude<HistoryGroupBy, "none">): { key: string; label: string } {
  switch (groupBy) {
    case "date": {
      const date = toLocalDate(entry.completedAt);
      return date
        ? { key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`, label: formatHistoryMonthLabel(entry.completedAt) }
        : { key: "date:", label: "Дата неизвестна" };
    }
    case "author":
      return entry.author
        ? { key: `author:${entry.author}`, label: entry.author }
        : { key: "author:", label: "Неизвестный автор" };
    case "genre":
      return entry.genreName
        ? { key: `genre:${entry.genreName}`, label: entry.genreName }
        : { key: "genre:", label: "Без жанра" };
    case "cycle":
      return entry.cycleName
        ? { key: `cycle:${entry.cycleName}`, label: entry.cycleName }
        : { key: "cycle:", label: "Вне цикла" };
  }
}

export function groupHistoryEntries(entries: readonly ReadingHistoryEntry[], groupBy: HistoryGroupBy): HistoryGroup[] {
  if (groupBy === "none") return [];

  return entries.reduce<HistoryGroup[]>((groups, entry) => {
    const { key, label } = resolveGroup(entry, groupBy);
    const previous = groups[groups.length - 1];
    if (previous?.key === key) {
      previous.items.push(entry);
    } else {
      groups.push({ key, label, items: [entry] });
    }
    return groups;
  }, []);
}

export function planHistoryDeletion(selectedIds: readonly number[], totalEntries: number): HistoryDeletionPlan {
  if (selectedIds.length > 0 && selectedIds.length === totalEntries) return { mode: "clear" };

  const batches: number[][] = [];
  for (let start = 0; start < selectedIds.length; start += HISTORY_DELETE_BATCH_SIZE) {
    batches.push(selectedIds.slice(start, start + HISTORY_DELETE_BATCH_SIZE));
  }
  return { mode: "bulk", batches };
}
