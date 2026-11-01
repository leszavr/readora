import { useGetAdminExternalStorageStats, useAdminControlExternalSyncJob, getGetAdminExternalStorageStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Cloud, Database, Loader2, Pause, Play, RefreshCw, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PROVIDER_LABELS: Record<string, string> = {
  yandex_disk: "Яндекс.Диск",
  mail_ru_cloud: "Облако Mail.ru",
};

const CONNECTION_STATUS_LABELS: Record<string, string> = {
  active: "Активно",
  auth_error: "Ошибка авторизации",
  error: "Ошибка",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Ожидание",
  processing: "Выполняется",
  paused: "Пауза",
  cancelled: "Остановлена",
  completed: "Завершено",
  failed: "Ошибка",
};

function SyncJobControls({ jobId, status }: { jobId: number; status: string | null | undefined }) {
  const qc = useQueryClient();
  const { mutate: control, isPending } = useAdminControlExternalSyncJob({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetAdminExternalStorageStatsQueryKey() });
      },
    },
  });
  const running = status === "queued" || status === "processing";
  const paused = status === "paused";
  if (!running && !paused) return null;

  return (
    <div className="flex items-center gap-1">
      {running && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Пауза"
          disabled={isPending}
          onClick={() => control({ id: jobId, data: { action: "pause" } })}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
      )}
      {paused && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Продолжить"
          disabled={isPending}
          onClick={() => control({ id: jobId, data: { action: "resume" } })}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive"
        title="Остановить"
        disabled={isPending}
        onClick={() => control({ id: jobId, data: { action: "cancel" } })}
      >
        <Square className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminExternalStorage() {
  const { data, isLoading, isError, refetch, isRefetching } = useGetAdminExternalStorageStats({
    query: {
      queryKey: getGetAdminExternalStorageStatsQueryKey(),
      retry: false,
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Загрузка метрик внешних хранилищ...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">Не удалось загрузить метрики внешних хранилищ.</p>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => void refetch()}
        >
          Повторить
        </button>
      </div>
    );
  }

  const connections = {
    total: data.connections?.total ?? 0,
    byProvider: data.connections?.byProvider ?? [],
    byStatus: data.connections?.byStatus ?? [],
  };
  const books = {
    externalBooks: data.books?.externalBooks ?? 0,
    missingBooks: data.books?.missingBooks ?? 0,
  };
  const cache = {
    cachedBooks: data.cache?.cachedBooks ?? 0,
    cachedBytes: data.cache?.cachedBytes ?? 0,
    budgetBytes: data.cache?.budgetBytes ?? 0,
  };
  const sync = {
    last30Days: data.sync?.last30Days ?? null,
    recentJobs: data.sync?.recentJobs ?? [],
  };

  const cacheUsedPercent = cache.budgetBytes > 0
    ? Math.min(100, Math.round((cache.cachedBytes / cache.budgetBytes) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Внешние хранилища</h2>
        <button
          type="button"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => void refetch()}
        >
          {isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Обновить
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Cloud className="w-4 h-4 text-primary" />
              <p className="text-sm text-muted-foreground">Подключений</p>
            </div>
            <p className="text-2xl font-bold">{connections.total}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {connections.byProvider.map((row) => (
                <Badge key={row.provider} variant="secondary">
                  {PROVIDER_LABELS[row.provider ?? ""] ?? row.provider}: {row.count ?? 0}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-primary" />
              <p className="text-sm text-muted-foreground">Внешних книг</p>
            </div>
            <p className="text-2xl font-bold">{books.externalBooks}</p>
            {books.missingBooks > 0 && (
              <p className="mt-2 text-xs text-destructive">Недоступно в облаке: {books.missingBooks}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">Кэш контента</p>
            <p className="text-2xl font-bold">{formatBytes(cache.cachedBytes)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {cache.cachedBooks} книг · бюджет {formatBytes(cache.budgetBytes)}
            </p>
            <Progress value={cacheUsedPercent} className="mt-2" />
            <p className="mt-2 text-xs text-muted-foreground">
              Бюджет кэша и включение функции внешних хранилищ настраиваются в разделе «Настройки».
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-2">Синхронизаций за 30 дней</p>
            <p className="text-2xl font-bold">{sync.last30Days?.total ?? 0}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Успешных: {sync.last30Days?.completed ?? 0} · Ошибок: {sync.last30Days?.failed ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Импортировано книг: {sync.last30Days?.filesImported ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Статусы подключений</CardTitle>
        </CardHeader>
        <CardContent>
          {connections.byStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет подключённых хранилищ</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connections.byStatus.map((row) => (
                <Badge
                  key={row.status}
                  variant={row.status === "active" ? "secondary" : "destructive"}
                >
                  {CONNECTION_STATUS_LABELS[row.status ?? ""] ?? row.status}: {row.count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние синхронизации</CardTitle>
        </CardHeader>
        <CardContent>
          {sync.recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Синхронизации ещё не запускались</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Хранилище</TableHead>
                    <TableHead>Пользователь</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Управление</TableHead>
                    <TableHead className="text-right">Найдено</TableHead>
                    <TableHead className="text-right">Новых</TableHead>
                    <TableHead className="text-right">Обновлено</TableHead>
                    <TableHead className="text-right">Пропало</TableHead>
                    <TableHead className="text-right">Ошибок</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sync.recentJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(job.createdAt)}</TableCell>
                      <TableCell>{PROVIDER_LABELS[job.provider ?? ""] ?? job.provider}</TableCell>
                      <TableCell>{job.ownerUsername ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={job.status === "completed" ? "secondary" : job.status === "failed" ? "destructive" : "outline"}>
                          {JOB_STATUS_LABELS[job.status ?? ""] ?? job.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <SyncJobControls jobId={job.id ?? 0} status={job.status} />
                      </TableCell>
                      <TableCell className="text-right">{job.filesFound}</TableCell>
                      <TableCell className="text-right">{job.filesImported}</TableCell>
                      <TableCell className="text-right">{job.filesUpdated}</TableCell>
                      <TableCell className="text-right">{job.filesMissing}</TableCell>
                      <TableCell className="text-right">{job.filesFailed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
