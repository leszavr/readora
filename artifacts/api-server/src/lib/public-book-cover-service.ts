import sharp from "sharp";

type CoverInput = {
  title: string;
  author: string | null;
  coverSeed: string;
};

const PALETTES = [
  ["#0b2934", "#1c6070", "#d9bc6c"],
  ["#3b252c", "#89505e", "#d8b06a"],
  ["#283a20", "#60733a", "#d5d8c4"],
  ["#2d314d", "#5b5f9d", "#d1c59a"],
  ["#482c25", "#9b6046", "#c8d4c7"],
  ["#173342", "#36737b", "#d7e0d0"],
] as const;

function seedNumber(seed: string, offset: number): number {
  return Number.parseInt(seed.slice(offset, offset + 8), 16) || 0;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

type TextBlock = {
  buffer: Buffer;
  width: number;
  height: number;
};

type TextStyle = {
  font: string;
  maxWidth: number;
  maxHeight: number;
  maxFontSize: number;
  minFontSize: number;
  letterSpacing?: number;
  truncate?: boolean;
};

function normalizeText(value: string, fallback: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 320);
}

function withEllipsis(words: string[], count: number): string {
  return `${words.slice(0, count).join(" ").replace(/[.…]+$/, "").trimEnd()}…`;
}

async function renderText(text: string, style: TextStyle, fontSize: number): Promise<TextBlock> {
  const letterSpacing = style.letterSpacing ? ` letter_spacing="${style.letterSpacing}"` : "";
  const markup = `<span font_desc="${style.font} ${fontSize}" foreground="#ffffff"${letterSpacing}>${escapeXml(text)}</span>`;
  const buffer = await sharp({
    text: {
      text: markup,
      width: style.maxWidth,
      align: "center",
      rgba: true,
    },
  }).png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Unable to render public book cover text");
  return { buffer, width: metadata.width, height: metadata.height };
}

async function renderFittedText(value: string, fallback: string, style: TextStyle): Promise<TextBlock> {
  const text = normalizeText(value, fallback);
  for (let fontSize = style.maxFontSize; fontSize >= style.minFontSize; fontSize -= 2) {
    const rendered = await renderText(text, style, fontSize);
    if (rendered.width <= style.maxWidth && rendered.height <= style.maxHeight) return rendered;
  }

  if (!style.truncate) return renderText(text, style, style.minFontSize);

  const words = text.split(" ");
  let low = 1;
  let high = words.length;
  let fitted: TextBlock | null = null;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const rendered = await renderText(withEllipsis(words, count), style, style.minFontSize);
    if (rendered.width <= style.maxWidth && rendered.height <= style.maxHeight) {
      fitted = rendered;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  return fitted ?? renderText("…", style, style.minFontSize);
}

async function applyFoil(text: TextBlock, isSilver: boolean): Promise<TextBlock> {
  const stops = isSilver
    ? `<stop stop-color="#ffffff"/><stop offset=".35" stop-color="#9eabb5"/><stop offset=".66" stop-color="#ffffff"/><stop offset="1" stop-color="#87939e"/>`
    : `<stop stop-color="#fff1a6"/><stop offset=".35" stop-color="#ad7820"/><stop offset=".66" stop-color="#ffe69a"/><stop offset="1" stop-color="#976619"/>`;
  const gradient = `<svg width="${text.width}" height="${text.height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#foil)"/></svg>`;
  const buffer = await sharp(Buffer.from(gradient)).composite([{ input: text.buffer, blend: "dest-in" }]).png().toBuffer();
  return { ...text, buffer };
}

function createCoverSvg({ coverSeed }: CoverInput): string {
  const palette = PALETTES[seedNumber(coverSeed, 0) % PALETTES.length];
  const variant = seedNumber(coverSeed, 16) % 4;
  const decoration = [
    `<circle cx="650" cy="430" r="224" fill="${palette[2]}" opacity=".12"/>`,
    `<path d="M194 640 480 276l294 364z" fill="${palette[2]}" opacity=".14"/>`,
    `<path d="M188 362h594M188 560h594" stroke="${palette[2]}" stroke-width="5" opacity=".15"/><circle cx="486" cy="462" r="160" fill="none" stroke="${palette[2]}" stroke-width="5" opacity=".15"/>`,
    `<path d="M188 598c136-260 292-260 590 0" fill="none" stroke="${palette[2]}" stroke-width="36" opacity=".15"/>`,
  ][variant];

  return `<svg width="900" height="1260" viewBox="0 0 900 1260" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="back" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5f6f2"/><stop offset="1" stop-color="#ccd2ca"/></linearGradient>
    <linearGradient id="cover" x1="0" y1="0" x2=".88" y2="1"><stop stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[0]}"/></linearGradient>
    <linearGradient id="spine" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#020608" stop-opacity=".6"/><stop offset="1" stop-color="${palette[0]}" stop-opacity="0"/></linearGradient>
    <filter id="shadow" x="-30%" y="-20%" width="180%" height="160%"><feDropShadow dx="30" dy="34" stdDeviation="24" flood-color="#132018" flood-opacity=".38"/></filter>
    <filter id="leather"><feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="4" seed="${seedNumber(coverSeed, 24) % 100}" result="noise"/><feColorMatrix in="noise" type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .14"/></feComponentTransfer></filter>
    <pattern id="moire" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><path d="M0 2h18M0 10h18" stroke="${palette[2]}" stroke-width="1.5" opacity=".2"/></pattern>
    <clipPath id="middle"><rect x="164" y="218" width="590" height="668"/></clipPath>
  </defs>
  <rect width="900" height="1260" fill="url(#back)"/>
  <ellipse cx="477" cy="1110" rx="304" ry="39" fill="#132018" opacity=".17"/>
  <g filter="url(#shadow)">
    <rect x="112" y="76" width="682" height="1040" rx="9" fill="url(#cover)"/>
    <rect x="112" y="76" width="58" height="1040" rx="9" fill="url(#spine)"/>
    <path d="M170 83v1024" stroke="#fff" stroke-opacity=".18" stroke-width="4"/>
    <rect x="120" y="84" width="666" height="1024" rx="5" filter="url(#leather)"/>
    <rect x="164" y="84" width="590" height="134" fill="${palette[0]}" fill-opacity=".76"/>
    <rect x="164" y="218" width="590" height="668" fill="url(#moire)"/>
    <g clip-path="url(#middle)">${decoration}</g>
    <rect x="164" y="886" width="590" height="222" fill="${palette[0]}" fill-opacity=".8"/>
    <path d="M164 218h590M164 886h590" stroke="#fff" stroke-opacity=".24" stroke-width="3"/>
  </g>
</svg>`;
}

const coverCache = new Map<string, Buffer>();

export async function createPublicBookCover(input: CoverInput): Promise<Buffer> {
  const cached = coverCache.get(input.coverSeed);
  if (cached) return cached;

  const isSilver = seedNumber(input.coverSeed, 8) % 2 === 0;
  const [author, title, imprint] = await Promise.all([
    renderFittedText(normalizeText(input.author ?? "", "Неизвестный автор").toLocaleUpperCase("ru"), "НЕИЗВЕСТНЫЙ АВТОР", {
      font: "DejaVu Sans Bold",
      maxWidth: 500,
      maxHeight: 78,
      maxFontSize: 23,
      minFontSize: 15,
    }),
    renderFittedText(input.title, "Без названия", {
      font: "DejaVu Serif Bold",
      maxWidth: 500,
      maxHeight: 310,
      maxFontSize: 66,
      minFontSize: 34,
      truncate: true,
    }),
    renderFittedText("R E A D O R A", "READORA", {
      font: "DejaVu Serif Bold",
      maxWidth: 420,
      maxHeight: 54,
      maxFontSize: 38,
      minFontSize: 28,
    }),
  ]);
  const [foilAuthor, foilTitle, foilImprint] = await Promise.all([
    applyFoil(author, isSilver),
    applyFoil(title, isSilver),
    applyFoil(imprint, isSilver),
  ]);
  const image = await sharp(Buffer.from(createCoverSvg(input)))
    .composite([
      { input: foilAuthor.buffer, left: 459 - Math.round(foilAuthor.width / 2), top: 151 - Math.round(foilAuthor.height / 2) },
      { input: foilTitle.buffer, left: 459 - Math.round(foilTitle.width / 2), top: 552 - Math.round(foilTitle.height / 2) },
      { input: foilImprint.buffer, left: 459 - Math.round(foilImprint.width / 2), top: 1018 - Math.round(foilImprint.height / 2) },
    ])
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  coverCache.set(input.coverSeed, image);
  return image;
}

export function invalidatePublicBookCoverCache(): void {
  coverCache.clear();
}
