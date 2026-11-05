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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, Save, BookOpen, BookMarked, Clock, Eye, EyeOff, Trash2, MessageSquareText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { clearAnalyticsQueue } from "@/lib/analytics";
import { openFeedbackPrompt } from "@/lib/feedback-prompt";
import { ExternalStorageCard } from "@/components/external-storage/ExternalStorageCard";

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
  const [deleteStep, setDeleteStep] = useState<"closed" | "info" | "confirm">("closed");
  const [deleteCode, setDeleteCode] = useState<string | null>(null);
  const [deleteCodeInput, setDeleteCodeInput] = useState("");
  const [deleteCodePending, setDeleteCodePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function handleAnalyticsOptInChange(analyticsOptIn: boolean) {
    if (!analyticsOptIn && user) await clearAnalyticsQueue(user.id);
    updateProfile({ data: { analyticsOptIn } });
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

  function closeDeleteDialogs() {
    if (deletePending) return;
    setDeleteStep("closed");
    setDeleteCode(null);
    setDeleteCodeInput("");
    setDeleteError(null);
  }

  // Второе окно (модель GitHub): предупреждение + свежий 8-значный код.
  async function openDeleteConfirm() {
    setDeleteStep("confirm");
    setDeleteCode(null);
    setDeleteCodeInput("");
    setDeleteError(null);
    setDeleteCodePending(true);
    try {
      const res = await fetch("/api/auth/me/delete/preview", {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !data.code) {
        setDeleteError(data.error ?? "Не удалось открыть подтверждение удаления");
        setDeleteStep("info");
        return;
      }
      setDeleteCode(data.code);
    } catch {
      setDeleteError("Не удалось открыть подтверждение удаления");
      setDeleteStep("info");
    } finally {
      setDeleteCodePending(false);
    }
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteCode || deleteCodeInput !== deleteCode) return;
    setDeleteError(null);
    setDeletePending(true);

    try {
      const res = await fetch("/api/auth/me/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: deleteCodeInput }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setDeleteError(data.error ?? "Не удалось удалить учётную запись");
        return;
      }

      // Сессия аннулирована сервером: выходим на страницу входа с уведомлением.
      qc.clear();
      globalThis.location.assign("/login?deletion=scheduled");
    } catch {
      setDeleteError("Не удалось удалить учётную запись");
    } finally {
      setDeletePending(false);
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

                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="analytics-opt-in">Я помогаю улучшать Readora</Label>
                    <Dialog>
                      <DialogTrigger asChild>
                        <button type="button" className="block text-xs text-primary underline-offset-4 hover:underline">
                          Подробнее
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Помогите улучшать Readora</DialogTitle>
                          <DialogDescription>
                            Сбор статистики включён для новых аккаунтов и его можно отключить в любое время.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 text-sm">
                          <p>
                            Мы собираем обезличенную статистику использования: открытие приложения и библиотеки, загрузку книг, начало и длительность чтения, сохранение прогресса, тип устройства и изменения настроек читалки.
                          </p>
                          <p>
                            Это помогает понять, какие функции полезны и где нужны улучшения.
                          </p>
                          <p className="text-muted-foreground">
                            Содержимое и названия книг, текст, поисковые запросы, точная позиция чтения, IP-адрес, данные браузера и личные заметки не собираются.
                          </p>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <Switch
                    id="analytics-opt-in"
                    checked={user?.analyticsOptIn === true}
                    disabled={isPending}
                    onCheckedChange={handleAnalyticsOptInChange}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Оцените Readora</p>
                    <p className="text-xs text-muted-foreground">Расскажите, что улучшить, — это займёт минуту.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-2"
                    onClick={openFeedbackPrompt}
                  >
                    <MessageSquareText className="w-4 h-4" />
                    Оставить отзыв
                  </Button>
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

          <ExternalStorageCard />

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Удаление учётной записи</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {user?.role === "admin" ? (
                <p className="text-sm text-muted-foreground">
                  Администратор не может удалить свою учётную запись самостоятельно, чтобы не потерять доступ к управлению сервисом.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Аккаунт будет окончательно удалён вместе с библиотекой через 30 дней.
                    До этого момента его можно восстановить, обратившись в поддержку.
                  </p>
                  <AlertDialog open={deleteStep !== "closed"} onOpenChange={(open) => (open ? undefined : closeDeleteDialogs())}>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="gap-2" onClick={() => setDeleteStep("info")}>
                        <Trash2 className="w-4 h-4" />
                        Удалить учётную запись
                      </Button>
                    </AlertDialogTrigger>

                    {deleteStep === "info" && (
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Что произойдёт при удалении аккаунта</AlertDialogTitle>
                          <AlertDialogDescription>
                            Аккаунт будет помечен на удаление и окончательно очищен через 30 дней.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
                          <li>Профиль, email и настройки читалки</li>
                          <li>Все книги и загруженные файлы из вашей библиотеки</li>
                          <li>Прогресс чтения, закладки и заметки</li>
                          <li>Доступ на всех устройствах — вы выйдете из системы</li>
                        </ul>
                        <p className="text-sm">
                          До даты удаления аккаунт можно восстановить, написав в поддержку
                          через форму обратной связи или по email техподдержки.
                          После удаления данные восстановить невозможно.
                        </p>
                        <AlertDialogFooter>
                          <AlertDialogCancel type="button" onClick={closeDeleteDialogs}>
                            Отмена
                          </AlertDialogCancel>
                          <Button
                            type="button"
                            variant="destructive"
                            className="gap-2"
                            onClick={() => void openDeleteConfirm()}
                          >
                            <Trash2 className="w-4 h-4" />
                            Удалить
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    )}

                    {deleteStep === "confirm" && (
                      <AlertDialogContent>
                        <form onSubmit={handleDeleteAccount} className="space-y-4">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Подтвердите удаление аккаунта</AlertDialogTitle>
                            <AlertDialogDescription>
                              Аккаунт <strong>{user?.email}</strong> будет окончательно удалён через 30 дней.
                              До этого момента его можно восстановить, написав в поддержку
                              (форма обратной связи или email техподдержки). Все сессии будут завершены.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <div className="space-y-2">
                            <Label htmlFor="delete-account-code">Код подтверждения</Label>
                            {deleteCodePending ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Генерация кода…
                              </div>
                            ) : deleteCode ? (
                              <>
                                <p className="font-mono text-lg font-bold tracking-[0.3em] select-all">
                                  {deleteCode}
                                </p>
                                <Input
                                  id="delete-account-code"
                                  inputMode="numeric"
                                  pattern="\d{8}"
                                  maxLength={8}
                                  placeholder="Введите код"
                                  value={deleteCodeInput}
                                  onChange={(e) => setDeleteCodeInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
                                  autoComplete="one-time-code"
                                  disabled={deletePending}
                                  required
                                  className="font-mono tracking-[0.3em]"
                                />
                              </>
                            ) : null}
                          </div>
                          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
                          <AlertDialogFooter>
                            <AlertDialogCancel type="button" onClick={closeDeleteDialogs} disabled={deletePending}>
                              Отмена
                            </AlertDialogCancel>
                            <Button
                              type="submit"
                              variant="destructive"
                              disabled={deletePending || deleteCodeInput !== deleteCode}
                            >
                              {deletePending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                              Удалить
                            </Button>
                          </AlertDialogFooter>
                        </form>
                      </AlertDialogContent>
                    )}
                  </AlertDialog>
                </>
              )}
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
