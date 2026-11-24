import assert from "node:assert/strict";
import test from "node:test";
import { clampNoteText } from "./note-text";

test("текст в пределах лимита не меняется", () => {
  assert.equal(clampNoteText("просто текст", 255), "просто текст");
  assert.equal(clampNoteText("а".repeat(255), 255), "а".repeat(255));
});

test("без лимита текст не обрезается", () => {
  assert.equal(clampNoteText("а".repeat(5000), undefined), "а".repeat(5000));
});

test("лишние символы отбрасываются", () => {
  assert.equal(clampNoteText("а".repeat(256), 255), "а".repeat(255));
});

test("эмодзи на границе не разрезается пополам", () => {
  assert.equal(clampNoteText(`${"а".repeat(254)}😀`, 255), "а".repeat(254));
  assert.equal(clampNoteText(`${"а".repeat(253)}😀б`, 255), `${"а".repeat(253)}😀`);
});
