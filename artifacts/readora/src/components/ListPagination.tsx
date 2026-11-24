import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";

export type AdminPageSize = 20 | 50 | 100 | "all";

const ADMIN_PAGE_SIZE_OPTIONS: readonly AdminPageSize[] = [20, 50, 100, "all"];
const ALL_MODE_BATCH = 100;

export interface AdminListPagination<T> {
  total: number;
  pageSize: AdminPageSize;
  setPageSize: (size: AdminPageSize) => void;
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  rangeStart: number;
  rangeEnd: number;
  visibleItems: T[];
  hasMore: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
}

export function useAdminListPagination<T>(
  items: readonly T[],
  storageKey: string,
  resetKey?: string,
): AdminListPagination<T> {
  const [pageSize, setPageSize] = useLocalStorageState<AdminPageSize>(storageKey, 20);
  const [page, setPage] = useState(1);
  const [visibleLimit, setVisibleLimit] = useState(ALL_MODE_BATCH);

  const total = items.length;
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);

  useEffect(() => {
    setPage(1);
    setVisibleLimit(ALL_MODE_BATCH);
  }, [resetKey]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = pageSize === "all" && visibleLimit < total;

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleLimit((limit) => Math.min(limit + ALL_MODE_BATCH, total));
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, total, visibleLimit]);

  const visibleItems = useMemo(() => {
    if (pageSize === "all") return items.slice(0, visibleLimit);
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, pageSize, currentPage, visibleLimit]);

  const rangeEnd = pageSize === "all"
    ? Math.min(visibleLimit, total)
    : Math.min(currentPage * pageSize, total);
  const rangeStart = rangeEnd === 0 ? 0 : rangeEnd - visibleItems.length + 1;

  const changePageSize = (size: AdminPageSize) => {
    setPageSize(size);
    setPage(1);
    setVisibleLimit(ALL_MODE_BATCH);
  };

  return {
    total,
    pageSize,
    setPageSize: changePageSize,
    page: currentPage,
    pageCount,
    setPage,
    rangeStart,
    rangeEnd,
    visibleItems,
    hasMore,
    sentinelRef,
  };
}

function getPageNumbers(page: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const nearby = [page - 1, page, page + 1].filter((item) => item >= 1 && item <= pageCount);
  const unique = Array.from(new Set([1, ...nearby, pageCount])).sort((a, b) => a - b);

  const numbers: Array<number | "ellipsis"> = [];
  let previous = 0;
  for (const item of unique) {
    if (item - previous > 1) numbers.push("ellipsis");
    numbers.push(item);
    previous = item;
  }
  return numbers;
}

export function AdminPaginationControls<T>({ pagination }: Readonly<{ pagination: AdminListPagination<T> }>) {
  const { total, pageSize, setPageSize, page, pageCount, setPage, rangeStart, rangeEnd, hasMore, sentinelRef } = pagination;

  if (total === 0) return null;

  const handlePageSizeChange = (value: string) => {
    setPageSize(value === "all" ? "all" : (Number(value) as AdminPageSize));
  };

  return (
    <div className="space-y-3">
      {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Показано {rangeStart}–{rangeEnd} из {total}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="w-32" aria-label="Строк на странице">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>
                  {option === "all" ? "ВСЕ" : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pageSize !== "all" && pageCount > 1 && (
            <Pagination className="mx-0 w-auto justify-start">
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    aria-label="Предыдущая страница"
                    aria-disabled={page <= 1}
                    tabIndex={page <= 1 ? -1 : 0}
                    className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      if (page > 1) setPage(page - 1);
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </PaginationLink>
                </PaginationItem>
                {getPageNumbers(page, pageCount).map((item, index) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        href="#"
                        isActive={item === page}
                        aria-label={`Страница ${item}`}
                        onClick={(event) => {
                          event.preventDefault();
                          setPage(item);
                        }}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    aria-label="Следующая страница"
                    aria-disabled={page >= pageCount}
                    tabIndex={page >= pageCount ? -1 : 0}
                    className={page >= pageCount ? "pointer-events-none opacity-50" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      if (page < pageCount) setPage(page + 1);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </div>
    </div>
  );
}
