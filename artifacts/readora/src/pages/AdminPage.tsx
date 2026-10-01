import { lazy, Suspense, useState } from "react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Users, BookCopy, BarChart2, Settings, ShieldCheck, Tags, Mail, Inbox, PanelsTopLeft, LineChart, Gift } from "lucide-react";

const AdminStats = lazy(() => import("@/pages/admin/AdminStats"));
const AdminUsers = lazy(() => import("@/pages/admin/AdminUsers"));
const AdminBooks = lazy(() => import("@/pages/admin/AdminBooks"));
const AdminGenres = lazy(() => import("@/pages/admin/AdminGenres"));
const AdminSettings = lazy(() => import("@/pages/admin/AdminSettings"));
const AdminSmtp = lazy(() => import("@/pages/admin/AdminSmtp").then(({ AdminSmtp }) => ({ default: AdminSmtp })));
const AdminEmails = lazy(() => import("@/pages/admin/AdminEmails"));
const AdminLandingBooks = lazy(() => import("@/pages/admin/AdminLandingBooks"));
const AdminGiftEditions = lazy(() => import("@/pages/admin/AdminGiftEditions"));
const AdminAnalytics = lazy(() => import("@/pages/admin/AdminAnalytics"));

const TABS = [
  { id: "stats", label: "Обзор", icon: BarChart2 },
  { id: "analytics", label: "Аналитика", icon: LineChart },
  { id: "users", label: "Пользователи", icon: Users },
  { id: "books", label: "Книги", icon: BookCopy },
  { id: "landing-books", label: "Лендинг", icon: PanelsTopLeft },
  { id: "gift-editions", label: "Подарочные издания", icon: Gift },
  { id: "genres", label: "Жанры", icon: Tags },
  { id: "email", label: "Email", icon: Mail },
  { id: "saved-emails", label: "Письма", icon: Inbox },
  { id: "settings", label: "Настройки", icon: Settings },
] as const;

type TabId = typeof TABS[number]["id"];

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<TabId>("stats");
  const visibleTabs = isAdmin ? TABS : TABS.filter(({ id }) => id !== "analytics");

  return (
    <ProtectedRoute adminOnly>
      <Layout>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Панель управления</h1>
              <p className="text-muted-foreground text-sm">Администрирование системы</p>
            </div>
          </div>

          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            {/* Навигация: горизонтальная прокрутка на мобильных, левый сайдбар на md+ */}
            <nav aria-label="Разделы админки" className="-mx-4 overflow-x-auto px-4 md:sticky md:top-20 md:mx-0 md:w-56 md:shrink-0 md:overflow-visible md:px-0">
              <ul className="flex w-max gap-1 rounded-xl bg-muted p-1 md:w-full md:flex-col">
                {visibleTabs.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setTab(id)}
                      aria-current={tab === id ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                        tab === id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <section className="min-w-0 flex-1">
              <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-muted" />}>
                {tab === "stats" && <AdminStats />}
                {tab === "analytics" && isAdmin && <AdminAnalytics />}
                {tab === "users" && <AdminUsers />}
                {tab === "books" && <AdminBooks />}
                {tab === "landing-books" && <AdminLandingBooks />}
                {tab === "gift-editions" && <AdminGiftEditions />}
                {tab === "genres" && <AdminGenres />}
                {tab === "email" && <AdminSmtp />}
                {tab === "saved-emails" && <AdminEmails />}
                {tab === "settings" && <AdminSettings />}
              </Suspense>
            </section>
          </div>
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
