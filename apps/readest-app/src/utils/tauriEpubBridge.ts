// JS<->Rust EPUB bridge for Tauri targets.
//
// Forwards EPUB work to native commands and falls back transparently
// to the foliate-js path on web / non-Tauri / parse error.
//
//   * tryNativeParseEpub    — import-time metadata + cover + partialMD5
//                             via `parse_epub_metadata`. Skips the
//                             foliate-js full archive parse and the
//                             second-pass partialMD5 over the file.
//   * tryNativePrefetchEpub — open-time OPF + nav + ncx + entry-size
//                             prefetch via `parse_epub_full`. Lets the
//                             foliate-js zip loader serve those calls
//                             from an in-memory cache.
//
// Avoids ferrying multi-MB blobs across the JS<->Rust IPC boundary
// and is a no-op on the web platform.
import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { BookDoc, BookMetadata } from '@/libs/document';

// ─── shared helpers ──────────────────────────────────────────────────

const isEligibleEpubPath = (filePath: string | undefined): filePath is string =>
  !!filePath && isTauriAppPlatform() && /\.epub$/i.test(filePath);

const base64ToUint8Array = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Decode a UTF-8 byte buffer (sent by Rust as either a number[] or a typed
 * array, depending on Tauri's IPC serializer) into a string.
 */
const bytesArrayToString = (bytes: number[] | Uint8Array): string => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder('utf-8').decode(u8);
};

// ─── parse_epub_metadata (import path) ───────────────────────────────

interface RustParsedMetadata {
  title?: string | null;
  authors?: string[] | null;
  language?: string | null;
  identifier?: string | null;
  isbn?: string | null;
  publisher?: string | null;
  published?: string | null;
  description?: string | null;
  subject?: string[] | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
}

interface RustParsedEpub {
  partialMd5: string;
  metadata: RustParsedMetadata;
  coverBase64?: string | null;
  coverMime?: string | null;
  coverZipPath?: string | null;
}

export interface NativeParsedEpub {
  /** partialMD5 of the file, ready to use as the Book.hash */
  partialMd5: string;
  /** Lightweight BookDoc stub: only metadata + getCover() are populated. */
  bookDoc: BookDoc;
}

const buildMetadata = (m: RustParsedMetadata): BookMetadata => {
  const meta: BookMetadata = {
    title: m.title || '',
    author: (m.authors && m.authors.length > 0 ? m.authors.join(', ') : '') as string,
    language: m.language || '',
  };
  if (m.identifier) meta.identifier = m.identifier;
  if (m.isbn) meta.isbn = m.isbn;
  if (m.publisher) meta.publisher = m.publisher;
  if (m.published) meta.published = m.published;
  if (m.description) meta.description = m.description;
  if (m.subject && m.subject.length > 0) meta.subject = m.subject;
  // Map calibre series into the standard belongsTo.series shape so that
  // bookService.importBook's series-aware downstream logic just works.
  if (m.seriesName) {
    meta.belongsTo = {
      series: {
        name: m.seriesName,
        position: m.seriesIndex != null ? String(m.seriesIndex) : undefined,
      },
    } as BookMetadata['belongsTo'];
  }
  return meta;
};

const buildBookDocStub = (rust: RustParsedEpub): BookDoc => {
  const metadata = buildMetadata(rust.metadata);
  let coverBlob: Blob | null = null;
  if (rust.coverBase64 && rust.coverMime) {
    const bytes = base64ToUint8Array(rust.coverBase64);
    // Slice into a fresh ArrayBuffer to satisfy lib.dom Blob typings (which
    // require BlobPart = ArrayBuffer/ArrayBufferView<ArrayBuffer>, not the
    // ArrayBufferLike that the Uint8Array constructor exposes).
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    coverBlob = new Blob([ab], { type: rust.coverMime });
  }
  // Minimal BookDoc shape: bookService.importBook only consults `metadata`
  // and `getCover()`. Other fields are populated lazily by the reader.
  const stub = {
    metadata,
    rendition: {},
    dir: 'ltr',
    toc: [],
    sections: [],
    splitTOCHref: () => [null, null],
    getCover: async () => coverBlob,
  } as unknown as BookDoc;
  return stub;
};

/**
 * Try to parse an EPUB natively via Rust. Returns null when the native path
 * is unavailable (web platform, no file path, format mismatch, parse error).
 *
 * The caller can then fall back to the foliate-js DocumentLoader path.
 */
export const tryNativeParseEpub = async (
  filePath: string | undefined,
): Promise<NativeParsedEpub | null> => {
  if (!isEligibleEpubPath(filePath)) return null;
  try {
    const rust = await invoke<RustParsedEpub>('parse_epub_metadata', {
      filePath,
    });
    if (!rust || !rust.partialMd5) return null;
    return {
      partialMd5: rust.partialMd5,
      bookDoc: buildBookDocStub(rust),
    };
  } catch (err) {
    console.warn('[tauriEpubBridge] native parse failed, falling back to JS:', err);
    return null;
  }
};

// ─── parse_epub_full (open hot-path prefetch) ────────────────────────

interface RustParsedEpubFull {
  partialMd5: string;
  opfPath: string;
  opfBytes: number[] | Uint8Array;
  navPath?: string | null;
  navBytes?: number[] | Uint8Array | null;
  ncxPath?: string | null;
  ncxBytes?: number[] | Uint8Array | null;
  /**
   * Map: zip entry name → uncompressed size in bytes. Sent over IPC as a
   * plain object (`{ "OEBPS/x.html": 12345, ... }`) and rehydrated into a
   * Map below for O(1) `getSize()` calls.
   */
  sizes: Record<string, number>;
}

export interface NativeEpubPrefetch {
  /**
   * Map of zip-path → text content. Populated for the OPF, EPUB3 nav doc,
   * NCX (if present), and a synthetic META-INF/container.xml that points
   * foliate-js at our OPF path. Anything not in the map falls through to
   * the regular zip.js loadText path.
   */
  textCache: Map<string, string>;
  /** Map of zip-path → uncompressed byte size, for foliate-js getSize(). */
  sizes: Map<string, number>;
  /** partialMD5 of the file, returned alongside the prefetch in case the
   *  caller wants to reuse it (e.g. to set Book.hash without rehashing). */
  partialMd5: string;
}

/**
 * Build the minimal META-INF/container.xml that foliate-js's EPUB.init()
 * looks at to find the OPF. We synthesize this from `opfPath` so the JS
 * side never has to inflate the real container entry from the zip.
 */
const buildContainerXml = (opfPath: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
  `<rootfiles>` +
  `<rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>` +
  `</rootfiles>` +
  `</container>`;

/**
 * Try to prefetch OPF/nav/ncx + entry sizes for an EPUB via Rust.
 *
 * Returns null when the native path is unavailable (web platform, missing
 * file path, non-EPUB extension, IPC error). The caller (DocumentLoader)
 * then falls back to the original zip.js-only path with no behavioural
 * change.
 */
export const tryNativePrefetchEpub = async (
  filePath: string | undefined,
): Promise<NativeEpubPrefetch | null> => {
  if (!isEligibleEpubPath(filePath)) return null;
  try {
    const rust = await invoke<RustParsedEpubFull>('parse_epub_full', {
      filePath,
    });
    if (!rust || !rust.opfPath || !rust.opfBytes) return null;

    const textCache = new Map<string, string>();
    // foliate-js reads container.xml first; serve a synthetic one so it
    // skips the zip.js inflate.
    textCache.set('META-INF/container.xml', buildContainerXml(rust.opfPath));
    textCache.set(rust.opfPath, bytesArrayToString(rust.opfBytes));
    if (rust.navPath && rust.navBytes) {
      textCache.set(rust.navPath, bytesArrayToString(rust.navBytes));
    }
    if (rust.ncxPath && rust.ncxBytes) {
      textCache.set(rust.ncxPath, bytesArrayToString(rust.ncxBytes));
    }

    const sizes = new Map<string, number>();
    for (const [name, size] of Object.entries(rust.sizes || {})) {
      sizes.set(name, size);
    }

    return { textCache, sizes, partialMd5: rust.partialMd5 };
  } catch (err) {
    console.warn('[tauriEpubBridge] native prefetch failed, falling back to JS:', err);
    return null;
  }
};
