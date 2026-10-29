// MOBI/AZW3 парсер. Адаптация foliate-js (https://github.com/readest/foliate-js),
// форк johnfactotum/foliate-js, лицензия MIT.

type StructDef = Record<string, [number, number, "string" | "uint"]>;
type StructValues<T extends StructDef> = { [K in keyof T]: T[K] extends [number, number, "string"] ? string : number };

const PDB_HEADER = {
  type: [60, 4, "string"],
  creator: [64, 4, "string"],
  numRecords: [76, 2, "uint"],
} satisfies StructDef;

const PALMDOC_HEADER = {
  compression: [0, 2, "uint"],
  numTextRecords: [8, 2, "uint"],
  recordSize: [10, 2, "uint"],
  encryption: [12, 2, "uint"],
} satisfies StructDef;

const MOBI_HEADER = {
  magic: [16, 4, "string"],
  length: [20, 4, "uint"],
  type: [24, 4, "uint"],
  encoding: [28, 4, "uint"],
  uid: [32, 4, "uint"],
  version: [36, 4, "uint"],
  titleOffset: [84, 4, "uint"],
  titleLength: [88, 4, "uint"],
  localeRegion: [94, 1, "uint"],
  localeLanguage: [95, 1, "uint"],
  resourceStart: [108, 4, "uint"],
  huffcdic: [112, 4, "uint"],
  numHuffcdic: [116, 4, "uint"],
  exthFlag: [128, 4, "uint"],
  trailingFlags: [240, 4, "uint"],
  indx: [244, 4, "uint"],
} satisfies StructDef;

const KF8_HEADER = {
  resourceStart: [108, 4, "uint"],
  fdst: [192, 4, "uint"],
  numFdst: [196, 4, "uint"],
  frag: [248, 4, "uint"],
  skel: [252, 4, "uint"],
  guide: [260, 4, "uint"],
} satisfies StructDef;

const EXTH_HEADER = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  count: [8, 4, "uint"],
} satisfies StructDef;

const INDX_HEADER = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  type: [8, 4, "uint"],
  idxt: [20, 4, "uint"],
  numRecords: [24, 4, "uint"],
  encoding: [28, 4, "uint"],
  language: [32, 4, "uint"],
  total: [36, 4, "uint"],
  ordt: [40, 4, "uint"],
  ligt: [44, 4, "uint"],
  numLigt: [48, 4, "uint"],
  numCncx: [52, 4, "uint"],
} satisfies StructDef;

const TAGX_HEADER = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  numControlBytes: [8, 4, "uint"],
} satisfies StructDef;

const HUFF_HEADER = {
  magic: [0, 4, "string"],
  offset1: [8, 4, "uint"],
  offset2: [12, 4, "uint"],
} satisfies StructDef;

const CDIC_HEADER = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  numEntries: [8, 4, "uint"],
  codeLength: [12, 4, "uint"],
} satisfies StructDef;

const FDST_HEADER = {
  magic: [0, 4, "string"],
  numEntries: [8, 4, "uint"],
} satisfies StructDef;

const MOBI_ENCODING: Record<number, string> = {
  1252: "windows-1252",
  65001: "utf-8",
};

const EXTH_RECORD_TYPE: Record<number, [string] | [string, "string" | "uint"] | [string, "string" | "uint", boolean]> = {
  100: ["creator", "string", true],
  101: ["publisher"],
  103: ["description"],
  104: ["isbn"],
  105: ["subject", "string", true],
  106: ["date"],
  108: ["contributor", "string", true],
  109: ["rights"],
  110: ["subjectCode", "string", true],
  112: ["source", "string", true],
  113: ["asin"],
  121: ["boundary", "uint"],
  122: ["fixedLayout"],
  125: ["numResources", "uint"],
  126: ["originalResolution"],
  127: ["zeroGutter"],
  128: ["zeroMargin"],
  129: ["coverURI"],
  132: ["regionMagnification"],
  201: ["coverOffset", "uint"],
  202: ["thumbnailOffset", "uint"],
  503: ["title"],
  524: ["language", "string", true],
  527: ["pageProgressionDirection"],
};

const MOBI_LANG: Record<number, string[]> = {
  1: ["ar"], 2: ["bg"], 3: ["ca"], 4: ["zh"], 5: ["cs"], 6: ["da"],
  7: ["de"], 8: ["el"], 9: ["en"], 10: ["es"], 11: ["fi"], 12: ["fr"],
  13: ["he"], 14: ["hu"], 15: ["is"], 16: ["it"], 17: ["ja"], 18: ["ko"],
  19: ["nl"], 20: ["no"], 21: ["pl"], 22: ["pt"], 23: ["rm"], 24: ["ro"],
  25: ["ru"], 26: ["hr"], 27: ["sk"], 28: ["sq"], 29: ["sv"], 30: ["th"],
  31: ["tr"], 32: ["ur"], 33: ["id"], 34: ["uk"], 35: ["be"], 36: ["sl"],
  37: ["et"], 38: ["lv"], 39: ["lt"], 41: ["fa"], 42: ["vi"], 43: ["hy"],
  44: ["az"], 45: ["eu"], 46: ["hsb"], 47: ["mk"], 48: ["st"], 49: ["ts"],
  50: ["tn"], 52: ["xh"], 53: ["zu"], 54: ["af"], 55: ["ka"], 56: ["fo"],
  57: ["hi"], 58: ["mt"], 59: ["se"], 62: ["ms"], 63: ["kk"], 65: ["sw"],
  67: ["uz"], 68: ["tt"], 69: ["bn"], 70: ["pa"], 71: ["gu"], 72: ["or"],
  73: ["ta"], 74: ["te"], 75: ["kn"], 76: ["ml"], 77: ["as"], 78: ["mr"],
  79: ["sa"], 82: ["cy"], 83: ["gl"], 87: ["kok"], 97: ["ne"], 98: ["fy"],
};

const MAX_MOBI_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MOBI_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_MOBI_RECORDS = 100_000;

export interface MobiRawChapter {
  title: string;
  html: string;
}

export interface MobiRawBook {
  title: string;
  author: string | null;
  description: string | null;
  language: string | null;
  publicationYear: number | null;
  coverBase64: string | null;
  coverMime: string | null;
  genres: string[];
  chapters: MobiRawChapter[];
}

function getUint(buf: Buffer, offset: number, len: number): number {
  let value = 0;
  for (let i = 0; i < len; i++) value = value * 256 + buf[offset + i];
  return value >>> 0;
}

function getString(buf: Buffer, offset: number, len: number): string {
  return buf.subarray(offset, offset + len).toString("latin1");
}

function getStruct<T extends StructDef>(def: T, buf: Buffer): StructValues<T> {
  const result: Record<string, string | number> = {};
  for (const [key, [start, len, type]] of Object.entries(def)) {
    result[key] = type === "string" ? getString(buf, start, len) : getUint(buf, start, len);
  }
  return result as StructValues<T>;
}

function makeDecoder(encodingCode: number): TextDecoder {
  const label = MOBI_ENCODING[encodingCode] ?? "utf-8";
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder("utf-8");
  }
}

function getVarLen(buf: Buffer, offset: number): { value: number; length: number } {
  let value = 0;
  let length = 0;
  for (let i = offset; i < Math.min(offset + 4, buf.length); i++) {
    const byte = buf[i];
    value = ((value << 7) | (byte & 0b111_1111)) >>> 0;
    length++;
    if (byte & 0b1000_0000) break;
  }
  return { value, length };
}

function getVarLenFromEnd(buf: Buffer): number {
  let value = 0;
  const start = Math.max(0, buf.length - 4);
  for (let i = start; i < buf.length; i++) {
    if (buf[i] & 0b1000_0000) value = 0;
    value = ((value << 7) | (buf[i] & 0b111_1111)) >>> 0;
  }
  return value;
}

function countBitsSet(x: number): number {
  let count = 0;
  for (; x > 0; x = x >> 1) if ((x & 1) === 1) count++;
  return count;
}

function countUnsetEnd(x: number): number {
  let count = 0;
  while ((x & 1) === 0) {
    x = x >> 1;
    count++;
  }
  return count;
}

function concatBytes(chunks: Buffer[]): Buffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    chunk.copy(result, offset);
    offset += chunk.length;
  }
  return result;
}

function decompressPalmDOC(input: Buffer): Buffer {
  const output: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const byte = input[i];
    if (byte === 0) output.push(0);
    else if (byte <= 8) {
      for (let j = 0; j < byte && i + 1 < input.length; j++) output.push(input[++i]);
    } else if (byte <= 0b0111_1111) output.push(byte);
    else if (byte <= 0b1011_1111) {
      if (i + 1 >= input.length) break;
      const bytes = (byte << 8) | input[++i];
      const distance = (bytes & 0b0011_1111_1111_1111) >>> 3;
      const length = (bytes & 0b111) + 3;
      for (let j = 0; j < length; j++) output.push(output[output.length - distance] ?? 0);
    } else {
      output.push(32, byte ^ 0b1000_0000);
    }
    if (output.length > MAX_MOBI_UNCOMPRESSED_BYTES) throw new Error("MOBI слишком большой после распаковки");
  }
  return Buffer.from(output);
}

function read32Bits(buf: Buffer, from: number): bigint {
  const startByte = from >> 3;
  const end = from + 32;
  const endByte = end >> 3;
  let bits = 0n;
  for (let i = startByte; i <= endByte; i++) bits = (bits << 8n) | BigInt(buf[i] ?? 0);
  return (bits >> BigInt(8 - (end & 7))) & 0xffffffffn;
}

function makeHuffcdicDecompressor(huffRecord: Buffer, cdicRecords: Buffer[]): (input: Buffer) => Buffer {
  const { magic, offset1, offset2 } = getStruct(HUFF_HEADER, huffRecord);
  if (magic !== "HUFF") throw new Error("Некорректная HUFF-запись");

  const table1 = Array.from({ length: 256 }, (_, i) => offset1 + i * 4)
    .map((offset) => getUint(huffRecord, offset, 4))
    .map((x) => [x & 0b1000_0000, x & 0b1_1111, x >>> 8]);

  const table2: Array<[number, number] | null> = [
    null,
    ...Array.from({ length: 32 }, (_, i) => offset2 + i * 8).map((offset): [number, number] => [
      getUint(huffRecord, offset, 4),
      getUint(huffRecord, offset + 4, 4),
    ]),
  ];

  const dictionary: Array<[Buffer, boolean]> = [];
  for (const record of cdicRecords) {
    const cdic = getStruct(CDIC_HEADER, record);
    if (cdic.magic !== "CDIC") throw new Error("Некорректная CDIC-запись");
    const n = Math.min(1 << cdic.codeLength, cdic.numEntries - dictionary.length);
    const buffer = record.subarray(cdic.length);
    for (let i = 0; i < n; i++) {
      const offset = getUint(buffer, i * 2, 2);
      const x = getUint(buffer, offset, 2);
      const length = x & 0x7fff;
      const decompressed = Boolean(x & 0x8000);
      dictionary.push([buffer.subarray(offset + 2, offset + 2 + length), decompressed]);
    }
  }

  const decompress = (input: Buffer): Buffer => {
    const chunks: Buffer[] = [];
    const bitLength = input.length * 8;
    for (let i = 0; i < bitLength; ) {
      const bits = Number(read32Bits(input, i));
      const entry = table1[bits >>> 24];
      let found = entry[0] !== 0;
      let codeLength = entry[1];
      let value = entry[2];
      if (!found) {
        let row = table2[codeLength] as [number, number] | null;
        while (row && bits >>> (32 - codeLength) < row[0]) {
          codeLength += 1;
          row = table2[codeLength] ?? null;
        }
        if (!row) throw new Error("Повреждённая HUFF-таблица");
        value = row[1];
      }
      i += codeLength;
      if (i > bitLength) break;

      const code = value - (bits >>> (32 - codeLength));
      const dictEntry = dictionary[code];
      if (!dictEntry) throw new Error("Повреждённая HUFF-словарь");
      let [result, decompressedFlag] = dictEntry;
      if (!decompressedFlag) {
        result = decompress(result);
        dictionary[code] = [result, true];
      }
      chunks.push(result);
      if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > MAX_MOBI_UNCOMPRESSED_BYTES) {
        throw new Error("MOBI слишком большой после распаковки");
      }
    }
    return concatBytes(chunks);
  };
  return decompress;
}

interface IndexEntry {
  name: string;
  tagMap: Record<number, number[]>;
}

function getIndexData(indxIndex: number, loadRecord: (index: number) => Buffer): { table: IndexEntry[]; cncx: Record<number, string> } {
  const indxRecord = loadRecord(indxIndex);
  const indx = getStruct(INDX_HEADER, indxRecord);
  if (indx.magic !== "INDX") throw new Error("Некорректная INDX-запись");
  const decoder = makeDecoder(indx.encoding);

  const tagxBuffer = indxRecord.subarray(indx.length);
  const tagx = getStruct(TAGX_HEADER, tagxBuffer);
  if (tagx.magic !== "TAGX") throw new Error("Некорректная TAGX-секция");
  const numTags = (tagx.length - 12) / 4;
  const tagTable = Array.from({ length: numTags }, (_, i) => tagxBuffer.subarray(12 + i * 4, 12 + i * 4 + 4));

  const cncx: Record<number, string> = {};
  let cncxRecordOffset = 0;
  for (let i = 0; i < indx.numCncx; i++) {
    const record = loadRecord(indxIndex + indx.numRecords + i + 1);
    for (let pos = 0; pos < record.length; ) {
      const index = pos;
      const { value, length } = getVarLen(record, pos);
      pos += length;
      const result = record.subarray(pos, pos + value);
      pos += value;
      cncx[cncxRecordOffset + index] = decoder.decode(result);
    }
    cncxRecordOffset += 0x10000;
  }

  const table: IndexEntry[] = [];
  for (let i = 0; i < indx.numRecords; i++) {
    const record = loadRecord(indxIndex + 1 + i);
    const entryHeader = getStruct(INDX_HEADER, record);
    if (entryHeader.magic !== "INDX") throw new Error("Некорректная INDX-запись");
    for (let j = 0; j < entryHeader.numRecords; j++) {
      const offsetOffset = entryHeader.idxt + 4 + 2 * j;
      const offset = getUint(record, offsetOffset, 2);

      const length = getUint(record, offset, 1);
      const name = getString(record, offset + 1, length);

      const tags: Array<[number, number | null, number | null, number]> = [];
      const startPos = offset + 1 + length;
      let controlByteIndex = 0;
      let pos = startPos + tagx.numControlBytes;
      for (const [tagByte, numValuesByte, maskByte, endByte] of tagTable) {
        const tag = tagByte;
        const numValues = numValuesByte;
        const mask = maskByte;
        const end = endByte;
        if (end & 1) {
          controlByteIndex++;
          continue;
        }
        const value = getUint(record, startPos + controlByteIndex, 1) & mask;
        if (value === mask) {
          if (countBitsSet(mask) > 1) {
            const { value: valueBytes, length: varLen } = getVarLen(record, pos);
            tags.push([tag, null, valueBytes, numValues]);
            pos += varLen;
          } else tags.push([tag, 1, null, numValues]);
        } else tags.push([tag, value >> countUnsetEnd(mask), null, numValues]);
      }

      const tagMap: Record<number, number[]> = {};
      for (const [tag, valueCount, valueBytes, numValues] of tags) {
        const values: number[] = [];
        if (valueCount != null) {
          for (let k = 0; k < valueCount * numValues; k++) {
            const { value, length } = getVarLen(record, pos);
            values.push(value);
            pos += length;
          }
        } else {
          let count = 0;
          while (count < (valueBytes ?? 0)) {
            const { value, length } = getVarLen(record, pos);
            values.push(value);
            pos += length;
            count += length;
          }
        }
        tagMap[tag] = values;
      }
      table.push({ name, tagMap });
    }
  }
  return { table, cncx };
}

function getEXTH(buf: Buffer, encoding: number): Record<string, string | number | string[]> {
  const { magic, count } = getStruct(EXTH_HEADER, buf);
  if (magic !== "EXTH") throw new Error("Некорректный EXTH-заголовок");
  const decoder = makeDecoder(encoding);
  const results: Record<string, string | number | string[]> = {};
  let offset = 12;
  for (let i = 0; i < count; i++) {
    const type = getUint(buf, offset, 4);
    const length = getUint(buf, offset + 4, 4);
    const recordType = EXTH_RECORD_TYPE[type];
    if (recordType) {
      const [name, typ, many] = recordType;
      const data = buf.subarray(offset + 8, offset + length);
      const value = typ === "uint" ? getUint(data, 0, Math.min(4, data.length)) : decoder.decode(data);
      if (many) {
        const list = (results[name] as string[]) ?? [];
        list.push(value as string);
        results[name] = list;
      } else results[name] = value;
    }
    offset += length;
  }
  return results;
}

function getImageMime(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", laquo: "\u00ab", raquo: "\u00bb",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018",
  rdquo: "\u201d", ldquo: "\u201c", copy: "\u00a9", reg: "\u00ae", trade: "\u2122",
};

function unescapeHTML(str: string): string {
  if (!str) return "";
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

interface MobiHeaders {
  palmdoc: StructValues<typeof PALMDOC_HEADER>;
  mobi: StructValues<typeof MOBI_HEADER> & { titleBuffer: Buffer; language: string | null };
  exth: Record<string, string | number | string[]> | null;
  kf8: StructValues<typeof KF8_HEADER> | null;
}

class MobiFile {
  private buffer: Buffer;
  private recordOffsets: Array<[number, number | undefined]> = [];
  private start = 0;
  headers!: MobiHeaders;
  private decoder!: TextDecoder;
  private decompress!: (input: Buffer) => Buffer;
  private removeTrailingEntries!: (input: Buffer) => Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  open(): void {
    if (this.buffer.length < 78) throw new Error("Некорректный MOBI: файл слишком мал");
    const pdb = getStruct(PDB_HEADER, this.buffer) as { type: string; creator: string; numRecords: number };
    if (pdb.type !== "BOOK") throw new Error("Некорректный MOBI: отсутствует сигнатура BOOKMOBI");
    if (pdb.numRecords === 0 || pdb.numRecords > MAX_MOBI_RECORDS) throw new Error("Некорректный MOBI: неверное число записей");

    const infoOffset = 78;
    const infoEnd = infoOffset + pdb.numRecords * 8;
    if (infoEnd > this.buffer.length) throw new Error("Некорректный MOBI: повреждена таблица записей");
    const offsets: number[] = [];
    for (let i = 0; i < pdb.numRecords; i++) offsets.push(getUint(this.buffer, infoOffset + i * 8, 4));
    this.recordOffsets = offsets.map((x, i) => [x, offsets[i + 1]]);

    this.headers = this.readHeaders(this.loadBaseRecord(0));
    let isKF8 = (this.headers.mobi.version as number) >= 8;
    if (!isKF8) {
      const boundary = this.headers.exth?.boundary;
      if (typeof boundary === "number" && boundary < 0xffffffff) {
        try {
          this.headers = this.readHeaders(this.loadBaseRecord(boundary));
          this.start = boundary;
          isKF8 = true;
        } catch {
          this.start = 0;
          this.headers = this.readHeaders(this.loadBaseRecord(0));
        }
      }
    }
    this.setup();
    this.isKF8 = isKF8;
  }

  isKF8 = false;

  private loadBaseRecord(index: number): Buffer {
    const offsets = this.recordOffsets[index];
    if (!offsets) throw new Error("Индекс записи MOBI вне диапазона");
    const [start, end] = offsets;
    const stop = end ?? this.buffer.length;
    if (start < 0 || stop > this.buffer.length || start > stop) throw new Error("Повреждённая запись MOBI");
    return this.buffer.subarray(start, stop);
  }

  loadRecord(index: number): Buffer {
    return this.loadBaseRecord(this.start + index);
  }

  loadMagic(index: number): string {
    const offsets = this.recordOffsets[this.start + index];
    if (!offsets) throw new Error("Индекс записи MOBI вне диапазона");
    return getString(this.buffer, offsets[0], 4);
  }

  private readHeaders(buf: Buffer): MobiHeaders {
    const palmdoc = getStruct(PALMDOC_HEADER, buf);
    const mobi = getStruct(MOBI_HEADER, buf);
    if (mobi.magic !== "MOBI") throw new Error("Отсутствует MOBI-заголовок");

    const titleBuffer = buf.subarray(mobi.titleOffset, mobi.titleOffset + mobi.titleLength);
    const langList = MOBI_LANG[mobi.localeLanguage];
    const language = langList?.[mobi.localeRegion >> 2] ?? langList?.[0] ?? null;

    const exth = mobi.exthFlag & 0b100_0000 ? getEXTH(buf.subarray(mobi.length + 16), mobi.encoding) : null;
    const kf8 = mobi.version >= 8 ? getStruct(KF8_HEADER, buf) : null;
    return { palmdoc, mobi: { ...mobi, titleBuffer, language }, exth, kf8 };
  }

  private setup(): void {
    const { palmdoc, mobi } = this.headers;
    this.decoder = makeDecoder(mobi.encoding as number);

    if (palmdoc.encryption !== 0) throw new Error("MOBI защищён DRM и не может быть прочитан");

    if (palmdoc.compression === 1) this.decompress = (input) => input;
    else if (palmdoc.compression === 2) this.decompress = decompressPalmDOC;
    else if (palmdoc.compression === 17480) {
      const huffIndex = mobi.huffcdic as number;
      const numHuffcdic = mobi.numHuffcdic as number;
      const huffRecord = this.loadRecord(huffIndex);
      const cdicRecords: Buffer[] = [];
      for (let i = 1; i < numHuffcdic; i++) cdicRecords.push(this.loadRecord(huffIndex + i));
      this.decompress = makeHuffcdicDecompressor(huffRecord, cdicRecords);
    } else throw new Error("Неизвестный тип сжатия MOBI");

    const trailingFlags = mobi.trailingFlags as number;
    const multibyte = trailingFlags & 1;
    const numTrailingEntries = countBitsSet(trailingFlags >>> 1);
    this.removeTrailingEntries = (input) => {
      let array = input;
      for (let i = 0; i < numTrailingEntries; i++) {
        const length = getVarLenFromEnd(array);
        array = array.subarray(0, Math.max(0, array.length - length));
      }
      if (multibyte && array.length) {
        const length = (array[array.length - 1] & 0b11) + 1;
        array = array.subarray(0, Math.max(0, array.length - length));
      }
      return array;
    };
  }

  decode(buf: Buffer): string {
    return this.decoder.decode(buf);
  }

  loadText(index: number): Buffer {
    return this.decompress(this.removeTrailingEntries(this.loadRecord(index + 1)));
  }

  loadResource(index: number): Buffer {
    const resourceStart = this.headers.mobi.resourceStart as number;
    return this.loadRecord(resourceStart + index);
  }

  loadAllText(): Buffer {
    const chunks: Buffer[] = [];
    for (let i = 0; i < this.headers.palmdoc.numTextRecords; i++) chunks.push(this.loadText(i));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total > MAX_MOBI_UNCOMPRESSED_BYTES) throw new Error("MOBI слишком большой после распаковки");
    return concatBytes(chunks);
  }

  getMetadata(): {
    title: string; author: string[]; description: string | null; language: string | null;
    date: string | null; subjects: string[];
  } {
    const { mobi, exth } = this.headers;
    const title = unescapeHTML(
      (exth?.title as string) || this.decode((mobi.titleBuffer as Buffer).subarray()),
    );
    const author = ((exth?.creator as string[]) ?? []).map(unescapeHTML).filter(Boolean);
    // EXTH-записи 524 (language) могут повторяться — берём первое непустое значение.
    const exthLanguage = Array.isArray(exth?.language) ? (exth.language as string[]).find(Boolean) : (exth?.language as string | undefined);
    return {
      title,
      author,
      description: exth?.description ? unescapeHTML(exth.description as string) : null,
      language: exthLanguage || (mobi.language as string | null),
      date: (exth?.date as string) ?? null,
      subjects: ((exth?.subject as string[]) ?? []).map(unescapeHTML).filter(Boolean),
    };
  }

  getCover(): { base64: string; mime: string } | null {
    const exth = this.headers.exth;
    const offset =
      typeof exth?.coverOffset === "number" && exth.coverOffset < 0xffffffff
        ? exth.coverOffset
        : typeof exth?.thumbnailOffset === "number" && exth.thumbnailOffset < 0xffffffff
          ? exth.thumbnailOffset
          : null;
    if (offset == null) return null;
    try {
      const bytes = this.loadResource(offset);
      const mime = getImageMime(bytes);
      if (!mime || bytes.length > MAX_MOBI_IMAGE_BYTES || bytes.length === 0) return null;
      return { base64: bytes.toString("base64"), mime };
    } catch {
      return null;
    }
  }
}

const mbpPagebreakRegex = /<\s*(?:mbp:)?pagebreak[^>]*>/gi;
const selfClosingRegex = /<(a|div|span|p)\s*\/>/gi;
const headingRegex = /<h[1-6][^>]*>([^<]*)<\/h[1-6]>/i;
const recindexImgRegex = /<img\b[^>]*recindex=["']?(\d+)["']?[^>]*>/gi;
const kindleEmbedRegex = /kindle:(?:embed|flow):(\w+)(?:\?mime=[\w/.+-]+)?/gi;

function inlineMobiImages(html: string, loadResource: (index: number) => Buffer): string {
  return html.replace(recindexImgRegex, (match, recindex: string) => {
    const index = Number(recindex) - 1;
    if (!Number.isInteger(index) || index < 0) return "";
    try {
      const bytes = loadResource(index);
      const mime = getImageMime(bytes);
      if (!mime || bytes.length === 0 || bytes.length > MAX_MOBI_IMAGE_BYTES) return "";
      const alt = /alt=["']([^"']*)["']/i.exec(match)?.[1] ?? "Иллюстрация";
      return `<img src="data:${mime};base64,${bytes.toString("base64")}" alt="${alt.replace(/"/g, "&quot;")}">`;
    } catch {
      return "";
    }
  });
}

function inlineKf8Images(html: string, loadResource: (index: number) => Buffer): string {
  return html.replace(kindleEmbedRegex, (match, id: string) => {
    const index = parseInt(id, 32) - 1;
    if (!Number.isInteger(index) || index < 0) return "";
    try {
      const bytes = loadResource(index);
      const mime = getImageMime(bytes);
      if (!mime || bytes.length === 0 || bytes.length > MAX_MOBI_IMAGE_BYTES) return match;
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      return match;
    }
  });
}

function chapterTitleFromHtml(html: string, index: number): string {
  const heading = html.match(headingRegex)?.[1]?.trim();
  return heading || `Глава ${index + 1}`;
}

function buildMobi6Chapters(mobi: MobiFile): MobiRawChapter[] {
  const raw = mobi.loadAllText();
  const str = mobi.decode(raw);
  const parts = str.split(mbpPagebreakRegex).map((part) => part.replace(selfClosingRegex, "<$1></$1>"));

  const chapters: MobiRawChapter[] = [];
  for (const part of parts) {
    const html = inlineMobiImages(part, (index) => mobi.loadResource(index));
    if (!html.trim()) continue;
    chapters.push({ title: chapterTitleFromHtml(html, chapters.length), html });
  }
  return chapters;
}

interface Kf8Section {
  skelOffset: number;
  skelLength: number;
  frags: Array<{ insertOffset: number; index: number; offset: number; length: number }>;
}

function buildKf8Chapters(mobi: MobiFile): MobiRawChapter[] {
  const kf8 = mobi.headers.kf8!;
  const loadRecord = (index: number) => mobi.loadRecord(index);

  const skelData = getIndexData(kf8.skel as number, loadRecord);
  const skelTable = skelData.table.map(({ name, tagMap }) => ({
    name,
    numFrag: tagMap[1]?.[0] ?? 0,
    offset: tagMap[6]?.[0] ?? 0,
    length: tagMap[6]?.[1] ?? 0,
  }));
  const fragData = getIndexData(kf8.frag as number, loadRecord);
  const fragTable = fragData.table.map(({ name, tagMap }) => ({
    insertOffset: parseInt(name, 10) || 0,
    index: tagMap[4]?.[0] ?? 0,
    offset: tagMap[6]?.[0] ?? 0,
    length: tagMap[6]?.[1] ?? 0,
  }));

  const sections: Kf8Section[] = [];
  let fragCursor = 0;
  for (const skel of skelTable) {
    const frags = fragTable.slice(fragCursor, fragCursor + skel.numFrag);
    fragCursor += skel.numFrag;
    sections.push({ skelOffset: skel.offset, skelLength: skel.length, frags });
  }

  const raw = mobi.loadAllText();

  const assembled = sections.map((section) => {
    let skeleton = raw.subarray(section.skelOffset, section.skelOffset + section.skelLength);
    for (const frag of section.frags) {
      const insertOffset = Math.max(0, Math.min(frag.insertOffset - section.skelOffset, skeleton.length));
      const fragStart = section.skelOffset + section.skelLength + frag.offset;
      const fragRaw = raw.subarray(fragStart, fragStart + frag.length);
      skeleton = concatBytes([skeleton.subarray(0, insertOffset), fragRaw, skeleton.subarray(insertOffset)]);
    }
    return mobi.decode(skeleton);
  });

  const titlesBySection = new Map<number, string>();
  try {
    const ncxIndex = mobi.headers.mobi.indx as number;
    if (ncxIndex < 0xffffffff) {
      const { table, cncx } = getIndexData(ncxIndex, loadRecord);
      for (const { tagMap } of table) {
        const label = cncx[tagMap[3]?.[0] ?? -1];
        const fid = tagMap[6]?.[0];
        if (!label || fid == null) continue;
        const sectionIndex = sections.findIndex((section) => section.frags.some((frag) => frag.index === fid));
        if (sectionIndex >= 0 && !titlesBySection.has(sectionIndex)) {
          titlesBySection.set(sectionIndex, unescapeHTML(label));
        }
      }
    }
  } catch {
    // TOC опционален: заголовки возьмём из HTML
  }

  const chapters: MobiRawChapter[] = [];
  for (const [i, html] of assembled.entries()) {
    const withImages = inlineKf8Images(html, (index) => mobi.loadResource(index));
    if (!withImages.trim()) continue;
    chapters.push({
      title: titlesBySection.get(i) ?? chapterTitleFromHtml(withImages, i),
      html: withImages,
    });
  }
  return chapters;
}

export function isMobiBuffer(buffer: Buffer): boolean {
  return buffer.length >= 68 && getString(buffer, 60, 8) === "BOOKMOBI";
}

export function parseMobiRaw(buffer: Buffer): MobiRawBook {
  const mobi = new MobiFile(buffer);
  mobi.open();

  const metadata = mobi.getMetadata();
  const yearMatch = metadata.date?.match(/\d{4}/);
  const cover = mobi.getCover();

  let chapters: MobiRawChapter[];
  if (mobi.isKF8) {
    chapters = buildKf8Chapters(mobi);
    if (chapters.length === 0) chapters = buildMobi6Chapters(mobi);
  } else {
    chapters = buildMobi6Chapters(mobi);
  }

  return {
    title: metadata.title || "Без названия",
    author: metadata.author.join(", ") || null,
    description: metadata.description,
    language: metadata.language,
    publicationYear: yearMatch ? parseInt(yearMatch[0], 10) : null,
    coverBase64: cover?.base64 ?? null,
    coverMime: cover?.mime ?? null,
    genres: metadata.subjects,
    chapters,
  };
}
