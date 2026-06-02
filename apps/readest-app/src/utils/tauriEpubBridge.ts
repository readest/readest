// JS<->Rust EPUB bridge for Tauri targets.
//
// Architectural split:
//
//   * Rust handles the *mechanical* zip work that's expensive on a
//     WebView: opening the zip + central-directory parse, partialMD5
//     over the file, locating the cover entry, decoding/resizing the
//     cover image, and (on the open hot path) prefetching nav/ncx
//     bytes + the entry-size map. It also forwards the OPF bytes it
//     already had to read for cover resolution.
//   * foliate-js stays the single source of truth for OPF metadata
//     extraction (title, author, identifier, language map, refines /
//     `belongs-to-collection` graph, ONIX5 codelists, …). The import
//     path runs foliate's `parseEpubMetadataFromXML` directly on the
//     OPF bytes Rust hands over — no zip.js central-directory scan,
//     no nav/ncx inflate, no spine traversal — keeping the import
//     hot path fast while ensuring `Book.metadata` stays byte-stable
//     against what the reader path produces.
//
// Two Tauri commands back this:
//
//   * parse_epub_metadata  — import path. Returns
//                            `{ partialMd5, cover, coverMime, opfPath,
//                              opfBytes }`. The bridge runs foliate's
//                            OPF-only metadata extractor on
//                            `opfBytes` and assembles a lightweight
//                            BookDoc stub the importer consumes.
//   * parse_epub_full      — open path. Returns OPF prefetch + nav/
//                            ncx bytes + entry-size map for the
//                            DocumentLoader on the reader hot path.
//
// Avoids ferrying multi-MB blobs across the JS<->Rust IPC boundary
// and is a no-op on the web platform.
import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { BookDoc, BookMetadata } from '@/libs/document';

// ─── shared helpers ──────────────────────────────────────────────────

const isEligibleEpubPath = (filePath: string | undefined): filePath is string =>
  !!filePath && isTauriAppPlatform() && /\.epub$/i.test(filePath);

/**
 * Convert a `Vec<u8>` returned by Rust over Tauri's IPC into a plain
 * `Uint8Array`. Depending on Tauri's serializer / WebView the wire form
 * is either a `number[]` or already a typed array — normalize both.
 */
const toUint8Array = (bytes: number[] | Uint8Array): Uint8Array =>
  bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

/** Decode a UTF-8 byte buffer (Rust `Vec<u8>` over IPC) into a string. */
const bytesArrayToString = (bytes: number[] | Uint8Array): string =>
  new TextDecoder('utf-8').decode(toUint8Array(bytes));

// ─── parse_epub_metadata (import path) ───────────────────────────────

interface RustParsedEpubMetadata {
  /** partialMD5 of the EPUB file. Same algorithm as utils/md5.ts::partialMD5. */
  partialMd5: string;
  /** Pre-resized cover bytes (Vec<u8> over IPC), or null/absent when the
   *  EPUB has no cover. The Rust side runs the resize + JPEG re-encode
   *  through the `image` crate, which is materially faster than a
   *  `createImageBitmap` + canvas round-trip on Android mid-tier devices
   *  during bulk imports. */
  cover?: number[] | Uint8Array | null;
  /** MIME of `cover` after the (optional) re-encode. Always paired with
   *  `cover`. We propagate it so the JS-side SVG-cover branch in
   *  `bookService.importBook` (which checks `cover.type === "image/svg+xml"`
   *  to route through svg2png) keeps working even on the native fast path. */
  coverMime?: string | null;
  /** OPF zip path. Always present when `partialMd5` is. */
  opfPath: string;
  /** OPF bytes — Rust read these for cover resolution; we forward them
   *  so the importer can run foliate's OPF metadata extractor without a
   *  second zip access. */
  opfBytes: number[] | Uint8Array;
}

export interface NativeParsedEpub {
  /** partialMD5 of the file, ready to use as the `Book.hash`. */
  partialMd5: string;
  /** Lightweight BookDoc stub: only `metadata` and `getCover()` are
   *  populated, which is all `bookService.importBook` consults on the
   *  import hot path. Sections / TOC / fixed-layout detection are
   *  populated lazily by the reader when the user actually opens the
   *  book (which goes through the regular `DocumentLoader` path). */
  bookDoc: BookDoc;
}

/**
 * Build a BookDoc stub for the importer.
 *
 * `metadata` is whatever foliate-js's `parseEpubMetadataFromXML` returns
 * for the OPF Rust handed us — byte-stable against the reader path.
 * `getCover()` returns the Rust-downscaled blob; everything else is the
 * minimum the importer reads (it never touches `sections` / `toc` /
 * `splitTOCHref`).
 */
const buildBookDocStub = (metadata: BookMetadata, coverBlob: Blob | null): BookDoc => {
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
 * Try the import-time native fast-path. Returns `null` on web platform,
 * non-EPUB path, or any IPC / parse error so callers can fall back to
 * the regular foliate-js `DocumentLoader.open()` pipeline with no
 * behavioural change.
 *
 * On success the bridge:
 *   1. invokes the Rust `parse_epub_metadata` command (one IPC, one
 *      zip open, one partialMD5 pass);
 *   2. parses the returned OPF bytes through foliate-js's exported
 *      `parseEpubMetadataFromXML`, so the resulting `metadata` shape
 *      (refines chains, ONIX5 codelists, language maps,
 *      `belongs-to-collection`, …) matches the reader path exactly;
 *   3. wraps the cover bytes into a Blob carrying the Rust-supplied
 *      MIME (so `bookService.importBook`'s `cover.type === 'image/svg+xml'`
 *      branch can still route through svg2png).
 */
export const tryNativeParseEpub = async (
  filePath: string | undefined,
): Promise<NativeParsedEpub | null> => {
  if (!isEligibleEpubPath(filePath)) return null;
  try {
    const rust = await invoke<RustParsedEpubMetadata>('parse_epub_metadata', {
      filePath,
    });
    if (!rust || !rust.partialMd5 || !rust.opfPath || !rust.opfBytes) return null;

    // foliate-js exposes `parseEpubMetadataFromXML` so callers that
    // already have OPF bytes (us — Rust just read them out of the zip)
    // can derive `Book.metadata` without driving the full `EPUB.init()`
    // (which would force `@zip.js/zip.js` to scan the central directory
    // and inflate nav/ncx files the importer never reads). Dynamic
    // import keeps the bridge tree-shakable on web builds where this
    // path is never reached.
    const epubModule = (await import('foliate-js/epub.js')) as unknown as {
      parseEpubMetadataFromXML: (xml: string) => { metadata: BookMetadata };
    };
    const opfXml = bytesArrayToString(rust.opfBytes);
    const { metadata } = epubModule.parseEpubMetadataFromXML(opfXml);

    let coverBlob: Blob | null = null;
    if (rust.cover && rust.coverMime) {
      const bytes = toUint8Array(rust.cover);
      if (bytes.byteLength > 0) {
        // Slice into a fresh ArrayBuffer to satisfy lib.dom Blob typings
        // (which require BlobPart = ArrayBuffer/ArrayBufferView<ArrayBuffer>,
        // not the ArrayBufferLike that the Uint8Array constructor exposes).
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        coverBlob = new Blob([ab], { type: rust.coverMime });
      }
    }

    return {
      partialMd5: rust.partialMd5,
      bookDoc: buildBookDocStub(metadata, coverBlob),
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
 * Try to prefetch OPF/nav/ncx + entry sizes for an EPUB via Rust on the
 * reader open hot path. Returns null when the native path is unavailable
 * (web platform, missing file path, IPC error) so the caller can fall
 * back to the regular zip.js-only DocumentLoader.
 */
export const tryNativePrefetchEpub = async (
  filePath: string | undefined,
): Promise<NativeEpubPrefetch | null> => {
  if (!isEligibleEpubPath(filePath)) return null;
  try {
    const rust = await invoke<RustParsedEpubFull>('parse_epub_full', {
      filePath,
    });
    if (!rust || !rust.partialMd5 || !rust.opfPath || !rust.opfBytes) return null;

    const textCache = new Map<string, string>();
    textCache.set('META-INF/container.xml', buildContainerXml(rust.opfPath));
    textCache.set(rust.opfPath, bytesArrayToString(rust.opfBytes));
    if (rust.navPath && rust.navBytes) {
      textCache.set(rust.navPath, bytesArrayToString(rust.navBytes));
    }
    if (rust.ncxPath && rust.ncxBytes) {
      textCache.set(rust.ncxPath, bytesArrayToString(rust.ncxBytes));
    }

    const sizes = new Map<string, number>(Object.entries(rust.sizes ?? {}));
    return { textCache, sizes, partialMd5: rust.partialMd5 };
  } catch (err) {
    console.warn('[tauriEpubBridge] native prefetch failed, falling back to JS:', err);
    return null;
  }
};
