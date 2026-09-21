import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Library, LogOut, User as UserIcon, ShieldCheck } from "lucide-react";
import { useMaintenanceStatus } from "@/hooks/use-maintenance-status";
import { useRegistrationStatus } from "@/hooks/use-registration-status";
import { SiteFooter } from "@/components/SiteFooter";
import { clearAnalyticsQueue } from "@/lib/analytics";

function BrandWordmark({ className }: Readonly<{ className?: string }>) {
  return (
    <img
      src="/readora-wordmark.webp"
      alt="Readora"
      className={className ?? "h-6 w-auto"}
      loading="eager"
      decoding="async"
    />
  );
}

export function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, isAuthenticated, isModerator, isAdmin } = useAuth();
  const [location, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: maintenanceStatus } = useMaintenanceStatus();
  const { data: registrationStatus } = useRegistrationStatus();

  // Показываем баннер админу при активном режиме обслуживания
  const showAdminMaintenanceBanner = isAdmin && maintenanceStatus?.enabled;

  async function handleLogout() {
    if (user) await clearAnalyticsQueue(user.id);
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    qc.setQueryData(getGetMeQueryKey(), null);
    qc.clear();
    navigate("/login");
  }

  const displayName = user?.username?.trim() || user?.email || "Пользователь";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/readora-mark.webp"
              alt="Readora"
              className="h-8 w-auto"
              loading="eager"
              decoding="async"
            />
            <BrandWordmark className="h-5 w-auto" />
          </Link>

          {isAuthenticated && (
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/library">
                <Button variant={location.startsWith("/library") || location.startsWith("/book") ? "secondary" : "ghost"} size="sm" className="gap-2">
                  <Library className="w-4 h-4" />
                  Библиотека
                </Button>
              </Link>
              {isModerator && (
                <Link href="/admin">
                  <Button variant={location.startsWith("/admin") ? "secondary" : "ghost"} size="sm" className="gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    Панель
                  </Button>
                </Link>
              )}
            </nav>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="px-3 py-2">
                    <p className="font-semibold text-sm truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <Link href="/library">
                    <DropdownMenuItem className="gap-2 cursor-pointer">
                      <Library className="w-4 h-4" /> Моя библиотека
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/profile">
                    <DropdownMenuItem className="gap-2 cursor-pointer">
                      <UserIcon className="w-4 h-4" /> Профиль
                    </DropdownMenuItem>
                  </Link>
                  {isModerator && (
                    <Link href="/admin">
                      <DropdownMenuItem className="gap-2 cursor-pointer">
                        <ShieldCheck className="w-4 h-4" /> Панель управления
                      </DropdownMenuItem>
                    </Link>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2 cursor-pointer text-destructive focus:text-destructive" onSelect={handleLogout}>
                    <LogOut className="w-4 h-4" /> Выйти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">Войти</Button>
                </Link>
                {registrationStatus?.enabled === true && (
                  <Link href="/register">
                    <Button size="sm">Регистрация</Button>
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Баннер режима обслуживания для администраторов */}
      {showAdminMaintenanceBanner && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2">
          <div className="max-w-6xl mx-auto flex items-center justify-center gap-2 text-sm text-destructive">
            <span className="text-base">⚙️</span>
            <span className="font-medium">Сайт в режиме технического обслуживания</span>
          </div>
        </div>
      )}

      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  );
}
