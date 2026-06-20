// JS<->Rust MOBI/AZW/AZW3 bridge for Tauri targets.
//
// Architectural split (mirrors `tauriEpubBridge`):
//
//   * Rust handles the *mechanical* work that's expensive on a
//     WebView: `partialMD5` over the file, plus locating + decoding +
//     resizing the cover image. The cover bytes are downscaled by
//     the `image` crate, which is materially faster than a
//     `createImageBitmap` + canvas round-trip on Android mid-tier
//     devices during bulk imports.
//
//   * foliate-js stays the single source of truth for MOBI metadata
//     extraction (title / author / identifier=PalmDB UID /
//     publisher / description / language / subjects / …). The
//     importer runs foliate-js's exported `readMobiMetadata` on the
//     same File so `Book.metadata.identifier` is byte-stable against
//     what the reader path produces (foliate `mobi.uid.toString()`).
//     Existing libraries don't get every MOBI re-imported as a
//     duplicate after the metaHash recomputes.
//
//     `readMobiMetadata` deliberately stops at MOBI.open()'s
//     metadata-only short-circuit: PalmDB header + record offsets
//     table + record 0 (PalmDoc/MobiHeader/EXTH) + decoder setup,
//     and skips the MOBI6/KF8 init() that walks every text record.
//     Roughly the cost of a stub-style import path while preserving
//     foliate's metadata semantics.
//
// One Tauri command backs this:
//
//   * parse_mobi_metadata — returns `{ partialMd5, cover? }`. The
//                           bridge wraps `cover` into a Blob and
//                           bolts it onto a BookDoc stub whose
//                           metadata comes from foliate-js.
//
// Avoids ferrying multi-MB MOBI/AZW3 blobs across the JS<->Rust IPC
// boundary and is a no-op on the web platform.
import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { BookDoc, BookMetadata } from '@/libs/document';
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
 * Map the file's extension to the on-disk `Book.format`.
 *
 * `.azw3` is foliate's canonical "Kindle Format 8" container, `.azw`
 * is Amazon's wrapper around classic MOBI (KF7), `.mobi` and `.prc`
 * both mean classic Mobipocket. We honour the user-facing extension
 * here so the library list matches what the user dragged in, even
 * though foliate's MOBI loader doesn't differentiate at runtime.
 */
const inferMobiFormat = (filePath: string): BookFormat => {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'azw3') return 'AZW3' as BookFormat;
  if (ext === 'azw') return 'AZW' as BookFormat;
  return 'MOBI' as BookFormat;
};

// ─── parse_mobi_metadata (import path) ───────────────────────────────

interface RustRawCoverImage {
  /** Tauri's IPC serializer ships Vec<u8> as either a number[] or a typed
   *  array; we accept either and normalize via `Uint8Array.from(...)`. */
  bytes: number[] | Uint8Array;
  mime: string;
}

interface RustParsedMobi {
  partialMd5: string;
  cover?: RustRawCoverImage | null;
}

export interface NativeParsedMobi {
  /** partialMD5 of the file, ready to use as the `Book.hash`. */
  partialMd5: string;
  /** Resolved on-disk format from the file extension (MOBI / AZW / AZW3). */
  format: BookFormat;
  /** Lightweight BookDoc stub: only `metadata` and `getCover()` are
   *  populated, which is all `bookService.importBook` consults on the
   *  import hot path. */
  bookDoc: BookDoc;
}

/**
 * Build a BookDoc stub for the importer. `metadata` comes from
 * foliate-js's `readMobiMetadata` so it matches the reader path
 * byte-for-byte; `getCover()` returns the Rust-downscaled blob (or
 * falls back to foliate's `getCover` thunk when Rust didn't extract
 * a cover, which keeps the pre-Rust behaviour for cover-less files).
 */
const buildBookDocStub = (
  metadata: BookMetadata,
  coverBlob: Blob | null,
  foliateGetCover: () => Promise<Blob | null | undefined>,
): BookDoc => {
  const stub = {
    metadata,
    rendition: {},
    dir: 'ltr',
    toc: [],
    sections: [],
    splitTOCHref: () => [null, null],
    getCover: async () => {
      if (coverBlob) return coverBlob;
      const fallback = await foliateGetCover();
      return fallback ?? null;
    },
  } as unknown as BookDoc;
  return stub;
};

/**
 * Try the import-time native fast-path: ask Rust for the file's
 * partialMD5 + downscaled cover, then run foliate-js's exported
 * `readMobiMetadata` on the supplied `File` to derive metadata.
 * Returns `null` on web platform / non-MOBI path / IPC error so
 * callers can fall back to the regular foliate-js
 * `DocumentLoader.open()` pipeline with no behavioural change.
 *
 * `readMobiMetadata` short-circuits MOBI.open()'s expensive init()
 * (which walks every text record), keeping import roughly as fast
 * as the previous stub-style path while ensuring `Book.metadata`
 * matches the reader path exactly — including
 * `metadata.identifier === mobi.uid.toString()`, the PalmDB UID
 * existing libraries' `metaHash` was computed against.
 *
 * `fileobj` must be the same `File` the importer plans to keep using
 * for the rest of `importBook`; we route it directly into foliate so
 * we don't `openFile` twice (which can be expensive on mobile where
 * `Books` BaseDir routes through native scoped-storage).
 */
export const tryNativeParseMobi = async (
  filePath: string | undefined,
  fileobj: File,
): Promise<NativeParsedMobi | null> => {
  if (!isEligibleMobiPath(filePath)) return null;
  try {
    const rust = await invoke<RustParsedMobi>('parse_mobi_metadata', { filePath });
    if (!rust || !rust.partialMd5) return null;

    let coverBlob: Blob | null = null;
    if (rust.cover && rust.cover.bytes && rust.cover.mime) {
      const u8 =
        rust.cover.bytes instanceof Uint8Array
          ? rust.cover.bytes
          : Uint8Array.from(rust.cover.bytes);
      if (u8.byteLength > 0) {
        // Slice into a fresh ArrayBuffer to satisfy lib.dom Blob typings
        // (which require BlobPart = ArrayBuffer/ArrayBufferView<ArrayBuffer>,
        // not the ArrayBufferLike that the Uint8Array constructor exposes).
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
        coverBlob = new Blob([ab], { type: rust.cover.mime });
      }
    }

    const mobiModule = (await import('foliate-js/mobi.js')) as unknown as {
      readMobiMetadata: (
        file: File,
        opts?: { unzlib?: (buf: Uint8Array) => Uint8Array },
      ) => Promise<{
        metadata: BookMetadata;
        getCover: () => Promise<Blob | null | undefined>;
      }>;
    };
    const fflate = (await import('foliate-js/vendor/fflate.js')) as unknown as {
      unzlibSync: (buf: Uint8Array) => Uint8Array;
    };
    const { metadata, getCover } = await mobiModule.readMobiMetadata(fileobj, {
      unzlib: fflate.unzlibSync,
    });

    return {
      partialMd5: rust.partialMd5,
      format: inferMobiFormat(filePath),
      bookDoc: buildBookDocStub(metadata, coverBlob, getCover),
    };
  } catch (err) {
    console.warn('[tauriMobiBridge] native parse failed, falling back to JS:', err);
    return null;
  }
};
