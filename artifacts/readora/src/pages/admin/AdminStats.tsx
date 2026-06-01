import { useGetAdminStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, BookCopy, BookOpen, Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = { admin: "Администратор", moderator: "Модератор", user: "Пользователь" };

export default function AdminStats() {
  const { data: stats, isLoading } = useGetAdminStats();

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
