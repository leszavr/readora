import { useState } from "react";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { cn } from "@/lib/utils";
import { Users, BookCopy, BarChart2, Settings, ShieldCheck, Tags, Mail } from "lucide-react";
import AdminStats from "@/pages/admin/AdminStats";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminBooks from "@/pages/admin/AdminBooks";
import AdminGenres from "@/pages/admin/AdminGenres";
import AdminSettings from "@/pages/admin/AdminSettings";
import { AdminSmtp } from "@/pages/admin/AdminSmtp";

const TABS = [
  { id: "stats", label: "Обзор", icon: BarChart2 },
  { id: "users", label: "Пользователи", icon: Users },
  { id: "books", label: "Книги", icon: BookCopy },
  { id: "genres", label: "Жанры", icon: Tags },
  { id: "email", label: "Email", icon: Mail },
  { id: "settings", label: "Настройки", icon: Settings },
] as const;

type TabId = typeof TABS[number]["id"];

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>("stats");

  return (
    <ProtectedRoute adminOnly>
      <Layout>
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Панель управления</h1>
              <p className="text-muted-foreground text-sm">Администрирование системы</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-muted rounded-xl p-1 mb-6 w-fit">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  tab === id
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "stats" && <AdminStats />}
          {tab === "users" && <AdminUsers />}
          {tab === "books" && <AdminBooks />}
          {tab === "genres" && <AdminGenres />}
          {tab === "email" && <AdminSmtp />}
          {tab === "settings" && <AdminSettings />}
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
