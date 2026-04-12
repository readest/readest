/**
 * EPUB cache utilities for fast book re-open.
 *
 * At import time, we serialize the ZIP entry index (filename → byte offset/size)
 * to a JSON file alongside the book. On subsequent opens, we reconstruct a
 * zip-loader-compatible interface backed by Blob.slice() + DecompressionStream,
 * skipping the expensive zip.js getEntries() central directory scan entirely.
 *
 * The EPUB class from foliate-js doesn't know the difference — it just calls
 * loadText(name) and loadBlob(name, type) as usual.
 */

import type { BookDoc } from '@/libs/document';
import type { BookFormat } from '@/types/book';

// ── Cache schema ──────────────────────────────────────────────────────

export const EPUB_CACHE_VERSION = 1;
export const EPUB_CACHE_FILENAME = 'epub-cache.json';

export interface CachedZipEntry {
  filename: string;
  offset: number; // byte offset of the LOCAL file header in the ZIP
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0 = stored, 8 = deflate
  directory: boolean;
}

export interface EpubCache {
  version: number;
  entries: CachedZipEntry[];
}

// ── Serialization (import time) ───────────────────────────────────────

interface ZipJsEntry {
  filename: string;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  directory: boolean;
}

export function serializeEpubCache(zipEntries: ZipJsEntry[]): EpubCache {
  return {
    version: EPUB_CACHE_VERSION,
    entries: zipEntries.map((e) => ({
      filename: e.filename,
      offset: e.offset,
      compressedSize: e.compressedSize,
      uncompressedSize: e.uncompressedSize,
      compressionMethod: e.compressionMethod,
      directory: e.directory,
    })),
  };
}

// ── ZIP entry reader via Blob.slice ───────────────────────────────────

async function readZipEntryRaw(file: File, entry: CachedZipEntry): Promise<ArrayBuffer> {
  // The local file header is 30 bytes fixed + variable-length name + extra.
  // We read the header to find the exact data offset.
  const headerBuf = await file.slice(entry.offset, entry.offset + 30).arrayBuffer();
  const header = new DataView(headerBuf);
  const nameLen = header.getUint16(26, true);
  const extraLen = header.getUint16(28, true);
  const dataStart = entry.offset + 30 + nameLen + extraLen;

  if (entry.compressedSize === 0) {
    return new ArrayBuffer(0);
  }

  const compressed = file.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    return compressed.arrayBuffer();
  }

  // Deflate — use native DecompressionStream
  const ds = new DecompressionStream('deflate-raw');
  const response = new Response(compressed.stream().pipeThrough(ds));
  return response.arrayBuffer();
}

async function readZipEntryAsText(file: File, entry: CachedZipEntry): Promise<string> {
  const buf = await readZipEntryRaw(file, entry);
  return new TextDecoder().decode(buf);
}

async function readZipEntryAsBlob(file: File, entry: CachedZipEntry, type: string): Promise<Blob> {
  const buf = await readZipEntryRaw(file, entry);
  return new Blob([buf], { type });
}

// ── Cached loader reconstruction ──────────────────────────────────────

/**
 * Build a loader object matching the shape that foliate-js EPUB constructor
 * expects: { entries, loadText, loadBlob, getSize, getComment, sha1 }.
 *
 * Uses Blob.slice() + DecompressionStream for reads instead of zip.js,
 * skipping the expensive getEntries() central directory scan.
 */
export function makeCachedZipLoader(file: File, cache: EpubCache) {
  const map = new Map(cache.entries.map((e) => [e.filename, e]));

  const entries = cache.entries.map((e) => ({ filename: e.filename }));

  const loadText = (name: string): Promise<string> | null => {
    const entry = map.get(name);
    if (!entry || entry.directory) return null;
    return readZipEntryAsText(file, entry);
  };

  const loadBlob = (name: string, type?: string): Promise<Blob> | null => {
    const entry = map.get(name);
    if (!entry || entry.directory) return null;
    return readZipEntryAsBlob(file, entry, type ?? 'application/octet-stream');
  };

  const getSize = (name: string): number => map.get(name)?.uncompressedSize ?? 0;

  const getComment = async (): Promise<string | null> => null;

  return { entries, loadText, loadBlob, getSize, getComment, sha1: undefined };
}

// ── Open with cache ───────────────────────────────────────────────────

/**
 * Open an EPUB using the cached ZIP entry index. Skips zip.js getEntries()
 * entirely but still runs EPUB.init() (which parses OPF, nav, etc.) using
 * the Blob.slice-backed loader.
 */
export async function openEpubWithCache(
  file: File,
  cache: EpubCache,
): Promise<{ book: BookDoc; format: BookFormat }> {
  const loader = makeCachedZipLoader(file, cache);
  const { EPUB } = await import('foliate-js/epub.js');
  const book = (await new EPUB(loader).init()) as unknown as BookDoc;
  return { book, format: 'EPUB' };
}
