import { useGetAdminStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, BookCopy, BookOpen, Activity, Loader2, Server, Cpu, MemoryStick, HardDrive, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = { admin: "Администратор", moderator: "Модератор", user: "Пользователь" };

interface SystemMetrics {
  cpuCores: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  memoryUsedBytes: number;
  diskPath: string;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsedBytes: number;
  processUptimeSec: number;
  systemUptimeSec: number;
  nodeVersion: string;
  platform: string;
  arch: string;
  timestamp: string;
}

type UsageLevel = "normal" | "warning" | "critical";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}

function toPercent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function getUsageLevel(percent: number): UsageLevel {
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "normal";
}

function getUsageBadgeClass(level: UsageLevel): string {
  if (level === "critical") return "bg-destructive/10 text-destructive border-destructive/30";
  if (level === "warning") return "bg-amber-500/10 text-amber-700 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
}

function getUsageLabel(level: UsageLevel): string {
  if (level === "critical") return "Критично";
  if (level === "warning") return "Предупреждение";
  return "Норма";
}

function buildSparklinePath(points: number[], width = 180, height = 40): string {
  if (points.length === 0) return "";
  const maxValue = Math.max(...points, 0.01);
  const xStep = points.length > 1 ? width / (points.length - 1) : width;
  return points
    .map((value, index) => {
      const x = index * xStep;
      const y = height - (value / maxValue) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function AdminStats() {
  const { data: stats, isLoading } = useGetAdminStats();
  const [loadPoints, setLoadPoints] = useState<number[]>([]);

  const { data: metrics, refetch: refetchMetrics, isFetching: isFetchingMetrics } = useQuery<SystemMetrics>({
    queryKey: ["admin-system-metrics"],
    queryFn: async () => {
      const response = await fetch("/api/admin/system-metrics", { credentials: "include" });
      if (!response.ok) throw new Error("Не удалось получить метрики сервера");
      return response.json() as Promise<SystemMetrics>;
    },
    onSuccess: (nextMetrics) => {
      setLoadPoints((prev) => {
        const merged = [...prev, nextMetrics.loadAvg1m];
        return merged.slice(-20);
      });
    },
    refetchInterval: 30000,
  });

  const ramPercent = metrics ? toPercent(metrics.memoryUsedBytes, metrics.memoryTotalBytes) : 0;
  const diskPercent = metrics ? toPercent(metrics.diskUsedBytes, metrics.diskTotalBytes) : 0;
  const ramLevel = getUsageLevel(ramPercent);
  const diskLevel = getUsageLevel(diskPercent);

  const sparklinePath = useMemo(() => buildSparklinePath(loadPoints), [loadPoints]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!stats) return null;

  const STATS = [
    { label: "Всего пользователей", value: stats.totalUsers, icon: Users, color: "text-blue-500" },
    { label: "Всего книг", value: stats.totalBooks, icon: BookCopy, color: "text-green-500" },
    { label: "Активных читателей (7 дней)", value: stats.activeReaders, icon: Activity, color: "text-purple-500" },
    { label: "Открытий книг (7 дней)", value: stats.openCount7d, icon: BookOpen, color: "text-orange-500" },
  ];

  return (
    <div className="space-y-6">
      {metrics && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="w-4 h-4" />
                Ресурсы сервера
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetchMetrics();
                }}
                disabled={isFetchingMetrics}
                className="h-8"
              >
                <RefreshCcw className={cn("w-3.5 h-3.5 mr-1.5", isFetchingMetrics && "animate-spin")} />
                Обновить
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Cpu className="w-3 h-3" /> CPU
                </p>
                <p className="text-sm font-semibold mt-1">{metrics.cpuCores} vCPU</p>
                <p className="text-xs text-muted-foreground mt-1">
                  load: {metrics.loadAvg1m.toFixed(2)} / {metrics.loadAvg5m.toFixed(2)} / {metrics.loadAvg15m.toFixed(2)}
                </p>
                <div className="mt-2">
                  <p className="text-[11px] text-muted-foreground mb-1">Тренд load 1m (последние {loadPoints.length} точек)</p>
                  <svg viewBox="0 0 180 40" className="w-full h-10" preserveAspectRatio="none" role="img" aria-label="График нагрузки CPU">
                    <path d={sparklinePath} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
                  </svg>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MemoryStick className="w-3 h-3" /> RAM
                </p>
                <p className="text-sm font-semibold mt-1">
                  {formatBytes(metrics.memoryUsedBytes)} / {formatBytes(metrics.memoryTotalBytes)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{ramPercent.toFixed(1)}%</p>
                  <Badge variant="outline" className={cn("text-[10px] h-5", getUsageBadgeClass(ramLevel))}>
                    {getUsageLabel(ramLevel)}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> Диск ({metrics.diskPath})
                </p>
                <p className="text-sm font-semibold mt-1">
                  {formatBytes(metrics.diskUsedBytes)} / {formatBytes(metrics.diskTotalBytes)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{diskPercent.toFixed(1)}%</p>
                  <Badge variant="outline" className={cn("text-[10px] h-5", getUsageBadgeClass(diskLevel))}>
                    {getUsageLabel(diskLevel)}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className="text-sm font-semibold mt-1">App: {formatUptime(metrics.processUptimeSec)}</p>
                <p className="text-xs text-muted-foreground mt-1">Host: {formatUptime(metrics.systemUptimeSec)}</p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
              <span>Node: {metrics.nodeVersion}</span>
              <span>OS: {metrics.platform}/{metrics.arch}</span>
              <span>Обновлено: {new Date(metrics.timestamp).toLocaleTimeString("ru-RU")}</span>
              <span>Автообновление: 30с</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATS.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-muted", color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent users */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Последние пользователи</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(stats.recentUsers ?? []).map((u: { id: number; username: string; email: string; role: string; createdAt: string }) => (
                <div key={u.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {u.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.username}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                </div>
              ))}
              {!stats.recentUsers?.length && (
                <p className="text-sm text-muted-foreground text-center py-4">Нет пользователей</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent books */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Последние книги</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(stats.recentBooks ?? []).map((b: { id: number; title: string; author?: string | null; format: string }) => (
                <div key={b.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-xs font-mono font-bold text-muted-foreground uppercase">
                    {b.format}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{b.title}</p>
                    {b.author && <p className="text-xs text-muted-foreground truncate">{b.author}</p>}
                  </div>
                </div>
              ))}
              {!stats.recentBooks?.length && (
                <p className="text-sm text-muted-foreground text-center py-4">Нет книг</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
