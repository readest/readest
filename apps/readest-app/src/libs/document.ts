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
  MOBI: 'mobi',
  AZW: 'azw',
  AZW3: 'azw3',
  TXT: 'txt',
  MD: 'md',
  UNKNOWN: '',
};

export const MIMETYPES: Record<BookFormat, string[]> = {
  EPUB: ['application/epub+zip'],
  MOBI: ['application/x-mobipocket-ebook'],
  AZW: ['application/vnd.amazon.ebook'],
  AZW3: ['application/vnd.amazon.mobi8-ebook', 'application/x-mobi8-ebook'],
  TXT: ['text/plain'],
  MD: ['text/markdown', 'text/x-markdown'],
  UNKNOWN: [],
};

export class DocumentLoader {
  private file: File;

  constructor(file: File) {
    this.file = file;
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

  private async makeZipLoader() {
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

    const loadText = load((entry: Entry) =>
      !entry.directory ? entry.getData(new TextWriter()) : null,
    );
    const loadBlob = load((entry: Entry, type?: string) =>
      !entry.directory ? entry.getData(new BlobWriter(type!)) : null,
    );
    const getSize = (name: string) => getEntry(name)?.uncompressedSize ?? 0;

    return { entries, loadText, loadBlob, getSize, getComment, sha1: undefined };
  }

  private isCBZ(): boolean {
    return (
      this.file.type === 'application/vnd.comicbook+zip' ||
      this.file.type === 'application/x-cbz' ||
      this.file.name.toLowerCase().endsWith('.cbz')
    );
  }

  private isFB2(): boolean {
    return (
      this.file.type === 'application/x-fictionbook+xml' ||
      this.file.name.toLowerCase().endsWith('.fb2')
    );
  }

  private isFBZ(): boolean {
    return (
      this.file.type === 'application/x-zip-compressed-fb2' ||
      this.file.name.endsWith('.fb.zip') ||
      this.file.name.endsWith('.fb2.zip') ||
      this.file.name.toLowerCase().endsWith('.fbz')
    );
  }

  public async open(): Promise<{ book: BookDoc; format: BookFormat }> {
    let book = null;
    let format: BookFormat = 'EPUB';
    if (!this.file.size) {
      throw new Error('File is empty');
    }
    try {
      if (this.isCBZ() || this.isFB2() || this.isFBZ() || (await this.isPDF())) {
        throw new Error('Unsupported book format');
      }
      if (await this.isZip()) {
        const loader = await this.makeZipLoader();

        const { EPUB } = await import('foliate-js/epub.js');
        book = await new EPUB(loader).init();
        format = 'EPUB';
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
      }
    } catch (e: unknown) {
      console.error('Failed to open document:', e);
      if (e instanceof Error && e.message?.includes('not a valid zip')) {
        throw new Error('Unsupported or corrupted book file');
      }
      throw e;
    }
    return { book, format } as unknown as { book: BookDoc; format: BookFormat };
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
