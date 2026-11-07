import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAnnouncementsQueryKey,
  useGetAnnouncements,
  useMarkAnnouncementRead,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Bell, History, Megaphone, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { NoteText } from "@/components/NoteEditor";

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const COLOR_STRIP_CLASSES: Record<string, string> = {
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  purple: "bg-purple-500",
};

export function formatDate(value: string): string {
  return DATE_FORMAT.format(new Date(value));
}

export function AnnouncementBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useGetAnnouncements({
    query: { queryKey: getGetAnnouncementsQueryKey(), staleTime: 60_000, retry: false },
  });
  const markRead = useMarkAnnouncementRead();

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  async function handleOpenItem(id: number, isUnread: boolean) {
    if (!isUnread) return;
    await markRead.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: getGetAnnouncementsQueryKey() });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={`Оповещения${unreadCount > 0 ? ` (${unreadCount} непрочитанных)` : ""}`}
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
                unreadCount > 9 ? "px-0.5" : "",
                items.some((i) => i.severity === "warning" && i.readAt === null)
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Оповещения</p>
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Нет оповещений
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((item) => {
              const isUnread = item.readAt === null;
              const Icon =
                item.kind === "release" ? Sparkles : item.severity === "warning" ? AlertTriangle : Megaphone;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleOpenItem(item.id, isUnread)}
                  className={cn(
                    "relative block w-full px-4 py-3 text-left border-b border-border last:border-b-0 transition-colors hover:bg-muted/60",
                    isUnread && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0 top-0 h-full w-1",
                      COLOR_STRIP_CLASSES[item.color] ?? COLOR_STRIP_CLASSES.blue,
                    )}
                  />
                  <div className="flex items-start gap-2.5">
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        item.severity === "warning" ? "text-destructive" : "text-primary",
                        isUnread && "animate-in",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn("text-sm truncate", isUnread ? "font-semibold" : "font-medium")}>
                          {item.title}
                        </p>
                        {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(item.publishedAt)}</p>
                      <div className="mt-1 text-sm text-muted-foreground [&_strong]:text-foreground [&_em]:text-foreground [&_s]:text-foreground">
                        <NoteText text={item.body} className="line-clamp-3" />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="border-t border-border px-4 py-2">
          <Link
            href="/changelog"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <History className="h-4 w-4" />
            Весь Changelog
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
