import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { getGetMeQueryKey, useRegister } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LegalOverlay } from "@/components/LegalOverlay";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRegistrationStatus } from "@/hooks/use-registration-status";
import { captureReferralSource } from "@/lib/referral-source";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { isAuthenticated } = useAuth();
  const {
    data: registrationStatus,
    isLoading: isRegistrationStatusLoading,
    isError: isRegistrationStatusError,
  } = useRegistrationStatus();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate("/library");
  }, [isAuthenticated]);

  const { mutate: doRegister, isPending, error } = useRegister({
    mutation: {
      onSuccess: (data) => {
        // If email verification required, don't set user and redirect to login
        if (data.message?.includes("Проверьте email")) {
          navigate("/login?registered=true");
          return;
        }
        
        // Email verification disabled - user is logged in
        qc.setQueryData(getGetMeQueryKey(), data.user);
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate("/library");
      },
    },
  });

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) return;
    doRegister({ data: { email, username, password, referralSource: captureReferralSource() } });
  }

  const errorMsg = error
    ? ((error.data as { error?: string } | null)?.error ?? "Ошибка регистрации")
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 px-4 py-3 mb-4">
            <img src="/readora-wordmark.webp" alt="Readora" className="h-8 w-auto" loading="eager" decoding="async" />
          </div>
          <p className="text-muted-foreground text-sm mt-1">Создайте свою библиотеку</p>
          <Link href="/" className="inline-block mt-3 text-sm text-primary hover:underline">
            ← На главную
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Регистрация</CardTitle>
            <CardDescription>
              {registrationStatus?.enabled === true
                ? "Заполните данные для создания аккаунта"
                : "Создание новых аккаунтов временно недоступно."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isRegistrationStatusLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : registrationStatus?.enabled !== true ? (
              <p className="text-center text-sm text-muted-foreground">
                {isRegistrationStatusError
                  ? "Не удалось проверить доступность регистрации. Попробуйте позже."
                  : "Регистрация отключена администратором."}
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Имя пользователя</Label>
                  <Input
                    id="username"
                    placeholder="Иван Иванов"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
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
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Минимум 8 символов"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <p className="text-sm text-destructive">{errorMsg}</p>
                )}

                <div className="flex items-start gap-2">
                  <Checkbox
                    id="consent"
                    checked={consent}
                    onCheckedChange={(checked) => setConsent(checked === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="consent" className="text-sm font-normal leading-snug">
                    Я даю согласие на обработку моих персональных данных в соответствии с{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline cursor-pointer"
                      onClick={() => setIsPrivacyOpen(true)}
                    >
                      Политикой обработки персональных данных
                    </button>
                  </Label>
                </div>

                <LegalOverlay
                  isOpen={isPrivacyOpen}
                  onClose={() => setIsPrivacyOpen(false)}
                  title="Политика обработки персональных данных"
                >
                  <PrivacyPolicyContent />
                </LegalOverlay>

                <Button type="submit" className="w-full" disabled={isPending || !consent}>
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Создать аккаунт
                </Button>
              </form>
            )}

            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">или</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {consent ? (
              <Button variant="outline" className="w-full" asChild>
                <a href="/api/auth/yandex">Войти через Яндекс</a>
              </Button>
            ) : (
              <Button variant="outline" className="w-full" disabled title="Сначала дайте согласие на обработку персональных данных">
                Войти через Яндекс
              </Button>
            )}

            <p className="text-center text-sm text-muted-foreground mt-4">
              Уже есть аккаунт?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Войти
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
