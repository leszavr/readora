import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: () => void;
  isIos: boolean;
}

export function PwaInstallDialog({ open, onOpenChange, onInstall, isIos }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-5 text-primary" />
            Установить Readora
          </DialogTitle>
          <DialogDescription>
            Добавьте приложение на главный экран для быстрого доступа и удобства чтения.
          </DialogDescription>
        </DialogHeader>

        {isIos ? (
          <div className="rounded-lg bg-muted p-4 text-sm leading-relaxed">
            На iPhone/iPad нажмите <span className="font-semibold">Поделиться</span> (иконка{" "}
            <span className="inline-flex items-center justify-center size-5 rounded bg-muted-foreground/20 text-xs">⎙</span>)
            → <span className="font-semibold">На экран «Домой»</span>.
          </div>
        ) : (
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Быстрый запуск с главного экрана</li>
            <li>Отдельное окно без адресной строки</li>
          </ul>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="size-4" /> Позже
          </Button>
          {!isIos && (
            <Button onClick={() => { onInstall(); onOpenChange(false); }}>
              <Smartphone className="size-4" /> Установить
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
