import { useState } from "react";
import { BookOpen, Library, Settings, MessageSquare } from "lucide-react";
import { LegalOverlay } from "@/components/LegalOverlay";
import { FeedbackModal } from "@/components/FeedbackModal";
import { TermsOfServiceContent } from "@/components/legal/TermsOfServiceContent";
import { CopyrightHoldersContent } from "@/components/legal/CopyrightHoldersContent";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";

function BrandWordmark({ className }: Readonly<{ className?: string }>) {
  return (
    <img
      src="/readora-wordmark.webp"
      alt="Readora"
      className={className ?? "h-6 w-auto"}
      loading="lazy"
      decoding="async"
    />
  );
}

export function SiteFooter() {
  const [activeLegalPage, setActiveLegalPage] = useState<"terms" | "copyright" | "privacy" | null>(null);
  const [legalStack, setLegalStack] = useState<Array<"terms" | "copyright" | "privacy">>([]);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  return (
    <>
      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 text-primary mb-3">
                <img
                  src="/readora-mark.webp"
                  alt="Readora"
                  className="h-8 w-auto"
                  loading="lazy"
                  decoding="async"
                />
                <BrandWordmark className="h-6 w-auto" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Личная библиотека для чтения книг в форматах FB2 и EPUB.
                <br />
                Удобно, безопасно, бесплатно.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-3 text-sm">Навигация</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="/" className="hover:text-foreground transition-colors flex items-center gap-2">
                    <BookOpen className="w-3 h-3" />
                    Главная
                  </a>
                </li>
                <li>
                  <a href="/library" className="hover:text-foreground transition-colors flex items-center gap-2">
                    <Library className="w-3 h-3" />
                    Библиотека
                  </a>
                </li>
                <li>
                  <a href="/profile" className="hover:text-foreground transition-colors flex items-center gap-2">
                    <Settings className="w-3 h-3" />
                    Профиль
                  </a>
                </li>
                <li>
                  <button onClick={() => setIsFeedbackOpen(true)} className="hover:text-foreground transition-colors flex items-center gap-2 text-left">
                    <MessageSquare className="w-3 h-3" />
                    Обратная связь
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-3 text-sm">Информация</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="/about" className="hover:text-foreground transition-colors">
                    О сервисе
                  </a>
                </li>
                <li>
                  <button
                    onClick={() => setActiveLegalPage("terms")}
                    className="hover:text-foreground transition-colors text-left"
                  >
                    Правила пользования
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveLegalPage("copyright")}
                    className="hover:text-foreground transition-colors text-left"
                  >
                    Правообладателям
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveLegalPage("privacy")}
                    className="hover:text-foreground transition-colors text-left break-words"
                  >
                    Политика обработки персональных данных
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-border text-center text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Readora. Личная библиотека книг.</p>
          </div>
        </div>
      </footer>

      {/* Legal Overlays */}
      <LegalOverlay
        isOpen={activeLegalPage === "terms"}
        onClose={() => {
          const prev = legalStack[legalStack.length - 1];
          setLegalStack((s) => s.slice(0, -1));
          setActiveLegalPage(prev ?? null);
        }}
        title="Правила пользования"
      >
        <TermsOfServiceContent />
      </LegalOverlay>

      <LegalOverlay
        isOpen={activeLegalPage === "copyright"}
        onClose={() => {
          const prev = legalStack[legalStack.length - 1];
          setLegalStack((s) => s.slice(0, -1));
          setActiveLegalPage(prev ?? null);
        }}
        title="Информация для правообладателей"
      >
        <CopyrightHoldersContent onOpenPrivacy={() => { setLegalStack((s) => [...s, "copyright"]); setActiveLegalPage("privacy"); }} />
      </LegalOverlay>

      <LegalOverlay
        isOpen={activeLegalPage === "privacy"}
        onClose={() => {
          const prev = legalStack[legalStack.length - 1];
          setLegalStack((s) => s.slice(0, -1));
          setActiveLegalPage(prev ?? null);
        }}
        title="Политика обработки персональных данных"
      >
        <PrivacyPolicyContent />
      </LegalOverlay>

      {/* Feedback Modal */}
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </>
  );
}
