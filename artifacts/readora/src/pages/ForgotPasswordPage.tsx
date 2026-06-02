import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || "Не удалось отправить письмо");
      }
    } catch {
      setError("Произошла ошибка. Попробуйте позже");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <Layout>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg">
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
              <h1 className="mt-4 text-2xl font-bold">Проверьте почту</h1>
              <p className="mt-2 text-muted-foreground">
                Если аккаунт с таким email существует, вы получите письмо с инструкциями по восстановлению пароля.
              </p>
              <Button className="mt-6" onClick={() => navigate("/login")}>
                Вернуться ко входу
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
            <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 px-4 py-3 mb-2">
              <img src="/readora-wordmark.webp" alt="Readora" className="h-8 w-auto" loading="eager" decoding="async" />
            </div>
            <Mail className="mx-auto h-9 w-9 text-primary/80" />
            <h1 className="text-2xl font-bold">Восстановление пароля</h1>
            <p className="text-muted-foreground">
              Укажите email вашего аккаунта. Мы отправим ссылку для сброса пароля.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {loading ? "Отправка..." : "Отправить ссылку"}
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
