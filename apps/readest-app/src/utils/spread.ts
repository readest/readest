import { invoke } from '@tauri-apps/api/core';
import { Inflate } from 'fflate';
import type { Entry } from '@zip.js/zip.js';

import type { BookDoc, SectionItem } from '@/libs/document';
import { isTauriAppPlatform } from '@/services/environment';
import { RemoteFile } from '@/utils/file';
import { getImageSize } from '@/utils/image';

/** `[width, height]` in pixels of each image in a comic archive, by path. */
type PageSizes = Record<string, [number, number]>;

// A page is read a step at a time until its size parses: a JPEG keeps the size
// behind its metadata segments, often tens of kilobytes in.
const HEAD_STEP = 16 * 1024;
const HEAD_LIMIT = 64 * 1024;

const readPageSize = async (file: File, entry: Entry): Promise<[number, number] | null> => {
  const { offset, compressionMethod, compressedSize } = entry;
  if (entry.encrypted || (compressionMethod !== 0 && compressionMethod !== 8)) return null;
  // The local header's name and extra field can differ in length from the
  // central directory's, so the data offset comes from the local header.
  const header = new DataView(await file.slice(offset, offset + 30).arrayBuffer());
  const start = offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const end = start + Math.min(compressedSize, HEAD_LIMIT);
  // The limit holds for the inflated bytes too: output past it is dropped.
  const head = new Uint8Array(HEAD_LIMIT);
  let length = 0;
  const append = (chunk: Uint8Array) => {
    const kept = chunk.subarray(0, HEAD_LIMIT - length);
    head.set(kept, length);
    length += kept.length;
  };
  const inflate = compressionMethod === 8 ? new Inflate(append) : null;
  for (let pos = start; pos < end && length < HEAD_LIMIT; pos += HEAD_STEP) {
    const chunk = new Uint8Array(
      await file.slice(pos, Math.min(pos + HEAD_STEP, end)).arrayBuffer(),
    );
    if (!inflate) append(chunk);
    // A push inflates all it is given, and deflate can expand a thousandfold,
    // so feed it a kilobyte at a time.
    for (let i = 0; inflate && i < chunk.length && length < HEAD_LIMIT; i += 1024) {
      inflate.push(chunk.subarray(i, i + 1024));
    }
    const size = getImageSize(head.subarray(0, length));
    if (size) return [size.width, size.height];
  }
  return null;
};

type Section = Pick<SectionItem, 'id' | 'pageSpread'>;

// The native app measures the pages in Rust. On the web an in-memory file is
// read here; a streamed one is left alone, as each page would cost a request.
const getPageSizes = async (
  file: File,
  entries: Entry[],
  nativeFilePath?: string,
): Promise<PageSizes> => {
  if (isTauriAppPlatform()) {
    if (!nativeFilePath) return {};
    return invoke<PageSizes>('get_comic_page_sizes', { filePath: nativeFilePath }).catch(
      () => ({}),
    );
  }
  if (file instanceof RemoteFile) return {};
  const sizes: PageSizes = {};
  for (const entry of entries) {
    if (!/\.(jpe?g|png|gif|bmp|webp)$/i.test(entry.filename)) continue;
    const size = await readPageSize(file, entry).catch(() => null);
    if (size) sizes[entry.filename] = size;
  }
  return sizes;
};

/** Paths of the pages in a comic archive that are wider than they are tall. */
export const measureWidePages = async (file: File, entries: Entry[], nativeFilePath?: string) =>
  Object.entries(await getPageSizes(file, entries, nativeFilePath))
    .filter(([, [width, height]]) => width > height)
    .map(([path]) => path);

export interface WidePagesOptions {
  /** The wide pages an earlier open found: no page is measured up front. */
  known?: string[];
  /** Hears of a page found wide as it loaded, with every wide page so far. */
  onFound?: (ids: string[]) => void;
}

/** The pages laid out on their own, by id: the value `BookConfig.widePages` caches. */
export const getWidePages = (sections: Section[]) =>
  sections.filter((section) => section.pageSpread === 'center').map((section) => section.id);

/**
 * Lays out each wide page of a comic on its own. A double-page spread is
 * usually stored as one wide image; paired with the next page it would show at
 * half size and push every later page onto the wrong side.
 *
 * The returned loader measures each page as its image loads. A streamed comic
 * can only be measured then, and the renderer regroups the spreads when a page
 * it loads comes back wide; `onFound` then gets every wide page so far. Once
 * the book is built, `attach` marks the pages already known to be wide.
 */
export const trackWidePages = <L extends { loadBlob: (name: string) => Promise<unknown> | null }>(
  loader: L,
  onFound?: (ids: string[]) => void,
) => {
  let sections: Section[] = [];
  return {
    loader: {
      ...loader,
      loadBlob: async (name: string) => {
        const blob = await loader.loadBlob(name);
        const section = sections.find((s) => s.id === name);
        if (blob instanceof Blob && section && section.pageSpread !== 'center') {
          const size = getImageSize(new Uint8Array(await blob.slice(0, HEAD_LIMIT).arrayBuffer()));
          if (size && size.width > size.height) {
            section.pageSpread = 'center';
            onFound?.(getWidePages(sections));
          }
        }
        return blob;
      },
    },
    attach: (bookSections: Section[], wide: string[]) => {
      sections = bookSections;
      for (const section of sections) if (wide.includes(section.id)) section.pageSpread = 'center';
    },
  };
};

/**
 * Keeps the cover alone at the start of the book, or pairs it with the next
 * page. A wide cover (a wraparound or spread image) keeps a spread of its own.
 */
export const setCoverSpread = (book: BookDoc, keepCoverSpread: boolean) => {
  const cover = book.sections[0];
  if (!cover || cover.pageSpread === 'center') return;
  cover.pageSpread = keepCoverSpread ? '' : book.dir === 'rtl' ? 'right' : 'left';
};
