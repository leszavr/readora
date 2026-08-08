import { BookOpen, CheckCircle2, Library, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const aboutFaqItems = [
  {
    question: "Связан ли Readora.ru с другими приложениями или сервисами с похожим названием?",
    answer: "Нет. Readora.ru — самостоятельный веб-сервис. Мы не связаны с мобильными приложениями, сайтами или другими продуктами третьих лиц, которые используют похожее название.",
  },
  {
    question: "Есть ли в Readora.ru платные подписки?",
    answer: "Нет. Readora.ru не оформляет платные подписки, не запрашивает платёжные данные и не списывает деньги с пользователей.",
  },
  {
    question: "Где хранятся мои книги?",
    answer: "Книги, которые вы добавляете в библиотеку, хранятся в защищённом серверном хранилище. Доступ к ним есть только у владельца учётной записи.",
  },
  {
    question: "Нужна ли регистрация?",
    answer: "Да. Для работы с личной библиотекой нужен аккаунт. При регистрации используется адрес электронной почты для подтверждения учётной записи и восстановления доступа.",
  },
  {
    question: "Как удалить учётную запись и книги?",
    answer: "Учётную запись можно удалить в настройках профиля. Вместе с ней удаляются связанные данные, включая адрес электронной почты и загруженные файлы книг.",
  },
];

export function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
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
        <section className="border-b border-border bg-primary/5">
          <div className="max-w-3xl mx-auto px-4 py-16 md:py-20 text-center">
            <p className="text-sm font-medium text-primary mb-4">О сервисе</p>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Readora.ru — самостоятельная личная веб-библиотека</h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Readora.ru помогает хранить, организовывать и читать собственные книги в форматах FB2 и EPUB прямо в браузере.
            </p>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 py-12 md:py-16 space-y-10">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-6 md:p-8">
              <h2 className="text-2xl font-bold mb-4">Readora.ru не связана с другими одноимёнными продуктами</h2>
              <p className="text-muted-foreground leading-relaxed">
                В магазинах приложений и интернете могут существовать сервисы с похожим названием. Readora.ru — независимый веб-сервис и не относится к мобильным приложениям, сайтам или продуктам третьих лиц с названием Readora.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                По вопросам подписок, платежей или списаний в сторонних приложениях обращайтесь в поддержку соответствующего магазина приложений или разработчика этого приложения.
              </p>
            </CardContent>
          </Card>

          <section>
            <h2 className="text-2xl font-bold mb-6">Как устроена Readora.ru</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-6">
                  <Library className="w-6 h-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Личная библиотека</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Добавляйте собственные книги FB2 и EPUB, объединяйте их в циклы и находите нужное через поиск и фильтры.</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <BookOpen className="w-6 h-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Чтение в браузере</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Настраивайте шрифт, размер текста, тему и ширину колонки. Прогресс чтения сохраняется автоматически.</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <CheckCircle2 className="w-6 h-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Без платных подписок</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Readora.ru не оформляет платные подписки, не запрашивает платёжные данные и не показывает рекламу.</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <LockKeyhole className="w-6 h-6 text-primary mb-3" aria-hidden="true" />
                  <h3 className="font-semibold mb-2">Приватный доступ</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Загруженные книги хранятся в защищённом хранилище и доступны только владельцу учётной записи.</p>
                </CardContent>
              </Card>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-6">Частые вопросы</h2>
            <Accordion type="single" collapsible className="border-t border-border">
              {aboutFaqItems.map((item, index) => (
                <AccordionItem key={item.question} value={`faq-${index}`}>
                  <AccordionTrigger className="py-5 text-base font-semibold hover:no-underline">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent forceMount className="text-base text-muted-foreground leading-relaxed">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center">
            <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-2xl font-bold mb-3">Начните с личной библиотеки</h2>
            <p className="text-muted-foreground max-w-xl mx-auto mb-6">Создайте аккаунт, чтобы хранить и читать свои книги в одном месте.</p>
            <Button size="lg" asChild><a href="/register">Создать аккаунт</a></Button>
            <p className="text-sm text-muted-foreground mt-5">
              Вопросы о сервисе: <a className="text-primary hover:underline" href="mailto:admin@voxlibris.ru"><Mail className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />admin@voxlibris.ru</a>
            </p>
          </section>
        </section>
      </main>
    </div>
  );
}
