import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminFeedbackQueryKey,
  useDeleteAdminFeedback,
  useDeleteAdminFeedbackItem,
  useGetAdminFeedback,
} from "@workspace/api-client-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, MessageSquareText, RefreshCw, Star, Trash2, TrendingUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

type RangeValue = "all" | "7" | "30" | "90";

const RANGES: ReadonlyArray<{ value: RangeValue; label: string }> = [
  { value: "all", label: "Все время" },
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
];

const RATING_OPTIONS = ["all", "5", "4", "3", "2", "1"] as const;

const distributionConfig = {
  count: { label: "Отзывы", color: "hsl(38 92% 50%)" },
} satisfies ChartConfig;

const painPointConfig = {
  count: { label: "Упоминания", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const trendConfig = {
  count: { label: "Отзывы", color: "hsl(var(--primary))" },
  averageRating: { label: "Средняя оценка", color: "hsl(38 92% 50%)" },
} satisfies ChartConfig;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export default function AdminFeedback() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<RangeValue>("all");
  const [rating, setRating] = useState<(typeof RATING_OPTIONS)[number]>("all");
  const [painPoint, setPainPoint] = useState("all");
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const params = useMemo(() => ({ days, rating, painPoint }), [days, rating, painPoint]);

  const { data, isError, isLoading, refetch, isFetching } = useGetAdminFeedback(params, {
    query: { queryKey: getGetAdminFeedbackQueryKey(params), retry: false },
  });

  const painPointOptions = data?.filters.painPointOptions ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetAdminFeedbackQueryKey() });

  const deleteAll = useDeleteAdminFeedback();
  const deleteOne = useDeleteAdminFeedbackItem();

  async function handleDeleteAll() {
    setDeleting(true);
    try {
      await deleteAll.mutateAsync({ params });
      await invalidate();
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteOne(id: number) {
    await deleteOne.mutateAsync({ id });
    await invalidate();
  }

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-muted" />;
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Не удалось загрузить отзывы</AlertTitle>
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

  const { summary, items } = data;
  const hasData = summary.total > 0;
  const hasActiveFilters = days !== "all" || rating !== "all" || painPoint !== "all";

  const cards = [
    { label: "Всего отзывов", value: formatNumber(summary.total), icon: MessageSquareText },
    { label: "Средняя оценка", value: summary.averageRating.toFixed(2), icon: Star },
    { label: "Оценки ниже 5", value: formatNumber(summary.lowRatings), icon: TrendingUp },
    {
      label: "Запросили связь",
      value: `${formatNumber(summary.contactRequests)} (${summary.contactRate}%)`,
      icon: Mail,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Отзывы пользователей</h2>
          <p className="text-sm text-muted-foreground">
            Ответы на опрос оценки сайта. Контакты видны только администратору.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => void refetch()} disabled={isFetching} aria-label="Обновить отзывы">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" size="sm" disabled={!hasData || deleting}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                {hasActiveFilters ? "Удалить найденные" : "Удалить все"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {hasActiveFilters ? "Удалить отзывы по фильтрам?" : "Удалить все отзывы?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {hasActiveFilters
                    ? `Будут безвозвратно удалены ${formatNumber(summary.total)} отзывов, попавших под текущие фильтры, и статистика по ним.`
                    : `Будут безвозвратно удалены все ${formatNumber(summary.total)} отзывов и статистика по ним.`}{" "}
                  Действие необратимо.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    void handleDeleteAll();
                  }}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Удалить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Период</p>
          <Select value={days} onValueChange={(value) => setDays(value as RangeValue)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Оценка</p>
          <Select value={rating} onValueChange={(value) => setRating(value as (typeof RATING_OPTIONS)[number])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RATING_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "Все оценки" : `${option} звезд`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Тип жалобы</p>
          <Select value={painPoint} onValueChange={setPainPoint}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все жалобы</SelectItem>
              {painPointOptions.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
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

      {hasData && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Распределение оценок</CardTitle>
              <CardDescription>Количество отзывов по каждой оценке.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={distributionConfig} className="h-56 w-full">
                <BarChart data={summary.distribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="rating"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value} ★`}
                  />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent labelFormatter={(value) => `Оценка ${value}`} />}
                  />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Типы жалоб</CardTitle>
              <CardDescription>Как часто упоминается каждая причина.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.topPainPoints.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Причин пока не выбрано.</p>
              ) : (
                <ChartContainer config={painPointConfig} className="h-56 w-full">
                  <BarChart
                    data={summary.topPainPoints}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      width={190}
                      tick={{ fontSize: 11 }}
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {hasData && summary.trend.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Динамика по дням</CardTitle>
            <CardDescription>Количество отзывов и средняя оценка за день.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={trendConfig} className="h-64 w-full">
              <LineChart data={summary.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={formatDay} />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={formatDay} />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="averageRating" stroke="var(--color-averageRating)" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Список отзывов</CardTitle>
          <CardDescription>
            Найдено {formatNumber(summary.total)}, показаны последние {formatNumber(items.length)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              По выбранным фильтрам отзывов нет.
            </p>
          ) : (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Star
                          key={value}
                          className={cn(
                            "h-4 w-4",
                            value <= item.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                          )}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDeleteOne(item.id)}
                        aria-label="Удалить отзыв"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {item.painPoints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.painPoints.map((point) => (
                        <Badge key={point} variant="secondary">{point}</Badge>
                      ))}
                    </div>
                  )}

                  {item.missingFeature && (
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">Не хватает: </span>
                      {item.missingFeature}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{item.user ? `Авторизован: ${item.user.username || item.user.email}` : "Аноним"}</span>
                    {item.pageUrl && <span>{item.pageUrl}</span>}
                    {item.wantsContact && (
                      <span className="flex items-center gap-1 text-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        {item.contactInfo ?? (item.user?.email ?? "Контакты в профиле")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
