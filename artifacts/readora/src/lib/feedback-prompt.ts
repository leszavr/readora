export const FEEDBACK_PROMPT_OPEN_EVENT = "readora:open-feedback-prompt";

const BLOB_SHOWN_AT_KEY = "readora_feedback_blob_shown_at";
const BLOB_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function openFeedbackPrompt(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FEEDBACK_PROMPT_OPEN_EVENT));
}

export function shouldShowFeedbackBlob(): boolean {
  try {
    const shownAt = Number(localStorage.getItem(BLOB_SHOWN_AT_KEY));
    return !Number.isFinite(shownAt) || shownAt <= 0 || Date.now() - shownAt >= BLOB_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markFeedbackBlobShown(): void {
  try {
    localStorage.setItem(BLOB_SHOWN_AT_KEY, String(Date.now()));
  } catch {
    // Игнорируем ошибки приватного режима/квоты.
  }
}
