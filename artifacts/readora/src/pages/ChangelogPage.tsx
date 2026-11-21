import { getGetAnnouncementsChangelogQueryKey, useGetAnnouncementsChangelog } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { ChangelogEntryCard, ChangelogSsrContent } from "@/components/ChangelogContent";
import { PublicDocumentShell } from "@/components/PublicDocumentShell";
import type { ChangelogEntry } from "@/entry-server";
import { cn } from "@/lib/utils";

function readSsrChangelog(): ChangelogEntry[] | null {
  const element = document.getElementById("changelog-data");
  if (!element?.textContent) return null;
  try {
    const data = JSON.parse(element.textContent) as { items?: unknown };
    if (!Array.isArray(data.items)) return null;
    const items = data.items.filter(
      (item): item is ChangelogEntry =>
        !!item && typeof item === "object" &&
        typeof (item as ChangelogEntry).id === "number" &&
        typeof (item as ChangelogEntry).title === "string" &&
        typeof (item as ChangelogEntry).body === "string" &&
        typeof (item as ChangelogEntry).publishedAt === "string",
    );
    return items;
  } catch {
    return null;
  }
}

export default function ChangelogPage() {
  const ssrItems = readSsrChangelog();
  const { data, isError, refetch, isFetching } = useGetAnnouncementsChangelog({
    query: {
      queryKey: getGetAnnouncementsChangelogQueryKey(),
      staleTime: 5 * 60_000,
      retry: false,
      initialData: ssrItems && ssrItems.length > 0 ? { items: ssrItems } : undefined,
    },
  });

  const items = data?.items ?? [];

  return (
    <PublicDocumentShell>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              Changelog
            </h1>
            <p className="text-muted-foreground text-sm mt-1">История обновлений платформы Readora</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Обновить"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>

        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>Не удалось загрузить Changelog</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>Повторите попытку позже.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Повторить
              </Button>
            </AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="font-medium">Записей пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Здесь появится история обновлений платформы.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <ChangelogEntryCard key={item.id} item={item as ChangelogEntry} />
            ))}
          </div>
        )}
      </div>
    </PublicDocumentShell>
  );
}
