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
import { BookOpen, Library, LogOut, User as UserIcon, ShieldCheck, Shield, Sparkles } from "lucide-react";

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
  const { user, isAuthenticated, isModerator } = useAuth();
  const [location, navigate] = useLocation();
  const qc = useQueryClient();
  async function handleLogout() {
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
                <Link href="/register">
                  <Button size="sm">Регистрация</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 text-primary mb-3">
                <img
                  src="/readora-mark.webp"
                  alt="Readora"
                  className="h-8 w-auto"
                  loading="lazy"
                  decoding="async"
                />
                <BrandWordmark className="h-6 w-auto" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Личная библиотека для чтения книг в форматах FB2 и EPUB. 
                Удобно, безопасно, бесплатно.
              </p>
            </div>

            {/* Navigation */}
            <div>
              <h4 className="font-semibold mb-3 text-sm">Навигация</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/" className="hover:text-foreground transition-colors">
                    Главная
                  </Link>
                </li>
                {isAuthenticated ? (
                  <>
                    <li>
                      <Link href="/library" className="hover:text-foreground transition-colors">
                        Библиотека
                      </Link>
                    </li>
                    <li>
                      <Link href="/profile" className="hover:text-foreground transition-colors">
                        Профиль
                      </Link>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <Link href="/login" className="hover:text-foreground transition-colors">
                        Войти
                      </Link>
                    </li>
                    <li>
                      <Link href="/register" className="hover:text-foreground transition-colors">
                        Регистрация
                      </Link>
                    </li>
                  </>
                )}
              </ul>
            </div>

            {/* Info */}
            <div>
              <h4 className="font-semibold mb-3 text-sm">Информация</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Shield className="w-3 h-3" />
                  Приватность данных
                </li>
                <li className="flex items-center gap-2">
                  <BookOpen className="w-3 h-3" />
                  FB2 и EPUB
                </li>
                <li className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  Бесплатно навсегда
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-border text-center text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Readora. Личная библиотека книг.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
