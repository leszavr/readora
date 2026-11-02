import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListExternalStorageConnections,
  useConnectMailRuStorage,
  useUpdateExternalStorageConnection,
  useDeleteExternalStorageConnection,
  useListExternalStorageFolders,
  useSyncExternalStorage,
  useGetExternalSyncJob,
  useGetExternalSyncJobFailures,
  useControlExternalSyncJob,
  useGetExternalStorageFeatureStatus,
  useListExternalRelocations,
  useResolveExternalRelocation,
  getListExternalStorageConnectionsQueryKey,
  getListExternalStorageFoldersQueryKey,
  getGetExternalSyncJobQueryKey,
  getGetExternalSyncJobFailuresQueryKey,
  getListExternalRelocationsQueryKey,
  type ExternalStorageConnection,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Cloud, FolderOpen, HardDriveDownload, Loader2, Pause, Play, RefreshCw, Square, Trash2, ChevronRight, ChevronDown, ChevronUp, AlertTriangle, CloudUpload, X } from "lucide-react";

const STATUS_LABELS: Record<ExternalStorageConnection["status"], string> = {
  active: "Активно",
  auth_error: "Ошибка авторизации",
  error: "Ошибка",
};

const FAILURE_REASON_LABELS: Record<string, string> = {
  download: "Не удалось скачать",
  parse: "Ошибка обработки",
  duplicate: "Дубликат",
};

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 Б";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string } } | null)?.data;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function ConnectButtons({ onMailRuOpen }: { onMailRuOpen: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={() => window.location.assign("/api/external-storage/yandex/connect")}
      >
        <Cloud className="w-4 h-4" />
        Подключить Яндекс.Диск
      </Button>
      <Button type="button" variant="outline" className="gap-2" onClick={onMailRuOpen}>
        <HardDriveDownload className="w-4 h-4" />
        Подключить Облако Mail.ru
      </Button>
    </div>
  );
}

function MailRuConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [login, setLogin] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { mutate: connect, isPending } = useConnectMailRuStorage({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListExternalStorageConnectionsQueryKey() });
        setLogin("");
        setAppPassword("");
        setError(null);
        onOpenChange(false);
      },
      onError: (e) => setError(apiErrorMessage(e, "Не удалось подключить Облако Mail.ru")),
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    connect({ data: { login: login.trim(), appPassword } });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключение Облака Mail.ru</DialogTitle>
          <DialogDescription>
            Облако подключается по WebDAV. Создайте пароль приложения в настройках
            безопасности Mail.ru и укажите его вместе с логином.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mailru-login">Логин Mail.ru</Label>
            <Input
              id="mailru-login"
              type="email"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mailru-password">Пароль приложения</Label>
            <Input
              id="mailru-password"
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !login.trim() || !appPassword} className="gap-2">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Подключить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FolderPickerDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: ExternalStorageConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [currentPath, setCurrentPath] = useState(connection.rootFolder);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrentPath(connection.rootFolder);
      setError(null);
    }
  }, [open, connection.rootFolder]);

  const { data: folderList, isLoading, isError } = useListExternalStorageFolders(
    connection.id,
    { path: currentPath },
    {
      query: {
        queryKey: getListExternalStorageFoldersQueryKey(connection.id, { path: currentPath }),
        enabled: open,
        retry: false,
      },
    },
  );

  const { mutate: update, isPending } = useUpdateExternalStorageConnection({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListExternalStorageConnectionsQueryKey() });
        onOpenChange(false);
      },
      onError: (e) => setError(apiErrorMessage(e, "Не удалось сохранить папку")),
    },
  });

  const crumbs = currentPath.split("/").filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Папка с книгами — {connection.providerLabel}</DialogTitle>
          <DialogDescription>
            Выберите папку, которую нужно синхронизировать. Подпапки сканируются автоматически.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setCurrentPath("/")}
            >
              Корень
            </button>
            {crumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setCurrentPath(`/${crumbs.slice(0, i + 1).join("/")}`)}
                >
                  {crumb}
                </button>
              </span>
            ))}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border">
            {isLoading && (
              <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Загрузка папок...
              </div>
            )}
            {isError && (
              <p className="p-4 text-sm text-destructive">
                Не удалось загрузить список папок. Проверьте подключение хранилища.
              </p>
            )}
            {!isLoading && !isError && (folderList?.folders.length ?? 0) === 0 && (
              <p className="p-4 text-sm text-muted-foreground">В этой папке нет подпапок</p>
            )}
            {!isLoading &&
              !isError &&
              (folderList?.folders ?? []).map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  className="flex w-full items-center gap-2 border-b px-4 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                  onClick={() => setCurrentPath(folder.path)}
                >
                  <FolderOpen className="w-4 h-4 text-muted-foreground" />
                  {folder.name}
                </button>
              ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={isPending || isLoading || isError}
            onClick={() => update({ id: connection.id, data: { rootFolder: currentPath } })}
            className="gap-2"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Выбрать эту папку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Детализация ошибок джобы: список файлов, которые не удалось импортировать.
function SyncJobFailures({ jobId, failedCount }: { jobId: number; failedCount: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useGetExternalSyncJobFailures(jobId, {
    query: {
      queryKey: getGetExternalSyncJobFailuresQueryKey(jobId),
      enabled: open,
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-destructive underline-offset-4 hover:underline"
        onClick={() => setOpen((prev) => !prev)}
      >
        <AlertTriangle className="w-3 h-3" />
        {open ? "Скрыть ошибки" : `Ошибок: ${failedCount} — показать`}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
          {isLoading && (
            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Загрузка списка ошибок...
            </div>
          )}
          {isError && (
            <p className="p-2 text-xs text-destructive">Не удалось загрузить список ошибок</p>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">Детали ошибок недоступны (старая синхронизация)</p>
          )}
          {items.map((item, i) => (
            <div key={i} className="space-y-0.5 border-b px-2 py-1.5 last:border-b-0">
              <p className="break-all text-xs font-medium">{item.fileName}</p>
              <p className="break-all text-[11px] text-muted-foreground">{item.externalPath}</p>
              <p className="text-xs text-destructive">
                {FAILURE_REASON_LABELS[item.reason] ?? item.reason}: {item.errorMessage}
              </p>
            </div>
          ))}
          {!isLoading && !isError && items.length > 0 && items.length < failedCount && (
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">
              Показаны первые {items.length} из {failedCount}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SyncControls({
  connection,
  featureEnabled,
  onRunningChange,
}: {
  connection: ExternalStorageConnection;
  featureEnabled: boolean;
  onRunningChange?: (running: boolean) => void;
}) {
  const qc = useQueryClient();
  // jobId переживает перезагрузку страницы: восстановление из данных подключения.
  const [jobId, setJobId] = useState<number | null>(connection.activeSyncJobId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  // Подхват активной джобы, появившейся после монтирования (другое устройство).
  useEffect(() => {
    const activeId = connection.activeSyncJobId ?? null;
    if (activeId !== null && activeId !== jobId) setJobId(activeId);
  }, [connection.activeSyncJobId, jobId]);

  const { mutate: sync, isPending } = useSyncExternalStorage({
    mutation: {
      onSuccess: (job) => {
        setError(null);
        setJobId(job.id);
      },
      onError: (e) => setError(apiErrorMessage(e, "Не удалось запустить синхронизацию")),
    },
  });

  const { mutate: control } = useControlExternalSyncJob({
    mutation: {
      onMutate: () => setMutating(true),
      onSuccess: (job) => {
        setError(null);
        if (job.status === "queued") setJobId(job.id);
      },
      onSettled: () => setMutating(false),
      onError: (e) => setError(apiErrorMessage(e, "Не удалось изменить состояние синхронизации")),
    },
  });

  const { data: job } = useGetExternalSyncJob(jobId ?? 0, {
    query: {
      queryKey: getGetExternalSyncJobQueryKey(jobId ?? 0),
      enabled: jobId !== null,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "queued" || status === "processing" ? 1500 : false;
      },
    },
  });

  useEffect(() => {
    if (job && (job.status === "completed" || job.status === "failed" || job.status === "cancelled")) {
      void qc.invalidateQueries({ queryKey: getListExternalStorageConnectionsQueryKey() });
      // Финальный список кандидатов на переезд мог появиться в последнем файле
      void qc.invalidateQueries({ queryKey: getListExternalRelocationsQueryKey(connection.id) });
    }
  }, [job?.status, qc, job, connection.id]);

  const running = job?.status === "queued" || job?.status === "processing";
  const paused = job?.status === "paused";
  const controllable = featureEnabled && (running || paused);

  // Блок локальных копий опрашивает список, пока синхронизация идёт
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  const statusText =
    job?.status === "completed" ? "Синхронизация завершена"
    : job?.status === "failed" ? "Синхронизация не удалась"
    : job?.status === "cancelled" ? "Синхронизация остановлена"
    : job?.status === "paused" ? `Пауза (${job.progress}%)`
    : job?.status === "queued" ? "Ожидание запуска"
    : job?.status === "processing" ? `Выполнение: ${job.progress}%`
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!running && !paused && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={!featureEnabled || isPending}
            onClick={() => sync({ id: connection.id })}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Синхронизировать
          </Button>
        )}
        {controllable && running && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={mutating}
            onClick={() => control({ id: jobId ?? 0, data: { action: "pause" } })}
          >
            {mutating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
            Пауза
          </Button>
        )}
        {controllable && paused && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={mutating}
            onClick={() => control({ id: jobId ?? 0, data: { action: "resume" } })}
          >
            {mutating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Продолжить
          </Button>
        )}
        {controllable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-destructive"
            disabled={mutating}
            onClick={() => control({ id: jobId ?? 0, data: { action: "cancel" } })}
          >
            <Square className="w-4 h-4" />
            Остановить
          </Button>
        )}
      </div>

      {job && statusText && (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">{statusText}</span>
            <span className="text-muted-foreground">
              Найдено {job.filesFound} · Новых {job.filesImported} · Обновлено {job.filesUpdated} · Пропало{" "}
              {job.filesMissing}
              {job.filesFailed > 0 ? ` · Ошибок ${job.filesFailed}` : ""}
            </span>
          </div>
          {(running || paused) && <Progress value={job.progress} />}
          {job.status === "failed" && job.errorMessage && (
            <p className="text-destructive">{job.errorMessage}</p>
          )}
          {job.filesFailed > 0 && jobId !== null && (
            <SyncJobFailures jobId={jobId} failedCount={job.filesFailed} />
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// Локальные копии книг из облака: предложение перенести книгу в облако,
// чтобы не хранить файл на сервере (прогресс, закладки и заметки сохраняются).
// Пока синхронизация идёт, список опрашивается: кандидаты появляются на лету.
function RelocationsBlock({
  connection,
  syncRunning,
}: {
  connection: ExternalStorageConnection;
  syncRunning: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data, isLoading } = useListExternalRelocations(connection.id, {
    query: {
      queryKey: getListExternalRelocationsQueryKey(connection.id),
      refetchInterval: syncRunning ? 1500 : false,
    },
  });

  const { mutate: resolve } = useResolveExternalRelocation({
    mutation: {
      onMutate: ({ id }) => setBusyId(id),
      onSuccess: () => {
        setError(null);
        void qc.invalidateQueries({ queryKey: getListExternalRelocationsQueryKey(connection.id) });
        void qc.invalidateQueries({ queryKey: getListExternalStorageConnectionsQueryKey() });
      },
      onSettled: () => setBusyId(null),
      onError: (e) => setError(apiErrorMessage(e, "Не удалось перенести книгу")),
    },
  });

  const items = data?.items ?? [];
  if (isLoading) return null;
  if (items.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Локальные копии книг из облака: {items.length}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Эти книги уже загружены в библиотеку вручную, и тот же файл найден в облаке. Перенесите их в
          облако: файл удалится с сервера и освободит место, а прогресс, закладки и заметки сохранятся.
          После переноса книга будет читаться из облака.
        </p>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2">
            <p className="break-all text-sm font-medium">{item.bookTitle}</p>
            <p className="text-xs text-muted-foreground">
              {item.bookAuthor ?? "Автор неизвестен"} · {formatFileSize(item.fileSize)} · {item.fileName}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={busyId !== null}
                onClick={() => resolve({ id: item.id, data: { action: "migrate" } })}
              >
                {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                Перенести в облако
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-2"
                disabled={busyId !== null}
                onClick={() => resolve({ id: item.id, data: { action: "dismiss" } })}
              >
                <X className="w-4 h-4" />
                Оставить как есть
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function ConnectionCard({ connection, featureEnabled }: { connection: ExternalStorageConnection; featureEnabled: boolean }) {
  const qc = useQueryClient();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [syncRunning, setSyncRunning] = useState(false);

  const { mutate: disconnect, isPending } = useDeleteExternalStorageConnection({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListExternalStorageConnectionsQueryKey() });
      },
    },
  });

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{connection.providerLabel}</span>
            <Badge variant={connection.status === "active" ? "secondary" : "destructive"}>
              {STATUS_LABELS[connection.status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Папка: {connection.rootFolder} · Книг: {connection.booksCount}
            {connection.missingBooksCount > 0 ? ` · Недоступно: ${connection.missingBooksCount}` : ""} · Последняя
            синхронизация: {formatDate(connection.lastSyncedAt)}
          </p>
          {connection.status !== "active" && connection.lastError && (
            <p className="text-xs text-destructive">{connection.lastError}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => setFolderPickerOpen(true)}>
            <FolderOpen className="w-4 h-4" />
            Папка
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="gap-2 text-destructive" disabled={isPending}>
                <Trash2 className="w-4 h-4" />
                Отключить
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Отключить {connection.providerLabel}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Книги, прогресс чтения, закладки и заметки сохранятся в библиотеке, но книги из этого хранилища
                  нельзя будет открыть, пока вы не подключите его снова. Файлы в облаке не удаляются.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={isPending}>
                  Отмена
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => disconnect({ id: connection.id })}
                >
                  {isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  Отключить
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <SyncControls connection={connection} featureEnabled={featureEnabled} onRunningChange={setSyncRunning} />

      <RelocationsBlock connection={connection} syncRunning={syncRunning} />

      <FolderPickerDialog
        connection={connection}
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
      />
    </div>
  );
}

export function ExternalStorageCard() {
  const { data: connections, isLoading, isError } = useListExternalStorageConnections();
  const { data: featureStatus } = useGetExternalStorageFeatureStatus();
  const featureEnabled = featureStatus?.enabled !== false;
  const [mailRuOpen, setMailRuOpen] = useState(false);
  const [oauthNotice, setOauthNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storage = params.get("storage");
    if (storage === "connected" || storage === "error") {
      setOauthNotice({
        kind: storage === "connected" ? "ok" : "error",
        message:
          storage === "connected"
            ? "Яндекс.Диск подключён. Выберите папку и запустите синхронизацию."
            : params.get("message") ?? "Не удалось подключить Яндекс.Диск",
      });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Внешние хранилища</CardTitle>
        <a
          href="/help/external-storage"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Инструкция по подключению
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Подключите облачное хранилище, чтобы читать книги из него без расхода места на сервере. Файлы остаются в
          вашем облаке, а прогресс, закладки и заметки синхронизируются между устройствами.
        </p>

        {!featureEnabled && (
          <p className="text-sm text-destructive">
            Функция внешних хранилищ отключена администратором. Ранее подключённые книги доступны, пока их контент
            есть в кэше сервера.
          </p>
        )}

        {oauthNotice && (
          <p className={`text-sm ${oauthNotice.kind === "ok" ? "text-green-600" : "text-destructive"}`}>
            {oauthNotice.message}
          </p>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка подключений...
          </div>
        )}
        {isError && (
          <p className="text-sm text-destructive">Не удалось загрузить список подключений. Попробуйте обновить страницу.</p>
        )}

        {!isLoading && !isError && ((connections ?? []).length) === 0 && featureEnabled && (
          <ConnectButtons onMailRuOpen={() => setMailRuOpen(true)} />
        )}

        {!isLoading &&
          !isError &&
          (connections ?? []).map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} featureEnabled={featureEnabled} />
          ))}

        {!isLoading && !isError && featureEnabled && ((connections ?? []).length) > 0 && (
          <div className="flex flex-wrap gap-2">
            {(connections ?? []).every((c) => c.provider !== "yandex_disk") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => window.location.assign("/api/external-storage/yandex/connect")}
              >
                <Cloud className="w-4 h-4" />
                Добавить Яндекс.Диск
              </Button>
            )}
            {(connections ?? []).every((c) => c.provider !== "mail_ru_cloud") && (
              <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => setMailRuOpen(true)}>
                <HardDriveDownload className="w-4 h-4" />
                Добавить Облако Mail.ru
              </Button>
            )}
          </div>
        )}

        <MailRuConnectDialog open={mailRuOpen} onOpenChange={setMailRuOpen} />
      </CardContent>
    </Card>
  );
}
