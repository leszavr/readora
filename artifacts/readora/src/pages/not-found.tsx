import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { AlertTriangle, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-4xl bg-card border border-border shadow-lg">
        <CardContent className="grid gap-10 p-8 md:p-12">
          <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center md:gap-6">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/10 text-primary md:h-28 md:w-28">
              <AlertTriangle className="h-10 w-10" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.32em] text-muted-foreground">Страница не найдена</p>
              <h1 className="mt-3 text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">404</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                Кажется, этой страницы больше нет или вы ошиблись в адресе. Переходите на главную, чтобы вернуться в приложение.
              </p>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-muted p-5">
              <p className="text-sm font-semibold text-foreground">Что можно сделать?</p>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li>• Проверьте правильность URL-адреса.</li>
                <li>• Вернитесь на главную страницу.</li>
                <li>• Откройте библиотеку или полку из меню.</li>
              </ul>
            </div>
            <div className="flex flex-col justify-between rounded-2xl border border-border bg-muted p-5">
              <div>
                <p className="text-sm font-semibold text-foreground">Нужна помощь?</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Если проблема повторяется, проверьте адрес снова или обратитесь к администратору проекта.
                </p>
              </div>
              <Button asChild size="lg" className="mt-6 gap-2 w-full sm:w-auto">
                <Link href="/">
                  <Home className="h-4 w-4" /> На главную
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
