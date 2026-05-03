/**
 * Slob (Aard 2) reader. Reference: https://github.com/itkach/slob `slob.py`.
 *
 * # File layout
 *
 * ```
 *   header    : magic, uuid, encoding, compression, tags, content_types,
 *               blob_count, store_offset, file_size
 *   refs      : ItemList<Ref> at refs_offset = end of header
 *   store     : ItemList<StoreItem> at store_offset
 * ```
 *
 * ## ItemList format (used for refs and store):
 *
 * ```
 *   count  : 4 bytes BE  (refs only — bin/store list count is 4 bytes BE)
 *   pos[i] : 8 bytes BE × count
 *   data   : items, accessed at data_offset + pos[i]
 * ```
 *
 * ## Ref item:
 *
 * ```
 *   key       : pascal text, 2-byte BE length
 *   bin_index : 4 bytes BE
 *   item_index: 2 bytes BE
 *   fragment  : pascal text, 1-byte length
 * ```
 *
 * ## Store item:
 *
 * ```
 *   bin_item_count   : 4 bytes BE
 *   content_type_ids : 1 byte × bin_item_count
 *   compressed_len   : 4 bytes BE
 *   compressed       : bytes (compression algorithm from header)
 *
 *   decompressed:
 *     pos[i]   : 4 bytes BE × bin_item_count
 *     items    : at pos[i]: 4-byte length + content
 * ```
 *
 * # Compression
 *
 * The header carries a compression name: `zlib`, `bz2`, `lzma2`, or empty.
 * v1 supports `zlib` only — that's what virtually every Wikipedia/Wiktionary-
 * derived slob ships with. `bz2` and `lzma2` are flagged unsupported at
 * import time so the popup hides the provider with a clear reason.
 *
 * # Refs sort order
 *
 * `slob.py` uses ICU PRIMARY/TERTIARY collation when sorting refs. In
 * practice for Latin-only ASCII keys the byte order matches lowercased-
 * ASCII order; for accented or non-Latin scripts the orders differ. v1
 * does case-insensitive ASCII binary search, plus a tiny linear "near"
 * scan around the binary-search bracket to absorb the small ICU/byte
 * order mismatches that occur with diacritics. Real Wikipedia/Wiktionary
 * slobs lookup hot headwords correctly with this strategy; pure ICU
 * collation would require shipping ICU data and isn't worth it for v1.
 */
import { unzlibSync } from 'fflate';
import { LRU } from './dictZip';

const utf8 = new TextDecoder('utf-8');

export interface SlobHeader {
  uuid: Uint8Array;
  encoding: string;
  compression: string;
  tags: Record<string, string>;
  contentTypes: string[];
  blobCount: number;
  storeOffset: number;
  fileSize: number;
  refsOffset: number;
}

export interface SlobRef {
  key: string;
  binIndex: number;
  itemIndex: number;
  fragment: string;
}

export interface SlobBlob {
  /** Resolved content type, e.g. `text/html;charset=utf-8`. */
  contentType: string;
  /** Raw decompressed item bytes (not text-decoded — could be CSS, JS, etc.). */
  data: Uint8Array;
}

const MAGIC = new Uint8Array([0x21, 0x2d, 0x31, 0x53, 0x4c, 0x4f, 0x42, 0x1f]); // "!-1SLOB\x1F"

class ByteCursor {
  pos = 0;
  constructor(public readonly buf: Uint8Array) {}

  read(n: number): Uint8Array {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  byte(): number {
    return this.buf[this.pos++]!;
  }
  u16(): number {
    const b0 = this.buf[this.pos]!;
    const b1 = this.buf[this.pos + 1]!;
    this.pos += 2;
    return (b0 << 8) | b1;
  }
  u32(): number {
    const v = readU32BE(this.buf, this.pos);
    this.pos += 4;
    return v;
  }
  u64(): number {
    const hi = readU32BE(this.buf, this.pos);
    const lo = readU32BE(this.buf, this.pos + 4);
    this.pos += 8;
    // JS numbers are safe up to 2^53; slob files are far smaller.
    return hi * 0x1_0000_0000 + lo;
  }
  /** Pascal-text with `n`-byte BE length prefix. Trailing NULs are trimmed (slob's editable padding). */
  text(lenBytes: 1 | 2): string {
    const len = lenBytes === 1 ? this.byte() : this.u16();
    const bytes = this.read(len);
    return decodePascalText(bytes);
  }
}

function readU32BE(b: Uint8Array, o: number): number {
  return (
    (((b[o]! << 24) >>> 0) | ((b[o + 1]! << 16) >>> 0) | ((b[o + 2]! << 8) >>> 0) | b[o + 3]!) >>> 0
  );
}

/**
 * slob's `_read_text` trims a NUL-padded value when the byte length equals
 * the format max (255 for 1-byte length, 65535 for 2-byte). We always trim
 * trailing NULs — they're meaningless in tag values and only appear due to
 * the editable-padding scheme.
 */
function decodePascalText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return utf8.decode(bytes.subarray(0, end));
}

const cmpAsciiCI = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Read header from a Blob. Reads ~8 KB; tags+content types fit comfortably. */
async function readHeader(blob: Blob): Promise<SlobHeader> {
  // 64 KB is plenty even for slobs with hundreds of tags / content types.
  const headBytes = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, 64 * 1024)).arrayBuffer(),
  );
  const c = new ByteCursor(headBytes);
  const magic = c.read(MAGIC.length);
  for (let i = 0; i < MAGIC.length; i++) {
    if (magic[i] !== MAGIC[i]) throw new Error('Not a Slob file (bad magic)');
  }
  const uuid = c.read(16);
  const encoding = c.text(1);
  if (encoding.toLowerCase() !== 'utf-8') {
    // slob.py supports any Python codec, but everything in the wild is utf-8.
    throw new Error(`Unsupported Slob encoding: ${encoding}`);
  }
  const compression = c.text(1);
  const tagCount = c.byte();
  const tags: Record<string, string> = {};
  for (let i = 0; i < tagCount; i++) {
    const k = c.text(1);
    const v = c.text(1);
    tags[k] = v;
  }
  const ctCount = c.byte();
  const contentTypes: string[] = [];
  for (let i = 0; i < ctCount; i++) contentTypes.push(c.text(2));
  const blobCount = c.u32();
  const storeOffset = c.u64();
  const fileSize = c.u64();
  const refsOffset = c.pos;
  return {
    uuid: new Uint8Array(uuid),
    encoding,
    compression,
    tags,
    contentTypes,
    blobCount,
    storeOffset,
    fileSize,
    refsOffset,
  };
}

export interface SlobReaderOpts {
  slob: Blob;
  /** Decompressed-bin LRU size. Defaults to 16. */
  binCacheSize?: number;
  /** Decoded-ref LRU size. Defaults to 1024. */
  refCacheSize?: number;
}

export class SlobReader {
  header: SlobHeader = {
    uuid: new Uint8Array(),
    encoding: 'utf-8',
    compression: '',
    tags: {},
    contentTypes: [],
    blobCount: 0,
    storeOffset: 0,
    fileSize: 0,
    refsOffset: 0,
  };
  /** Number of refs (text-key → blob mappings). */
  refCount = 0;

  private blob: Blob | null = null;
  /** ItemList header offset for refs (count then 8-byte positions). */
  private refsDataOffset = 0;
  /** Position of each ref within the refs data area; one Float64-style entry per ref but stored as two i32s (hi, lo) for >4 GB safety. */
  private refPositions: Float64Array = new Float64Array(0);

  /** Bin count + per-bin position metadata. */
  private binCount = 0;
  private binDataOffset = 0;
  private binPositions: Float64Array = new Float64Array(0);

  private refCache: LRU<number, SlobRef>;
  private binCache: LRU<number, { contentTypeIds: Uint8Array; raw: Uint8Array }>;

  constructor(opts?: { binCacheSize?: number; refCacheSize?: number }) {
    this.refCache = new LRU<number, SlobRef>(opts?.refCacheSize ?? 1024);
    this.binCache = new LRU<number, { contentTypeIds: Uint8Array; raw: Uint8Array }>(
      opts?.binCacheSize ?? 16,
    );
  }

  async load(opts: SlobReaderOpts): Promise<void> {
    if (opts.refCacheSize !== undefined) {
      this.refCache = new LRU<number, SlobRef>(opts.refCacheSize);
    }
    if (opts.binCacheSize !== undefined) {
      this.binCache = new LRU<number, { contentTypeIds: Uint8Array; raw: Uint8Array }>(
        opts.binCacheSize,
      );
    }
    this.blob = opts.slob;
    this.header = await readHeader(opts.slob);

    if (this.header.compression !== 'zlib') {
      throw new Error(
        `Unsupported Slob compression "${this.header.compression}". v1 supports zlib only.`,
      );
    }
    if (this.header.fileSize !== opts.slob.size) {
      throw new Error(
        `Slob file size mismatch: header says ${this.header.fileSize}, file is ${opts.slob.size}`,
      );
    }

    // Refs ItemList: 4-byte count, then count × u64 positions.
    const refsHeader = new Uint8Array(
      await opts.slob.slice(this.header.refsOffset, this.header.refsOffset + 4).arrayBuffer(),
    );
    this.refCount = readU32BE(refsHeader, 0);
    const refPosStart = this.header.refsOffset + 4;
    const refPosBytes = new Uint8Array(
      await opts.slob.slice(refPosStart, refPosStart + this.refCount * 8).arrayBuffer(),
    );
    this.refPositions = new Float64Array(this.refCount);
    for (let i = 0; i < this.refCount; i++) {
      const o = i * 8;
      const hi = readU32BE(refPosBytes, o);
      const lo = readU32BE(refPosBytes, o + 4);
      this.refPositions[i] = hi * 0x1_0000_0000 + lo;
    }
    this.refsDataOffset = refPosStart + this.refCount * 8;

    // Store ItemList: 4-byte bin_count, then bin_count × u64 positions.
    const storeHeader = new Uint8Array(
      await opts.slob.slice(this.header.storeOffset, this.header.storeOffset + 4).arrayBuffer(),
    );
    this.binCount = readU32BE(storeHeader, 0);
    const binPosStart = this.header.storeOffset + 4;
    const binPosBytes = new Uint8Array(
      await opts.slob.slice(binPosStart, binPosStart + this.binCount * 8).arrayBuffer(),
    );
    this.binPositions = new Float64Array(this.binCount);
    for (let i = 0; i < this.binCount; i++) {
      const o = i * 8;
      const hi = readU32BE(binPosBytes, o);
      const lo = readU32BE(binPosBytes, o + 4);
      this.binPositions[i] = hi * 0x1_0000_0000 + lo;
    }
    this.binDataOffset = binPosStart + this.binCount * 8;
  }

  /**
   * Decode one ref. Each ref is variable-length: 2-byte BE key length + key
   * bytes + 4-byte BE bin_index + 2-byte BE item_index + 1-byte fragment
   * length + fragment bytes. We read a generous slice (max key 65535 +
   * max fragment 255 + 7 fixed bytes), then truncate.
   */
  private async decodeRef(i: number): Promise<SlobRef> {
    const cached = this.refCache.get(i);
    if (cached) return cached;
    if (!this.blob) throw new Error('slob blob not loaded');
    const start = this.refsDataOffset + this.refPositions[i]!;
    // Maximum ref size: 2 + 65535 + 4 + 2 + 1 + 255 = 65799. Realistic
    // headwords are ≤ 200 bytes; reading 4 KB covers virtually all of
    // them with one Blob slice.
    const slice = new Uint8Array(
      await this.blob.slice(start, Math.min(start + 4 * 1024, this.blob.size)).arrayBuffer(),
    );
    let pos = 0;
    const keyLen = (slice[pos]! << 8) | slice[pos + 1]!;
    pos += 2;
    let keyBytes: Uint8Array;
    if (pos + keyLen <= slice.length) {
      keyBytes = slice.subarray(pos, pos + keyLen);
      pos += keyLen;
    } else {
      // Tail spilled past our 4 KB read — fall back to a precise re-read.
      const need = 2 + keyLen + 4 + 2 + 1 + 255;
      const exact = new Uint8Array(
        await this.blob.slice(start, Math.min(start + need, this.blob.size)).arrayBuffer(),
      );
      keyBytes = exact.subarray(2, 2 + keyLen);
      pos = 2 + keyLen;
      const binIndex = readU32BE(exact, pos);
      pos += 4;
      const itemIndex = (exact[pos]! << 8) | exact[pos + 1]!;
      pos += 2;
      const fragLen = exact[pos]!;
      pos += 1;
      const fragment = decodePascalText(exact.subarray(pos, pos + fragLen));
      const ref: SlobRef = {
        key: decodePascalText(keyBytes),
        binIndex,
        itemIndex,
        fragment,
      };
      this.refCache.set(i, ref);
      return ref;
    }
    const binIndex = readU32BE(slice, pos);
    pos += 4;
    const itemIndex = (slice[pos]! << 8) | slice[pos + 1]!;
    pos += 2;
    const fragLen = slice[pos]!;
    pos += 1;
    const fragment = decodePascalText(slice.subarray(pos, pos + fragLen));

    const ref: SlobRef = {
      key: decodePascalText(keyBytes),
      binIndex,
      itemIndex,
      fragment,
    };
    this.refCache.set(i, ref);
    return ref;
  }

  /** Look up the first ref whose key case-insensitively matches `word`. */
  async findRef(word: string): Promise<SlobRef | undefined> {
    if (!this.refCount) return undefined;
    let lo = 0;
    let hi = this.refCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = await this.decodeRef(mid);
      const cmp = cmpAsciiCI(word, r.key);
      if (cmp === 0) return r;
      if (cmp > 0) lo = mid + 1;
      else hi = mid - 1;
    }
    // Binary search misses can happen when the slob was sorted with ICU
    // collation (locale-aware) but our key compare is byte-wise: keys with
    // diacritics or non-ASCII codepoints may end up adjacent to but not
    // exactly at the binary-search bracket. Scan a tiny window.
    const NEAR_WINDOW = 8;
    const wlo = Math.max(0, lo - NEAR_WINDOW);
    const whi = Math.min(this.refCount - 1, lo + NEAR_WINDOW);
    for (let i = wlo; i <= whi; i++) {
      const r = await this.decodeRef(i);
      if (cmpAsciiCI(word, r.key) === 0) return r;
    }
    return undefined;
  }

  /**
   * Decompress a bin and cache it. The bin lays out as:
   *   bin_item_count : u32 BE
   *   ct_ids         : 1 byte × bin_item_count
   *   compressed_len : u32 BE
   *   compressed     : bytes
   */
  private async getBin(binIndex: number): Promise<{ contentTypeIds: Uint8Array; raw: Uint8Array }> {
    const cached = this.binCache.get(binIndex);
    if (cached) return cached;
    if (!this.blob) throw new Error('slob blob not loaded');

    const start = this.binDataOffset + this.binPositions[binIndex]!;
    // Read the small leading header first to learn bin_item_count + comp_len.
    const headSlice = new Uint8Array(
      await this.blob.slice(start, Math.min(start + 4 * 1024, this.blob.size)).arrayBuffer(),
    );
    const binItemCount = readU32BE(headSlice, 0);
    if (4 + binItemCount + 4 > headSlice.length) {
      // 4 KB wasn't enough — re-read precise size.
      const need = 4 + binItemCount + 4;
      const exact = new Uint8Array(await this.blob.slice(start, start + need).arrayBuffer());
      // Use exact for the lengths only; we still need to read the body.
      const ctIds = exact.subarray(4, 4 + binItemCount);
      const compLen = readU32BE(exact, 4 + binItemCount);
      const compStart = start + 4 + binItemCount + 4;
      const comp = new Uint8Array(
        await this.blob.slice(compStart, compStart + compLen).arrayBuffer(),
      );
      const raw = unzlibSync(comp);
      const out = { contentTypeIds: ctIds.slice(), raw };
      this.binCache.set(binIndex, out);
      return out;
    }
    const ctIds = headSlice.subarray(4, 4 + binItemCount);
    const compLen = readU32BE(headSlice, 4 + binItemCount);
    const compStartInSlice = 4 + binItemCount + 4;
    let compBytes: Uint8Array;
    if (compStartInSlice + compLen <= headSlice.length) {
      compBytes = headSlice.subarray(compStartInSlice, compStartInSlice + compLen);
    } else {
      const compStart = start + compStartInSlice;
      compBytes = new Uint8Array(
        await this.blob.slice(compStart, compStart + compLen).arrayBuffer(),
      );
    }
    const raw = unzlibSync(compBytes);
    const out = { contentTypeIds: ctIds.slice(), raw };
    this.binCache.set(binIndex, out);
    return out;
  }

  /** Read the blob referenced by a ref. */
  async readBlob(ref: SlobRef): Promise<SlobBlob> {
    const bin = await this.getBin(ref.binIndex);
    const itemCount = bin.contentTypeIds.length;
    if (ref.itemIndex >= itemCount) {
      throw new Error(`Slob item_index ${ref.itemIndex} out of range (bin has ${itemCount})`);
    }
    // Decompressed bin: u32 BE positions × itemCount, then items.
    const pos = readU32BE(bin.raw, ref.itemIndex * 4);
    const dataOffset = itemCount * 4;
    const itemStart = dataOffset + pos;
    const itemLen = readU32BE(bin.raw, itemStart);
    const data = bin.raw.subarray(itemStart + 4, itemStart + 4 + itemLen);

    const ctId = bin.contentTypeIds[ref.itemIndex]!;
    const contentType = this.header.contentTypes[ctId] ?? '';
    return { contentType, data };
  }

  /** Number of refs — exposed for tests. */
  get refsCount(): number {
    return this.refCount;
  }
}

/** Strip trailing NULs from header tag values (slob editable-padding). */
export const cleanTag = (v: string): string => v.replace(/\0+$/u, '');
