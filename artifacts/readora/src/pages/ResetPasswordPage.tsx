import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const [, params] = useRoute("/reset-password/:token");
  const [, navigate] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Пароль должен быть не менее 8 символов");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params?.token, newPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || "Не удалось сбросить пароль");
      }
    } catch {
      setError("Произошла ошибка. Попробуйте позже");
    } finally {
      setLoading(false);
    }
  }

  if (!params?.token) {
    return (
      <Layout>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg text-center">
            <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
            <h1 className="text-2xl font-bold">Недействительная ссылка</h1>
            <p className="text-muted-foreground">Ссылка сброса пароля недействительна или отсутствует.</p>
            <Button onClick={() => navigate("/forgot-password")}>
              Запросить новую ссылку
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  if (success) {
    return (
      <Layout>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg">
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
              <h1 className="mt-4 text-2xl font-bold text-green-600">Пароль обновлен!</h1>
              <p className="mt-2 text-muted-foreground">
                Ваш пароль успешно изменен. Теперь вы можете войти с новым паролем.
              </p>
              <Button className="mt-6" onClick={() => navigate("/login")}>
                Войти
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg">
          <div className="space-y-2 text-center">
            <Lock className="mx-auto h-12 w-12 text-primary" />
            <h1 className="text-2xl font-bold">Новый пароль</h1>
            <p className="text-muted-foreground">
              Введите новый пароль для вашего аккаунта
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Новый пароль</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Минимум 8 символов"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Повторите пароль"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Обновление..." : "Обновить пароль"}
            </Button>
          </form>

          <div className="text-center">
            <Link href="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Вернуться ко входу
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
