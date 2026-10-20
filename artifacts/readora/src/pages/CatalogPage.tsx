import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  claimCatalogEdition,
  getListBooksQueryKey,
  listCatalogEditions,
  useListGenres,
  type CatalogEdition,
  type ListCatalogEditionsParams,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { BookOpen, Check, Grid2X2, Landmark, List, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";
type SortBy = "publishedAt" | "title" | "author" | "publicationYear";
type GroupBy = "none" | "author" | "genre" | "year" | "month";

function getStringParam(params: URLSearchParams, key: string, fallback = ""): string {
  return params.get(key) ?? fallback;
}

function getNumberParam(params: URLSearchParams, key: string): number | undefined {
  const value = Number.parseInt(params.get(key) ?? "", 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

function getGroupLabel(edition: CatalogEdition, groupBy: GroupBy): string {
  if (groupBy === "author") return edition.author || "Автор не указан";
  if (groupBy === "genre") return edition.primaryGenre?.name || "Жанр не указан";
  if (groupBy === "year") return edition.publicationYear ? String(edition.publicationYear) : "Год не указан";
  if (groupBy === "month") {
    return edition.publishedAt
      ? new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(edition.publishedAt))
      : "Дата публикации не указана";
  }
  return "";
}

function CatalogCover({ edition, className }: Readonly<{ edition: CatalogEdition; className?: string }>) {
  const [failed, setFailed] = useState(false);
  if (!edition.coverUrl || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-muted p-4", className)}>
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }
  return <img src={edition.coverUrl} alt={`Обложка «${edition.title}»`} className={cn("bg-muted object-cover", className)} onError={() => setFailed(true)} />;
}

function CatalogEditionCard({ edition, viewMode, onClaim, isClaiming }: Readonly<{
  edition: CatalogEdition;
  viewMode: ViewMode;
  onClaim: (id: number) => void;
  isClaiming: boolean;
}>) {
  const genreNames = edition.genres.map((genre) => genre.name).join(", ");
  const claimed = edition.isClaimed;

  if (viewMode === "list") {
    return (
      <article className="flex gap-4 rounded-xl border bg-card p-3 shadow-sm">
        <CatalogCover edition={edition} className="h-28 w-20 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-semibold">{edition.title}</h2>
              <p className="truncate text-sm text-muted-foreground">{edition.author || "Автор не указан"}</p>
            </div>
            <Badge variant="outline" className="font-mono uppercase">{edition.format}</Badge>
          </div>
          {edition.description && <p className="line-clamp-2 text-sm text-muted-foreground">{edition.description}</p>}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
            <p className="text-xs text-muted-foreground">{[edition.publicationYear, genreNames].filter(Boolean).join(" · ") || "Метаданные не указаны"}</p>
            <ClaimButton edition={edition} onClaim={onClaim} isClaiming={isClaiming} />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <CatalogCover edition={edition} className="aspect-[2/3] w-full" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-2 font-semibold leading-tight">{edition.title}</h2>
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">{edition.format}</Badge>
        </div>
        <p className="line-clamp-1 text-sm text-muted-foreground">{edition.author || "Автор не указан"}</p>
        {edition.description && <p className="line-clamp-2 text-xs text-muted-foreground">{edition.description}</p>}
        <p className="mt-auto line-clamp-1 pt-1 text-xs text-muted-foreground">{[edition.publicationYear, genreNames].filter(Boolean).join(" · ") || "Метаданные не указаны"}</p>
        <ClaimButton edition={edition} onClaim={onClaim} isClaiming={isClaiming} />
      </div>
    </article>
  );
}

function ClaimButton({ edition, onClaim, isClaiming }: Readonly<{ edition: CatalogEdition; onClaim: (id: number) => void; isClaiming: boolean }>) {
  if (edition.isClaimed) {
    return (
      <Button size="sm" variant="secondary" className="mt-1 w-full gap-2" asChild>
        <Link href="/library"><Check className="h-4 w-4" /> В библиотеке</Link>
      </Button>
    );
  }
  return (
    <Button size="sm" className="mt-1 w-full gap-2" onClick={() => onClaim(edition.id)} disabled={isClaiming}>
      {isClaiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
      Добавить в библиотеку
    </Button>
  );
}

export default function CatalogPage() {
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const params = useMemo(() => new URLSearchParams(location.split("?")[1] ?? ""), [location]);
  const [searchInput, setSearchInput] = useState(() => getStringParam(params, "q"));
  const [authorInput, setAuthorInput] = useState(() => getStringParam(params, "author"));
  const viewMode = getStringParam(params, "view", "grid") === "list" ? "list" : "grid";
  const groupParam = getStringParam(params, "group");
  const groupBy: GroupBy = groupParam === "author" || groupParam === "genre" || groupParam === "year" || groupParam === "month"
    ? groupParam
    : "none";
  const sortBy = (["publishedAt", "title", "author", "publicationYear"] as const).includes(getStringParam(params, "sort", "publishedAt") as SortBy)
    ? getStringParam(params, "sort", "publishedAt") as SortBy
    : "publishedAt";
  const sortDir = getStringParam(params, "dir", sortBy === "publishedAt" || sortBy === "publicationYear" ? "desc" : "asc") === "asc" ? "asc" : "desc";
  const genreId = getNumberParam(params, "genre");
  const yearFrom = getNumberParam(params, "yearFrom");
  const yearTo = getNumberParam(params, "yearTo");
  const queryParams = useMemo<ListCatalogEditionsParams>(() => ({
    q: getStringParam(params, "q") || undefined,
    author: getStringParam(params, "author") || undefined,
    genreId,
    yearFrom,
    yearTo,
    sortBy,
    sortDir,
    limit: 24,
  }), [params, genreId, yearFrom, yearTo, sortBy, sortDir]);
  const { data: genres = [] } = useListGenres();
  const catalogQuery = useInfiniteQuery({
    queryKey: ["catalog-editions", queryParams],
    queryFn: ({ pageParam }) => listCatalogEditions({ ...queryParams, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (page) => page.hasNextPage ? page.nextCursor : undefined,
  });
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const editions = catalogQuery.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    setSearchInput(getStringParam(params, "q"));
    setAuthorInput(getStringParam(params, "author"));
  }, [params]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !catalogQuery.hasNextPage || catalogQuery.isFetchingNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void catalogQuery.fetchNextPage();
    }, { rootMargin: "240px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [catalogQuery.fetchNextPage, catalogQuery.hasNextPage, catalogQuery.isFetchingNextPage]);

  function updateUrl(next: Record<string, string | number | undefined>) {
    const nextParams = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "" || value === "all" || value === "grid" || value === "none") nextParams.delete(key);
      else nextParams.set(key, String(value));
    }
    const search = nextParams.toString();
    navigate(search ? `/catalog?${search}` : "/catalog");
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    updateUrl({ q: searchInput.trim() || undefined, author: authorInput.trim() || undefined });
  }

  async function claim(id: number) {
    setClaimingId(id);
    try {
      const result = await claimCatalogEdition(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog-editions"] }),
        queryClient.invalidateQueries({ queryKey: getListBooksQueryKey() }),
      ]);
      toast({ title: result.added > 0 ? "Книга добавлена в библиотеку" : "Книга уже есть в библиотеке" });
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Повторите попытку позже.";
      toast({ title: "Не удалось добавить книгу", description: message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  const groups = useMemo(() => {
    if (groupBy === "none") return [["", editions] as const];
    const map = new Map<string, CatalogEdition[]>();
    for (const edition of editions) {
      const label = getGroupLabel(edition, groupBy);
      map.set(label, [...(map.get(label) ?? []), edition]);
    }
    return [...map.entries()];
  }, [editions, groupBy]);

  const hasFilters = Boolean(queryParams.q || queryParams.author || genreId || yearFrom || yearTo || sortBy !== "publishedAt" || groupBy !== "none");

  return (
    <ProtectedRoute>
      <Layout>
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary"><Landmark className="h-5 w-5" /><span className="text-sm font-medium">Мировое достояние</span></div>
              <h1 className="text-2xl font-bold">Каталог изданий</h1>
              <p className="mt-1 text-sm text-muted-foreground">Свободные для чтения книги: добавьте любое издание в свою библиотеку без расхода квоты.</p>
            </div>
          </div>

          <form onSubmit={submitSearch} className="mb-4 flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-0 flex-1 sm:min-w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Название или ключевое слово" className="pl-9" />
            </div>
            <div className="min-w-0 sm:w-56">
              <Label className="sr-only" htmlFor="catalog-author-filter">Автор</Label>
              <Input id="catalog-author-filter" value={authorInput} onChange={(event) => setAuthorInput(event.target.value)} placeholder="Только автор" />
            </div>
            <Button type="submit" variant="secondary" className="gap-2"><Search className="h-4 w-4" /> Найти</Button>
            <Button type="button" variant="ghost" onClick={() => { setSearchInput(""); setAuthorInput(""); navigate("/catalog"); }} disabled={!hasFilters}>Сбросить</Button>
          </form>

          <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-card p-3 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><SlidersHorizontal className="h-4 w-4" /> Фильтры</div>
            <Select value={genreId ? String(genreId) : "all"} onValueChange={(value) => updateUrl({ genre: value === "all" ? undefined : value })}>
              <SelectTrigger className="lg:w-48"><SelectValue placeholder="Все жанры" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Все жанры</SelectItem>{genres.map((genre) => <SelectItem key={genre.id} value={String(genre.id)}>{genre.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2 lg:w-48">
              <Label className="sr-only" htmlFor="catalog-year-from">Год от</Label>
              <Input id="catalog-year-from" type="number" min={0} max={9999} value={yearFrom ?? ""} onChange={(event) => updateUrl({ yearFrom: event.target.value || undefined })} placeholder="Год от" />
              <Label className="sr-only" htmlFor="catalog-year-to">Год до</Label>
              <Input id="catalog-year-to" type="number" min={0} max={9999} value={yearTo ?? ""} onChange={(event) => updateUrl({ yearTo: event.target.value || undefined })} placeholder="Год до" />
            </div>
            <Select value={sortBy} onValueChange={(value) => updateUrl({ sort: value })}>
              <SelectTrigger className="lg:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="publishedAt">По дате публикации</SelectItem>
                <SelectItem value="title">По названию</SelectItem>
                <SelectItem value="author">По автору</SelectItem>
                <SelectItem value="publicationYear">По году книги</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortDir} onValueChange={(value) => updateUrl({ dir: value })}>
              <SelectTrigger className="lg:w-28"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="asc">По возрастанию</SelectItem><SelectItem value="desc">По убыванию</SelectItem></SelectContent>
            </Select>
            <Select value={groupBy} onValueChange={(value) => updateUrl({ group: value })}>
              <SelectTrigger className="lg:w-40"><SelectValue placeholder="Без группировки" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Без группировки</SelectItem><SelectItem value="author">По автору</SelectItem><SelectItem value="genre">По жанру</SelectItem><SelectItem value="year">По году</SelectItem><SelectItem value="month">По месяцу добавления</SelectItem></SelectContent>
            </Select>
            <div className="flex gap-1 rounded-md border p-1 lg:ml-auto">
              <Button type="button" variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => updateUrl({ view: "grid" })} aria-label="Карточки"><Grid2X2 className="h-4 w-4" /></Button>
              <Button type="button" variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" onClick={() => updateUrl({ view: "list" })} aria-label="Список"><List className="h-4 w-4" /></Button>
            </div>
          </div>

          {catalogQuery.isLoading ? (
            <div className="flex justify-center rounded-xl border bg-card py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : catalogQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-12 text-center">
              <p className="font-medium text-destructive">Не удалось загрузить каталог</p>
              <Button className="mt-4" variant="outline" onClick={() => void catalogQuery.refetch()}>Повторить</Button>
            </div>
          ) : editions.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center">
              <BookOpen className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
              <h2 className="font-semibold">Издания не найдены</h2>
              <p className="mt-1 text-sm text-muted-foreground">Измените запрос или сбросьте фильтры.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groups.map(([label, groupEditions]) => (
                <section key={label || "all"}>
                  {label && <h2 className="mb-3 text-lg font-semibold capitalize">{label}</h2>}
                  <div className={viewMode === "grid" ? "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" : "space-y-3"}>
                    {groupEditions.map((edition) => <CatalogEditionCard key={edition.id} edition={edition} viewMode={viewMode} onClaim={claim} isClaiming={claimingId === edition.id} />)}
                  </div>
                </section>
              ))}
            </div>
          )}

          {catalogQuery.hasNextPage && (
            <div ref={loadMoreRef} className="flex justify-center py-8">
              <Button variant="outline" onClick={() => void catalogQuery.fetchNextPage()} disabled={catalogQuery.isFetchingNextPage}>
                {catalogQuery.isFetchingNextPage ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загружаем</> : "Показать ещё"}
              </Button>
            </div>
          )}
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
