// JS<->Rust EPUB bridge for Tauri targets.
//
// Forwards EPUB work to native commands and falls back transparently
// to the foliate-js path on web / non-Tauri / parse error.
//
//   * tryNativeParseEpub — import-time metadata + cover + partialMD5
//                          via `parse_epub_metadata`. Skips the
//                          foliate-js full archive parse and the
//                          second-pass partialMD5 over the file.
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
