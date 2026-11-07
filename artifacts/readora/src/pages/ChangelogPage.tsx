import { getGetAnnouncementsChangelogQueryKey, useGetAnnouncementsChangelog } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { NoteText } from "@/components/NoteEditor";
import { cn } from "@/lib/utils";

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

// Классы фона те же, что у заметок в ридере
const COLOR_CLASSES: Record<string, string> = {
  yellow: "bg-yellow-200/60 dark:bg-yellow-900/25 border-yellow-300/60 dark:border-yellow-800/50",
  green: "bg-green-200/60 dark:bg-green-900/25 border-green-300/60 dark:border-green-800/50",
  blue: "bg-blue-200/60 dark:bg-blue-900/25 border-blue-300/60 dark:border-blue-800/50",
  pink: "bg-pink-200/60 dark:bg-pink-900/25 border-pink-300/60 dark:border-pink-800/50",
  purple: "bg-purple-200/60 dark:bg-purple-900/25 border-purple-300/60 dark:border-purple-800/50",
};

export default function ChangelogPage() {
  const { data, isError, isLoading, refetch, isFetching } = useGetAnnouncementsChangelog({
    query: { queryKey: getGetAnnouncementsChangelogQueryKey(), staleTime: 5 * 60_000, retry: false },
  });

  const items = data?.items ?? [];

  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-primary" />
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

          {isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : isError ? (
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
                <article
                  key={item.id}
                  className={cn("rounded-xl border p-5", COLOR_CLASSES[item.color] ?? COLOR_CLASSES.blue)}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {item.severity === "warning" && (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    )}
                    <h2 className="text-lg font-semibold">{item.title}</h2>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {DATE_FORMAT.format(new Date(item.publishedAt))}
                    </span>
                  </div>
                  <div className="text-sm leading-relaxed text-foreground/90">
                    <NoteText text={item.body} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
