import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Save,
  CheckCircle2,
  Loader2,
  Send,
  AlertTriangle,
  Server,
} from "lucide-react";

interface SmtpLocal {
  host: string;
  port: string;
  user: string;
  password: string;
  from: string;
  secure: boolean;
  enabled: boolean;
}

interface SmtpResponse {
  smtp_host?: string | null;
  smtp_port?: string | null;
  smtp_user?: string | null;
  smtp_from?: string | null;
  smtp_secure?: string | null;
  smtp_enabled?: string | null;
}

const DEFAULTS: SmtpLocal = {
  host: "",
  port: "587",
  user: "",
  password: "",
  from: "",
  secure: false,
  enabled: false,
};

export function AdminSmtp() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [local, setLocal] = useState<SmtpLocal>(DEFAULTS);
  const [testEmail, setTestEmail] = useState("");

  // Загрузка настроек. Важно: НЕ обновляем форму внутри queryFn —
  // иначе любой авто-refetch (focus/mount) перетирает введённые данные.
  const { data, isLoading } = useQuery<SmtpResponse>({
    queryKey: ["admin", "smtp-settings"],
    queryFn: () => customFetch<SmtpResponse>("/api/admin/settings", { method: "GET" }),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // Гидрация локального состояния только когда данные сменились по reference
  useEffect(() => {
    if (!data) return;
    setLocal({
      host: data.smtp_host ?? "",
      port: data.smtp_port ?? "587",
      user: data.smtp_user ?? "",
      password: "",
      from: data.smtp_from ?? "",
      secure: data.smtp_secure === "true",
      enabled: data.smtp_enabled === "true",
    });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {
        smtp_host: local.host,
        smtp_port: local.port,
        smtp_user: local.user,
        smtp_from: local.from,
        smtp_secure: local.secure ? "true" : "false",
        smtp_enabled: local.enabled ? "true" : "false",
      };
      // Пароль отправляем только если пользователь его ввёл
      if (local.password.length > 0) {
        payload.smtp_password = local.password;
      }
      await customFetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({
        title: "Сохранено",
        description: "Настройки SMTP применены",
      });
      // Очищаем поле пароля после успешного сохранения, чтобы не отправлять
      // повторно при следующем save (если пользователь ничего не вводил).
      setLocal((prev) => ({ ...prev, password: "" }));
      // Точечно обновим кеш без refetch, чтобы форма не перезатёрлась
      qc.setQueryData<SmtpResponse>(["admin", "smtp-settings"], (prev) => {
        if (prev) {
          return {
            ...prev,
            smtp_host: local.host,
            smtp_port: local.port,
            smtp_user: local.user,
            smtp_from: local.from,
            smtp_secure: local.secure ? "true" : "false",
            smtp_enabled: local.enabled ? "true" : "false",
          };
        }
        return {
          smtp_host: local.host,
          smtp_port: local.port,
          smtp_user: local.user,
          smtp_from: local.from,
          smtp_secure: local.secure ? "true" : "false",
          smtp_enabled: local.enabled ? "true" : "false",
        };
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Ошибка сохранения",
        description: err instanceof Error ? err.message : "Не удалось сохранить настройки",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (to: string) => {
      return await customFetch<{ ok: boolean; messageId?: string; error?: string }>(
        "/api/admin/smtp/test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to }),
        },
      );
    },
    onSuccess: (res) => {
      toast({
        title: "Письмо отправлено",
        description: res.messageId ? `Message ID: ${res.messageId}` : undefined,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Ошибка отправки",
        description: err instanceof Error ? err.message : "Не удалось отправить тестовое письмо",
        variant: "destructive",
      });
    },
  });

  function handleSave() {
    saveMutation.mutate();
  }

  function handleSendTest() {
    const trimmed = testEmail.trim();
    if (!trimmed) {
      toast({
        title: "Укажите email",
        description: "Введите email получателя тестового письма",
        variant: "destructive",
      });
      return;
    }
    testMutation.mutate(trimmed);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Email / SMTP</h2>
        <p className="text-muted-foreground mt-1">
          Настройте SMTP для отправки писем (подтверждение email, восстановление пароля)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Настройки SMTP сервера
          </CardTitle>
          <CardDescription>
            Изменения применяются сразу после нажатия «Сохранить» — перезапуск сервера не требуется
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div className="space-y-1">
              <Label htmlFor="smtp-enabled" className="font-semibold">
                Включить SMTP
              </Label>
              <p className="text-sm text-muted-foreground">
                Активировать отправку email через SMTP-сервер
              </p>
            </div>
            <Switch
              id="smtp-enabled"
              checked={local.enabled}
              onCheckedChange={(checked) =>
                setLocal((prev) => ({ ...prev, enabled: checked }))
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">Хост SMTP сервера *</Label>
              <Input
                id="smtp-host"
                placeholder="smtp.example.com"
                value={local.host}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, host: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Например: smtp.gmail.com, smtp.yandex.ru, mail.yourdomain.com
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-port">Порт *</Label>
              <Input
                id="smtp-port"
                type="number"
                placeholder="587"
                value={local.port}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, port: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                587 (STARTTLS) или 465 (SSL)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-user">Имя пользователя</Label>
              <Input
                id="smtp-user"
                placeholder="noreply@yourdomain.com"
                value={local.user}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, user: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-password">Пароль</Label>
              <Input
                id="smtp-password"
                type="password"
                placeholder="••••••••"
                value={local.password}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, password: e.target.value }))
                }
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Оставьте пустым, чтобы сохранить ранее введённый пароль
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp-from">От кого (From email) *</Label>
            <Input
              id="smtp-from"
              placeholder="Readora <noreply@yourdomain.com>"
              value={local.from}
              onChange={(e) =>
                setLocal((prev) => ({ ...prev, from: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Адрес отправителя для всех системных писем
            </p>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div className="space-y-1">
              <Label htmlFor="smtp-secure">Использовать SSL/TLS</Label>
              <p className="text-sm text-muted-foreground">
                Шифрованное подключение (обычно для порта 465)
              </p>
            </div>
            <Switch
              id="smtp-secure"
              checked={local.secure}
              onCheckedChange={(checked) =>
                setLocal((prev) => ({ ...prev, secure: checked }))
              }
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="w-full"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Сохранить настройки
              </>
            )}
          </Button>

          {saveMutation.isSuccess && !saveMutation.isPending && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Настройки сохранены
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Тестовая отправка
          </CardTitle>
          <CardDescription>
            Отправьте тестовое письмо, чтобы проверить корректность настроек SMTP
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="test@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              disabled={!local.enabled}
            />
            <Button
              type="button"
              onClick={handleSendTest}
              disabled={testMutation.isPending || !local.enabled || !testEmail.trim()}
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Отправить
                </>
              )}
            </Button>
          </div>

          {!local.enabled && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-800 rounded-lg">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm">
                SMTP отключён. Включите SMTP и сохраните настройки, чтобы отправить тестовое письмо.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Популярные SMTP-провайдеры
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <div>
            <strong className="text-foreground">Gmail:</strong> smtp.gmail.com:587, требуется App Password
          </div>
          <div>
            <strong className="text-foreground">Yandex:</strong> smtp.yandex.ru:465 (SSL)
          </div>
          <div>
            <strong className="text-foreground">Mail.ru:</strong> smtp.mail.ru:465 (SSL)
          </div>
          <div>
            <strong className="text-foreground">SendGrid:</strong> smtp.sendgrid.net:587
          </div>
          <div>
            <strong className="text-foreground">Mailgun:</strong> smtp.mailgun.org:587
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
