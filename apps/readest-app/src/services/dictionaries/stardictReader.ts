/**
 * Self-contained StarDict reader with lazy random-access binary search
 * across all three bundle parts: `.idx`, `.syn`, and `.dict.dz`.
 *
 * Replaces `foliate-js/dict.js`'s `StarDict` / `DictZip`. The upstream
 * `DictZip.read` calls `inflateSync` on each chunk, but per-chunk DictZip
 * data ends at `Z_FULL_FLUSH` boundaries (BFINAL=0) — `inflateSync`
 * rejects those with `unexpected EOF`. fflate's streaming `Inflate` class
 * accepts non-final input and emits chunk bytes via `ondata`; that's what
 * we use here.
 *
 * # `.idx` / `.syn`: lazy random-access binary search
 *
 * Each is a sorted list of variable-length records:
 *   `<word-bytes>\0<payload>`
 * (`.idx` payload = 8 bytes; `.syn` payload = 4 bytes.)
 *
 * Eagerly parsing all entries into JS objects is heap-expensive: cmudict's
 * 105K entries cost ~10 MB. We instead:
 *
 *   1. Scan the bytes once at init to find every entry's start offset.
 *      Stored as an `Int32Array` (cmudict: 420 KB). The raw bytes are
 *      then dropped — the original Blob stays alive for slice reads.
 *   2. At lookup time, binary search the offsets. Each probe reads one
 *      entry's bytes (~16 B) from the Blob, decodes, compares.
 *   3. LRU-cache decoded entries (default 256).
 *
 * `.syn` further defers its offset scan until first synonym fallback —
 * sessions that never miss the primary index pay nothing for synonyms.
 * An optional offsets sidecar (see {@link serializeOffsetsSidecar}) lets
 * init skip the offset scan entirely.
 *
 * # `.dict.dz`: lazy chunk decompression
 *
 * DictZip files have a FEXTRA/RA subfield listing per-chunk compressed
 * sizes; chunks are separated by `Z_FULL_FLUSH` so each chunk's
 * uncompressed bytes are exactly `chlen` long (the last may be shorter).
 *
 * At init we parse the FEXTRA, then probe-inflate chunk 0 with streaming
 * `Inflate` to confirm it works. If yes (the common case for properly-
 * tooled `.dict.dz` files like cmudict and eng-nld), we keep only the
 * chunk metadata (~few KB) and the original Blob. Each lookup reads only
 * the chunks containing the entry's uncompressed range, inflates them
 * via streaming `Inflate`, and caches the decompressed output (LRU,
 * default 16 chunks ≈ 1 MB).
 *
 * If FEXTRA/RA is missing or the probe fails, we fall back to whole-file
 * gunzip at init and slice the in-memory buffer thereafter — same as
 * before.
 *
 * Net effect (cmudict):
 *   Init heap before: ~1.3 MB (whole inflated dict) + ~10 MB (parsed idx).
 *   Init heap after:  ~420 KB (idx offsets) + chunk metadata (~few KB)
 *                     + LRU chunk cache (≤ ~1 MB after warmup).
 */
import { LRU, loadDictBody, type DictBody } from './dictZip';

export interface StarDictEntry {
  word: string;
  offset: number;
  size: number;
}

const decoder = new TextDecoder('utf-8');

/** Parse the key=value `.ifo` text into a record. */
export function parseIfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Scan a `.idx` (or `.syn`) byte buffer to find every entry's start offset.
 * Returns an `Int32Array` of byte offsets — one per entry.
 *
 * Each entry: `<word-bytes>\0<payload>`. The payload is fixed-size:
 *   - `.idx`: 8 bytes (offset:u32be + size:u32be)
 *   - `.syn`: 4 bytes (idx-index:u32be)
 */
export function scanEntryOffsets(bytes: Uint8Array, payloadBytes: number): Int32Array {
  const offsets: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    offsets.push(i);
    while (i < bytes.length && bytes[i] !== 0) i++;
    if (i >= bytes.length) break;
    i += 1 + payloadBytes; // skip null terminator + payload
  }
  return new Int32Array(offsets);
}

// ---------------------------------------------------------------------------
// Offset sidecar serialization.
//
// Format:
//   bytes 0-3: magic 'SDOF' (StarDict OFfsets)
//   bytes 4-7: u32 little-endian version (current = 1)
//   bytes 8+:  raw Int32Array little-endian payload (one i32 per entry start)
//
// LE byte order is used unconditionally — every platform we ship to (web,
// Tauri on x86 / ARM64) is LE. If we ever need cross-endian sync, version-bump
// and add a byte-swap path.
// ---------------------------------------------------------------------------

const SIDECAR_MAGIC = [0x53, 0x44, 0x4f, 0x46]; // 'SDOF'
const SIDECAR_VERSION = 1;
const SIDECAR_HEADER_SIZE = 8;

/** Serialize an offsets array to a single allocation suitable for `fs.writeFile`. */
export function serializeOffsetsSidecar(offsets: Int32Array): Uint8Array {
  const out = new Uint8Array(SIDECAR_HEADER_SIZE + offsets.byteLength);
  out[0] = SIDECAR_MAGIC[0]!;
  out[1] = SIDECAR_MAGIC[1]!;
  out[2] = SIDECAR_MAGIC[2]!;
  out[3] = SIDECAR_MAGIC[3]!;
  // Version (u32 LE).
  const view = new DataView(out.buffer);
  view.setUint32(4, SIDECAR_VERSION, true);
  // Payload — direct memcpy of the Int32Array's bytes.
  out.set(
    new Uint8Array(offsets.buffer, offsets.byteOffset, offsets.byteLength),
    SIDECAR_HEADER_SIZE,
  );
  return out;
}

/** Parse a sidecar blob. Returns `null` for missing / wrong-magic / wrong-version. */
export function parseOffsetsSidecar(bytes: Uint8Array): Int32Array | null {
  if (bytes.length < SIDECAR_HEADER_SIZE) return null;
  for (let i = 0; i < SIDECAR_MAGIC.length; i++) {
    if (bytes[i] !== SIDECAR_MAGIC[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== SIDECAR_VERSION) return null;

  const payloadLen = bytes.byteLength - SIDECAR_HEADER_SIZE;
  if (payloadLen % 4 !== 0) return null;
  // Copy into a freshly-allocated Int32Array so the consumer owns aligned
  // memory regardless of how `bytes` was sliced upstream.
  const out = new Int32Array(payloadLen / 4);
  const src = new Int32Array(bytes.buffer, bytes.byteOffset + SIDECAR_HEADER_SIZE, payloadLen / 4);
  out.set(src);
  return out;
}

const cmpAscii = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

// DictZip parsing + lazy chunk decompression has been extracted to
// `dictZip.ts` so the DICT (dictd) reader can share the same code path. The
// `loadDictBody` factory below replaces the old per-class probe + fallback.

export interface StarDictReaderOpts {
  ifo: Blob;
  idx: Blob;
  /** Either `.dict.dz` (gzip) or a raw `.dict` (no compression). */
  dict: Blob;
  syn?: Blob;
  /**
   * Optional `.idx.offsets` sidecar (see {@link serializeOffsetsSidecar}).
   * When provided and valid, init skips the full `.idx` scan — the only
   * `.idx` reads are the small per-lookup probes.
   */
  idxOffsets?: Blob;
  /** Optional `.syn.offsets` sidecar — same idea for `.syn`. */
  synOffsets?: Blob;
  /** LRU cache size for decoded entries. Defaults to 256. */
  cacheSize?: number;
}

export class StarDictReader {
  ifo: Record<string, string> = {};

  // Dict body — a `DictBody` from `dictZip.ts` that internally chooses lazy
  // chunk decompression for proper DictZip files and falls back to whole-
  // file gunzip when the FEXTRA is absent or the probe fails.
  private body: DictBody | null = null;

  // .idx state — populated eagerly at init.
  private idxBlob: Blob | null = null;
  /** Byte offset of each entry's start within `.idx`. */
  private idxOffsets: Int32Array = new Int32Array(0);
  /** Number of entries (= idxOffsets.length, cached for hot path). */
  private idxCount = 0;

  // .syn state — populated lazily on first {@link resolveSynonym} call.
  private synBlob: Blob | null = null;
  private synOffsets: Int32Array = new Int32Array(0);
  private synCount = 0;
  private synBuilt = false;
  private synBuildPromise: Promise<void> | null = null;

  // LRU caches — keyed by entry index within their respective offset arrays.
  private idxCache: LRU<number, StarDictEntry>;
  private synCache: LRU<number, { syn: string; idxIndex: number }>;

  constructor(cacheSize = 256) {
    this.idxCache = new LRU<number, StarDictEntry>(cacheSize);
    this.synCache = new LRU<number, { syn: string; idxIndex: number }>(cacheSize);
  }

  async load(opts: StarDictReaderOpts): Promise<void> {
    const cacheSize = opts.cacheSize ?? 256;
    if (opts.cacheSize !== undefined) {
      this.idxCache = new LRU<number, StarDictEntry>(cacheSize);
      this.synCache = new LRU<number, { syn: string; idxIndex: number }>(cacheSize);
    }

    const [ifoBuf, idxOffsetsBuf, synOffsetsBuf] = await Promise.all([
      opts.ifo.arrayBuffer(),
      opts.idxOffsets ? opts.idxOffsets.arrayBuffer() : Promise.resolve(undefined),
      opts.synOffsets ? opts.synOffsets.arrayBuffer() : Promise.resolve(undefined),
    ]);

    this.ifo = parseIfo(decoder.decode(new Uint8Array(ifoBuf)));

    const offsetBits = this.ifo['idxoffsetbits'] ? parseInt(this.ifo['idxoffsetbits'], 10) : 32;
    if (offsetBits !== 32) {
      throw new Error(`StarDict idxoffsetbits=${offsetBits} not supported (only 32)`);
    }

    // Resolve the .idx offsets from sidecar if available + valid; otherwise
    // fall back to scanning the raw .idx bytes.
    let idxOffsets: Int32Array | null = null;
    if (idxOffsetsBuf) {
      idxOffsets = parseOffsetsSidecar(new Uint8Array(idxOffsetsBuf));
    }
    if (!idxOffsets) {
      const idxBytes = new Uint8Array(await opts.idx.arrayBuffer());
      idxOffsets = scanEntryOffsets(idxBytes, /* payloadBytes */ 8);
    }
    this.idxOffsets = idxOffsets;
    this.idxCount = idxOffsets.length;
    this.idxBlob = opts.idx;

    this.body = await loadDictBody(opts.dict, {
      chunkCacheSize: Math.max(8, Math.floor(cacheSize / 16)),
    });

    // .syn: keep the Blob, accept its sidecar eagerly if provided. If not,
    // the offset table is built lazily on first synonym fallback.
    if (opts.syn) {
      this.synBlob = opts.syn;
      if (synOffsetsBuf) {
        const parsed = parseOffsetsSidecar(new Uint8Array(synOffsetsBuf));
        if (parsed) {
          this.synOffsets = parsed;
          this.synCount = parsed.length;
          this.synBuilt = true;
        }
      }
    }
  }

  /** Resolve an entry's bytes from the dict body. */
  async read(entry: StarDictEntry): Promise<Uint8Array> {
    if (!this.body) throw new Error('dict body not loaded');
    return this.body.read(entry.offset, entry.size);
  }

  /** Number of entries — exposed for tests. */
  get entryCount(): number {
    return this.idxCount;
  }

  /**
   * Decode one `.idx` entry. Each entry's bytes span
   * `[idxOffsets[i], idxOffsets[i+1])` (or to end-of-file for the last).
   * Cached in `idxCache`.
   */
  private async decodeIdxEntry(i: number): Promise<StarDictEntry> {
    const cached = this.idxCache.get(i);
    if (cached) return cached;
    if (!this.idxBlob) throw new Error('idx blob not loaded');
    const start = this.idxOffsets[i]!;
    const end = i + 1 < this.idxCount ? this.idxOffsets[i + 1]! : this.idxBlob.size;
    const bytes = new Uint8Array(await this.idxBlob.slice(start, end).arrayBuffer());

    let nullPos = 0;
    while (nullPos < bytes.length && bytes[nullPos] !== 0) nullPos++;
    const word = decoder.decode(bytes.subarray(0, nullPos));
    const view = new DataView(bytes.buffer, bytes.byteOffset + nullPos + 1, 8);
    const offset = view.getUint32(0);
    const size = view.getUint32(4);

    const entry: StarDictEntry = { word, offset, size };
    this.idxCache.set(i, entry);
    return entry;
  }

  /**
   * Look up a headword. Returns `undefined` when absent.
   *
   * Lazy random-access binary search: log2(N) probes, each reading one
   * entry's worth of bytes (~16) from the .idx Blob.
   */
  async lookup(word: string): Promise<StarDictEntry | undefined> {
    let lo = 0;
    let hi = this.idxCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const entry = await this.decodeIdxEntry(mid);
      const cmp = cmpAscii(word, entry.word);
      if (cmp === 0) return entry;
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  private async ensureSynBuilt(): Promise<void> {
    if (this.synBuilt) return;
    if (!this.synBlob) {
      this.synBuilt = true;
      return;
    }
    if (!this.synBuildPromise) {
      this.synBuildPromise = (async () => {
        const synBytes = new Uint8Array(await this.synBlob!.arrayBuffer());
        this.synOffsets = scanEntryOffsets(synBytes, /* payloadBytes */ 4);
        this.synCount = this.synOffsets.length;
        this.synBuilt = true;
      })();
    }
    await this.synBuildPromise;
  }

  private async decodeSynEntry(i: number): Promise<{ syn: string; idxIndex: number }> {
    const cached = this.synCache.get(i);
    if (cached) return cached;
    if (!this.synBlob) throw new Error('syn blob not loaded');
    const start = this.synOffsets[i]!;
    const end = i + 1 < this.synCount ? this.synOffsets[i + 1]! : this.synBlob.size;
    const bytes = new Uint8Array(await this.synBlob.slice(start, end).arrayBuffer());

    let nullPos = 0;
    while (nullPos < bytes.length && bytes[nullPos] !== 0) nullPos++;
    const syn = decoder.decode(bytes.subarray(0, nullPos));
    const view = new DataView(bytes.buffer, bytes.byteOffset + nullPos + 1, 4);
    const idxIndex = view.getUint32(0);

    const entry = { syn, idxIndex };
    this.synCache.set(i, entry);
    return entry;
  }

  /**
   * Resolve a synonym to its underlying `.idx` entry. `undefined` when no
   * `.syn` file is loaded or the synonym isn't present.
   *
   * On first call, scans the `.syn` blob to build its offset table.
   */
  async resolveSynonym(word: string): Promise<StarDictEntry | undefined> {
    await this.ensureSynBuilt();
    if (!this.synCount) return undefined;

    let lo = 0;
    let hi = this.synCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const entry = await this.decodeSynEntry(mid);
      const cmp = cmpAscii(word, entry.syn);
      if (cmp === 0) return this.decodeIdxEntry(entry.idxIndex);
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }
}
