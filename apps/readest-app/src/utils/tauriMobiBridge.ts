// JS<->Rust MOBI/AZW/AZW3 bridge for Tauri targets.
//
// Forwards MOBI-family work to the native `parse_mobi_metadata` command
// and falls back transparently to the foliate-js path on web /
// non-Tauri / parse error.
//
//   * tryNativeParseMobi — import-time metadata + cover + partialMD5
//                          via `parse_mobi_metadata`. Skips the
//                          foliate-js full-buffer parse and the
//                          second-pass partialMD5 over the file.
//
// Avoids ferrying multi-MB MOBI/AZW3 blobs across the JS<->Rust IPC
// boundary and is a no-op on the web platform.
//
// Schema mirrors `tauriEpubBridge.ts` but the Rust side returns the cover
// as a raw byte array (`RawCoverImage { bytes, mime }`) instead of a
// base64 string — so we skip the atob() round-trip here.
import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { BookDoc, BookMetadata } from '@/libs/document';
import type { BookFormat } from '@/types/book';

// ─── shared helpers ──────────────────────────────────────────────────

/**
 * Match every Kindle container we feed to the foliate-js MOBI loader on
 * the web fallback path: classic MOBI, Amazon's AZW (KF7), AZW3 (KF8),
 * and the legacy Mobipocket .prc wrapper.
 */
const MOBI_EXT_RE = /\.(mobi|azw|azw3|prc)$/i;

export const isEligibleMobiPath = (filePath: string | undefined): filePath is string =>
  !!filePath && isTauriAppPlatform() && MOBI_EXT_RE.test(filePath);

/**
 * Map a file path / name to the canonical `BookFormat` that the rest of
 * bookService keys book records by. Defaults to 'MOBI' if the extension
 * isn't one we recognize (caller already narrowed via `isEligibleMobiPath`).
 */
export const inferMobiFormat = (filePath: string): BookFormat => {
  const m = filePath.match(MOBI_EXT_RE);
  if (!m) return 'MOBI' as BookFormat;
  const ext = m[1]!.toLowerCase();
  if (ext === 'azw3') return 'AZW3' as BookFormat;
  if (ext === 'azw') return 'AZW' as BookFormat;
  // .prc is just a Mobipocket wrapper — the on-disk Books/<hash>/ folder
  // doesn't care about that distinction, so fold it into MOBI.
  return 'MOBI' as BookFormat;
};

// ─── parse_mobi_metadata (import path) ───────────────────────────────

interface RustParsedMobiMetadata {
  title?: string | null;
  authors?: string[] | null;
  language?: string | null;
  identifier?: string | null;
  isbn?: string | null;
  publisher?: string | null;
  published?: string | null;
  description?: string | null;
  subject?: string[] | null;
  /** "MOBI" | "AZW3" — informational; the JS side prefers the file-extension
   *  derived format from `inferMobiFormat()` (which also distinguishes AZW). */
  kfFormat?: string | null;
}

interface RustRawCoverImage {
  /** Tauri's IPC serializer ships Vec<u8> as either a number[] or a typed
   *  array; we accept either and normalize via Uint8Array.from(). */
  bytes: number[] | Uint8Array;
  mime: string;
}

interface RustParsedMobi {
  partialMd5: string;
  metadata: RustParsedMobiMetadata;
  cover?: RustRawCoverImage | null;
}

export interface NativeParsedMobi {
  /** partialMD5 of the file, ready to use as the Book.hash. */
  partialMd5: string;
  /** Lightweight BookDoc stub: only metadata + getCover() are populated. */
  bookDoc: BookDoc;
}

const buildMetadata = (m: RustParsedMobiMetadata): BookMetadata => {
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
  return meta;
};

const buildBookDocStub = (rust: RustParsedMobi): BookDoc => {
  const metadata = buildMetadata(rust.metadata);
  let coverBlob: Blob | null = null;
  if (rust.cover && rust.cover.bytes && rust.cover.mime) {
    const u8 =
      rust.cover.bytes instanceof Uint8Array ? rust.cover.bytes : Uint8Array.from(rust.cover.bytes);
    // Slice into a fresh ArrayBuffer to satisfy lib.dom Blob typings (which
    // require BlobPart = ArrayBuffer/ArrayBufferView<ArrayBuffer>, not the
    // ArrayBufferLike that the Uint8Array constructor exposes).
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    coverBlob = new Blob([ab], { type: rust.cover.mime });
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
 * Try to parse a MOBI/AZW/AZW3/PRC natively via Rust. Returns null when
 * the native path is unavailable (web platform, no file path, format
 * mismatch, parse error). The caller can then fall back to the
 * foliate-js DocumentLoader path with no behavioural change.
 */
export const tryNativeParseMobi = async (
  filePath: string | undefined,
): Promise<NativeParsedMobi | null> => {
  if (!isEligibleMobiPath(filePath)) return null;
  try {
    const rust = await invoke<RustParsedMobi>('parse_mobi_metadata', {
      filePath,
    });
    if (!rust || !rust.partialMd5) return null;
    return {
      partialMd5: rust.partialMd5,
      bookDoc: buildBookDocStub(rust),
    };
  } catch (err) {
    console.warn('[tauriMobiBridge] native parse failed, falling back to JS:', err);
    return null;
  }
};
