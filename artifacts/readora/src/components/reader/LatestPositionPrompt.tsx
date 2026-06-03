// Adapted from voxlibris LatestPositionPrompt.tsx
// Shows a banner when a more advanced position is found on the server
// (e.g. read further on another device)

import { RotateCcw, ArrowRightCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LatestPositionPromptProps {
  currentChapterNum: number | null;
  remoteChapterNum: number;
  onOpenLatest: () => void;
  onDismiss: () => void;
}

export function LatestPositionPrompt({
  currentChapterNum,
  remoteChapterNum,
  onOpenLatest,
  onDismiss,
}: Readonly<LatestPositionPromptProps>) {
  return (
    <div className="fixed top-14 inset-x-0 z-50 flex justify-center px-4">
      <div className="max-w-xl w-full rounded-xl border bg-background/95 backdrop-blur-md shadow-xl p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="w-4 h-4 text-primary" />
              Найдена более новая позиция чтения
            </div>
            <p className="text-sm text-muted-foreground">
              На другом устройстве книга уже открыта дальше
              {currentChapterNum ? `: сейчас у вас глава ${currentChapterNum},` : ","}{" "}
              последняя сохраненная позиция на главе {remoteChapterNum}.
            </p>
          </div>

          <div className="flex gap-2 sm:flex-shrink-0">
            <Button variant="outline" size="sm" onClick={onDismiss}>
              Оставить текущую
            </Button>
            <Button size="sm" onClick={onOpenLatest}>
              <ArrowRightCircle className="w-4 h-4 mr-2" />
              Открыть последнюю
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
