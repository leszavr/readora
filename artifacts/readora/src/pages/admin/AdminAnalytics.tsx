import { useMemo, useState } from "react";
import { getGetAdminAnalyticsQueryKey, getGetAdminAnalyticsUsersQueryKey, useGetAdminAnalytics, useGetAdminAnalyticsUsers } from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Activity, BookCheck, BookCopy, BookOpenCheck, Clock3, Download, MailCheck, MailWarning, RefreshCw, UserCheck, UserX, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type AnalyticsRange = 7 | 30 | 90;

const RANGES: ReadonlyArray<{ value: AnalyticsRange; label: string }> = [
  { value: 7, label: "7 дней" },
  { value: 30, label: "30 дней" },
  { value: 90, label: "90 дней" },
];

const trendConfig = {
  activeUsers: { label: "Активные пользователи", color: "hsl(var(--primary))" },
  readerSessions: { label: "Сессии чтения", color: "hsl(38 92% 50%)" },
  provisionalActiveUsers: { label: "Сегодня: пользователи", color: "hsl(24 95% 53%)" },
  provisionalReaderSessions: { label: "Сегодня: сессии", color: "hsl(340 82% 52%)" },
} satisfies ChartConfig;

const funnelConfig = {
  count: { label: "Пользователи", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const registrationsConfig = {
  registrations: { label: "Регистрации", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const countConfig = {
  count: { label: "Сессии", color: "hsl(38 92% 50%)" },
} satisfies ChartConfig;

const sessionsConfig = {
  readerSessions: { label: "Сессии чтения", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatReadingTime(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds} с`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes} мин` : `${minutes} мин ${seconds} с`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} ч` : `${hours} ч ${remainingMinutes} мин`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatWeek(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00Z`));
}

const REFERRAL_SOURCE_LABELS: Record<string, string> = {
  direct: "Прямой",
  telegram: "Telegram",
  habr: "Habr",
  productradar: "Product Radar",
  show_hn: "Show HN",
  reddit: "Reddit",
  vk: "VK",
  seo: "Поиск",
  other: "Другое",
  unknown: "Без данных",
};

const SESSION_END_REASON_LABELS: Record<string, string> = {
  hidden: "Ушёл со вкладки",
  inactive: "Бездействие",
  unmount: "Закрыл страницу",
  timeout: "Нет сигнала более 10 минут",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Компьютер",
  mobile: "Телефон",
  unknown: "Неизвестно",
};

export default function AdminAnalytics() {
  const [days, setDays] = useState<AnalyticsRange>(30);
  const [usersOpen, setUsersOpen] = useState(false);
  const { data, isError, isLoading, refetch, isFetching } = useGetAdminAnalytics(
    { days },
    { query: { queryKey: getGetAdminAnalyticsQueryKey({ days }), retry: false } },
  );

  const trendChartData = useMemo(() => {
    if (!data) return [];

    const historical = data.trend.map((day) => ({
      activityDate: day.activityDate,
      activeUsers: day.activeUsers,
      readerSessions: day.readerSessions,
      provisionalActiveUsers: null,
      provisionalReaderSessions: null,
    }));
    const currentDay = data.provisionalCurrentDay;

    if (historical.some((day) => day.activityDate === currentDay.activityDate)) {
      return historical;
    }

    return [
      ...historical,
      {
        activityDate: currentDay.activityDate,
        activeUsers: null,
        readerSessions: null,
        provisionalActiveUsers: currentDay.activeUsers,
        provisionalReaderSessions: currentDay.readerSessions,
      },
    ];
  }, [data]);

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-muted" />;
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Не удалось загрузить аналитику</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>Повторите попытку позже.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { summary, marketing, systemSummary, sessions, engagement, devices, unverifiedAccounts } = data;
  const systemCards = [
    { label: "Всего пользователей", value: formatNumber(systemSummary.totalUsers), icon: Users },
    { label: "Всего книг", value: formatNumber(systemSummary.totalBooks), icon: BookCopy },
    { label: `Активных читателей (${data.days} дней)`, value: formatNumber(systemSummary.activeReaders), icon: Activity },
    { label: `Сохранений прогресса (${data.days} дней)`, value: formatNumber(systemSummary.progressSaves), icon: BookOpenCheck },
    { label: "Подтверждения установки PWA", value: formatNumber(systemSummary.pwaInstallConfirmations), icon: Download },
  ];
  const analyticsCards = [
    { label: "Активные пользователи с аналитикой", value: formatNumber(summary.activeUsers), icon: Users },
    { label: "Открытия приложения", value: formatNumber(summary.appOpens), icon: Activity },
    { label: "Завершённые сессии чтения", value: formatNumber(summary.readerSessions), icon: BookOpenCheck },
    { label: "Время чтения", value: formatReadingTime(summary.activeReadingMs), icon: Clock3 },
  ];
  const hasFunnelData = marketing.funnel.some((step) => step.count > 0);
  const hasTrendData = trendChartData.some((day) => (
    (day.activeUsers ?? 0) > 0
    || (day.readerSessions ?? 0) > 0
    || (day.provisionalActiveUsers ?? 0) > 0
    || (day.provisionalReaderSessions ?? 0) > 0
  ));
  const registrationChartData = marketing.registrationTrend.map((week) => ({
    ...week,
    label: formatWeek(week.weekStart),
  }));
  const sourceChartData = marketing.referralSources.map((source) => ({
    ...source,
    label: REFERRAL_SOURCE_LABELS[source.source] ?? source.source,
  }));
  const sessionEndChartData = sessions.byEndReason.map((entry) => ({
    ...entry,
    label: SESSION_END_REASON_LABELS[entry.reason] ?? entry.reason,
  }));
  const deviceChartData = devices.map((device) => ({
    ...device,
    label: DEVICE_LABELS[device.deviceMode] ?? device.deviceMode,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Системная аналитика</h2>
          <p className="text-sm text-muted-foreground">
            Готовые агрегаты за {formatDate(data.rangeStart)} - {formatDate(data.rangeEnd)}. Данные за {formatDate(data.provisionalCurrentDay.activityDate)} предварительные и обновляются из сырых событий.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex shrink-0 rounded-lg border p-1" aria-label="Период аналитики">
            {RANGES.map((range) => (
              <Button
                key={range.value}
                type="button"
                variant={days === range.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setDays(range.value)}
              >
                {range.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Обновить аналитику"
            title={isFetching ? "Обновление аналитики" : "Обновить аналитику"}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">Системные показатели</h3>
          <p className="text-sm text-muted-foreground">Общие данные сервиса и чтения за выбранный период.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {systemCards.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-3 pb-4 pt-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">Рост и активация</h3>
          <p className="text-sm text-muted-foreground">Показатели по всем пользователям, зарегистрированным в выбранном периоде.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Регистрации", value: formatNumber(marketing.registrations), description: `за ${data.days} дней`, icon: Users },
            { label: "Подтвердили email", value: formatPercent(marketing.emailVerificationRate), description: `${formatNumber(marketing.verifiedUsers)} пользователей`, icon: MailCheck },
            { label: "Первая успешная загрузка", value: formatPercent(marketing.firstSuccessfulUploadRate), description: `${formatNumber(marketing.firstSuccessfulUploads)} пользователей`, icon: UserCheck },
            { label: "Дочитанные книги", value: formatPercent(systemSummary.completedBooksRate), description: `${formatNumber(systemSummary.completedBooks)} из ${formatNumber(systemSummary.totalBooks)}`, icon: BookCheck },
            { label: "Напоминания об активации", value: formatNumber(unverifiedAccounts.remindersSent), description: `отправлено за ${data.days} дней`, icon: MailWarning },
            { label: "Удалённые неактивированные", value: formatNumber(unverifiedAccounts.accountsDeleted), description: `аккаунтов за ${data.days} дней`, icon: UserX },
          ].map(({ label, value, description, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-3 pb-4 pt-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Воронка активации</CardTitle>
          <CardDescription>Новые пользователи за период: от регистрации до первого сохранения прогресса.</CardDescription>
        </CardHeader>
        <CardContent>
          {hasFunnelData ? (
            <ChartContainer config={funnelConfig} className="h-64 w-full">
              <BarChart data={marketing.funnel} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={170} tick={{ fontSize: 12 }} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Данных за выбранный период пока нет.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Возвращаемость читателей</CardTitle>
            <CardDescription>Первое сохранение прогресса в день регистрации и повторное — ровно на D7 или D30.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold">{formatPercent(marketing.retention.d7Rate)}</p>
              <p className="text-sm text-muted-foreground">D7: {formatNumber(marketing.retention.d7RetainedUsers)} из {formatNumber(marketing.retention.d7EligibleUsers)}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{formatPercent(marketing.retention.d30Rate)}</p>
              <p className="text-sm text-muted-foreground">D30: {formatNumber(marketing.retention.d30RetainedUsers)} из {formatNumber(marketing.retention.d30EligibleUsers)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Глубина использования</CardTitle>
            <CardDescription>Системные счётчики без зависимости от согласия на аналитику.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold">{formatNumber(systemSummary.booksPerUser)}</p>
              <p className="text-sm text-muted-foreground">книг на пользователя</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{formatNumber(systemSummary.progressSavesPerReader)}</p>
              <p className="text-sm text-muted-foreground">сохранений прогресса на активного читателя</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Регистрации по неделям</CardTitle>
            <CardDescription>Текущая и семь предыдущих недель.</CardDescription>
          </CardHeader>
          <CardContent>
            {registrationChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Регистраций пока нет.</p>
            ) : (
              <ChartContainer config={registrationsConfig} className="h-56 w-full">
                <BarChart data={registrationChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => `С ${value}`} />} />
                  <Bar dataKey="registrations" fill="var(--color-registrations)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Источники регистраций</CardTitle>
            <CardDescription>Только нормализованные категории; адреса и UTM-метки не сохраняются.</CardDescription>
          </CardHeader>
          <CardContent>
            {sourceChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">За период нет регистраций.</p>
            ) : (
              <ChartContainer config={registrationsConfig} className="h-56 w-full">
                <BarChart data={sourceChartData} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="registrations" fill="var(--color-registrations)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Приватная аналитика</h3>
            <p className="text-sm text-muted-foreground">Только данные пользователей, включивших сбор аналитики.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setUsersOpen(true)}>
            <Users className="mr-1.5 h-4 w-4" />
            Детализация по пользователям
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {analyticsCards.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-3 pb-4 pt-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Короткая сессия", value: formatReadingTime(sessions.minMs), description: "минимум" },
            { label: "Средняя сессия", value: formatReadingTime(sessions.avgMs), description: "среднее" },
            { label: "Долгая сессия", value: formatReadingTime(sessions.maxMs), description: "максимум" },
            {
              label: "Короткие сессии (< 30 с)",
              value: formatNumber(sessions.shortSessions),
              description: `${formatPercent(sessions.shortShare)} из ${formatNumber(sessions.count)}`,
            },
          ].map(({ label, value, description }) => (
            <Card key={label}>
              <CardContent className="pb-4 pt-5">
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "DAU (за день)", value: formatNumber(engagement.dau), description: `на ${formatDate(data.rangeEnd)}` },
            { label: "WAU (за 7 дней)", value: formatNumber(engagement.wau), description: "уникальных пользователей" },
            { label: "MAU (за 30 дней)", value: formatNumber(engagement.mau), description: "уникальных пользователей" },
            { label: "Липкость (DAU/MAU)", value: formatPercent(engagement.stickiness), description: "доля от месячной аудитории" },
          ].map(({ label, value, description }) => (
            <Card key={label}>
              <CardContent className="pb-4 pt-5">
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Причины завершения сессий</CardTitle>
              <CardDescription>Сессии без heartbeat более 10 минут завершаются на сервере по тайм-ауту.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.count === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Сессий за период нет.</p>
              ) : (
                <ChartContainer config={countConfig} className="h-56 w-full">
                  <BarChart data={sessionEndChartData} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={175} tick={{ fontSize: 11 }} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Устройства</CardTitle>
              <CardDescription>Завершённые сессии чтения по типу устройства.</CardDescription>
            </CardHeader>
            <CardContent>
              {deviceChartData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Данных за период нет.</p>
              ) : (
                <ChartContainer config={sessionsConfig} className="h-56 w-full">
                  <BarChart data={deviceChartData} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Bar dataKey="readerSessions" fill="var(--color-readerSessions)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Книги</CardDescription>
            <CardTitle>{formatNumber(summary.booksStarted)} начато / {formatNumber(summary.booksCompleted)} завершено</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            В агрегатах отражены {formatNumber(summary.trackedBooks)} книг.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Успешная синхронизация</CardDescription>
            <CardTitle>{formatPercent(summary.syncSuccessRate)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatNumber(summary.syncSuccesses)} из {formatNumber(summary.syncAttempts)} попыток.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Источник данных</CardDescription>
            <CardTitle>Дневные агрегаты</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Для текущего UTC-дня добавлены предварительные сырые события.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Динамика по дням</CardTitle>
            <CardDescription>Активные пользователи и завершённые сессии чтения. Дни без активности не включаются.</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300">
            Сегодня предварительно
          </Badge>
        </CardHeader>
        <CardContent>
          {hasTrendData ? (
            <ChartContainer config={trendConfig} className="h-72 w-full">
              <LineChart data={trendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="activityDate" tickLine={false} axisLine={false} tickFormatter={(value) => formatDate(String(value))} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => formatDate(String(value))} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line type="monotone" dataKey="activeUsers" stroke="var(--color-activeUsers)" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="readerSessions" stroke="var(--color-readerSessions)" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="provisionalActiveUsers" stroke="var(--color-provisionalActiveUsers)" strokeWidth={0} dot={{ r: 5 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="provisionalReaderSessions" stroke="var(--color-provisionalReaderSessions)" strokeWidth={0} dot={{ r: 5 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ChartContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Данных пока нет. Готовые агрегаты появятся после суточного пересчёта; предварительные данные за сегодня — после первых событий.
            </p>
          )}
        </CardContent>
      </Card>

      <UsersDetailDialog open={usersOpen} onOpenChange={setUsersOpen} days={days} />
    </div>
  );
}

function UsersDetailDialog({
  open,
  onOpenChange,
  days,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  days: AnalyticsRange;
}) {
  const { data, isLoading, isError } = useGetAdminAnalyticsUsers(
    { days },
    { query: { queryKey: getGetAdminAnalyticsUsersQueryKey({ days }), enabled: open, retry: false } },
  );
  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Детализация по пользователям</DialogTitle>
          <DialogDescription>
            {data
              ? `За ${data.days} дней: ${formatDate(data.rangeStart)} - ${formatDate(data.rangeEnd)}. Только пользователи с включённым сбором аналитики.`
              : "Загрузка…"}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Не удалось загрузить данные.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет данных за выбранный период.</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 border-b bg-background text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Пользователь</th>
                  <th className="px-2 py-2 text-right font-medium">Дней</th>
                  <th className="px-2 py-2 text-right font-medium">Сессий</th>
                  <th className="px-2 py-2 text-right font-medium">Чтение</th>
                  <th className="px-2 py-2 text-right font-medium">Ср. сессия</th>
                  <th className="px-2 py-2 text-right font-medium">Мин / Макс</th>
                  <th className="px-2 py-2 text-right font-medium">Начато / Завершено</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.userId} className="border-b last:border-0">
                    <td className="px-2 py-2 font-medium">
                      {row.username}
                      {row.role === "admin" ? " (админ)" : ""}
                    </td>
                    <td className="px-2 py-2 text-right">{formatNumber(row.activeDays)}</td>
                    <td className="px-2 py-2 text-right">{formatNumber(row.sessionCount)}</td>
                    <td className="px-2 py-2 text-right">{formatReadingTime(row.activeReadingMs)}</td>
                    <td className="px-2 py-2 text-right">{formatReadingTime(row.avgSessionMs)}</td>
                    <td className="px-2 py-2 text-right">
                      {formatReadingTime(row.minSessionMs)} / {formatReadingTime(row.maxSessionMs)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {formatNumber(row.booksStarted)} / {formatNumber(row.booksCompleted)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
