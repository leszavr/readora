import { useState } from "react";
import { getGetAdminAnalyticsQueryKey, useGetAdminAnalytics } from "@workspace/api-client-react";
import { Activity, BookCheck, BookCopy, BookOpen, BookOpenCheck, ChartNoAxesCombined, Clock3, Download, MailCheck, RefreshCw, UserCheck, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AnalyticsRange = 7 | 30 | 90;

const RANGES: ReadonlyArray<{ value: AnalyticsRange; label: string }> = [
  { value: 7, label: "7 дней" },
  { value: 30, label: "30 дней" },
  { value: 90, label: "90 дней" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatReadingTime(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} мин`;

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

export default function AdminAnalytics() {
  const [days, setDays] = useState<AnalyticsRange>(30);
  const { data, isError, isLoading, refetch, isFetching } = useGetAdminAnalytics(
    { days },
    { query: { queryKey: getGetAdminAnalyticsQueryKey({ days }), retry: false } },
  );

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

  const { summary, marketing, systemSummary } = data;
  const systemCards = [
    { label: "Всего пользователей", value: formatNumber(systemSummary.totalUsers), icon: Users },
    { label: "Всего книг", value: formatNumber(systemSummary.totalBooks), icon: BookCopy },
    { label: `Активных читателей (${data.days} дней)`, value: formatNumber(systemSummary.activeReaders), icon: Activity },
    { label: `Открытий книг (${data.days} дней)`, value: formatNumber(systemSummary.bookOpens), icon: BookOpen },
    { label: "Установок PWA (accepted)", value: formatNumber(systemSummary.pwaInstallAccepted), icon: Download },
  ];
  const analyticsCards = [
    { label: "Активные пользователи с аналитикой", value: formatNumber(summary.activeUsers), icon: Users },
    { label: "Открытия приложения", value: formatNumber(summary.appOpens), icon: Activity },
    { label: "Сессии чтения", value: formatNumber(summary.readerSessions), icon: BookOpenCheck },
    { label: "Время чтения", value: formatReadingTime(summary.activeReadingMs), icon: Clock3 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Системная аналитика</h2>
          <p className="text-sm text-muted-foreground">
            Приватная аналитика за {formatDate(data.rangeStart)} - {formatDate(data.rangeEnd)}.
          </p>
        </div>
        <div className="flex rounded-lg border p-1" aria-label="Период аналитики">
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
          <p className="text-sm text-muted-foreground">Системные показатели по всем пользователям за выбранный период.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Регистрации", value: formatNumber(marketing.registrations), description: `за ${data.days} дней`, icon: Users },
            { label: "Подтвердили email", value: formatPercent(marketing.emailVerificationRate), description: `${formatNumber(marketing.verifiedUsers)} пользователей`, icon: MailCheck },
            { label: "Загрузили первую книгу", value: formatPercent(marketing.firstBookUploadRate), description: `${formatNumber(marketing.usersWithBooks)} пользователей`, icon: UserCheck },
            { label: "Дочитанные книги", value: formatPercent(systemSummary.completedBooksRate), description: `${formatNumber(systemSummary.completedBooks)} из ${formatNumber(systemSummary.totalBooks)}`, icon: BookCheck },
          ].map(({ label, value, description, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-3 pb-4 pt-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
                <div className="min-w-0"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Возвращаемость читателей</CardTitle>
            <CardDescription>Пользователь читал в день регистрации и вернулся в указанный срок.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div><p className="text-2xl font-bold">{formatPercent(marketing.retention.d7Rate)}</p><p className="text-sm text-muted-foreground">D7: {formatNumber(marketing.retention.d7RetainedUsers)} из {formatNumber(marketing.retention.d7EligibleUsers)}</p></div>
            <div><p className="text-2xl font-bold">{formatPercent(marketing.retention.d30Rate)}</p><p className="text-sm text-muted-foreground">D30: {formatNumber(marketing.retention.d30RetainedUsers)} из {formatNumber(marketing.retention.d30EligibleUsers)}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle>Глубина использования</CardTitle><CardDescription>Системные счётчики без зависимости от согласия на аналитику.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div><p className="text-2xl font-bold">{formatNumber(systemSummary.booksPerUser)}</p><p className="text-sm text-muted-foreground">книг на пользователя</p></div>
            <div><p className="text-2xl font-bold">{formatNumber(systemSummary.readEventsPerActiveReader)}</p><p className="text-sm text-muted-foreground">открытий на активного читателя</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle>Регистрации по неделям</CardTitle><CardDescription>Текущая и семь предыдущих недель.</CardDescription></CardHeader>
          <CardContent>
            {marketing.registrationTrend.length === 0 ? <p className="text-sm text-muted-foreground">Регистраций пока нет.</p> : <div className="space-y-2">{marketing.registrationTrend.map((week) => <div key={week.weekStart} className="flex items-center justify-between border-b pb-2 last:border-0"><span className="text-sm">С {formatWeek(week.weekStart)}</span><span className="font-medium">{formatNumber(week.registrations)}</span></div>)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle>Источники регистраций</CardTitle><CardDescription>Только нормализованные категории; адреса и UTM-метки не сохраняются.</CardDescription></CardHeader>
          <CardContent>
            {marketing.referralSources.length === 0 ? <p className="text-sm text-muted-foreground">За период нет регистраций.</p> : <div className="space-y-2">{marketing.referralSources.map((source) => <div key={source.source} className="flex items-center justify-between border-b pb-2 last:border-0"><span className="text-sm">{REFERRAL_SOURCE_LABELS[source.source]}</span><span className="font-medium">{formatNumber(source.registrations)}</span></div>)}</div>}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">Приватная аналитика</h3>
          <p className="text-sm text-muted-foreground">Только данные пользователей, включивших сбор аналитики.</p>
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
        <p className="text-sm text-muted-foreground">Средняя длительность сессии: {formatReadingTime(summary.averageSessionReadingMs)}.</p>
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
            <CardTitle>{summary.syncSuccessRate}%</CardTitle>
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
            Сырые события и персональные данные не выводятся.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Динамика по дням</CardTitle>
            <CardDescription>Дни без данных не включаются в таблицу.</CardDescription>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => void refetch()} disabled={isFetching} aria-label="Обновить аналитику">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {data.trend.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Данных пока нет. Они появятся после ежедневного пересчёта аналитики.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-3 font-medium">Дата</th>
                    <th className="pb-3 text-right font-medium">Пользователи</th>
                    <th className="pb-3 text-right font-medium">Открытия</th>
                    <th className="pb-3 text-right font-medium">Сессии</th>
                    <th className="pb-3 text-right font-medium">Чтение</th>
                    <th className="pb-3 text-right font-medium">Завершено</th>
                    <th className="pb-3 text-right font-medium">Синхронизация</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trend.map((day) => (
                    <tr key={day.activityDate} className="border-b last:border-0">
                      <td className="py-3 font-medium">{formatDate(day.activityDate)}</td>
                      <td className="py-3 text-right">{formatNumber(day.activeUsers)}</td>
                      <td className="py-3 text-right">{formatNumber(day.appOpens)}</td>
                      <td className="py-3 text-right">{formatNumber(day.readerSessions)}</td>
                      <td className="py-3 text-right">{formatReadingTime(day.activeReadingMs)}</td>
                      <td className="py-3 text-right">{formatNumber(day.booksCompleted)}</td>
                      <td className="py-3 text-right">{formatNumber(day.syncSuccesses)} / {formatNumber(day.syncAttempts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
