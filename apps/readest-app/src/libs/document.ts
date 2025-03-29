import { BookFormat } from '@/types/book';
import { Contributor, LanguageMap } from '@/utils/book';
import * as epubcfi from 'foliate-js/epubcfi.js';

// A groupBy polyfill for foliate-js
Object.groupBy ??= (iterable, callbackfn) => {
  const obj = Object.create(null);
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++);
    if (key in obj) {
      obj[key].push(value);
    } else {
      obj[key] = [value];
    }
  }
  return obj;
};

Map.groupBy ??= (iterable, callbackfn) => {
  const map = new Map();
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++),
      list = map.get(key);
    if (list) {
      list.push(value);
    } else {
      map.set(key, [value]);
    }
  }
  return map;
};

export const CFI = epubcfi;

export type DocumentFile = File;

export interface TOCItem {
  id: number;
  label: string;
  href: string;
  cfi?: string;
  subitems?: TOCItem[];
}

export interface SectionItem {
  id: string;
  cfi: string;
  size: number;
}

export interface BookDoc {
  metadata: {
    // NOTE: the title and author fields should be formatted
    title: string | LanguageMap;
    author: string | Contributor;
    language: string | string[];
    editor?: string;
    publisher?: string;
    published?: string;
    description?: string;
    subject?: string[];
    identifier?: string;
  };
  dir: string;
  toc?: Array<TOCItem>;
  sections?: Array<SectionItem>;
  transformTarget?: EventTarget;
  splitTOCHref(href: string): Array<string | number>;
  getCover(): Promise<Blob | null>;
}

export const EXTS: Record<BookFormat, string> = {
  EPUB: 'epub',
  PDF: 'pdf',
  MOBI: 'mobi',
  CBZ: 'cbz',
  FB2: 'fb2',
  FBZ: 'fbz',
};

export class DocumentLoader {
  private file: File;

  constructor(file: File) {
    this.file = file;
  }

  private async isZip(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 4).arrayBuffer());
    return arr[0] === 0x50 && arr[1] === 0x4b && arr[2] === 0x03 && arr[3] === 0x04;
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

    const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import(
      '@zip.js/zip.js'
    );
    type Entry = import('@zip.js/zip.js').Entry;
    configure({ useWebWorkers: false });
    const reader = new ZipReader(new BlobReader(this.file));
    const entries = await reader.getEntries();
    const map = new Map(entries.map((entry) => [entry.filename, entry]));
    const load =
      (f: (entry: Entry, type?: string) => Promise<string | Blob> | null) =>
      (name: string, ...args: [string?]) =>
        map.has(name) ? f(map.get(name)!, ...args) : null;

    const loadText = load((entry: Entry) =>
      entry.getData ? entry.getData(new TextWriter()) : null,
    );
    const loadBlob = load((entry: Entry, type?: string) =>
      entry.getData ? entry.getData(new BlobWriter(type!)) : null,
    );
    const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0;

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
    if (await this.isZip()) {
      const loader = await this.makeZipLoader();
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
      format = 'MOBI';
    } else if (this.isFB2()) {
      const { makeFB2 } = await import('foliate-js/fb2.js');
      book = await makeFB2(this.file);
      format = 'FB2';
    }
    return { book, format } as { book: BookDoc; format: BookFormat };
  }
}

export const getDirection = (doc: Document) => {
  const { defaultView } = doc;
  const { writingMode, direction } = defaultView!.getComputedStyle(doc.body);
  const vertical = writingMode === 'vertical-rl' || writingMode === 'vertical-lr';
  const rtl = doc.body.dir === 'rtl' || direction === 'rtl' || doc.documentElement.dir === 'rtl';
  return { vertical, rtl };
};
