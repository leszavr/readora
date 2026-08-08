import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Library, LogOut, ShieldCheck, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";

export function PublicHeaderNavigation() {
  const { user, isAuthenticated, isModerator } = useAuth();
  const queryClient = useQueryClient();

  if (!isAuthenticated) {
    return (
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild><a href="/login">Войти</a></Button>
        <Button size="sm" asChild><a href="/register">Регистрация</a></Button>
      </div>
    );
  }

  const displayName = user?.username.trim() || user?.email || "Пользователь";
  const initials = displayName.slice(0, 2).toUpperCase();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    queryClient.setQueryData(getGetMeQueryKey(), null);
    queryClient.clear();
    window.location.assign("/login");
  }

  return (
    <>
      <nav className="hidden items-center gap-1 md:flex" aria-label="Навигация пользователя">
        <Button variant="ghost" size="sm" className="gap-2" asChild>
          <a href="/library">
            <Library className="h-4 w-4" />
            Библиотека
          </a>
        </Button>
        {isModerator && (
          <Button variant="ghost" size="sm" className="gap-2" asChild>
            <a href="/admin">
              <ShieldCheck className="h-4 w-4" />
              Панель
            </a>
          </Button>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Открыть меню профиля">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <a href="/library">
              <DropdownMenuItem className="cursor-pointer gap-2">
                <Library className="h-4 w-4" /> Моя библиотека
              </DropdownMenuItem>
            </a>
            <a href="/profile">
              <DropdownMenuItem className="cursor-pointer gap-2">
                <UserIcon className="h-4 w-4" /> Профиль
              </DropdownMenuItem>
            </a>
            {isModerator && (
              <a href="/admin">
                <DropdownMenuItem className="cursor-pointer gap-2">
                  <ShieldCheck className="h-4 w-4" /> Панель управления
                </DropdownMenuItem>
              </a>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-destructive focus:text-destructive"
              onSelect={handleLogout}
            >
              <LogOut className="h-4 w-4" /> Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
