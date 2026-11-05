import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackModal } from "@/components/FeedbackModal";
import { AlertTriangle, Mail, MessageSquareText, X } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;

// Email поддержки, отображаемый на экране блокировки (контакт для
// восстановления удаляемого аккаунта; письма из формы идут на feedback_email).
const SUPPORT_EMAIL = "support@readora.ru";

function formatDeletionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS));
}

/**
 * Полноэкранный экран блокировки входа для аккаунта, помеченного на удаление
 * (модель GitHub): контент под ним заблюрен, сверху — информация о процессе
 * удаления, отсчёт до окончательной очистки и контакты для восстановления.
 */
export function DeletionPendingScreen({ scheduledFor }: Readonly<{ scheduledFor: string }>) {
  const [, navigate] = useLocation();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const days = daysUntil(scheduledFor);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 px-4 backdrop-blur-md">
      <Card className="relative w-full max-w-md border-destructive/40 shadow-lg">
        <button
          type="button"
          onClick={() => navigate("/")}
          aria-label="Закрыть и перейти на главную"
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4" />
        </button>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 w-6 h-6 text-destructive shrink-0" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-destructive">Аккаунт находится в процессе удаления</h2>
              <p className="text-sm text-muted-foreground">
                {days > 0 ? (
                  <>Аккаунт и все данные будут окончательно удалены {formatDeletionDate(scheduledFor)} — осталось {days} дн.</>
                ) : (
                  <>Аккаунт будет окончательно удалён в ближайшее время.</>
                )}
              </p>
            </div>
          </div>

          <p className="text-sm">
            До момента удаления аккаунт можно восстановить. Напишите нам — и мы вернём
            доступ к вашей библиотеке со всеми книгами и прогрессом чтения.
          </p>

          <div className="space-y-2">
            <Button type="button" className="w-full gap-2" onClick={() => setFeedbackOpen(true)}>
              <MessageSquareText className="w-4 h-4" />
              Написать в поддержку
            </Button>
            <Button type="button" variant="outline" className="w-full gap-2" asChild>
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Восстановление аккаунта Readora")}`}>
                <Mail className="w-4 h-4" />
                {SUPPORT_EMAIL}
              </a>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            В письме укажите email аккаунта, который нужно восстановить.
          </p>
        </CardContent>
      </Card>

      <FeedbackModal isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} elevated />
    </div>
  );
}
