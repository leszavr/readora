import { lazy } from "react";
import { Cloud, FolderOpen, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PublicHeaderNavigation } from "@/components/PublicHeaderNavigation";
import { SiteFooter } from "@/components/SiteFooter";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";

const ExternalStorageCard = lazy(() =>
  import("@/components/external-storage/ExternalStorageCard").then(({ ExternalStorageCard }) => ({ default: ExternalStorageCard })),
);

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {n}
      </span>
      <div className="space-y-1">
        <p className="font-medium leading-7">{title}</p>
        <p className="text-muted-foreground leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

const FAQ_ITEMS: Array<{ question: string; answer: React.ReactNode }> = [
  {
    question: "Расходуется ли место на сервере?",
    answer:
      "Нет. Файлы книг остаются в вашем облаке. На сервере хранятся только обложки, описания, оглавления, а также временный кэш содержимого читаемых книг — он не входит в вашу квоту.",
  },
  {
    question: "Что будет, если удалить файл из облака?",
    answer:
      "Книга пометится как недоступная, но останется в библиотеке вместе с прогрессом чтения, закладками и заметками. Если вернуть файл в облако и повторить синхронизацию, книга снова станет доступной.",
  },
  {
    question: "Что будет при отключении хранилища?",
    answer:
      "Книги, прогресс, закладки и заметки сохраняются, но открыть книги из этого хранилища будет нельзя. Файлы в облаке не удаляются. При повторном подключении того же хранилища книги привяжутся обратно автоматически.",
  },
  {
    question: "Почему какая-то книга не загрузилась?",
    answer:
      "Если во время синхронизации не удалось скачать или распознать файл, счётчик «Ошибок» в карточке подключения покажет их количество. Нажмите «Ошибки — показать», чтобы увидеть конкретный файл и причину: проблему со скачиванием, ошибку обработки (например, повреждённый файл) или дубликат.",
  },
  {
    question: "В облаке есть книги, которые я уже загружал вручную. Что с ними будет?",
    answer:
      "Синхронизация распознаёт полностью совпадающие файлы и не создаёт копии. Вместо этого в карточке подключения появится блок «Локальные копии книг из облака»: можно перенести такую книгу в облако — файл удалится с сервера и освободит место в квоте, а прогресс чтения, закладки и заметки сохранятся, книга будет читаться из облака.",
  },
  {
    question: "Удаляет ли Readora что-нибудь в моём облаке?",
    answer:
      "Нет. Readora работает с облаком только в режиме чтения: перечисляет папки, скачивает файлы книг и их метаданные. Удалить или изменить файлы в облаке технически невозможно.",
  },
  {
    question: "Можно ли приостановить синхронизацию?",
    answer:
      "Да. Во время синхронизации доступны кнопки «Пауза» и «Остановить», из паузы — «Продолжить». Прогресс синхронизации восстанавливается после перезагрузки страницы, а возобновление продолжится с места остановки.",
  },
  {
    question: "Как часто нужно синхронизировать?",
    answer:
      "По необходимости: добавили книги в облако — нажмите «Синхронизировать», и новые книги появятся в библиотеке. Изменённые файлы обновятся автоматически, отсутствующие будут помечены.",
  },
  {
    question: "Почему Яндекс.Диск просит разрешение на доступ?",
    answer:
      "Подключение выполняется через официальный OAuth Яндекса: Readora получает отдельный токен только для чтения Диска. Пароль от аккаунта Яндекса при этом не вводится и не сохраняется.",
  },
  {
    question: "Зачем Mail.ru нужен отдельный пароль приложения?",
    answer:
      "Облако Mail.ru не предоставляет OAuth-доступа сторонним сервисам — подключение выполняется по протоколу WebDAV с паролем приложения. Это официальный и безопасный способ: основной пароль аккаунта не используется, а пароль приложения можно отозвать в любой момент.",
  },
];

export default function HelpExternalStoragePage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2" aria-label="Readora">
            <img src="/readora-mark.webp" alt="" className="h-8 w-auto" loading="eager" decoding="async" />
            <img src="/readora-wordmark.webp" alt="Readora" className="h-5 w-auto" loading="eager" decoding="async" />
          </a>
          <PublicHeaderNavigation />
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b border-border bg-primary/5">
          <div className="max-w-3xl mx-auto px-4 py-14 md:py-18 text-center">
            <p className="text-sm font-medium text-primary mb-4">Инструкция</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Подключение внешних хранилищ книг
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Читайте книги из Яндекс.Диска и Облака Mail.ru, не расходуя место на сервере. Файлы остаются
              в вашем облаке, а прогресс, закладки и заметки синхронизируются между всеми устройствами.
            </p>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 py-12 space-y-12">
          <div className="grid sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5">
                <HardDrive className="w-5 h-5 text-primary mb-3" aria-hidden="true" />
                <p className="font-medium mb-1">Без расхода квоты</p>
                <p className="text-sm text-muted-foreground">Файлы книг хранятся в вашем облаке</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <ShieldCheck className="w-5 h-5 text-primary mb-3" aria-hidden="true" />
                <p className="font-medium mb-1">Только чтение</p>
                <p className="text-sm text-muted-foreground">Readora не изменяет и не удаляет файлы в облаке</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <FolderOpen className="w-5 h-5 text-primary mb-3" aria-hidden="true" />
                <p className="font-medium mb-1">Выбор папки</p>
                <p className="text-sm text-muted-foreground">Сканируется выбранная папка с подпапками</p>
              </CardContent>
            </Card>
          </div>

          <section id="yandex" className="space-y-6">
            <div className="flex items-center gap-3">
              <Cloud className="w-6 h-6 text-primary" aria-hidden="true" />
              <h2 className="text-2xl font-bold">Яндекс.Диск</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Подключение выполняется через официальный механизм авторизации Яндекса: вы подтверждаете
              разрешение на чтение Диска одним кликом, пароль от аккаунта не вводится.
            </p>
            <ol className="space-y-5">
              <Step n={1} title="Откройте профиль">
                В меню сайта перейдите в раздел профиля и найдите карточку «Внешние хранилища».
              </Step>
              <Step n={2} title="Нажмите «Подключить Яндекс.Диск»">
                Вы перейдёте на страницу авторизации Яндекса. Если вы не вошли в аккаунт — введите логин и
                пароль Яндекса (их видит только Яндекс, не Readora).
              </Step>
              <Step n={3} title="Разрешите доступ к Диску">
                Нажмите «Разрешить» в диалоге Яндекса. Readora получает токен, который позволяет только
                читать файлы Диска. После подтверждения вы вернётесь в профиль.
              </Step>
              <Step n={4} title="Выберите папку с книгами">
                Нажмите «Папка» в карточке подключения и укажите каталог, где лежат книги. Подпапки
                сканируются автоматически.
              </Step>
              <Step n={5} title="Запустите синхронизацию">
                Нажмите «Синхронизировать». Readora перечислит файлы, прочитает метаданные и обложки, и
                книги появятся в библиотеке. Следите за прогрессом в карточке подключения.
              </Step>
            </ol>
          </section>

          <section id="mailru" className="space-y-6">
            <div className="flex items-center gap-3">
              <HardDrive className="w-6 h-6 text-primary" aria-hidden="true" />
              <h2 className="text-2xl font-bold">Облако Mail.ru</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Облако Mail.ru подключается по протоколу WebDAV с паролем приложения. Основной пароль
              аккаунта не используется и не сохраняется.
            </p>
            <ol className="space-y-5">
              <Step n={1} title="Создайте пароль приложения">
                В настройках безопасности аккаунта Mail.ru (id.mail.ru, раздел «Безопасность», пункт
                «Пароли приложений») создайте новый пароль приложения. Придумайте ему понятное имя,
                например «Readora».
              </Step>
              <Step n={2} title="Нажмите «Подключить Облако Mail.ru»">
                В карточке «Внешние хранилища» в профиле нажмите кнопку подключения.
              </Step>
              <Step n={3} title="Введите логин и пароль приложения">
                Укажите адрес вашей почты Mail.ru и созданный на шаге 1 пароль приложения — не основной
                пароль аккаунта.
              </Step>
              <Step n={4} title="Выберите папку и синхронизируйте">
                Как и для Яндекс.Диска: кнопка «Папка» — выбор каталога с книгами, «Синхронизировать» —
                импорт.
              </Step>
            </ol>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-primary" aria-hidden="true" />
              <h2 className="text-2xl font-bold">Синхронизация</h2>
            </div>
            <ul className="space-y-3 text-muted-foreground leading-relaxed list-disc pl-5">
              <li>Поддерживаемые форматы: FB2 (в том числе fb2.zip/fbz), EPUB, MOBI, CBZ, TXT, MD, HTML.</li>
              <li>Сканируется выбранная папка и её подпапки (до 6 уровней вложенности, до 2000 книг за один запуск).</li>
              <li>Синхронизацию можно поставить на паузу или остановить; прогресс сохраняется и восстанавливается после перезагрузки страницы.</li>
              <li>Повторная синхронизация докачивает новые книги, обновляет изменённые файлы и помечает удалённые из облака.</li>
              <li>Не загрузившиеся файлы видны в карточке подключения: нажмите «Ошибки — показать», чтобы увидеть файл и причину.</li>
              <li>При первом открытии книга загружается из облака — это может занять несколько секунд, далее переходы между главами мгновенны.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Частые вопросы</h2>
            <Accordion type="single" collapsible>
              {FAQ_ITEMS.map((item) => (
                <AccordionItem key={item.question} value={item.question}>
                  <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Подключить сейчас</h2>
            {isAuthenticated ? (
              <>
                <p className="text-muted-foreground">Подключение выполняется прямо здесь или в разделе профиля.</p>
                <ExternalStorageCard />
              </>
            ) : (
              <>
                <p className="text-muted-foreground">Войдите в аккаунт — подключение выполняется в разделе профиля.</p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link href="/login">Войти</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/register">Создать аккаунт</Link>
                  </Button>
                </div>
              </>
            )}
          </section>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
