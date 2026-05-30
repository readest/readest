import { BookFormat } from '@/types/book';
import { Collection, Contributor, Identifier, LanguageMap } from '@/utils/book';
import { configureZip } from '@/utils/zip';
import * as epubcfi from 'foliate-js/epubcfi.js';

export const CFI = epubcfi;

export type DocumentFile = File;

export type Location = {
  current: number;
  next: number;
  total: number;
};

export interface TOCItem {
  id: number;
  label: string;
  href: string;
  index: number; // Page index for PDF books
  cfi?: string;
  location?: Location;
  subitems?: TOCItem[];
}

export interface SectionFragment {
  id: string;
  href: string;
  cfi: string;
  size: number;
  linear: string;
  location?: Location;
  fragments?: Array<SectionFragment>;
}

export interface SectionItem {
  id: string;
  cfi: string;
  size: number;
  linear: string;
  href?: string;
  location?: Location;
  pageSpread?: 'left' | 'right' | 'center' | '';
  fragments?: Array<SectionFragment>;

  loadText?: () => Promise<string | null>;
  createDocument: () => Promise<Document>;
}

export type BookMetadata = {
  // NOTE: the title and author fields should be formatted
  title: string | LanguageMap;
  author: string | Contributor;
  language: string | string[];
  editor?: string;
  publisher?: string;
  published?: string;
  description?: string;
  subject?: string | string[] | Contributor;
  identifier?: string;
  isbn?: string;
  altIdentifier?: string | string[] | Identifier;
  belongsTo?: {
    collection?: Array<Collection> | Collection;
    series?: Array<Collection> | Collection;
  };

  subtitle?: string;
  series?: string;
  seriesIndex?: number;
  seriesTotal?: number;

  coverImageFile?: string;
  coverImageUrl?: string;
  coverImageBlobUrl?: string;
};

export interface BookDoc {
  metadata: BookMetadata;
  rendition: {
    layout?: 'pre-paginated' | 'reflowable';
    spread?: 'auto' | 'none';
    viewport?: { width: number; height: number };
  };
  dir: string;
  toc?: Array<TOCItem>;
  sections: Array<SectionItem>;
  transformTarget?: EventTarget;
  splitTOCHref(href: string): Array<string | number>;
  getCover(): Promise<Blob | null>;
}

export const EXTS: Record<BookFormat, string> = {
  EPUB: 'epub',
  PDF: 'pdf',
  MOBI: 'mobi',
  AZW: 'azw',
  AZW3: 'azw3',
  CBZ: 'cbz',
  FB2: 'fb2',
  FBZ: 'fbz',
  TXT: 'txt',
  MD: 'md',
};

export const MIMETYPES: Record<BookFormat, string[]> = {
  EPUB: ['application/epub+zip'],
  PDF: ['application/pdf'],
  MOBI: ['application/x-mobipocket-ebook'],
  AZW: ['application/vnd.amazon.ebook'],
  AZW3: ['application/vnd.amazon.mobi8-ebook', 'application/x-mobi8-ebook'],
  CBZ: ['application/vnd.comicbook+zip', 'application/zip', 'application/x-cbz'],
  FB2: ['application/x-fictionbook+xml', 'text/xml', 'application/xml'],
  FBZ: ['application/x-zip-compressed-fb2', 'application/zip'],
  TXT: ['text/plain'],
  MD: ['text/markdown', 'text/x-markdown'],
};

export interface DocumentLoaderOptions {
  /**
   * Absolute filesystem path of `file`, used by Tauri builds to invoke the
   * Rust EPUB pre-parser (`parse_epub_full`). When omitted (web platform,
   * synthetic File, tests) the loader silently falls back to the
   * zip.js-only path. Callers SHOULD pass it whenever they have one --
   * the foliate-js init() drops from ~1.5s to ~0.3s on iOS for a typical
   * EPUB when the prefetch cache is hit.
   */
  nativeFilePath?: string;
}

export class DocumentLoader {
  private file: File;
  private nativeFilePath?: string;

  constructor(file: File, options: DocumentLoaderOptions = {}) {
    this.file = file;
    this.nativeFilePath = options.nativeFilePath;
  }

  private async isZip(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 4).arrayBuffer());
    // Standard local file header signature is PK\x03\x04, but some non-conformant
    // EPUB writers emit malformed bytes (e.g., PK\x03\x02) on the first entry.
    // The archive is still readable via the central directory, so don't gate on
    // the 4th byte. PK\x03 alone is enough to identify a local file header.
    if (arr[0] === 0x50 && arr[1] === 0x4b && arr[2] === 0x03) {
      return true;
    }
    // Some files have their first few bytes corrupted (e.g. Baidu Netdisk
    // mangles the leading PK\x03\x04 into garbage on certain epubs). The zip
    // format is officially located by walking the End-of-Central-Directory
    // record at the *tail* of the file -- everything before it is allowed to
    // be arbitrary data (self-extracting executables rely on this). So when
    // the magic bytes look wrong, fall back to searching for the EOCD
    // signature (PK\x05\x06) in the last 64 KiB of the file. If found, the
    // file is still a usable zip and we should let zip.js try to read it.
    return await this.hasEOCD();
  }

  private async hasEOCD(): Promise<boolean> {
    // EOCD record is at least 22 bytes (sig + 16 + comment length); the
    // trailing comment can be up to 64 KiB, so search the last 64 KiB + 22.
    const maxEOCDSearch = 1024 * 64 + 22;
    const sliceSize = Math.min(maxEOCDSearch, this.file.size);
    if (sliceSize < 22) return false;
    const tail = await this.file.slice(this.file.size - sliceSize, this.file.size).arrayBuffer();
    const bytes = new Uint8Array(tail);
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        return true;
      }
    }
    return false;
  }

  private async isPDF(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 5).arrayBuffer());
    return (
      arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46 && arr[4] === 0x2d
    );
  }

  private async makeZipLoader(prefetch?: {
    textCache?: Map<string, string>;
    sizes?: Map<string, number>;
  }) {
    const getComment = async (): Promise<string | null> => {
      const EOCD_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];
      const maxEOCDSearch = 1024 * 64;

      const sliceSize = Math.min(maxEOCDSearch, this.file.size);
      const tail = await this.file.slice(this.file.size - sliceSize, this.file.size).arrayBuffer();
      const bytes = new Uint8Array(tail);

      for (let i = bytes.length - 22; i >= 0; i--) {
        if (
          bytes[i] === EOCD_SIGNATURE[0] &&
          bytes[i + 1] === EOCD_SIGNATURE[1] &&
          bytes[i + 2] === EOCD_SIGNATURE[2] &&
          bytes[i + 3] === EOCD_SIGNATURE[3]
        ) {
          const commentLength = bytes[i + 20]! + (bytes[i + 21]! << 8);
          const commentStart = i + 22;
          const commentBytes = bytes.slice(commentStart, commentStart + commentLength);
          return new TextDecoder().decode(commentBytes);
        }
      }

      return null;
    };

    await configureZip();
    const { ZipReader, BlobReader, TextWriter, BlobWriter } = await import('@zip.js/zip.js');
    type Entry = import('@zip.js/zip.js').Entry;
    const reader = new ZipReader(new BlobReader(this.file));
    const entries = await reader.getEntries();
    const map = new Map(entries.map((entry) => [entry.filename, entry]));
    const lowercaseMap = new Map<string, Entry | null>();
    for (const entry of entries) {
      const lowercaseName = entry.filename.toLowerCase();
      const existing = lowercaseMap.get(lowercaseName);
      lowercaseMap.set(
        lowercaseName,
        existing && existing.filename !== entry.filename ? null : entry,
      );
    }
    const getEntry = (name: string) =>
      map.get(name) ?? lowercaseMap.get(name.toLowerCase()) ?? null;
    const load =
      (f: (entry: Entry, type?: string) => Promise<string | Blob> | null) =>
      (name: string, ...args: [string?]) => {
        const entry = getEntry(name);
        return entry ? f(entry, ...args) : null;
      };

    const zipLoadText = load((entry: Entry) =>
      !entry.directory ? entry.getData(new TextWriter()) : null,
    );
    const loadBlob = load((entry: Entry, type?: string) =>
      !entry.directory ? entry.getData(new BlobWriter(type!)) : null,
    );

    // Prefetch fast-path: foliate-js's EPUB.init() reads container.xml,
    // the OPF, the EPUB3 nav and (if present) the NCX via this very
    // `loadText`. On Tauri we already have those bytes in memory from
    // the Rust `parse_epub_full` command, so we hand them back without
    // touching zip.js. Anything not in the cache falls through to the
    // original zip.js path (CSS/HTML/font assets the reader pulls
    // lazily as the user actually reads stay on the slow path, which
    // is fine -- they're also tiny per-call and async).
    const textCache = prefetch?.textCache;
    const sizesOverride = prefetch?.sizes;

    // In-flight dedupe for spine-text loads.
    //
    // foliate-js's `Section` exposes both `loadText()` and `createDocument()`
    // (which internally re-runs `loadText` + parseFromString). Our nav
    // pipeline (`computeBookNav` and `enrichTocFromNavElements`) needs both
    // the raw HTML (for byte-size math + regex-based fragment locator) and
    // the parsed Document (for CFI computation), so it ends up calling them
    // back-to-back on the same href — without dedupe, every chapter pays for
    // two zip.js inflate calls per `computeBookNav`. On iOS WebView a 100KB
    // chapter inflate is ~3-5ms, so for a 100-section book this costs
    // ~300-500ms per first open. The dedupe is a single Map lookup on the
    // hot path, so the overhead when nothing is in flight is negligible.
    //
    // We intentionally only dedupe *concurrent* requests: as soon as the
    // promise settles, we drop it from the map so we don't retain inflated
    // chapter strings in memory (a long book is megabytes of text). This is
    // safe because the only consumer that cares about reuse — nav
    // computation — issues both calls in the same microtask span.
    const inflight = new Map<string, Promise<string | null>>();
    const dedupedZipLoadText = (name: string, ...args: [string?]): Promise<string | null> => {
      const existing = inflight.get(name);
      if (existing) return existing;
      const p =
        (zipLoadText(name, ...args) as Promise<string | null> | null) ?? Promise.resolve(null);
      const wrapped = Promise.resolve(p).finally(() => {
        // Release as soon as the promise settles; subsequent independent
        // reads will re-inflate (intentional — we don't want a nav-time
        // cache to hold the whole book in RAM).
        if (inflight.get(name) === wrapped) inflight.delete(name);
      });
      inflight.set(name, wrapped);
      return wrapped;
    };

    const loadText = textCache
      ? (name: string, ...args: [string?]) => {
          const cached = textCache.get(name);
          if (cached !== undefined) return Promise.resolve(cached);
          return dedupedZipLoadText(name, ...args);
        }
      : dedupedZipLoadText;

    const getSize = sizesOverride
      ? (name: string) => sizesOverride.get(name) ?? getEntry(name)?.uncompressedSize ?? 0
      : (name: string) => getEntry(name)?.uncompressedSize ?? 0;

    return { entries, loadText, loadBlob, getSize, getComment, sha1: undefined };
  }

  private isCBZ(): boolean {
    return (
      this.file.type === 'application/vnd.comicbook+zip' || this.file.name.endsWith(`.${EXTS.CBZ}`)
    );
  }

  private isFB2(): boolean {
    return (
      this.file.type === 'application/x-fictionbook+xml' || this.file.name.endsWith(`.${EXTS.FB2}`)
    );
  }

  private isFBZ(): boolean {
    return (
      this.file.type === 'application/x-zip-compressed-fb2' ||
      this.file.name.endsWith('.fb.zip') ||
      this.file.name.endsWith('.fb2.zip') ||
      this.file.name.endsWith(`.${EXTS.FBZ}`)
    );
  }

  public async open(): Promise<{ book: BookDoc; format: BookFormat }> {
    let book = null;
    let format: BookFormat = 'EPUB';
    if (!this.file.size) {
      throw new Error('File is empty');
    }
    try {
      if (await this.isZip()) {
        // EPUB-only fast path: ask Rust to pre-read OPF/nav/ncx + sizes.
        // CBZ/FBZ skip this -- they have no OPF and Rust has no parser
        // for them. We probe `isEPUBLike()` (= isZip but not CBZ/FBZ)
        // so the prefetch RPC only fires when it can actually be used.
        const isEPUBLike = !this.isCBZ() && !this.isFBZ();
        let prefetch: { textCache: Map<string, string>; sizes: Map<string, number> } | undefined;
        if (isEPUBLike && this.nativeFilePath) {
          const { tryNativePrefetchEpub } = await import('@/utils/tauriEpubBridge');
          const native = await tryNativePrefetchEpub(this.nativeFilePath);
          if (native) {
            prefetch = { textCache: native.textCache, sizes: native.sizes };
          }
        }
        const loader = await this.makeZipLoader(prefetch);
        const { entries } = loader;

        if (this.isCBZ()) {
          const { makeComicBook } = await import('foliate-js/comic-book.js');
          book = await makeComicBook(loader, this.file);
          format = 'CBZ';
        } else if (this.isFBZ()) {
          const entry = entries.find((entry) => entry.filename.endsWith(`.${EXTS.FB2}`));
          const blob = await loader.loadBlob((entry ?? entries[0]!).filename);
          const { makeFB2 } = await import('foliate-js/fb2.js');
          book = await makeFB2(blob);
          format = 'FBZ';
        } else {
          const { EPUB } = await import('foliate-js/epub.js');
          book = await new EPUB(loader).init();
          format = 'EPUB';
        }
      } else if (await this.isPDF()) {
        const { makePDF } = await import('foliate-js/pdf.js');
        book = await makePDF(this.file);
        format = 'PDF';
      } else if (await (await import('foliate-js/mobi.js')).isMOBI(this.file)) {
        const fflate = await import('foliate-js/vendor/fflate.js');
        const { MOBI } = await import('foliate-js/mobi.js');
        book = await new MOBI({ unzlib: fflate.unzlibSync }).open(this.file);
        const ext = this.file.name.split('.').pop()?.toLowerCase();
        switch (ext) {
          case 'azw':
            format = 'AZW';
            break;
          case 'azw3':
            format = 'AZW3';
            break;
          default:
            format = 'MOBI';
        }
      } else if (this.isFB2()) {
        const { makeFB2 } = await import('foliate-js/fb2.js');
        book = await makeFB2(this.file);
        format = 'FB2';
      }
    } catch (e: unknown) {
      console.error('Failed to open document:', e);
      if (e instanceof Error && e.message?.includes('not a valid zip')) {
        throw new Error('Unsupported or corrupted book file');
      }
      throw e;
    }
    return { book, format } as { book: BookDoc; format: BookFormat };
  }
}

export const getDirection = (doc: Document) => {
  const { defaultView } = doc;
  let { writingMode, direction } = defaultView!.getComputedStyle(doc.body);
  // Some EPUBs set writing-mode on the first child of body instead of body itself
  if (!writingMode || writingMode === 'horizontal-tb') {
    const firstChild = doc.body.querySelector(':scope > :not([cfi-inert])');
    if (firstChild) {
      const childStyle = defaultView!.getComputedStyle(firstChild);
      if (childStyle.writingMode === 'vertical-rl' || childStyle.writingMode === 'vertical-lr') {
        writingMode = childStyle.writingMode;
      }
    }
  }
  const vertical = writingMode === 'vertical-rl' || writingMode === 'vertical-lr';
  const rtl = doc.body.dir === 'rtl' || direction === 'rtl' || doc.documentElement.dir === 'rtl';
  return { vertical, rtl };
};

export const getFileExtFromMimeType = (mimeType?: string): string => {
  if (!mimeType) return '';

  for (const format in MIMETYPES) {
    const list = MIMETYPES[format as BookFormat];
    if (list.includes(mimeType)) {
      return EXTS[format as BookFormat];
    }
  }
  return '';
};

export const getMimeTypeFromFileExt = (ext: string): string => {
  ext = ext.toLowerCase();
  for (const format in EXTS) {
    if (EXTS[format as BookFormat] === ext) {
      const mimeTypes = MIMETYPES[format as BookFormat];
      return mimeTypes[0] || 'application/octet-stream';
    }
  }
  return 'application/octet-stream';
};

export const convertBlobUrlToDataUrl = async (blobUrl: string): Promise<string> => {
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch blob from "${blobUrl}": ${response.status} ${response.statusText}`,
      );
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to convert blob to data URL:', error);
    throw error;
  }
};
