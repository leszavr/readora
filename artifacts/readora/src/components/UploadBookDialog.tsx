import { useEffect, useRef, useState } from "react";
import { fetchUploadJob, type UploadJob, useUploadBook } from "@/hooks/use-upload-book";
import { useListCycles } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2, Layers, Plus, List } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FileUploadState {
  file: File;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
  progress: number;
  job: UploadJob | null;
  error: string | null;
}

function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "fb2" && ext !== "epub") {
    return "Поддерживаются только форматы FB2 и EPUB";
  }
  if (file.size > 50 * 1024 * 1024) {
    return "Файл слишком большой. Максимум 50 МБ";
  }
  return null;
}

function getJobStatus(jobStatus: string): "completed" | "failed" | "processing" {
  if (jobStatus === "completed") return "completed";
  if (jobStatus === "failed") return "failed";
  return "processing";
}

function applyJobUpdate(
  prev: FileUploadState[],
  file: File,
  nextJob: UploadJob,
): FileUploadState[] {
  return prev.map((f) =>
    f.file === file
      ? {
          ...f,
          job: nextJob,
          progress: nextJob.progress,
          status: getJobStatus(nextJob.status),
          error: nextJob.errorMessage,
        }
      : f,
  );
}

function applyJobError(
  prev: FileUploadState[],
  file: File,
  message: string,
): FileUploadState[] {
  return prev.map((f) =>
    f.file === file ? { ...f, status: "failed" as const, error: message } : f,
  );
}

async function pollJob(
  fileState: FileUploadState,
  setFiles: React.Dispatch<React.SetStateAction<FileUploadState[]>>,
  invalidateBooks: () => void,
  isCancelled: () => boolean,
): Promise<void> {
  if (!fileState.job) return;
  try {
    const nextJob = await fetchUploadJob(fileState.job.id);
    if (isCancelled()) return;
    setFiles((prev) => applyJobUpdate(prev, fileState.file, nextJob));
    if (nextJob.status === "completed") invalidateBooks();
  } catch (e) {
    if (isCancelled()) return;
    const message = e instanceof Error ? e.message : "Не удалось получить статус";
    setFiles((prev) => applyJobError(prev, fileState.file, message));
  }
}

function applyMarkUploading(prev: FileUploadState[], file: File): FileUploadState[] {
  return prev.map((f) => (f.file === file ? { ...f, status: "uploading" as const } : f));
}

function applyMarkProcessing(
  prev: FileUploadState[],
  file: File,
  job: UploadJob,
): FileUploadState[] {
  return prev.map((f) =>
    f.file === file
      ? { ...f, status: "processing" as const, job, progress: job.progress }
      : f,
  );
}

type UploadMutate = (
  vars: { file: File; cycleId?: number; cycleNumber?: number },
  cbs: { onSuccess: (job: UploadJob) => void; onError: (err: unknown) => void },
) => void;

function uploadSingleFile(
  fileState: FileUploadState,
  cycleIdToUse: number | undefined,
  cycleNumber: number | undefined,
  setFiles: React.Dispatch<React.SetStateAction<FileUploadState[]>>,
  upload: UploadMutate,
): Promise<void> {
  setFiles((prev) => applyMarkUploading(prev, fileState.file));
  return new Promise<void>((resolve) => {
    const handleSuccess = (job: UploadJob) => {
      setFiles((prev) => applyMarkProcessing(prev, fileState.file, job));
      resolve();
    };
    const handleError = (err: unknown) => {
      const message = err instanceof Error ? err.message : "Ошибка загрузки";
      setFiles((prev) => applyJobError(prev, fileState.file, message));
      resolve();
    };
    upload(
      { file: fileState.file, cycleId: cycleIdToUse, cycleNumber },
      { onSuccess: handleSuccess, onError: handleError },
    );
  });
}

export function UploadBookDialog({ open, onClose }: Readonly<Props>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Cycle settings
  const [useCycle, setUseCycle] = useState(false);
  const [cycleMode, setCycleMode] = useState<"existing" | "new">("existing");
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [newCycleName, setNewCycleName] = useState("");
  const [startNumber, setStartNumber] = useState("1");
  const [autoNumber, setAutoNumber] = useState(true);

  const { data: cycles = [] } = useListCycles();
  const { mutate: upload, invalidateBooks } = useUploadBook();

  // Poll for job status updates
  useEffect(() => {
    const filesToPoll = files.filter((f) => f.job && f.status === "processing");
    if (filesToPoll.length === 0) return;

    let cancelled = false;
    const isCancelled = () => cancelled;
    const timer = globalThis.setInterval(() => {
      for (const fileState of filesToPoll) {
        void pollJob(fileState, setFiles, invalidateBooks, isCancelled);
      }
    }, 1500);

    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [files, invalidateBooks]);

  function handleFiles(fileList: FileList) {
    const newFiles: FileUploadState[] = [];
    for (const file of Array.from(fileList)) {
      const error = validateFile(file);
      if (error) {
        alert(`${file.name}: ${error}`);
        continue;
      }
      // Check duplicate
      if (files.some((f) => f.file.name === file.name && f.file.size === file.size)) {
        continue;
      }
      newFiles.push({
        file,
        status: "pending",
        progress: 0,
        job: null,
        error: null,
      });
    }
    setFiles((prev) => [...prev, ...newFiles]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function removeFile(file: File) {
    setFiles((prev) => prev.filter((f) => f.file !== file));
  }

  function validateCycleSettings(): string | null {
    if (!useCycle) return null;
    if (cycleMode === "existing" && !selectedCycleId) {
      return "Выберите цикл или создайте новый";
    }
    if (cycleMode === "new" && !newCycleName.trim()) {
      return "Укажите название нового цикла";
    }
    return null;
  }

  async function resolveCycleId(): Promise<number | undefined> {
    if (!useCycle) return undefined;
    if (cycleMode === "existing") return Number.parseInt(selectedCycleId, 10);
    const res = await fetch("/api/cycles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCycleName.trim() }),
    });
    if (!res.ok) throw new Error("Не удалось создать цикл");
    const newCycle = await res.json();
    return newCycle.id;
  }

  function uploadOne(
    fileState: FileUploadState,
    cycleIdToUse: number | undefined,
    cycleNumber: number | undefined,
  ): Promise<void> {
    return uploadSingleFile(fileState, cycleIdToUse, cycleNumber, setFiles, upload);
  }

  async function handleUploadAll() {
    if (files.length === 0) return;

    const validationError = validateCycleSettings();
    if (validationError) {
      alert(validationError);
      return;
    }

    setIsUploading(true);

    let cycleIdToUse: number | undefined;
    try {
      cycleIdToUse = await resolveCycleId();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка создания цикла");
      setIsUploading(false);
      return;
    }

    let currentNumber = autoNumber && useCycle ? Number.parseFloat(startNumber) || 1 : undefined;

    for (const fileState of files) {
      if (fileState.status !== "pending") continue;
      await uploadOne(fileState, cycleIdToUse, currentNumber);
      if (currentNumber !== undefined) currentNumber += 1;
    }

    setIsUploading(false);
  }

  function handleClose() {
    if (isUploading) return;
    onClose();
    setFiles([]);
    setUseCycle(false);
    setCycleMode("existing");
    setSelectedCycleId("");
    setNewCycleName("");
    setStartNumber("1");
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  };

  const getStatusText = (f: FileUploadState) => {
    if (f.status === "pending") return "Ожидает";
    if (f.status === "uploading") return "Загрузка...";
    if (f.status === "processing") {
      const stage = f.job?.stage;
      if (stage === "validating") return "Проверка...";
      if (stage === "parsing") return "Парсинг...";
      if (stage === "saving") return "Сохранение...";
      return "Обработка...";
    }
    if (f.status === "completed") return "Готово";
    if (f.status === "failed") return "Ошибка";
    return "";
  };

  const allCompleted = files.length > 0 && files.every((f) => f.status === "completed");
  const hasPending = files.some((f) => f.status === "pending");
  const hasActive = files.some((f) => f.status === "uploading" || f.status === "processing");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl min-w-0">
        <DialogHeader>
          <DialogTitle>Загрузить книги</DialogTitle>
          <DialogDescription>
            Поддерживаются форматы FB2 и EPUB (до 50 МБ). Можно загрузить несколько файлов сразу.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <button
            type="button"
            className={`w-full border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="font-medium text-sm">Перетащите файлы или нажмите для выбора</p>
            <p className="text-xs text-muted-foreground mt-1">FB2, EPUB • Множественный выбор</p>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".fb2,.epub"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />

          {/* Cycle settings */}
          {files.length > 0 && (
            <div className="space-y-3 border rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="use-cycle"
                  checked={useCycle}
                  onCheckedChange={(checked) => setUseCycle(checked === true)}
                  disabled={hasActive}
                />
                <Label htmlFor="use-cycle" className="text-sm font-medium flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Добавить в цикл
                </Label>
              </div>

              {useCycle && (
                <div className="space-y-3 ml-6">
                  <Tabs value={cycleMode} onValueChange={(v) => setCycleMode(v as "existing" | "new")}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="existing" aria-label="Существующий цикл" title="Существующий цикл">
                        <List className="w-4 h-4" />
                        <span className="sr-only">Существующий</span>
                      </TabsTrigger>
                      <TabsTrigger value="new" aria-label="Новый цикл" title="Новый цикл">
                        <Plus className="w-4 h-4" />
                        <span className="sr-only">Новый цикл</span>
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="existing" className="space-y-2">
                      <Select value={selectedCycleId} onValueChange={setSelectedCycleId} disabled={hasActive}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите цикл" />
                        </SelectTrigger>
                        <SelectContent>
                          {cycles.length === 0 && (
                            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                              Циклов пока нет
                            </div>
                          )}
                          {cycles.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TabsContent>
                    <TabsContent value="new" className="space-y-2">
                      <Input
                        placeholder="Название цикла"
                        value={newCycleName}
                        onChange={(e) => setNewCycleName(e.target.value)}
                        disabled={hasActive}
                      />
                    </TabsContent>
                  </Tabs>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="auto-number"
                      checked={autoNumber}
                      onCheckedChange={(checked) => setAutoNumber(checked === true)}
                      disabled={hasActive}
                    />
                    <Label htmlFor="auto-number" className="text-sm">
                      Автоматическая нумерация
                    </Label>
                  </div>

                  {autoNumber && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="start-number" className="text-sm">
                        Начать с:
                      </Label>
                      <Input
                        id="start-number"
                        type="number"
                        min="1"
                        step="1"
                        value={startNumber}
                        onChange={(e) => setStartNumber(e.target.value)}
                        className="w-20"
                        disabled={hasActive}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Files list */}
          {files.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {files.map((f) => (
                <div
                  key={`${f.file.name}-${f.file.size}`}
                  className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30"
                >
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium" title={f.file.name}>
                      {f.file.name}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatSize(f.file.size)}</span>
                      <span>•</span>
                      <span className={f.status === "failed" ? "text-destructive" : ""}>
                        {getStatusText(f)}
                      </span>
                    </div>
                    {(f.status === "uploading" || f.status === "processing") && (
                      <Progress value={f.progress} className="h-1 mt-2" />
                    )}
                    {f.error && (
                      <p className="text-xs text-destructive mt-1">{f.error}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {f.status === "completed" && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                    {f.status === "failed" && <AlertCircle className="w-5 h-5 text-destructive" />}
                    {(f.status === "uploading" || f.status === "processing") && (
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    )}
                    {f.status === "pending" && (
                      <button
                        onClick={() => removeFile(f.file)}
                        className="text-muted-foreground hover:text-foreground"
                        disabled={isUploading}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Success message */}
          {allCompleted && (
            <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Все книги успешно добавлены в библиотеку
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={handleClose} disabled={isUploading}>
              {allCompleted ? "Закрыть" : "Отмена"}
            </Button>
            <Button
              className="flex-1"
              onClick={handleUploadAll}
              disabled={!hasPending || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Загрузка...
                </>
              ) : (
                `Загрузить (${files.filter((f) => f.status === "pending").length})`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
