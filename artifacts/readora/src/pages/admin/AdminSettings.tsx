import { useState, useEffect } from "react";
import { useGetAppSettings, useUpdateAppSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save } from "lucide-react";

export default function AdminSettings() {
  const { data: settings, isLoading } = useGetAppSettings();

  const [siteName, setSiteName] = useState("");
  const [allowReg, setAllowReg] = useState(true);
  const [maxSize, setMaxSize] = useState(50);
  const [maintenance, setMaintenance] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setSiteName(settings.siteName ?? "Readora");
      setAllowReg(settings.allowRegistration ?? true);
      setMaxSize(settings.maxFileSizeMb ?? 50);
      setMaintenance(settings.maintenanceMode ?? false);
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
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Режим обслуживания</p>
              <p className="text-xs text-muted-foreground">Ограничить доступ для обычных пользователей</p>
            </div>
            <Switch checked={maintenance} onCheckedChange={setMaintenance} />
          </div>
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
