import { useCallback, useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function reportInstallAccepted() {
  fetch("/api/pwa/install-accepted", { method: "POST" }).catch(() => {});
}

export function usePwaInstall() {
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const reportedRef = useRef(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const checkInstalled = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standalone);
      if (standalone) reportedRef.current = false;
    };
    checkInstalled();

    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => checkInstalled();
    mq.addEventListener("change", onChange);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setIsInstallable(true);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      deferredRef.current = null;
      if (!reportedRef.current) {
        reportedRef.current = true;
        reportInstallAccepted();
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const ev = deferredRef.current;
    if (!ev) return false;
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice.outcome === "accepted" && !reportedRef.current) {
      reportedRef.current = true;
      reportInstallAccepted();
    }
    deferredRef.current = null;
    setIsInstallable(false);
    return choice.outcome === "accepted";
  }, []);

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;

  return { isInstallable, isInstalled, promptInstall, isIos };
}
