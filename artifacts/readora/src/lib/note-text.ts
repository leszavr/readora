export function clampNoteText(text: string, maxLength: number | undefined): string {
  if (!maxLength || text.length <= maxLength) return text;

  const lastKeptCodeUnit = text.charCodeAt(maxLength - 1);
  const cutsEmojiInHalf = lastKeptCodeUnit >= 0xd800 && lastKeptCodeUnit <= 0xdbff;
  return text.slice(0, cutsEmojiInHalf ? maxLength - 1 : maxLength);
}
