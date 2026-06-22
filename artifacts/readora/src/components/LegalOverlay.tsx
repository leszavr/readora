import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function LegalOverlay({ isOpen, onClose, title, children }: LegalOverlayProps) {
  // Блокировка прокрутки body при открытии оверлея
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center">
      {/* Затемнённый блюр фон */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Контейнер контента */}
      <div className="relative w-full max-w-4xl h-screen flex flex-col bg-background shadow-2xl md:mt-8 md:mb-8 md:h-auto md:max-h-[calc(100vh-4rem)] md:rounded-lg overflow-hidden">
        {/* Шапка */}
        <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b bg-muted/30 shrink-0">
          <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Прокручиваемый контент */}
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8">
          <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
            {children}
          </div>
        </div>

        {/* Футер с кнопкой закрытия (опционально для мобильных) */}
        <div className="shrink-0 px-4 py-3 md:px-6 md:py-4 border-t bg-muted/30 flex justify-end">
          <Button onClick={onClose} variant="outline">
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  );
}
