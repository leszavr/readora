import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { getGetMeQueryKey, useLogin } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (isAuthenticated) navigate("/library");
  }, [isAuthenticated]);

  const { mutate: doLogin, isPending, error } = useLogin({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getGetMeQueryKey(), data.user);
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate("/library");
      },
    },
  });

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    doLogin({ data: { email, password } });
  }

  const errorMsg = error
    ? ((error.data as { error?: string } | null)?.error ?? "Ошибка входа")
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 px-4 py-3 mb-4">
            <img src="/readora-wordmark.webp" alt="Readora" className="h-8 w-auto" loading="eager" decoding="async" />
          </div>
          <p className="text-muted-foreground text-sm mt-1">Войдите в свою библиотеку</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Вход</CardTitle>
            <CardDescription>Введите ваши данные для входа</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              <div className="text-right">
                <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                  Забыли пароль?
                </Link>
              </div>

              {errorMsg && (
                <p className="text-sm text-destructive">{errorMsg}</p>
              )}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Войти
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-4">
              Нет аккаунта?{" "}
              <Link href="/register" className="text-primary hover:underline font-medium">
                Зарегистрироваться
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
