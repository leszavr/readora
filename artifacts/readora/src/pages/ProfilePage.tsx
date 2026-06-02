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
import { Loader2, Save, BookOpen, BookMarked, Clock, Eye, EyeOff } from "lucide-react";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (newPassword.length < 8) {
      setPasswordError("Новый пароль должен быть не короче 8 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Новый пароль и подтверждение не совпадают");
      return;
    }

    setPasswordPending(true);
    try {
      const res = await fetch("/api/auth/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setPasswordError(data.error ?? "Не удалось изменить пароль");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch {
      setPasswordError("Не удалось изменить пароль");
    } finally {
      setPasswordPending(false);
    }
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Смена пароля</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Текущий пароль</Label>
                  <div className="relative">
                    <Input
                      id="current-password"
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showCurrentPassword ? "Скрыть пароль" : "Показать пароль"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowCurrentPassword((prev) => !prev)}
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password">Новый пароль</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showNewPassword ? "Скрыть пароль" : "Показать пароль"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Подтверждение нового пароля</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
                {passwordSaved && <p className="text-sm text-green-600">Письмо подтверждения отправлено на ваш email</p>}

                <Button
                  type="submit"
                  disabled={passwordPending || !currentPassword || !newPassword || !confirmPassword}
                  className="gap-2"
                >
                  {passwordPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Обновить пароль
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
