import { useState, useEffect } from "react";
import { useGetAppSettings, useUpdateAppSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, AlertTriangle } from "lucide-react";

export default function AdminSettings() {
  const { data: settings, isLoading } = useGetAppSettings();

  const [siteName, setSiteName] = useState("");
  const [allowReg, setAllowReg] = useState(true);
  const [maxSize, setMaxSize] = useState(50);
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceReason, setMaintenanceReason] = useState("");
  const [maintenanceEta, setMaintenanceEta] = useState("");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setSiteName(settings.siteName ?? "Readora");
      setAllowReg(settings.allowRegistration ?? true);
      setMaxSize(settings.maxFileSizeMb ?? 50);
      setMaintenance(settings.maintenanceMode ?? false);
      setMaintenanceReason(settings.maintenanceReason ?? "");
      setMaintenanceEta(settings.maintenanceEta ?? "");
      setMaintenanceMessage(settings.maintenanceMessage ?? "");
    }
  }, [settings]);

  const { mutate: updateSettings, isPending } = useUpdateAppSettings({
    mutation: {
      onSuccess: () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
    },
  });

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    updateSettings({
      data: {
        siteName,
        allowRegistration: allowReg,
        maxFileSizeMb: maxSize,
        maintenanceMode: maintenance,
        maintenanceReason: maintenanceReason || null,
        maintenanceEta: maintenanceEta || null,
        maintenanceMessage: maintenanceMessage || null,
      },
    });
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Общие настройки</CardTitle>
          <CardDescription>Основные параметры сайта</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Название сайта</Label>
            <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Максимальный размер файла (МБ)</Label>
            <Input
              type="number" min={1} max={500}
              value={maxSize}
                onChange={(e) => setMaxSize(Number.parseInt(e.target.value, 10) || 50)}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Разрешить регистрацию</p>
              <p className="text-xs text-muted-foreground">Новые пользователи смогут зарегистрироваться</p>
            </div>
            <Switch checked={allowReg} onCheckedChange={setAllowReg} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <CardTitle className="text-base">Режим обслуживания</CardTitle>
          </div>
          <CardDescription>Настройки отображения информации о технических работах</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Включить режим обслуживания</p>
              <p className="text-xs text-muted-foreground">Ограничить доступ для обычных пользователей</p>
            </div>
            <Switch checked={maintenance} onCheckedChange={setMaintenance} />
          </div>
          
          {maintenance && (
            <div className="space-y-4 pt-2 border-t border-border">
              <div className="space-y-2">
                <Label htmlFor="maintenance-reason">Причина остановки</Label>
                <Input
                  id="maintenance-reason"
                  placeholder="Например: Обновление сервера"
                  value={maintenanceReason}
                  onChange={(e) => setMaintenanceReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Краткое описание причины технических работ
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="maintenance-eta">Ориентировочное время окончания</Label>
                <Input
                  id="maintenance-eta"
                  placeholder="Например: 18:00 или 2 часа"
                  value={maintenanceEta}
                  onChange={(e) => setMaintenanceEta(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Когда планируется завершение работ (произвольный текст)
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="maintenance-message">Дополнительное сообщение</Label>
                <textarea
                  id="maintenance-message"
                  placeholder="Введите дополнительную информацию для пользователей..."
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Развёрнутое сообщение с деталями о проводимых работах
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {saved && <p className="text-sm text-green-600">Настройки сохранены</p>}

      <Button type="submit" disabled={isPending} className="gap-2">
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Сохранить настройки
      </Button>
    </form>
  );
}
