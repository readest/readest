/**
 * Babylon Glossary (.bgl) reader. Reference: PyGlossary's babylon_bgl plugin
 * (https://github.com/ilius/pyglossary, pyglossary/plugins/babylon_bgl),
 * itself based on the ktranslator reverse engineering by Raul Fernandes and
 * Karl Grill.
 *
 * # File layout
 *
 * ```
 *   bytes [0..4)  : magic 12 34 00 01 or 12 34 00 02
 *   bytes [4..6)  : u16 BE — offset of the gzip stream
 *   bytes [6..off): junk (not part of the payload)
 *   bytes [off..) : one gzip member holding the block stream
 * ```
 *
 * Many BGL files carry a zeroed gzip CRC; fflate's `gunzipSync` skips
 * checksum verification, which is exactly the tolerance PyGlossary patches
 * into Python's gzip module.
 *
 * ## Block stream
 *
 * Each block starts with one byte: low nibble = block type, high nibble =
 * length. A high nibble < 4 means the next (nibble + 1) bytes are a BE
 * length; otherwise the data length is nibble - 4.
 *
 * Block types:
 *   - 0            : misc; code 8 carries the default charset
 *   - 1, 7, 10, 13 : entry — 1-byte word len, word, 2-byte BE defi len,
 *                    defi, then alternates (1-byte len each)
 *   - 11           : entry, wide form — 5-byte word len, 4-byte alt count,
 *                    4-byte len per alt, 4-byte defi len
 *   - 2            : embedded resource file (1-byte name len, name, data)
 *   - 3            : glossary property — 2-byte BE code, value
 *
 * ## Encodings
 *
 * Keys use the source encoding, definitions the target encoding; both derive
 * from explicit charset properties (0x1a/0x1b), the language properties
 * (0x07/0x08), the type-0 default charset, or the global utf-8 flag
 * (property 0x11, bit 0x8000). Definitions may switch encodings inline via
 * `<charset c=X>…</charset>` tags (U = utf-8, T = 4-hex-digit Babylon char
 * references, K/E = source encoding, G = gbk).
 *
 * Definitions may end with control-sequence trailing fields introduced by
 * 0x14: part of speech (0x02), display title (0x18), title translation
 * (0x28), transcriptions (0x50/0x60), and a few opaque fields we skip.
 */
import { gunzipSync } from 'fflate';

export interface BglMetadata {
  title?: string;
  author?: string;
  email?: string;
  copyright?: string;
  description?: string;
  /** Babylon language names, e.g. `English`, `French`. */
  sourceLang?: string;
  targetLang?: string;
  /** Resolved codepage names, e.g. `cp1252`, `utf-8`. */
  sourceEncoding: string;
  targetEncoding: string;
}

export interface BglEntry {
  headword: string;
  alternates: string[];
  /** Definition HTML fragment (Babylon definitions are HTML). */
  definition: string;
}

const MAGIC = [0x12, 0x34, 0x00];

/** Babylon charset property byte → codepage (property codes 0x1a/0x1b, type-0 code 8). */
const CHARSET_BY_CODE = new Map<number, string>([
  [0x41, 'cp1252'], // Default
  [0x42, 'cp1252'], // Latin
  [0x43, 'cp1250'], // Eastern European
  [0x44, 'cp1251'], // Cyrillic
  [0x45, 'cp932'], // Japanese
  [0x46, 'cp950'], // Traditional Chinese
  [0x47, 'cp936'], // Simplified Chinese
  [0x48, 'cp1257'], // Baltic
  [0x49, 'cp1253'], // Greek
  [0x4a, 'cp949'], // Korean
  [0x4b, 'cp1254'], // Turkish
  [0x4c, 'cp1255'], // Hebrew
  [0x4d, 'cp1256'], // Arabic
  [0x4e, 'cp874'], // Thai
]);

/** Babylon language code (properties 0x07/0x08) → [name, default codepage]. */
const LANGUAGES: [string, string][] = [
  ['English', 'cp1252'], // 0x00
  ['French', 'cp1252'], // 0x01
  ['Italian', 'cp1252'], // 0x02
  ['Spanish', 'cp1252'], // 0x03
  ['Dutch', 'cp1252'], // 0x04
  ['Portuguese', 'cp1252'], // 0x05
  ['German', 'cp1252'], // 0x06
  ['Russian', 'cp1251'], // 0x07
  ['Japanese', 'cp932'], // 0x08
  ['Chinese', 'cp950'], // 0x09
  ['Chinese', 'cp936'], // 0x0a
  ['Greek', 'cp1253'], // 0x0b
  ['Korean', 'cp949'], // 0x0c
  ['Turkish', 'cp1254'], // 0x0d
  ['Hebrew', 'cp1255'], // 0x0e
  ['Arabic', 'cp1256'], // 0x0f
  ['Thai', 'cp874'], // 0x10
  ['Other', 'cp1252'], // 0x11
  ['Chinese', 'cp936'], // 0x12
  ['Chinese', 'cp950'], // 0x13
  ['Other Eastern-European languages', 'cp1250'], // 0x14
  ['Other Western-European languages', 'cp1252'], // 0x15
  ['Other Russian languages', 'cp1251'], // 0x16
  ['Other Japanese languages', 'cp932'], // 0x17
  ['Other Baltic languages', 'cp1257'], // 0x18
  ['Other Greek languages', 'cp1253'], // 0x19
  ['Other Korean dialects', 'cp949'], // 0x1a
  ['Other Turkish dialects', 'cp1254'], // 0x1b
  ['Other Thai dialects', 'cp874'], // 0x1c
  ['Polish', 'cp1250'], // 0x1d
  ['Hungarian', 'cp1250'], // 0x1e
  ['Czech', 'cp1250'], // 0x1f
  ['Lithuanian', 'cp1257'], // 0x20
  ['Latvian', 'cp1257'], // 0x21
  ['Catalan', 'cp1252'], // 0x22
  ['Croatian', 'cp1250'], // 0x23
  ['Serbian', 'cp1250'], // 0x24
  ['Slovak', 'cp1250'], // 0x25
  ['Albanian', 'cp1252'], // 0x26
  ['Urdu', 'cp1256'], // 0x27
  ['Slovenian', 'cp1250'], // 0x28
  ['Estonian', 'cp1252'], // 0x29
  ['Bulgarian', 'cp1250'], // 0x2a
  ['Danish', 'cp1252'], // 0x2b
  ['Finnish', 'cp1252'], // 0x2c
  ['Icelandic', 'cp1252'], // 0x2d
  ['Norwegian', 'cp1252'], // 0x2e
  ['Romanian', 'cp1252'], // 0x2f
  ['Swedish', 'cp1252'], // 0x30
  ['Ukrainian', 'cp1251'], // 0x31
  ['Belarusian', 'cp1251'], // 0x32
  ['Persian', 'cp1256'], // 0x33
  ['Basque', 'cp1252'], // 0x34
  ['Macedonian', 'cp1250'], // 0x35
  ['Afrikaans', 'cp1252'], // 0x36
  ['Faroese', 'cp1252'], // 0x37
  ['Latin', 'cp1252'], // 0x38
  ['Esperanto', 'cp1254'], // 0x39
  ['Tamazight', 'cp1252'], // 0x3a
  ['Armenian', 'cp1252'], // 0x3b
  ['Hindi', 'cp1252'], // 0x3c
  ['Somali', 'cp1252'], // 0x3d
];

/** Part-of-speech byte (trailing field 0x02) → label. */
const PART_OF_SPEECH_BY_CODE = new Map<number, string>([
  [0x30, 'noun'],
  [0x31, 'adjective'],
  [0x32, 'verb'],
  [0x33, 'adverb'],
  [0x34, 'interjection'],
  [0x35, 'pronoun'],
  [0x36, 'preposition'],
  [0x37, 'conjunction'],
  [0x38, 'suffix'],
  [0x39, 'prefix'],
  [0x3a, 'article'],
  [0x3c, 'abbreviation'],
  [0x3d, 'masculine noun and adjective'],
  [0x3e, 'feminine noun and adjective'],
  [0x3f, 'masculine and feminine noun and adjective'],
  [0x40, 'feminine noun'],
  [0x41, 'masculine and feminine noun'],
  [0x42, 'masculine noun'],
  [0x43, 'numeral'],
  [0x44, 'participle'],
]);

/** Codepage names → WHATWG TextDecoder labels. */
const ENCODING_LABELS: Record<string, string> = {
  cp1250: 'windows-1250',
  cp1251: 'windows-1251',
  cp1252: 'windows-1252',
  cp1253: 'windows-1253',
  cp1254: 'windows-1254',
  cp1255: 'windows-1255',
  cp1256: 'windows-1256',
  cp1257: 'windows-1257',
  cp874: 'windows-874',
  cp932: 'shift_jis',
  cp936: 'gbk',
  cp949: 'euc-kr',
  cp950: 'big5',
};

const decoders = new Map<string, TextDecoder>();
const getDecoder = (encoding: string): TextDecoder => {
  let d = decoders.get(encoding);
  if (!d) {
    try {
      d = new TextDecoder(ENCODING_LABELS[encoding] ?? encoding);
    } catch {
      d = new TextDecoder('windows-1252');
    }
    decoders.set(encoding, d);
  }
  return d;
};

/** latin1 maps every byte to the same code unit — used for byte-level regexes. */
const latin1 = new TextDecoder('latin1');
const latin1Bytes = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

const uint = (b: Uint8Array, start: number, end: number): number => {
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + b[i]!;
  return v;
};

// --------------------------------------------------------------------------
// Text cleanup (ports of PyGlossary's bgl_text helpers)
// --------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, number> = {
  amp: 38,
  lt: 60,
  gt: 62,
  quot: 34,
  apos: 39,
  nbsp: 160,
};

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const resolveEntity = (text: string, name: string): string | null => {
  if (text.startsWith('&#')) {
    const code = text.slice(0, 3).toLowerCase() === '&#x' ? parseInt(name, 16) : parseInt(name, 10);
    if (!Number.isFinite(code) || code <= 0) return '�';
    return String.fromCodePoint(code);
  }
  const code = NAMED_ENTITIES[name.toLowerCase()];
  // Babylon glossaries are full of non-standard named entities (csdot,
  // fllig, …) that Babylon itself renders literally — leave them as-is.
  return code === undefined ? null : String.fromCodePoint(code);
};

/** Replace character/entity references in definitions, escaping the result. */
const replaceHtmlEntries = (s: string): string =>
  s.replace(/(?:&#x|&#|&)(\w+);?/gi, (text, name: string) => {
    const resolved = resolveEntity(text, name);
    return resolved === null ? text : escapeXml(resolved);
  });

/** Same for keys, but a trailing `;` is required and the result is not escaped. */
const replaceHtmlEntriesInKeys = (s: string): string =>
  s.replace(/(?:&#x|&#|&)(\w+);/gi, (text, name: string) => resolveEntity(text, name) ?? text);

const stripHtmlTags = (s: string): string => s.replace(/(?:<[/a-zA-Z].*?(?:>|$))+/g, ' ');
const removeControlChars = (s: string): string => s.replace(/[\x00-\x08\x0c\x0e-\x1f]/g, '');
const removeNewlines = (s: string): string => s.replace(/[\r\n]+/g, ' ');
const normalizeNewlines = (s: string): string => s.replace(/[\r\n]+/g, '\n');
/** `<img>` src values are wrapped in \x1e…\x1f markers; strip them anywhere. */
const fixImgLinks = (s: string): string => s.replace(/[\x1e\x1f]/g, '');

/**
 * Strip `$<index>$` suffixes from keys (`make do$4$`, `word$$$$…`). Runs of
 * two or more dollars are dropped wholesale; `$…$` with non-digits between
 * is kept.
 */
const stripDollarIndexes = (b: Uint8Array): Uint8Array => {
  const s = latin1.decode(b);
  let out = '';
  let i = 0;
  for (;;) {
    const d0 = s.indexOf('$', i);
    if (d0 === -1) {
      out += s.slice(i);
      break;
    }
    const d1 = s.indexOf('$', d0 + 1);
    if (d1 === -1) {
      out += s.slice(i);
      break;
    }
    if (d1 === d0 + 1) {
      // `$$…` run — drop every consecutive dollar.
      out += s.slice(i, d0);
      i = d1 + 1;
      while (i < s.length && s[i] === '$') i++;
      if (i >= s.length) break;
      continue;
    }
    if (/[^0-9]/.test(s.slice(d0 + 1, d1))) {
      out += s.slice(i, d1);
      i = d1;
      continue;
    }
    out += s.slice(i, d0);
    i = d1 + 1;
  }
  return latin1Bytes(out);
};

// --------------------------------------------------------------------------
// Definition trailing fields (after the 0x14 marker)
// --------------------------------------------------------------------------

interface DefiFields {
  body: Uint8Array;
  partOfSpeech?: string;
  title?: Uint8Array;
  titleTrans?: Uint8Array;
  transcription50?: Uint8Array;
  code50?: number;
  transcription60?: Uint8Array;
  code60?: number;
}

/**
 * Find the 0x14 byte that starts the trailing-field set. A 0x14 followed by
 * a space is assumed to be article text; the last byte is never a marker.
 */
const findDefiFieldsStart = (b: Uint8Array): number => {
  let index = 0;
  for (;;) {
    index = b.indexOf(0x14, index);
    if (index === -1 || index >= b.length - 1) return -1;
    if (b[index + 1] !== 0x20) return index;
    index += 1;
  }
};

const collectDefiFields = (b: Uint8Array): DefiFields => {
  const d0 = findDefiFieldsStart(b);
  if (d0 === -1) return { body: b };
  const fields: DefiFields = { body: b.subarray(0, d0) };
  let i = d0 + 1;
  while (i < b.length) {
    const code = b[i]!;
    if (code === 0x02) {
      // part of speech: one byte
      if (i + 1 >= b.length) break;
      fields.partOfSpeech = PART_OF_SPEECH_BY_CODE.get(b[i + 1]!);
      i += 2;
    } else if (code === 0x06) {
      i += 2; // one opaque byte
    } else if (code === 0x07) {
      i += 3; // two opaque bytes
    } else if (code === 0x13 || code === 0x1a) {
      // one-byte length + opaque data
      if (i + 1 >= b.length) break;
      i += 2 + b[i + 1]!;
    } else if (code === 0x18) {
      // display title: one-byte length + text
      if (i + 1 >= b.length) break;
      const len = b[i + 1]!;
      i += 2;
      if (len > 0 && i + len <= b.length) fields.title = b.subarray(i, i + len);
      i += len;
    } else if (code === 0x28) {
      // title translation: two-byte BE length + text
      if (i + 2 >= b.length) break;
      const len = uint(b, i + 1, i + 3);
      i += 3;
      if (len > 0 && i + len <= b.length) fields.titleTrans = b.subarray(i, i + len);
      i += len;
    } else if (code >= 0x40 && code <= 0x4f) {
      // opaque; data length is derived from the code itself
      i += 2 + (code - 0x3f);
    } else if (code === 0x50) {
      // transcription: one code byte + one-byte length + text
      if (i + 2 >= b.length) break;
      fields.code50 = b[i + 1]!;
      const len = b[i + 2]!;
      i += 3;
      if (len > 0 && i + len <= b.length) fields.transcription50 = b.subarray(i, i + len);
      i += len;
    } else if (code === 0x60) {
      // transcription: one code byte + two-byte BE length + text
      if (i + 3 >= b.length) break;
      fields.code60 = b[i + 1]!;
      const len = uint(b, i + 2, i + 4);
      i += 4;
      if (len > 0 && i + len <= b.length) fields.transcription60 = b.subarray(i, i + len);
      i += len;
    } else {
      break; // unknown control code — ignore the rest
    }
  }
  return fields;
};

// --------------------------------------------------------------------------
// Reader
// --------------------------------------------------------------------------

interface EntrySpan {
  headword: string;
  alternates: string[];
  defiStart: number;
  defiEnd: number;
}

interface RawEntryBlock {
  type: number;
  start: number;
  end: number;
}

export class BglReader {
  metadata: BglMetadata = { sourceEncoding: 'cp1252', targetEncoding: 'cp1252' };
  entryCount = 0;

  /** Decompressed block stream; definition spans point into it. */
  private data: Uint8Array = new Uint8Array(0);
  private entries: EntrySpan[] = [];
  /** Lowercased headword/alternate → indices into `entries`. */
  private index = new Map<string, number[]>();

  async load(opts: { bgl: Blob }): Promise<void> {
    const bytes = new Uint8Array(await opts.bgl.arrayBuffer());
    if (
      bytes.length < 6 ||
      bytes[0] !== MAGIC[0] ||
      bytes[1] !== MAGIC[1] ||
      bytes[2] !== MAGIC[2] ||
      (bytes[3] !== 0x01 && bytes[3] !== 0x02)
    ) {
      throw new Error('Not a Babylon glossary (bad magic)');
    }
    const gzipOffset = (bytes[4]! << 8) | bytes[5]!;
    if (gzipOffset < 6 || gzipOffset >= bytes.length) {
      throw new Error(`Not a Babylon glossary (bad gzip offset ${gzipOffset})`);
    }
    this.data = gunzipSync(bytes.subarray(gzipOffset));

    // Pass 1 — walk the block stream: collect entry spans, raw glossary
    // properties, and the charset hints needed to resolve encodings.
    const rawInfo = new Map<number, Uint8Array>();
    const entryBlocks: RawEntryBlock[] = [];
    let defaultCharset = '';
    const data = this.data;
    let pos = 0;
    while (pos < data.length) {
      let length = data[pos]!;
      pos += 1;
      const type = length & 0xf;
      length >>= 4;
      if (length < 4) {
        const numBytes = length + 1;
        if (pos + numBytes > data.length) break;
        length = uint(data, pos, pos + numBytes);
        pos += numBytes;
      } else {
        length -= 4;
      }
      if (pos + length > data.length) break;
      if (length > 0) {
        if (type === 1 || type === 7 || type === 10 || type === 11 || type === 13) {
          entryBlocks.push({ type, start: pos, end: pos + length });
        } else if (type === 3 && length >= 2) {
          rawInfo.set(uint(data, pos, pos + 2), data.subarray(pos + 2, pos + length));
        } else if (type === 0 && data[pos] === 8 && length >= 2) {
          defaultCharset = CHARSET_BY_CODE.get(data[pos + 1]!) ?? '';
        }
        // Type 2 (embedded resource files) and other types are skipped in v1.
      }
      pos += length;
    }

    this.resolveMetadata(rawInfo, defaultCharset);

    // Pass 2 — decode keys and alternates (source encoding is known now)
    // and build the lookup index. Definitions stay undecoded until lookup.
    for (const block of entryBlocks) {
      const span = block.type === 11 ? this.parseEntryWide(block) : this.parseEntry(block);
      if (!span || !span.headword) continue;
      const idx = this.entries.length;
      this.entries.push(span);
      for (const key of [span.headword, ...span.alternates]) {
        const norm = key.toLowerCase();
        const list = this.index.get(norm);
        if (list) list.push(idx);
        else this.index.set(norm, [idx]);
      }
    }
    this.entryCount = this.entries.length;
  }

  findEntries(word: string): BglEntry[] {
    const indices = this.index.get(word.trim().toLowerCase()) ?? [];
    return indices.map((i) => {
      const span = this.entries[i]!;
      return {
        headword: span.headword,
        alternates: span.alternates,
        definition: this.processDefi(this.data.subarray(span.defiStart, span.defiEnd)),
      };
    });
  }

  private resolveMetadata(rawInfo: Map<number, Uint8Array>, defaultCharset: string): void {
    const langOf = (code: number | undefined) => (code === undefined ? undefined : LANGUAGES[code]);
    const charsetOf = (v: Uint8Array | undefined) =>
      v && v.length > 0 ? CHARSET_BY_CODE.get(v[0]!) : undefined;

    const sourceLangValue = rawInfo.get(0x07);
    const targetLangValue = rawInfo.get(0x08);
    const sourceLang = langOf(
      sourceLangValue ? uint(sourceLangValue, 0, sourceLangValue.length) : undefined,
    );
    const targetLang = langOf(
      targetLangValue ? uint(targetLangValue, 0, targetLangValue.length) : undefined,
    );

    const flagsValue = rawInfo.get(0x11);
    const utf8Everywhere =
      flagsValue !== undefined && (uint(flagsValue, 0, flagsValue.length) & 0x8000) !== 0;

    const defaultEncoding = defaultCharset || 'cp1252';
    const sourceEncoding = utf8Everywhere
      ? 'utf-8'
      : (charsetOf(rawInfo.get(0x1a)) ?? sourceLang?.[1] ?? defaultEncoding);
    const targetEncoding = utf8Everywhere
      ? 'utf-8'
      : (charsetOf(rawInfo.get(0x1b)) ?? targetLang?.[1] ?? defaultEncoding);

    const text = (code: number): string | undefined => {
      const v = rawInfo.get(code);
      if (!v) return undefined;
      const s = getDecoder(targetEncoding).decode(v).replace(/\0+/g, '').trim();
      return s || undefined;
    };

    this.metadata = {
      title: text(0x01),
      author: text(0x02),
      email: text(0x03),
      copyright: text(0x04),
      description: text(0x09),
      sourceLang: sourceLang?.[0],
      targetLang: targetLang?.[0],
      sourceEncoding,
      targetEncoding,
    };
  }

  /** Entry block types 1/7/10/13: 1-byte word len, 2-byte defi len, 1-byte alt lens. */
  private parseEntry(block: RawEntryBlock): EntrySpan | null {
    const d = this.data;
    let pos = block.start;
    if (pos + 1 > block.end) return null;
    const wordLen = d[pos]!;
    pos += 1;
    if (pos + wordLen > block.end) return null;
    const headword = this.processKey(d.subarray(pos, pos + wordLen));
    pos += wordLen;
    if (pos + 2 > block.end) return null;
    const defiLen = uint(d, pos, pos + 2);
    pos += 2;
    if (pos + defiLen > block.end) return null;
    const defiStart = pos;
    pos += defiLen;
    const alternates = new Set<string>();
    while (pos < block.end) {
      const altLen = d[pos]!;
      pos += 1;
      if (pos + altLen > block.end) return null;
      const alt = this.processAlternate(d.subarray(pos, pos + altLen));
      if (alt) alternates.add(alt);
      pos += altLen;
    }
    alternates.delete(headword);
    return { headword, alternates: [...alternates], defiStart, defiEnd: defiStart + defiLen };
  }

  /** Entry block type 11: 5-byte word len, 4-byte alt count/lens, 4-byte defi len. */
  private parseEntryWide(block: RawEntryBlock): EntrySpan | null {
    const d = this.data;
    let pos = block.start;
    if (pos + 5 > block.end) return null;
    const wordLen = uint(d, pos, pos + 5);
    pos += 5;
    if (pos + wordLen > block.end) return null;
    const headword = this.processKey(d.subarray(pos, pos + wordLen));
    pos += wordLen;
    if (pos + 4 > block.end) return null;
    const altCount = uint(d, pos, pos + 4);
    pos += 4;
    const alternates = new Set<string>();
    for (let n = 0; n < altCount; n++) {
      if (pos + 4 > block.end) return null;
      const altLen = uint(d, pos, pos + 4);
      pos += 4;
      if (altLen === 0) break;
      if (pos + altLen > block.end) return null;
      const alt = this.processAlternate(d.subarray(pos, pos + altLen));
      if (alt) alternates.add(alt);
      pos += altLen;
    }
    alternates.delete(headword);
    if (pos + 4 > block.end) return null;
    const defiLen = uint(d, pos, pos + 4);
    pos += 4;
    if (pos + defiLen > block.end) return null;
    return { headword, alternates: [...alternates], defiStart: pos, defiEnd: pos + defiLen };
  }

  private processKey(b: Uint8Array): string {
    let s = getDecoder(this.metadata.sourceEncoding).decode(stripDollarIndexes(b));
    s = replaceHtmlEntriesInKeys(s);
    s = stripHtmlTags(s);
    return removeNewlines(removeControlChars(s)).trim();
  }

  private processAlternate(b: Uint8Array): string {
    let s = getDecoder(this.metadata.sourceEncoding).decode(stripDollarIndexes(b));
    // strip "/" before words, e.g. "/make /do"
    s = s.replace(/(^|\s)\/(\w)/g, '$1$2');
    s = stripHtmlTags(s);
    s = replaceHtmlEntriesInKeys(s);
    return removeNewlines(removeControlChars(s)).trim();
  }

  /**
   * Decode definition bytes honoring inline `<charset c=X>` switches. The
   * bytes are round-tripped through latin1 (a 1:1 byte↔code-unit mapping) so
   * the tag regex can run over them as a string.
   */
  private decodeCharsetTags(b: Uint8Array, defaultEncoding: string): string {
    const parts = latin1.decode(b).split(/(<charset\s+c=['"]?(\w)['"]?>|<\/charset>)/i);
    let out = '';
    const encodings: string[] = [];
    // parts repeat as [text, tag, tagType] — tagType is undefined for </charset>.
    for (let i = 0; i < parts.length; i += 3) {
      const encoding = encodings[encodings.length - 1] ?? defaultEncoding;
      out += this.decodeTextBlock(parts[i] ?? '', encoding);
      const tag = parts[i + 1];
      if (tag === undefined) continue;
      if (tag.startsWith('</')) {
        encodings.pop();
        continue;
      }
      const type = (parts[i + 2] ?? '').toLowerCase();
      if (type === 't') encodings.push('babylon-reference');
      else if (type === 'u') encodings.push('utf-8');
      else if (type === 'k' || type === 'e') encodings.push(this.metadata.sourceEncoding);
      else if (type === 'g') encodings.push('gbk');
      else encodings.push(defaultEncoding);
    }
    return out;
  }

  private decodeTextBlock(latin1Text: string, encoding: string): string {
    if (encoding === 'babylon-reference') {
      // Semicolon-separated 4-hex-digit character references.
      let out = '';
      for (const ref of latin1Text.split(';')) {
        if (/^[0-9a-fA-F]{4}$/.test(ref)) out += String.fromCharCode(parseInt(ref, 16));
      }
      return out;
    }
    let text = latin1Text;
    if (encoding === 'cp1252') {
      // Numeric character references in the 128–255 range are literal cp1252
      // bytes (`&#0147;` is a curly quote), not Unicode codepoints.
      text = text.replace(/&#(\w+);/gi, (whole, num: string) => {
        const code = num.toLowerCase().startsWith('x')
          ? parseInt(num.slice(1), 16)
          : parseInt(num, 10);
        return Number.isFinite(code) && code >= 128 && code <= 255
          ? String.fromCharCode(code)
          : whole;
      });
    }
    return getDecoder(encoding).decode(latin1Bytes(text));
  }

  private processDefi(b: Uint8Array): string {
    const fields = collectDefiFields(b);
    let defi = this.decodeCharsetTags(fields.body, this.metadata.targetEncoding);
    defi = normalizeNewlines(removeControlChars(replaceHtmlEntries(fixImgLinks(defi)))).trim();

    const decodeField = (v: Uint8Array | undefined): string =>
      v
        ? removeControlChars(
            replaceHtmlEntries(this.decodeCharsetTags(v, this.metadata.sourceEncoding)),
          )
        : '';
    const title = decodeField(fields.title);
    const titleTrans = decodeField(fields.titleTrans);
    // Transcription code 0x1b is text in the source encoding; other codes
    // hold binary data we can't render.
    const trans50 = fields.code50 === 0x1b ? decodeField(fields.transcription50) : '';
    const trans60 = fields.code60 === 0x1b ? decodeField(fields.transcription60) : '';

    let out = '';
    if (fields.partOfSpeech || title) {
      if (fields.partOfSpeech) {
        out += `<font color="#007000">${escapeXml(fields.partOfSpeech)}</font>`;
      }
      if (title) out += (out ? ' ' : '') + title;
      out += '<br>\n';
    }
    if (titleTrans) out += titleTrans + '<br>\n';
    if (trans50) out += `[${trans50}]<br>\n`;
    if (trans60) out += `[${trans60}]<br>\n`;
    out += defi;
    return out.replace(/<br>$/i, '');
  }
}
