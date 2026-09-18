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
  let head = new Uint8Array();
  const append = (chunk: Uint8Array) => {
    const joined = new Uint8Array(head.length + chunk.length);
    joined.set(head);
    joined.set(chunk, head.length);
    head = joined;
  };
  const inflate = compressionMethod === 8 ? new Inflate(append) : null;
  for (let pos = start; pos < end; pos += HEAD_STEP) {
    const chunk = new Uint8Array(
      await file.slice(pos, Math.min(pos + HEAD_STEP, end)).arrayBuffer(),
    );
    if (inflate) inflate.push(chunk);
    else append(chunk);
    const size = getImageSize(head);
    if (size) return [size.width, size.height];
  }
  return null;
};

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

/**
 * Lays out each wide page of a comic on its own. A double-page spread is
 * usually stored as one wide image; paired with the next page it would show at
 * half size and push every later page onto the wrong side.
 */
export const markWidePages = async (
  sections: Pick<SectionItem, 'id' | 'pageSpread'>[],
  file: File,
  entries: Entry[],
  nativeFilePath?: string,
) => {
  const sizes = await getPageSizes(file, entries, nativeFilePath);
  for (const section of sections) {
    const size = sizes[section.id];
    if (size && size[0] > size[1]) section.pageSpread = 'center';
  }
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
