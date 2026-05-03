/**
 * DICT (dictd) reader. Reference: RFC 2229 § 3.1 (dictzip body), the
 * `dictd` source `dictd.h`/`index.c` for the `.index` grammar.
 *
 * A DICT bundle is two files sharing a stem:
 *   - `name.index`  : plain ASCII, one entry per line:
 *                     `headword\tbase64(offset)\tbase64(length)`.
 *                     The offsets are big-endian 6-bit groups encoded with
 *                     the alphabet `[A-Za-z0-9+/]` — *not* standard base64
 *                     (no padding, variable-length).
 *   - `name.dict`   : raw or `.dict.dz` dictzip-compressed body. Random-
 *                     access reads at the offsets from the index.
 *
 * Index entries with words starting `00database` are reserved metadata:
 *
 *   00databasealphabet : 8.dictsort alphabet
 *   00databasedictfmt1121 : format marker
 *   00databaseinfo     : long-form description
 *   00databaseshort    : one-line label
 *   00databaseurl      : source URL
 *   00databaseutf8     : present iff bodies are UTF-8
 *
 * The reader exposes:
 *   - `info`: parsed metadata including the human-readable label.
 *   - `entryCount`: number of non-metadata entries.
 *   - `lookup(word)`: case-insensitive exact match → `Uint8Array` body.
 *   - `read(entry)`: random-access read of the dict body.
 *
 * Like `StarDictReader`, it does index parsing once at init, then per-
 * lookup it does a binary search over an `Int32Array` of line offsets and
 * reads ~one line plus one chunk from the dict body.
 */
import { LRU, loadDictBody, type DictBody } from './dictZip';

const decoder = new TextDecoder('utf-8');

export interface DictEntry {
  word: string;
  offset: number;
  size: number;
}

/** RFC 2229 base64-like alphabet (A-Za-z0-9+/), big-endian 6-bit groups. */
const B64: Int8Array = (() => {
  const t = new Int8Array(256).fill(-1);
  const set = (s: string, base: number) => {
    for (let i = 0; i < s.length; i++) t[s.charCodeAt(i)] = base + i;
  };
  set('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 0);
  set('abcdefghijklmnopqrstuvwxyz', 26);
  set('0123456789', 52);
  t['+'.charCodeAt(0)] = 62;
  t['/'.charCodeAt(0)] = 63;
  return t;
})();

/** Decode a DICT base64 token (no padding, variable length) into a number. */
export function decodeDictBase64(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64[s.charCodeAt(i)]!;
    if (v < 0) throw new Error(`Invalid DICT base64 character at ${i}: ${s[i]}`);
    n = n * 64 + v;
  }
  return n;
}

export interface DictInfo {
  /** Human-readable label, derived from `00databaseshort` if present. */
  label?: string;
  /** Long-form description from `00databaseinfo`. */
  description?: string;
  /** Source URL from `00databaseurl`. */
  url?: string;
  /** dictd alphabet hint from `00databasealphabet`. Rarely useful. */
  alphabet?: string;
  /** True iff the dict is UTF-8 (presence of `00databaseutf8`). */
  utf8: boolean;
}

const cmpAscii = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Parse a `.index` text into:
 *   - `entries`: `Int32Array` of `[offset, size]` pairs (2 ints per entry).
 *   - `words`: `string[]` aligned with `entries`, headwords lowercased so
 *     binary search is straightforward.
 *   - `meta`: a record of `00database*` headwords → body slice (offset,size)
 *     so callers can read out the description / short label after the body
 *     is open.
 */
export interface ParsedDictIndex {
  /** Sorted (case-insensitive) headwords (original case preserved). */
  words: string[];
  /** Per-entry [offset, size] pairs, two ints per entry. */
  entries: Int32Array;
  /** `00database*` metadata entries by name, holding their body slice. */
  meta: Record<string, { offset: number; size: number }>;
}

export function parseDictIndex(text: string): ParsedDictIndex {
  const words: string[] = [];
  const offsets: number[] = [];
  const sizes: number[] = [];
  const meta: Record<string, { offset: number; size: number }> = {};

  let line = 0;
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    const ln =
      text.charCodeAt(nl - 1) === 13 /* \r */ ? text.slice(pos, nl - 1) : text.slice(pos, nl);
    pos = nl + 1;
    if (!ln) continue;
    line++;

    const tab1 = ln.indexOf('\t');
    if (tab1 < 0) continue;
    const tab2 = ln.indexOf('\t', tab1 + 1);
    if (tab2 < 0) continue;
    const word = ln.slice(0, tab1);
    const offTok = ln.slice(tab1 + 1, tab2);
    const sizeTok = ln.slice(tab2 + 1).trim();
    let off: number;
    let size: number;
    try {
      off = decodeDictBase64(offTok);
      size = decodeDictBase64(sizeTok);
    } catch {
      continue;
    }

    if (word.startsWith('00database')) {
      meta[word] = { offset: off, size };
      continue;
    }
    words.push(word);
    offsets.push(off);
    sizes.push(size);
  }

  // The dictd convention is that .index is sorted by `dictsort` (mostly
  // case-insensitive ASCII). We re-sort here defensively so binary search
  // is correct regardless of the producer.
  const order = words.map((_, i) => i).sort((a, b) => cmpAscii(words[a]!, words[b]!));
  const sortedWords: string[] = new Array(words.length);
  const sortedEntries = new Int32Array(words.length * 2);
  for (let i = 0; i < order.length; i++) {
    const k = order[i]!;
    sortedWords[i] = words[k]!;
    sortedEntries[i * 2] = offsets[k]!;
    sortedEntries[i * 2 + 1] = sizes[k]!;
  }

  void line;
  return { words: sortedWords, entries: sortedEntries, meta };
}

export interface DictReaderOpts {
  index: Blob;
  /** Either `.dict.dz` (gzip) or a raw `.dict` (no compression). */
  dict: Blob;
  /** LRU cache size for decoded bodies. Defaults to 256. */
  cacheSize?: number;
}

export class DictReader {
  info: DictInfo = { utf8: false };
  private words: string[] = [];
  private entries: Int32Array = new Int32Array(0);
  private body: DictBody | null = null;
  private bodyCache: LRU<number, Uint8Array>;

  constructor(cacheSize = 256) {
    this.bodyCache = new LRU<number, Uint8Array>(cacheSize);
  }

  async load(opts: DictReaderOpts): Promise<void> {
    if (opts.cacheSize !== undefined) {
      this.bodyCache = new LRU<number, Uint8Array>(opts.cacheSize);
    }
    const cacheSize = opts.cacheSize ?? 256;

    const indexText = await opts.index.text();
    const parsed = parseDictIndex(indexText);
    this.words = parsed.words;
    this.entries = parsed.entries;

    this.body = await loadDictBody(opts.dict, {
      chunkCacheSize: Math.max(8, Math.floor(cacheSize / 16)),
    });

    // Resolve metadata bodies (if present) against the now-open dict.
    const tryRead = async (key: string): Promise<string | undefined> => {
      const m = parsed.meta[key];
      if (!m || !this.body) return undefined;
      const bytes = await this.body.read(m.offset, m.size);
      return decoder.decode(bytes).trim();
    };
    const [short, longInfo, url, alphabet, utf8] = await Promise.all([
      tryRead('00databaseshort'),
      tryRead('00databaseinfo'),
      tryRead('00databaseurl'),
      tryRead('00databasealphabet'),
      tryRead('00databaseutf8'),
    ]);
    this.info = {
      label: short,
      description: longInfo,
      url,
      alphabet,
      utf8: utf8 !== undefined,
    };
  }

  get entryCount(): number {
    return this.words.length;
  }

  /** Random-access read of `size` bytes from the dict body at `offset`. */
  async read(entry: DictEntry): Promise<Uint8Array> {
    if (!this.body) throw new Error('dict body not loaded');
    return this.body.read(entry.offset, entry.size);
  }

  /** Look up a headword (case-insensitive exact match). */
  async lookup(word: string): Promise<DictEntry | undefined> {
    let lo = 0;
    let hi = this.words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = cmpAscii(word, this.words[mid]!);
      if (cmp === 0) {
        return {
          word: this.words[mid]!,
          offset: this.entries[mid * 2]!,
          size: this.entries[mid * 2 + 1]!,
        };
      }
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /** Decode one entry's body to UTF-8 text, with LRU caching by index. */
  async readText(entry: DictEntry, idx?: number): Promise<string> {
    if (idx !== undefined) {
      const cached = this.bodyCache.get(idx);
      if (cached) return decoder.decode(cached);
    }
    const bytes = await this.read(entry);
    if (idx !== undefined) this.bodyCache.set(idx, bytes);
    return decoder.decode(bytes);
  }
}
