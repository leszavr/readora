import { useEffect, useRef } from "react";
import { configureAnalytics, startAnalyticsLifecycle, trackAppOpened } from "@/lib/analytics";
import { useAuth } from "@/hooks/use-auth";

export function AnalyticsLifecycle() {
  const { user } = useAuth();
  const openedAccountIdRef = useRef<number | null>(null);

  useEffect(() => {
    configureAnalytics(user ? { id: user.id, analyticsOptIn: user.analyticsOptIn } : null);
    if (user?.analyticsOptIn && openedAccountIdRef.current !== user.id) {
      const path = window.location.pathname;
      const entryPoint = path.startsWith("/reader/") ? "reader" : path.startsWith("/book/") ? "book" : path.startsWith("/profile") ? "profile" : "library";
      trackAppOpened(entryPoint);
      openedAccountIdRef.current = user.id;
    }
    if (!user) openedAccountIdRef.current = null;
  }, [user]);

  useEffect(() => startAnalyticsLifecycle(), []);

  return null;
}
