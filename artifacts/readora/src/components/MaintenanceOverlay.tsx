import { useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { AlertTriangle, Clock, Info, LogIn } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface MaintenanceStatus {
  enabled: boolean;
  reason: string | null;
  eta: string | null;
  message: string | null;
}

interface MaintenanceOverlayProps {
  status: MaintenanceStatus | null;
  isLoginPage?: boolean;
}

export function MaintenanceOverlay({ status, isLoginPage }: MaintenanceOverlayProps) {
  const { isAdmin } = useAuth();

  // Управление блокировкой прокрутки body при активации оверлея
  useEffect(() => {
    const shouldLockScroll = status?.enabled && !isAdmin && !isLoginPage;
    
    if (shouldLockScroll) {
      // Сохраняем текущее значение overflow
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      
      // Вычисляем ширину скроллбара для предотвращения сдвига контента
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      
      // Блокируем прокрутку
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      
      // Cleanup: восстанавливаем оригинальные значения при размонтировании или деактивации
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [status?.enabled, isAdmin, isLoginPage]);

  // Не показываем оверлей если:
  // - режим обслуживания выключен
  // - статус не загружен
  // - пользователь является администратором
  // - мы на странице логина (чтобы админ мог войти)
  if (!status?.enabled || isAdmin || isLoginPage) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/50 backdrop-blur-sm">
      {/* Размытый фон с контентом страницы */}
      <div className="absolute inset-0 backdrop-blur-md pointer-events-none" />
      
      {/* Модальное окно с информацией о технических работах */}
      <Card className="relative w-full max-w-md shadow-2xl border-destructive/20">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <CardTitle className="text-xl text-destructive">
            Техническое обслуживание
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            В настоящее время проводятся технические работы. 
            Сайт временно недоступен для обычных пользователей.
          </p>
          
          {status.reason && (
            <div className="flex items-start gap-3 p-3 bg-muted rounded-lg text-left">
              <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Причина:</p>
                <p className="text-sm text-muted-foreground">{status.reason}</p>
              </div>
            </div>
          )}
          
          {status.eta && (
            <div className="flex items-start gap-3 p-3 bg-muted rounded-lg text-left">
              <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Ориентировочное время окончания:</p>
                <p className="text-sm text-muted-foreground">{status.eta}</p>
              </div>
            </div>
          )}
          
          {status.message && (
            <div className="p-3 bg-primary/5 rounded-lg text-left">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {status.message}
              </p>
            </div>
          )}
          
          {/* Кнопка входа для администраторов */}
          <div className="pt-2">
            <Link href="/login">
              <Button variant="outline" className="gap-2 w-full">
                <LogIn className="w-4 h-4" />
                Войти в админ-панель
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-2">
              Только для администраторов
            </p>
          </div>
          
          <p className="text-xs text-muted-foreground pt-2">
            Приносим извинения за временные неудобства.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
