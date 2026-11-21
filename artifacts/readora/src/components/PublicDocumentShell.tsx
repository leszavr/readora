import { PublicHeaderNavigation } from "@/components/PublicHeaderNavigation";
import { SiteFooter } from "@/components/SiteFooter";

export function PublicDocumentShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2" aria-label="Readora">
            <img src="/readora-mark.webp" alt="" className="h-8 w-auto" loading="eager" decoding="async" />
            <img src="/readora-wordmark.webp" alt="Readora" className="h-5 w-auto" loading="eager" decoding="async" />
          </a>
          <PublicHeaderNavigation />
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
