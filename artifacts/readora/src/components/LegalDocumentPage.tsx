import { PublicHeaderNavigation } from "@/components/PublicHeaderNavigation";
import { TermsOfServiceContent } from "@/components/legal/TermsOfServiceContent";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";

export type LegalDocumentKind = "terms" | "privacy";

const documents = {
  terms: {
    label: "Условия использования",
    title: "Правила пользования Readora",
    content: <TermsOfServiceContent />,
  },
  privacy: {
    label: "Политика конфиденциальности",
    title: "Политика обработки персональных данных",
    content: <PrivacyPolicyContent />,
  },
} satisfies Record<LegalDocumentKind, { label: string; title: string; content: React.ReactNode }>;

export function LegalDocumentPage({ kind }: Readonly<{ kind: LegalDocumentKind }>) {
  const document = documents[kind];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2" aria-label="Readora">
            <img src="/readora-mark.webp" alt="" className="h-8 w-auto" loading="eager" decoding="async" />
            <img src="/readora-wordmark.webp" alt="Readora" className="h-5 w-auto" loading="eager" decoding="async" />
          </a>
          <PublicHeaderNavigation />
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b border-border bg-primary/5">
          <div className="max-w-3xl mx-auto px-4 py-12 md:py-16">
            <a href="/" className="text-sm text-primary hover:underline">← На главную</a>
            <p className="text-sm font-medium text-primary mt-8 mb-3">{document.label}</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{document.title}</h1>
          </div>
        </section>

        <article className="max-w-3xl mx-auto px-4 py-10 md:py-14 prose prose-sm md:prose-base dark:prose-invert max-w-none">
          {document.content}
        </article>
      </main>

      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-3xl mx-auto px-4 py-6 text-sm text-muted-foreground">
          <a href="/" className="text-primary hover:underline">← На главную</a>
        </div>
      </footer>
    </div>
  );
}
