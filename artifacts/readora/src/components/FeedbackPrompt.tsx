import { useCallback, useEffect, useState } from "react";
import { useGetFeedbackSurveyOptions, useSubmitFeedbackSurvey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FEEDBACK_PROMPT_OPEN_EVENT } from "@/lib/feedback-prompt";
import { CheckCircle2, Loader2, MessageSquareText, Star, X } from "lucide-react";

const SHOWN_AT_KEY = "readora_feedback_shown_at";
const SUBMITTED_KEY = "readora_feedback_submitted";
const MOBILE_TIMER_MS = 45 * 1000;
const MOBILE_BREAKPOINT = 768;
const CLOSE_DELAY_MS = 3000;

function isHiddenPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/reader" ||
    pathname.startsWith("/reader/")
  );
}

function readSubmitted(): boolean {
  try {
    return localStorage.getItem(SUBMITTED_KEY) === "1";
  } catch {
    return false;
  }
}

function wasAutoShown(): boolean {
  try {
    const shownAt = Number(localStorage.getItem(SHOWN_AT_KEY));
    return Number.isFinite(shownAt) && shownAt > 0;
  } catch {
    return true;
  }
}

export function FeedbackPrompt() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState(0);
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [missingFeature, setMissingFeature] = useState("");
  const [wantsContact, setWantsContact] = useState(false);
  const [contactInfo, setContactInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canClose, setCanClose] = useState(false);
  const [forced, setForced] = useState(false);

  const { data: options } = useGetFeedbackSurveyOptions();
  const submitMutation = useSubmitFeedbackSurvey();

  const resetForm = useCallback(() => {
    setRating(0);
    setPainPoints([]);
    setMissingFeature("");
    setWantsContact(false);
    setContactInfo("");
    setSubmitted(false);
    setSubmitting(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || isHiddenPath(window.location.pathname)) return;
    if (readSubmitted() || wasAutoShown()) return;

    let revealed = false;
    const reveal = () => {
      if (revealed || isHiddenPath(window.location.pathname)) return;
      revealed = true;
      try {
        localStorage.setItem(SHOWN_AT_KEY, String(Date.now()));
      } catch {
        // Игнорируем ошибки приватного режима/квоты.
      }
      setOpen(true);
    };

    const onMouseOut = (event: MouseEvent) => {
      if (event.clientY <= 0 && !event.relatedTarget) reveal();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") reveal();
    };

    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    let timer: number | undefined;

    if (isMobile) {
      timer = window.setTimeout(reveal, MOBILE_TIMER_MS);
      document.addEventListener("visibilitychange", onVisibilityChange);
    } else {
      document.addEventListener("mouseout", onMouseOut);
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onRequestOpen = () => {
      resetForm();
      setForced(true);
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_PROMPT_OPEN_EVENT, onRequestOpen);
    return () => window.removeEventListener(FEEDBACK_PROMPT_OPEN_EVENT, onRequestOpen);
  }, [resetForm]);

  useEffect(() => {
    if (!open) return;
    if (forced) {
      setCanClose(true);
      return;
    }
    setCanClose(false);
    const timer = window.setTimeout(() => setCanClose(true), CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, forced]);

  useEffect(() => {
    if (!open) setForced(false);
  }, [open]);

  useEffect(() => {
    if (!open || !canClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, canClose]);

  const submitSurvey = useCallback(
    async (nextRating: number, points: string[], feature: string, wants: boolean, contact: string) => {
      setSubmitting(true);
      setError(null);
      try {
        await submitMutation.mutateAsync({
          data: {
            rating: nextRating,
            painPoints: nextRating <= 4 ? points : [],
            missingFeature: feature.trim() || undefined,
            wantsContact: wants,
            contactInfo: wants ? contact.trim() || undefined : undefined,
            pageUrl: window.location.pathname,
          },
        });
        try {
          localStorage.setItem(SUBMITTED_KEY, "1");
        } catch {
          // Игнорируем ошибки приватного режима/квоты.
        }
        setSubmitted(true);
        window.setTimeout(() => setOpen(false), 4000);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Не удалось отправить отзыв");
      } finally {
        setSubmitting(false);
      }
    },
    [submitMutation],
  );

  function handleRate(value: number) {
    setRating(value);
    setError(null);
    if (value === 5) {
      void submitSurvey(5, [], "", false, "");
    }
  }

  function togglePainPoint(point: string) {
    setPainPoints((prev) => {
      if (prev.includes(point)) return prev.filter((item) => item !== point);
      if (options && prev.length >= options.maxPainPoints) return prev;
      return [...prev, point];
    });
  }

  function handleFormSubmit() {
    if (painPoints.length === 0) {
      setError("Выберите хотя бы одну причину");
      return;
    }
    if (options && painPoints.includes(options.missingFeatureTrigger) && !missingFeature.trim()) {
      setError("Опишите, какой функции не хватает");
      return;
    }
    if (wantsContact && !isAuthenticated && !contactInfo.trim()) {
      setError("Укажите email или Telegram для связи");
      return;
    }
    void submitSurvey(rating, painPoints, missingFeature, wantsContact, contactInfo);
  }

  if (!open) return null;

  const showForm = rating > 0 && rating <= 4 && !submitted;
  const needsContactField = wantsContact && !isAuthenticated;

  const handleClose = () => {
    if (canClose) {
      setOpen(false);
      setForced(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 animate-in fade-in-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="relative z-10 w-full max-w-xl animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-2xl border-2 border-primary/40 bg-card shadow-2xl"
      >
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/60 to-primary/20" />

        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <MessageSquareText className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="feedback-title" className="text-lg font-bold sm:text-xl">
                {submitted ? "Спасибо за отзыв!" : "Оцените Readora"}
              </h2>
              {!submitted && (
                <p className="mt-1 text-sm text-foreground/70">
                  Это займет меньше минуты и поможет нам стать лучше.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "-mr-1 -mt-1 h-8 w-8 shrink-0 transition-opacity",
                !canClose && "pointer-events-none opacity-0",
              )}
              onClick={handleClose}
              disabled={!canClose}
              aria-label="Закрыть опрос"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {submitted ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Мы учтем ваш ответ.
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleRate(value)}
                    disabled={submitting}
                    aria-label={`Оценка ${value} из 5`}
                    className="rounded-md p-1 transition-transform hover:scale-110 disabled:opacity-50"
                  >
                    <Star
                      className={cn(
                        "h-9 w-9 sm:h-10 sm:w-10",
                        value <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/60",
                      )}
                    />
                  </button>
                ))}
                {submitting && rating === 5 && (
                  <Loader2 className="ml-1 h-5 w-5 animate-spin text-muted-foreground" />
                )}
              </div>

              {showForm && (
                <div className="space-y-5">
                  {!options ? (
                    <p className="flex items-center gap-2 text-sm text-foreground/70">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Загружаем варианты ответа…
                    </p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label className="text-sm">
                          Что именно помешало поставить 5 звезд?{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <div className="space-y-2.5">
                          {options.painPoints.map((point) => {
                            const checked = painPoints.includes(point);
                            const disabled = !checked && painPoints.length >= options.maxPainPoints;
                            return (
                              <label
                                key={point}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2.5 text-sm",
                                  disabled && "cursor-not-allowed opacity-60",
                                )}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={disabled}
                                  onCheckedChange={() => togglePainPoint(point)}
                                />
                                <span>{point}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-foreground/60">
                          Можно выбрать до {options.maxPainPoints} вариантов.
                        </p>
                      </div>

                      {painPoints.includes(options.missingFeatureTrigger) && (
                        <div className="space-y-2">
                          <Label htmlFor="feedback-missing-feature" className="text-sm">
                            Какой одной функции вам сейчас больше всего не хватает?
                          </Label>
                          <Textarea
                            id="feedback-missing-feature"
                            rows={2}
                            className="resize-none text-sm"
                            placeholder="Например, синхронизация между устройствами, темная тема, полнотекстовый поиск."
                            value={missingFeature}
                            onChange={(event) => setMissingFeature(event.target.value)}
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label className="text-sm">Хотите, чтобы мы связались с вами для уточнения?</Label>
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                          <Checkbox
                            checked={wantsContact}
                            onCheckedChange={(checked) => setWantsContact(checked === true)}
                          />
                          <span>Да, свяжитесь со мной</span>
                        </label>
                        {needsContactField && (
                          <Input
                            className="text-sm"
                        placeholder="Email или @telegram"
                        value={contactInfo}
                        onChange={(event) => setContactInfo(event.target.value)}
                      />
                    )}
                      </div>
                    </>
                  )}

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={handleClose}
                      disabled={submitting || !canClose}
                    >
                      Не сейчас
                    </Button>
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={handleFormSubmit}
                      disabled={submitting || !options}
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Отправить"}
                    </Button>
                  </div>
                </div>
              )}

              {!showForm && error && <p className="text-sm text-destructive">{error}</p>}

              {!showForm && !canClose && (
                <p className="text-xs text-foreground/60">
                  Окно можно будет закрыть через пару секунд.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
