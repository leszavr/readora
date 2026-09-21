import { useState } from "react";
import { BookMarked, BookOpen, Library, Settings, Shield, Smartphone, Sparkles, Upload } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { PwaInstallDialog } from "@/components/PwaInstallDialog";
import { SiteFooter } from "@/components/SiteFooter";
import { PublicHeaderNavigation } from "@/components/PublicHeaderNavigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { MaintenanceOverlay } from "@/components/MaintenanceOverlay";
import { useMaintenanceStatus } from "@/hooks/use-maintenance-status";
import { useRegistrationStatus } from "@/hooks/use-registration-status";
import type { LandingData, PopularBook } from "@/landing-data";

const features = [
  {
    icon: <Upload className="w-6 h-6" />,
    title: "Загрузка книг",
    description: "Поддержка форматов FB2 и EPUB. Автоматическое извлечение метаданных, обложки и оглавления из ваших файлов.",
  },
  {
    icon: <BookOpen className="w-6 h-6" />,
    title: "Удобный ридер",
    description: "Читайте с комфортом на любом устройстве. Настройте шрифт, размер, тему и отступы под себя.",
  },
  {
    icon: <BookMarked className="w-6 h-6" />,
    title: "Прогресс чтения",
    description: "Приложение запоминает, где вы остановились, и отображает процент прочитанного для каждой книги.",
  },
  {
    icon: <Settings className="w-6 h-6" />,
    title: "Гибкие настройки",
    description: "Персонализируйте читалку: выбирайте из нескольких шрифтов, регулируйте размер и ширину текста.",
  },
  {
    icon: <Library className="w-6 h-6" />,
    title: "Организация библиотеки",
    description: "Сортируйте и фильтруйте книги по жанрам, авторам, циклам. Удобный поиск по названию.",
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Приватность",
    description: "Ваши книги доступны только вам. Мы не анализируем ваши предпочтения и не показываем рекламу.",
  },
];

export function LandingPage({
  popularBooks,
  maintenanceStatus,
  registrationStatus,
}: Readonly<{
  popularBooks: PopularBook[];
  maintenanceStatus?: LandingData["maintenanceStatus"];
  registrationStatus?: LandingData["registrationStatus"];
}>) {
  const [pwaDialogOpen, setPwaDialogOpen] = useState(false);
  const { isInstalled, isInstallable, promptInstall, isIos } = usePwaInstall();
  const showPwaButton = !isInstalled && (isInstallable || isIos);
  const { isAuthenticated } = useAuth();
  const { data: currentMaintenanceStatus } = useMaintenanceStatus(maintenanceStatus);
  const { data: currentRegistrationStatus } = useRegistrationStatus(registrationStatus);

  return (
    <div className="min-h-screen flex flex-col">
      <MaintenanceOverlay status={currentMaintenanceStatus ?? null} />
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2" aria-label="Readora">
            <img src="/readora-mark.webp" alt="" className="h-8 w-auto" loading="eager" decoding="async" />
            <img src="/readora-wordmark.webp" alt="Readora" className="h-5 w-auto" loading="eager" decoding="async" />
          </a>
          <PublicHeaderNavigation registrationStatus={currentRegistrationStatus} />
        </div>
      </header>

      <main className="flex-1">
        <section className="relative isolate overflow-hidden border-b border-border">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-20"
            style={{
              backgroundImage: "linear-gradient(rgba(6, 12, 18, 0.34), rgba(6, 12, 18, 0.76)), url('/hero-bg.webp')",
              backgroundPosition: "center center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "cover",
              backgroundAttachment: "scroll",
            }}
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/25 via-background/75 to-background" />
          <div className="max-w-5xl mx-auto px-4 py-20 md:py-28 text-center relative">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight text-foreground bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent drop-shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
              Ваша личная библиотека
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              Readora — удобное приложение для чтения книг в форматах FB2 и EPUB. Загружайте, читайте и отслеживайте прогресс без ограничений.
            </p>
            <div className="flex flex-wrap gap-3 justify-center mb-8">
              {isAuthenticated ? (
                <>
                  <Button size="lg" className="gap-2 shadow-lg" asChild>
                    <a href="/library"><Library className="w-5 h-5" /> Открыть библиотеку</a>
                  </Button>
                  <Button size="lg" variant="outline" asChild><a href="/profile">Профиль</a></Button>
                </>
              ) : (
                <>
                  {currentRegistrationStatus?.enabled === true && (
                    <Button size="lg" className="gap-2 shadow-lg" asChild>
                      <a href="/register"><Sparkles className="w-5 h-5" /> Начать бесплатно</a>
                    </Button>
                  )}
                  <Button size="lg" variant="outline" asChild><a href="/login">Войти</a></Button>
                </>
              )}
              {showPwaButton && (
                <Button size="lg" variant="secondary" className="gap-2" onClick={() => setPwaDialogOpen(true)}>
                  <Smartphone className="w-5 h-5" /> Установить приложение
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Бесплатно • Без рекламы • Личные данные остаются вашими</p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 py-16 md:py-20">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">Всё необходимое для комфортного чтения</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 text-primary">{feature.icon}</div>
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {popularBooks.length > 0 && (
          <section className="bg-muted/30 border-y border-border py-16 md:py-20">
            <div className="max-w-5xl mx-auto px-4">
              <div className="text-center mb-12">
                <h2 className="text-2xl md:text-3xl font-bold mb-3">Популярные книги</h2>
                <p className="text-muted-foreground">Книги, которые чаще всего открывают пользователи Readora</p>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {popularBooks.map((book) => (
                  <Card key={book.coverUrl} className="overflow-hidden hover:shadow-lg transition-shadow">
                    <CardContent className="p-0">
                      <div className="aspect-[3/4] bg-muted relative overflow-hidden">
                        <img src={book.coverUrl} alt={`Сгенерированная обложка: ${book.title}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold line-clamp-2 mb-1">{book.title}</h3>
                        {book.author && <p className="text-sm text-muted-foreground mb-2">{book.author}</p>}
                        {book.description && <p className="text-xs text-muted-foreground line-clamp-2">{book.description}</p>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="max-w-5xl mx-auto px-4 py-16 md:py-20 text-center">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 md:p-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Начните читать прямо сейчас</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Создайте бесплатный аккаунт и загрузите свою первую книгу. Это займёт меньше минуты.</p>
            {(isAuthenticated || currentRegistrationStatus?.enabled === true) && (
              <Button size="lg" className="gap-2 shadow-lg" asChild>
                <a href={isAuthenticated ? "/library" : "/register"}>
                  {isAuthenticated ? <Library className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                  {isAuthenticated ? "Перейти в библиотеку" : "Зарегистрироваться бесплатно"}
                </a>
              </Button>
            )}
            {!isAuthenticated && currentRegistrationStatus?.enabled === false && (
              <p className="text-sm text-muted-foreground">Регистрация временно отключена. Попробуйте позже.</p>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
      <PwaInstallDialog open={pwaDialogOpen} onOpenChange={setPwaDialogOpen} onInstall={promptInstall} isIos={isIos} />
    </div>
  );
}
