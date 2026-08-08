import { useState } from "react";
import { BookMarked, BookOpen, Library, MessageSquare, Settings, Shield, Sparkles, Upload } from "lucide-react";
import { FeedbackModal } from "@/components/FeedbackModal";
import { LegalOverlay } from "@/components/LegalOverlay";
import { CopyrightHoldersContent } from "@/components/legal/CopyrightHoldersContent";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";
import { TermsOfServiceContent } from "@/components/legal/TermsOfServiceContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PopularBook } from "@/landing-data";

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

export function LandingPage({ popularBooks }: Readonly<{ popularBooks: PopularBook[] }>) {
  const [activeLegalPage, setActiveLegalPage] = useState<"terms" | "copyright" | "privacy" | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2" aria-label="Readora">
            <img src="/readora-mark.webp" alt="" className="h-8 w-auto" loading="eager" decoding="async" />
            <img src="/readora-wordmark.webp" alt="Readora" className="h-5 w-auto" loading="eager" decoding="async" />
          </a>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><a href="/login">Войти</a></Button>
            <Button size="sm" asChild><a href="/register">Регистрация</a></Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative bg-gradient-to-b from-primary/5 via-background to-background border-b border-border">
          <div className="max-w-5xl mx-auto px-4 py-20 md:py-28 text-center">
            <div className="inline-flex items-center justify-center rounded-3xl bg-primary/15 px-6 py-4 mb-6 shadow-lg">
              <img src="/readora-wordmark.webp" alt="Readora" className="h-10 w-auto" loading="eager" decoding="async" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
              Ваша личная библиотека
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              Readora — удобное приложение для чтения книг в форматах FB2 и EPUB. Загружайте, читайте и отслеживайте прогресс без ограничений.
            </p>
            <div className="flex flex-wrap gap-3 justify-center mb-8">
              <Button size="lg" className="gap-2 shadow-lg" asChild>
                <a href="/register"><Sparkles className="w-5 h-5" /> Начать бесплатно</a>
              </Button>
              <Button size="lg" variant="outline" asChild><a href="/login">Войти</a></Button>
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
            <Button size="lg" className="gap-2 shadow-lg" asChild>
              <a href="/register"><Sparkles className="w-5 h-5" /> Зарегистрироваться бесплатно</a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 text-primary mb-3">
                <img src="/readora-mark.webp" alt="Readora" className="h-8 w-auto" loading="lazy" decoding="async" />
                <img src="/readora-wordmark.webp" alt="Readora" className="h-6 w-auto" loading="lazy" decoding="async" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Личная библиотека для чтения книг в форматах FB2 и EPUB.
                <br />
                Удобно, безопасно, бесплатно.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-3 text-sm">Навигация</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/" className="hover:text-foreground transition-colors">Главная</a></li>
                <li><a href="/library" className="hover:text-foreground transition-colors">Библиотека</a></li>
                <li><a href="/profile" className="hover:text-foreground transition-colors">Профиль</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-3 text-sm">Информация</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/about" className="hover:text-foreground transition-colors">О сервисе</a></li>
                <li><button onClick={() => setActiveLegalPage("terms")} className="hover:text-foreground transition-colors text-left">Правила пользования</button></li>
                <li><button onClick={() => setActiveLegalPage("copyright")} className="hover:text-foreground transition-colors text-left">Правообладателям</button></li>
                <li><button onClick={() => setActiveLegalPage("privacy")} className="hover:text-foreground transition-colors text-left">Политика обработки персональных данных</button></li>
                <li>
                  <button onClick={() => setIsFeedbackOpen(true)} className="hover:text-foreground transition-colors flex items-center gap-2 text-left">
                    <MessageSquare className="w-3 h-3" />
                    Обратная связь
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-border text-center text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} Readora. Личная библиотека книг.</p>
          </div>
        </div>
      </footer>

      <LegalOverlay isOpen={activeLegalPage === "terms"} onClose={() => setActiveLegalPage(null)} title="Правила пользования">
        <TermsOfServiceContent />
      </LegalOverlay>
      <LegalOverlay isOpen={activeLegalPage === "copyright"} onClose={() => setActiveLegalPage(null)} title="Информация для правообладателей">
        <CopyrightHoldersContent />
      </LegalOverlay>
      <LegalOverlay isOpen={activeLegalPage === "privacy"} onClose={() => setActiveLegalPage(null)} title="Политика обработки персональных данных">
        <PrivacyPolicyContent />
      </LegalOverlay>
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </div>
  );
}
