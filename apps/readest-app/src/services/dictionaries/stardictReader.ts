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
import { gunzipSync, Inflate } from 'fflate';

export interface StarDictEntry {
  word: string;
  offset: number;
  size: number;
}

const decoder = new TextDecoder('utf-8');

const GZIP_MAGIC = [0x1f, 0x8b];

const isGzip = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];

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

/**
 * Bounded LRU. Tiny enough we don't bother with a real linked-list
 * implementation; reusing the Map insertion order is fine.
 */
class LRU<K, V> {
  private readonly max: number;
  private readonly map = new Map<K, V>();

  constructor(max: number) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // Move to end (most-recently-used).
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      // Evict oldest.
      const first = this.map.keys().next().value as K | undefined;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

// ---------------------------------------------------------------------------
// DictZip parsing + lazy chunk decompression.
//
// A `.dict.dz` file is a standard gzip with a FEXTRA "RA" subfield
// listing the compressed length of each chunk. Each chunk's uncompressed
// length is exactly `chlen` (the last may be shorter). Chunks are
// separated by `Z_FULL_FLUSH` (BFINAL=0 + sync marker), so each chunk's
// deflate stream is non-terminating — `inflateSync` rejects them with
// "unexpected EOF". fflate's streaming `Inflate.push(bytes, false)`
// handles them correctly and emits chunk bytes via `ondata`.
// ---------------------------------------------------------------------------

interface DictZipMeta {
  /** Uncompressed bytes per chunk (last may be shorter). */
  chlen: number;
  /** Compressed bytes per chunk; sums to `compressedDataSize`. */
  chunkSizes: number[];
  /** Byte offset within the file where compressed chunk data begins. */
  compressedDataOffset: number;
}

/**
 * Parse the gzip header + FEXTRA RA subfield. Returns `null` for
 * non-gzip files or gzip files without an RA subfield (those need
 * whole-file gunzip).
 */
function parseDictZipHeader(bytes: Uint8Array): DictZipMeta | null {
  if (bytes.length < 12 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) {
    return null;
  }
  const flg = bytes[3]!;
  const hasFEXTRA = (flg & 0b100) !== 0;
  if (!hasFEXTRA) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xlen = view.getUint16(10, true);
  let chlen = 0;
  let chcnt = 0;
  const chunkSizes: number[] = [];

  let p = 12;
  while (p + 4 <= 12 + xlen) {
    const si1 = bytes[p]!;
    const si2 = bytes[p + 1]!;
    const slen = view.getUint16(p + 2, true);
    if (si1 === 0x52 && si2 === 0x41) {
      // RA subfield: ver(2) + chlen(2) + chcnt(2) + chcnt × chunkSize(2).
      const ver = view.getUint16(p + 4, true);
      if (ver !== 1) return null;
      chlen = view.getUint16(p + 6, true);
      chcnt = view.getUint16(p + 8, true);
      for (let i = 0; i < chcnt; i++) {
        chunkSizes.push(view.getUint16(p + 10 + 2 * i, true));
      }
    }
    p += 4 + slen;
  }
  if (chcnt === 0 || chunkSizes.length !== chcnt) return null;

  // Skip past FEXTRA + optional FNAME, FCOMMENT, FHCRC.
  let offset = 12 + xlen;
  if (flg & 0b1000) {
    while (offset < bytes.length && bytes[offset] !== 0) offset++;
    offset++;
  }
  if (flg & 0b10000) {
    while (offset < bytes.length && bytes[offset] !== 0) offset++;
    offset++;
  }
  if (flg & 0b10) offset += 2;

  return { chlen, chunkSizes, compressedDataOffset: offset };
}

/**
 * Inflate a single DictZip chunk via fflate's streaming `Inflate`. The
 * chunk's deflate stream ends at `Z_FULL_FLUSH` (BFINAL=0 — `inflateSync`
 * would reject), so we push with `final=false` and capture the data
 * emitted by `ondata`. Returns `null` on failure.
 */
function inflateChunkStreaming(chunkBytes: Uint8Array): Uint8Array | null {
  let result: Uint8Array | null = null;
  try {
    const inf = new Inflate();
    inf.ondata = (data, _final) => {
      // The first `ondata` carries this chunk's uncompressed bytes; any
      // subsequent calls would be from feeding further input (we don't).
      if (result === null) result = data;
    };
    inf.push(chunkBytes, false);
  } catch {
    return null;
  }
  if (!result || (result as Uint8Array).length === 0) return null;
  return result;
}

class DictZipChunkedDict {
  private blob: Blob;
  private meta: DictZipMeta;
  private chunkOffsets: number[];
  /** Total uncompressed dict size, derived from chunk count × chlen (last chunk may be shorter; we don't know its exact size yet). */
  private chunkCache: LRU<number, Uint8Array>;

  constructor(blob: Blob, meta: DictZipMeta, cacheSize: number) {
    this.blob = blob;
    this.meta = meta;
    this.chunkCache = new LRU<number, Uint8Array>(cacheSize);
    // Precompute starting compressed offset of each chunk for slice reads.
    const offsets: number[] = [];
    let acc = meta.compressedDataOffset;
    for (const cs of meta.chunkSizes) {
      offsets.push(acc);
      acc += cs;
    }
    this.chunkOffsets = offsets;
  }

  /** Read `size` uncompressed bytes starting at `offset`. */
  async read(offset: number, size: number): Promise<Uint8Array> {
    const chlen = this.meta.chlen;
    const startChunk = Math.floor(offset / chlen);
    const endChunk = Math.floor((offset + size - 1) / chlen);

    if (startChunk === endChunk) {
      const chunk = await this.getChunk(startChunk);
      const local = offset - startChunk * chlen;
      return chunk.subarray(local, local + size);
    }
    // Spans multiple chunks — concatenate.
    const parts: Uint8Array[] = [];
    let totalLen = 0;
    for (let i = startChunk; i <= endChunk; i++) {
      const chunk = await this.getChunk(i);
      parts.push(chunk);
      totalLen += chunk.length;
    }
    const combined = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) {
      combined.set(p, pos);
      pos += p.length;
    }
    const local = offset - startChunk * chlen;
    return combined.subarray(local, local + size);
  }

  private async getChunk(i: number): Promise<Uint8Array> {
    const cached = this.chunkCache.get(i);
    if (cached) return cached;
    const start = this.chunkOffsets[i]!;
    const compressedSize = this.meta.chunkSizes[i]!;
    const compressed = new Uint8Array(
      await this.blob.slice(start, start + compressedSize).arrayBuffer(),
    );
    const inflated = inflateChunkStreaming(compressed);
    if (!inflated) throw new Error(`Failed to inflate DictZip chunk ${i}`);
    this.chunkCache.set(i, inflated);
    return inflated;
  }
}

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

  // Dict-reading mode. Exactly one of these is populated at init:
  //   - `dictChunked`: lazy chunk decompression (proper DictZip files).
  //   - `dictBuffer`: whole-file gunzip in memory (fallback when FEXTRA
  //     is absent or chunk-probe fails).
  private dictChunked: DictZipChunkedDict | null = null;
  private dictBuffer: Uint8Array = new Uint8Array();

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

    // Read the small files in parallel. We deliberately skip
    // `opts.dict.arrayBuffer()` here — the dict is read in fragments
    // below depending on whether lazy chunk mode is viable.
    const [ifoBuf, idxOffsetsBuf, synOffsetsBuf, dictHeadBuf] = await Promise.all([
      opts.ifo.arrayBuffer(),
      opts.idxOffsets ? opts.idxOffsets.arrayBuffer() : Promise.resolve(undefined),
      opts.synOffsets ? opts.synOffsets.arrayBuffer() : Promise.resolve(undefined),
      // Read just the gzip header + FEXTRA region (much less than the
      // whole file). 64 KB is enormously generous for a FEXTRA RA
      // subfield — even thousands of chunks would fit in a few KB.
      opts.dict.slice(0, Math.min(opts.dict.size, 64 * 1024)).arrayBuffer(),
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

    // Try lazy chunk mode for `.dict.dz`. Parse FEXTRA, probe-inflate
    // chunk 0; on success, retain only the metadata + Blob. On failure,
    // fall back to whole-file gunzip.
    const dictHead = new Uint8Array(dictHeadBuf);
    if (isGzip(dictHead)) {
      const meta = parseDictZipHeader(dictHead);
      if (meta && (await this.probeChunkInflate(opts.dict, meta))) {
        this.dictChunked = new DictZipChunkedDict(
          opts.dict,
          meta,
          /* chunk LRU size */ Math.max(8, Math.floor(cacheSize / 16)),
        );
      } else {
        // FEXTRA missing or chunk probe failed — gunzip the whole file.
        const dictBytes = new Uint8Array(await opts.dict.arrayBuffer());
        this.dictBuffer = gunzipSync(dictBytes);
      }
    } else {
      // Raw .dict (no compression): keep bytes as-is.
      this.dictBuffer = new Uint8Array(await opts.dict.arrayBuffer());
    }

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

  /**
   * Read chunk 0 of a candidate DictZip and try to inflate it via the
   * streaming inflater. If that succeeds and produces ≤ chlen bytes, the
   * file's chunks are independently decompressible — lazy mode is viable.
   */
  private async probeChunkInflate(blob: Blob, meta: DictZipMeta): Promise<boolean> {
    if (meta.chunkSizes.length === 0) return false;
    const cs = meta.chunkSizes[0]!;
    const start = meta.compressedDataOffset;
    const compressed = new Uint8Array(await blob.slice(start, start + cs).arrayBuffer());
    const inflated = inflateChunkStreaming(compressed);
    return !!inflated && inflated.length > 0 && inflated.length <= meta.chlen;
  }

  /**
   * Resolve an entry's bytes from the dict.
   *
   * Lazy-chunk mode: reads the chunks containing the entry's uncompressed
   * range from the dict Blob and streaming-inflates them.
   * Whole-file mode: in-memory subarray.
   */
  async read(entry: StarDictEntry): Promise<Uint8Array> {
    if (this.dictChunked) {
      return this.dictChunked.read(entry.offset, entry.size);
    }
    return this.dictBuffer.subarray(entry.offset, entry.offset + entry.size);
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
