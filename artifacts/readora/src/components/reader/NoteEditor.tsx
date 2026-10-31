import { Bold, Italic, Strikethrough, Smile, Check } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const NOTE_COLOR_OPTIONS = [
  { value: "yellow", label: "Жёлтый", class: "bg-yellow-200 dark:bg-yellow-900/40" },
  { value: "green", label: "Зелёный", class: "bg-green-200 dark:bg-green-900/40" },
  { value: "blue", label: "Синий", class: "bg-blue-200 dark:bg-blue-900/40" },
  { value: "pink", label: "Розовый", class: "bg-pink-200 dark:bg-pink-900/40" },
  { value: "purple", label: "Фиолетовый", class: "bg-purple-200 dark:bg-purple-900/40" },
];

export function noteColorClass(color: string): string {
  return NOTE_COLOR_OPTIONS.find((c) => c.value === color)?.class ?? NOTE_COLOR_OPTIONS[0].class;
}

const EMOJI_OPTIONS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🤩", "🤔",
  "🤨", "😏", "😢", "😭", "😡", "🤯", "😱", "🙃",
  "👍", "👎", "👌", "🤝", "👏", "🙏", "💪", "🤞",
  "🔥", "⭐", "✨", "💡", "❗", "❓", "💯", "🎉",
  "❤️", "💔", "📖", "📚", "🔖", "✏️", "📝", "🎯",
  "⏰", "☕", "🍺", "🐍", "⚔️", "👑", "🧙", "🐉",
];

const NOTE_FORMAT_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~)/g;

export function NoteText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(NOTE_FORMAT_RE);
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.length > 4 && part.startsWith("~~") && part.endsWith("~~")) {
          return <s key={i}>{part.slice(2, -2)}</s>;
        }
        if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

interface NoteEditorProps {
  initialText: string;
  initialColor: string;
  saveLabel?: string;
  autoFocus?: boolean;
  onSave: (text: string, color: string) => void;
  onCancel: () => void;
}

export function NoteEditor({
  initialText,
  initialColor,
  saveLabel = "Сохранить",
  autoFocus = false,
  onSave,
  onCancel,
}: NoteEditorProps) {
  const [text, setText] = useState(initialText);
  const [color, setColor] = useState(initialColor);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyWrap = (marker: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);

    let nextValue: string;
    let selStart: number;
    let selEnd: number;
    if (selected && before.endsWith(marker) && after.startsWith(marker)) {
      nextValue = before.slice(0, -marker.length) + selected + after.slice(marker.length);
      selStart = start - marker.length;
      selEnd = end - marker.length;
    } else if (selected) {
      nextValue = before + marker + selected + marker + after;
      selStart = start + marker.length;
      selEnd = end + marker.length;
    } else {
      nextValue = before + marker + marker + after;
      selStart = start + marker.length;
      selEnd = selStart;
    }

    setText(nextValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setText(el.value.slice(0, start) + emoji + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Полужирный"
          aria-label="Полужирный"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyWrap("**")}
        >
          <Bold className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Курсив"
          aria-label="Курсив"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyWrap("*")}
        >
          <Italic className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Зачёркнутый"
          aria-label="Зачёркнутый"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyWrap("~~")}
        >
          <Strikethrough className="size-4" />
        </Button>
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Эмодзи"
              aria-label="Эмодзи"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Smile className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2" onMouseDown={(e) => e.preventDefault()}>
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded p-1 text-lg leading-none transition-colors hover:bg-muted"
                  onClick={() => insertEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[80px] text-sm"
        maxLength={2000}
        placeholder="Текст заметки…"
        autoFocus={autoFocus}
      />

      <div className="flex gap-1 flex-wrap">
        {NOTE_COLOR_OPTIONS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setColor(c.value)}
            className={cn("size-6 rounded-full border-2", c.class, color === c.value && "ring-2 ring-primary ring-offset-1")}
            title={c.label}
            aria-label={c.label}
          />
        ))}
      </div>

      <div className="flex gap-1">
        <Button size="sm" onClick={() => onSave(text.trim(), color)} disabled={!text.trim()}>
          <Check className="size-4" /> {saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
