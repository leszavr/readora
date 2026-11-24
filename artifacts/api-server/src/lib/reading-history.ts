import { z } from "zod/v4";

export const READING_HISTORY_COMMENT_MAX_LENGTH = 255;

const listQuerySchema = z.object({
  search: z.string().trim().max(200).transform((value) => value || undefined).optional(),
  sortBy: z.enum(["completedAt", "title", "author"]).default("completedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  groupBy: z.enum(["none", "date", "author", "genre", "cycle"]).default("none"),
});

export type ReadingHistorySortBy = z.infer<typeof listQuerySchema>["sortBy"];
export type ReadingHistorySortDir = z.infer<typeof listQuerySchema>["sortDir"];
export type ReadingHistoryGroupBy = z.infer<typeof listQuerySchema>["groupBy"];

export interface ReadingHistoryListParams {
  search: string | undefined;
  sortBy: ReadingHistorySortBy;
  sortDir: ReadingHistorySortDir;
  groupBy: ReadingHistoryGroupBy;
}

export type ReadingHistorySortField = ReadingHistorySortBy | "genre" | "cycle";

export interface ReadingHistorySortKey {
  field: ReadingHistorySortField;
  dir: ReadingHistorySortDir;
}

export type ReadingHistoryCommentResult = { valid: true; comment: string | null } | { valid: false; error: string };
export type ReadingHistoryListQueryResult = { valid: true; params: ReadingHistoryListParams } | { valid: false; error: string };

const commentSchema = z.string().trim().max(READING_HISTORY_COMMENT_MAX_LENGTH);

export function normalizeReadingHistoryComment(value: unknown): ReadingHistoryCommentResult {
  if (value === null || value === undefined) return { valid: true, comment: null };
  if (typeof value !== "string") return { valid: false, error: "Некорректный комментарий" };

  const parsed = commentSchema.safeParse(value);
  if (!parsed.success) {
    return { valid: false, error: `Комментарий — не более ${READING_HISTORY_COMMENT_MAX_LENGTH} символов` };
  }

  return { valid: true, comment: parsed.data.length > 0 ? parsed.data : null };
}

export function parseReadingHistoryListQuery(query: Record<string, unknown>): ReadingHistoryListQueryResult {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) return { valid: false, error: "Некорректные параметры списка истории" };

  return {
    valid: true,
    params: {
      search: parsed.data.search,
      sortBy: parsed.data.sortBy,
      sortDir: parsed.data.sortDir,
      groupBy: parsed.data.groupBy,
    },
  };
}

export function resolveReadingHistorySort(params: ReadingHistoryListParams): ReadingHistorySortKey[] {
  const sort: ReadingHistorySortKey = { field: params.sortBy, dir: params.sortDir };
  const { groupBy } = params;

  if (groupBy === "none") return [sort];
  if (groupBy === "date") return params.sortBy === "completedAt" ? [sort] : [{ field: "completedAt", dir: params.sortDir }, sort];
  return params.sortBy === groupBy ? [{ field: params.sortBy, dir: params.sortDir }] : [{ field: groupBy, dir: "asc" }, sort];
}
