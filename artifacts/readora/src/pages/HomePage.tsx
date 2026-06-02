import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Layout } from "@/components/Layout";
import { BookOpen, Library, Upload, BookMarked, Sparkles, Settings, Shield, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

type PopularBook = {
  id: number;
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string | null;
  openCount: number;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function HomePage() {
  const { isAuthenticated } = useAuth();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const inStandalone = globalThis.matchMedia("(display-mode: standalone)").matches;
    const iosStandalone = (globalThis.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsInstalled(inStandalone || iosStandalone);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    globalThis.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    globalThis.addEventListener("appinstalled", onAppInstalled);

    return () => {
      globalThis.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      globalThis.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (!installPrompt) {
      const userAgent = globalThis.navigator.userAgent.toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(userAgent);
      if (isIOS) {
        globalThis.alert("Для установки откройте меню Поделиться и выберите На экран Домой.");
      } else {
        globalThis.alert("Установка доступна через меню браузера: выберите Установить приложение.");
      }
      return;
    }

    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setInstallPrompt(null);
    }
  }

  const { data: popularBooks = [] } = useQuery<PopularBook[]>({
    queryKey: ["popular-books"],
    queryFn: async () => {
      const res = await fetch("/api/public/popular-books?limit=6");
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative bg-gradient-to-b from-primary/5 via-background to-background border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-20 md:py-28 text-center">
          <div className="inline-flex items-center justify-center rounded-3xl bg-primary/15 px-6 py-4 mb-6 shadow-lg">
            <img src="/readora-wordmark.webp" alt="Readora" className="h-10 w-auto" loading="eager" decoding="async" />
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Ваша личная библиотека
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Readora — удобное приложение для чтения книг в форматах FB2 и EPUB. 
            Загружайте, читайте и отслеживайте прогресс без ограничений.
          </p>

          <div className="flex flex-wrap gap-3 justify-center mb-8">
            {isAuthenticated ? (
              <>
                <Link href="/library">
                  <Button size="lg" className="gap-2 shadow-lg">
                    <Library className="w-5 h-5" /> Моя библиотека
                  </Button>
                </Link>
                <Link href="/library?upload=1">
                  <Button size="lg" variant="outline" className="gap-2">
                    <Upload className="w-5 h-5" /> Загрузить книгу
                  </Button>
                </Link>
                {!isInstalled && (
                  <Button size="lg" variant="outline" className="gap-2" onClick={handleInstallClick}>
                    <Download className="w-5 h-5" /> Установить приложение
                  </Button>
                )}
              </>
            ) : (
              <>
                <Link href="/register">
                  <Button size="lg" className="gap-2 shadow-lg">
                    <Sparkles className="w-5 h-5" /> Начать бесплатно
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="lg" variant="outline" className="gap-2">
                    Войти
                  </Button>
                </Link>
                {!isInstalled && (
                  <Button size="lg" variant="outline" className="gap-2" onClick={handleInstallClick}>
                    <Download className="w-5 h-5" /> Установить приложение
                  </Button>
                )}
              </>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Бесплатно • Без рекламы • Личные данные остаются вашими
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-20">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
          Всё необходимое для комфортного чтения
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <Upload className="w-6 h-6" />,
              title: "Загрузка книг",
              desc: "Поддержка форматов FB2 и EPUB. Автоматическое извлечение метаданных, обложки и оглавления из ваших файлов.",
            },
            {
              icon: <BookOpen className="w-6 h-6" />,
              title: "Удобный ридер",
              desc: "Читайте с комфортом на любом устройстве. Настройте шрифт, размер, тему и отступы под себя.",
            },
            {
              icon: <BookMarked className="w-6 h-6" />,
              title: "Прогресс чтения",
              desc: "Приложение запоминает, где вы остановились, и отображает процент прочитанного для каждой книги.",
            },
            {
              icon: <Settings className="w-6 h-6" />,
              title: "Гибкие настройки",
              desc: "Персонализируйте читалку: выбирайте из нескольких шрифтов, регулируйте размер и ширину текста.",
            },
            {
              icon: <Library className="w-6 h-6" />,
              title: "Организация библиотеки",
              desc: "Сортируйте и фильтруйте книги по жанрам, авторам, циклам. Удобный поиск по названию.",
            },
            {
              icon: <Shield className="w-6 h-6" />,
              title: "Приватность",
              desc: "Ваши книги доступны только вам. Мы не анализируем ваши предпочтения и не показываем рекламу.",
            },
          ].map((f) => (
            <Card key={f.title} className="border-border hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Popular Books Section */}
      {popularBooks.length > 0 && (
        <section className="bg-muted/30 border-y border-border py-16 md:py-20">
          <div className="max-w-5xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold mb-3">
                Популярные книги
              </h2>
              <p className="text-muted-foreground">
                Книги, которые чаще всего открывают пользователи Readora
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {popularBooks.map((book) => (
                <Card key={book.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                  <CardContent className="p-0">
                    <div className="aspect-[3/4] bg-muted relative overflow-hidden">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="w-16 h-16 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold line-clamp-2 mb-1">{book.title}</h3>
                      {book.author && (
                        <p className="text-sm text-muted-foreground mb-2">{book.author}</p>
                      )}
                      {book.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {book.description}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA Section */}
      {!isAuthenticated && (
        <section className="max-w-5xl mx-auto px-4 py-16 md:py-20 text-center">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 md:p-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Начните читать прямо сейчас
            </h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Создайте бесплатный аккаунт и загрузите свою первую книгу. 
              Это займёт меньше минуты.
            </p>
            <Link href="/register">
              <Button size="lg" className="gap-2 shadow-lg">
                <Sparkles className="w-5 h-5" /> Зарегистрироваться бесплатно
              </Button>
            </Link>
          </div>
        </section>
      )}
    </Layout>
  );
}
