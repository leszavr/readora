import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export default function VerifyEmailPage() {
  const [, params] = useRoute("/verify/:token");
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

    fetch(`/api/auth/verify/${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.message) {
          setStatus("success");
          setMessage(data.message);
        } else {
          setStatus("error");
          setMessage(data.error || "Не удалось подтвердить email");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Произошла ошибка при подтверждении email");
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
                <h1 className="mt-4 text-2xl font-bold">Подтверждение email...</h1>
                <p className="mt-2 text-muted-foreground">Пожалуйста, подождите</p>
              </>
            )}

            {status === "success" && (
              <>
                <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
                <h1 className="mt-4 text-2xl font-bold text-green-600">Email подтвержден!</h1>
                <p className="mt-2 text-muted-foreground">{message}</p>
                <Button className="mt-6" onClick={() => navigate("/library")}>
                  Перейти в библиотеку
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
                <h1 className="mt-4 text-2xl font-bold text-destructive">Ошибка подтверждения</h1>
                <p className="mt-2 text-muted-foreground">{message}</p>
                <div className="mt-6 space-y-3">
                  <Button onClick={() => navigate("/login")}>Войти</Button>
                  <p className="text-sm text-muted-foreground">
                    Ссылка могла истечь. Запросите новую ссылку в настройках профиля.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
