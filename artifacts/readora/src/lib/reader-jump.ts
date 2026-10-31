const READER_JUMP_KEY = "readora.reader.jump";

export interface ReaderJumpIntent {
  bookId: number;
  chapterId: number;
  positionRaw: string;
  highlightedText: string | null;
}

export function setReaderJumpIntent(intent: ReaderJumpIntent): void {
  try {
    sessionStorage.setItem(READER_JUMP_KEY, JSON.stringify(intent));
  } catch {
    // sessionStorage недоступен (приватный режим) — переход без восстановления позиции
  }
}

export function takeReaderJumpIntent(bookId: number): ReaderJumpIntent | null {
  try {
    const raw = sessionStorage.getItem(READER_JUMP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReaderJumpIntent;
    sessionStorage.removeItem(READER_JUMP_KEY);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.bookId !== bookId ||
      typeof parsed.chapterId !== "number" ||
      typeof parsed.positionRaw !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
