// Android PDF import bridge.
//
// Importing needs only catalog metadata and a first-page thumbnail. Running
// foliate-js's full PDF reader for that work initializes pdf.js, its worker,
// the page tree, and potentially every source range. This bridge keeps the
// source file native: Rust reads the catalog through a memory map, while
// Android renders page one from a seekable file descriptor.
import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { BookDoc, BookMetadata } from '@/libs/document';
import type { OsPlatform } from '@/types/system';

const COVER_MAX_LONG_EDGE = 512;

interface RustPdfInfo {
  title?: number[] | Uint8Array | null;
  author?: number[] | Uint8Array | null;
  subject?: number[] | Uint8Array | null;
}

interface RustParsedPdfMetadata {
  partialMd5: string;
  info: RustPdfInfo;
  xmp?: number[] | Uint8Array | null;
}

interface NativePdfCover {
  coverBase64?: string | null;
  coverMime?: string | null;
}

export interface NativeParsedPdf {
  partialMd5?: string;
  bookDoc: BookDoc;
}

interface NativeLocationFile extends File {
  getNativeLocation?(): { path: string };
}

const coverFromBase64 = (cover?: NativePdfCover): Blob | null => {
  if (!cover?.coverBase64 || !cover.coverMime) return null;
  const binary = atob(cover.coverBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: cover.coverMime });
};

const buildBookDocStub = (metadata: BookMetadata, cover: Blob | null): BookDoc =>
  ({
    metadata,
    rendition: {},
    dir: 'ltr',
    toc: [],
    sections: [],
    splitTOCHref: () => [null, null],
    getCover: async () => cover,
  }) as unknown as BookDoc;

/**
 * Open the Android import-only path. `null` means the path is ineligible, not
 * that Android should fall back to pdf.js. Once eligible, partial native
 * failures keep whatever metadata/cover succeeded; if both native readers
 * reject the file, import fails instead of reading the whole PDF in JS.
 */
export const tryNativeParsePdf = async (
  filePath: string | undefined,
  file: File | undefined,
  osPlatform: OsPlatform | undefined,
): Promise<NativeParsedPdf | null> => {
  if (!filePath || !isTauriAppPlatform() || osPlatform !== 'android') {
    return null;
  }

  // Xiaomi's picker uses a file-explorer content URI. NativeAppService has
  // already copied that URI to a cache file by the time this bridge runs, so
  // use NativeFile's resolved path instead of handing the content URI to Rust
  // or PdfRenderer. Folder imports already arrive as absolute paths.
  const openedPath = (file as NativeLocationFile | undefined)?.getNativeLocation?.().path;
  const nativePath =
    openedPath?.startsWith('/') || openedPath?.startsWith('content://')
      ? openedPath
      : filePath.startsWith('/')
        ? filePath
        : undefined;
  if (!nativePath || !/\.pdf$/i.test(file?.name || nativePath)) return null;

  const [metadataResult, coverResult] = await Promise.allSettled([
    invoke<RustParsedPdfMetadata>('parse_pdf_metadata', { filePath: nativePath }),
    invoke<NativePdfCover>('render_pdf_cover', {
      payload: { filePath: nativePath, maxLongEdge: COVER_MAX_LONG_EDGE },
    }),
  ]);
  if (metadataResult.status === 'rejected' && coverResult.status === 'rejected') {
    throw new Error('Native PDF metadata and cover extraction failed');
  }

  const rust = metadataResult.status === 'fulfilled' ? metadataResult.value : undefined;
  const cover = coverResult.status === 'fulfilled' ? coverFromBase64(coverResult.value) : null;
  const pdfMetadataModule = (await import('foliate-js/pdf.js')) as unknown as {
    parsePDFMetadata: (input: {
      info?: RustPdfInfo;
      xmp?: number[] | Uint8Array | null;
    }) => BookMetadata;
  };
  return {
    partialMd5: rust?.partialMd5,
    bookDoc: buildBookDocStub(
      pdfMetadataModule.parsePDFMetadata({ info: rust?.info, xmp: rust?.xmp }),
      cover,
    ),
  };
};
