import { useEffect, useMemo, useState } from "react";
import { useGetMyReferralCode, getGetMyReferralCodeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { trackReferralShared } from "@/lib/analytics";
import { Check, Copy, Loader2, Mail, Send, Share2 } from "lucide-react";

export const REFERRAL_SHARE_SHOWN_KEY = "readora.referral_share_shown";

const SHARE_TEXT = "Читаю книги в Readora — личная библиотека прямо в браузере: FB2, EPUB, MOBI и другие форматы, прогресс синхронизируется между устройствами. Попробуй:";

type ShareChannel = "telegram" | "vk" | "max" | "copy" | "email" | "native";

function buildShareUrl(referralCode?: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams({
    utm_source: "share",
    utm_medium: "referral",
    utm_campaign: "5star",
  });
  if (referralCode) params.set("ref", referralCode);
  return `${base}/?${params.toString()}`;
}

export function ReferralShareCard() {
  const { isAuthenticated } = useAuth();
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useGetMyReferralCode({
    query: {
      queryKey: getGetMyReferralCodeQueryKey(),
      enabled: isAuthenticated,
      staleTime: Infinity,
      retry: 1,
    },
  });
  const referralCode = data?.referralCode;

  const shareUrl = useMemo(() => buildShareUrl(referralCode), [referralCode]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyShareText(): Promise<boolean> {
    const text = `${SHARE_TEXT} ${shareUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) setCopied(true);
        return ok;
      } catch {
        return false;
      }
    }
  }

  function track(channel: ShareChannel): void {
    trackReferralShared(channel);
  }

  function handleTelegram(): void {
    track("telegram");
    const url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(SHARE_TEXT)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleVk(): void {
    track("vk");
    const url = `https://vk.com/share.php?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(SHARE_TEXT)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Официальный диплинк MAX: открывает экран выбора чата с готовым текстом.
  function handleMax(): void {
    track("max");
    const url = `https://max.ru/:share?text=${encodeURIComponent(`${SHARE_TEXT} ${shareUrl}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleNativeShare(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.share) return;
    track("native");
    try {
      await navigator.share({ text: `${SHARE_TEXT} ${shareUrl}` });
    } catch {
      // Отмена системного диалога — не ошибка
    }
  }

  function handleEmail(): void {
    track("email");
    const subject = encodeURIComponent("Рекомендую Readora");
    const body = encodeURIComponent(`${SHARE_TEXT}\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm text-foreground/70">
        Порекомендуйте Readora друзьям.
      </p>
      {isLoading && isAuthenticated ? (
        <p className="flex items-center gap-2 text-sm text-foreground/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Подготавливаем ссылку…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button type="button" variant="outline" className="gap-2" onClick={handleTelegram}>
              <Send className="h-4 w-4" />
              Telegram
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={handleVk}>
              <Share2 className="h-4 w-4" />
              VK
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={handleMax}>
              <Share2 className="h-4 w-4" />
              MAX
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => {
                track("copy");
                void copyShareText();
              }}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              className="flex items-center gap-1.5 text-primary hover:underline"
              onClick={handleEmail}
            >
              <Mail className="h-4 w-4" />
              Отправить по email
            </button>
            {hasNativeShare && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-primary hover:underline"
                onClick={() => void handleNativeShare()}
              >
                <Share2 className="h-4 w-4" />
                Другие способы
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
