import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useUpdateProfile, useListBooks } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, BookOpen, BookMarked, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  moderator: "Модератор",
  user: "Пользователь",
};

export default function ProfilePage() {
  const { user, refetch } = useAuth();
  const qc = useQueryClient();
  const [username, setUsername] = useState(user?.username ?? "");
  const [saved, setSaved] = useState(false);

  const { data: books = [] } = useListBooks();

  const readingCount = books.filter((b) => b.readingStatus === "reading").length;
  const finishedCount = books.filter((b) => b.readingStatus === "finished").length;
  const totalCount = books.length;

  const { mutate: updateProfile, isPending, error } = useUpdateProfile({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        refetch();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateProfile({ data: { username } });
  }

  const initials = user?.username?.slice(0, 2).toUpperCase() ?? "??";
  const errMsg = error ? "Ошибка сохранения" : null;

  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <h1 className="text-2xl font-bold">Профиль</h1>

          {/* User info card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 mb-6">
                <Avatar className="w-16 h-16">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xl">{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="font-bold text-lg">{user?.username}</h2>
                  <p className="text-muted-foreground text-sm">{user?.email}</p>
                  <Badge className="mt-1">{ROLE_LABELS[user?.role ?? "user"]}</Badge>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Имя пользователя</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user?.email ?? ""} disabled className="opacity-60" />
                  <p className="text-xs text-muted-foreground">Email изменить нельзя</p>
                </div>

                {errMsg && <p className="text-sm text-destructive">{errMsg}</p>}
                {saved && <p className="text-sm text-green-600">Изменения сохранены</p>}

                <Button type="submit" disabled={isPending || username === user?.username} className="gap-2">
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Сохранить
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Статистика чтения</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-muted rounded-xl p-4">
                  <BookOpen className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-bold">{totalCount}</p>
                  <p className="text-xs text-muted-foreground">Всего книг</p>
                </div>
                <div className="bg-muted rounded-xl p-4">
                  <Clock className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-bold">{readingCount}</p>
                  <p className="text-xs text-muted-foreground">Читаю</p>
                </div>
                <div className="bg-muted rounded-xl p-4">
                  <BookMarked className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-bold">{finishedCount}</p>
                  <p className="text-xs text-muted-foreground">Прочитано</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
