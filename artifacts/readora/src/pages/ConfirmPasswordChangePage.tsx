import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export default function ConfirmPasswordChangePage() {
  const [, params] = useRoute("/confirm-password-change/:token");
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = params?.token;
    if (!token) {
      setStatus("error");
      setMessage("Недействительная ссылка подтверждения");
      return;
    }

    fetch(`/api/auth/confirm-password-change/${token}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (res.ok) {
          setStatus("success");
          setMessage(data.message ?? "Пароль успешно изменен");
          return;
        }
        setStatus("error");
        setMessage(data.error ?? "Не удалось подтвердить смену пароля");
      })
      .catch(() => {
        setStatus("error");
        setMessage("Произошла ошибка при подтверждении смены пароля");
      });
  }, [params?.token]);

  return (
    <Layout>
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg">
          <div className="text-center">
            {status === "loading" && (
              <>
                <Loader2 className="mx-auto h-16 w-16 animate-spin text-primary" />
                <h1 className="mt-4 text-2xl font-bold">Подтверждение смены пароля...</h1>
                <p className="mt-2 text-muted-foreground">Пожалуйста, подождите</p>
              </>
            )}

            {status === "success" && (
              <>
                <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
                <h1 className="mt-4 text-2xl font-bold text-green-600">Готово</h1>
                <p className="mt-2 text-muted-foreground">{message}</p>
                <Button className="mt-6" onClick={() => navigate("/login")}>
                  Перейти ко входу
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
                <h1 className="mt-4 text-2xl font-bold text-destructive">Ошибка</h1>
                <p className="mt-2 text-muted-foreground">{message}</p>
                <Button className="mt-6" onClick={() => navigate("/profile")}>Вернуться в профиль</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
