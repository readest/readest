import type { BookDoc } from '@/libs/document';
import type { AppService } from '@/types/system';

// Longer edge in pixels: sharp at the sidebar's three-per-row size on 2x screens.
const THUMBNAIL_SIZE = 256;
// Object URLs kept alive in memory; older ones are revoked and reread from disk.
const MAX_MEMORY_THUMBNAILS = 300;

const memoryCache = new Map<string, string>();
const pendingLoads = new Map<string, Promise<string | null>>();
// Renders run one at a time: pdf.js parses pages on a single worker anyway, and
// a backlog must not starve the reader's own page renders.
let renderQueue: Promise<unknown> = Promise.resolve();

const getCachePath = (bookHash: string, index: number) =>
  `page-thumbnails/${bookHash}/${index}.jpg`;

const remember = (key: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  memoryCache.set(key, url);
  if (memoryCache.size > MAX_MEMORY_THUMBNAILS) {
    const [oldKey, oldUrl] = memoryCache.entries().next().value!;
    memoryCache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
};

export const getCachedPageThumbnail = (bookHash: string, index: number) =>
  memoryCache.get(`${bookHash}/${index}`) ?? null;

const loadThumbnail = async (
  appService: AppService,
  bookHash: string,
  bookDoc: BookDoc,
  index: number,
) => {
  const key = `${bookHash}/${index}`;
  const path = getCachePath(bookHash, index);
  try {
    const data = (await appService.readFile(path, 'Cache', 'binary')) as ArrayBuffer;
    return remember(key, new Blob([data], { type: 'image/jpeg' }));
  } catch {
    // Not rendered in an earlier session yet.
  }
  const render = renderQueue.then(() => bookDoc.getPageThumbnail!(index, THUMBNAIL_SIZE));
  renderQueue = render.catch(() => {});
  const blob = await render;
  if (!blob) return null;
  const url = remember(key, blob);
  void blob
    .arrayBuffer()
    .then((data) => appService.writeFile(path, 'Cache', data))
    .catch(() => {});
  return url;
};

/**
 * Object URL of a page thumbnail, from memory, the on-disk cache, or a fresh
 * render (which is then cached in both). Resolves null if the page can't be
 * rendered, e.g. after the book was closed.
 */
export const loadPageThumbnail = (
  appService: AppService,
  bookHash: string,
  bookDoc: BookDoc,
  index: number,
): Promise<string | null> => {
  const key = `${bookHash}/${index}`;
  const cached = memoryCache.get(key);
  if (cached) {
    // Refresh its LRU position.
    memoryCache.delete(key);
    memoryCache.set(key, cached);
    return Promise.resolve(cached);
  }
  let pending = pendingLoads.get(key);
  if (!pending) {
    pending = loadThumbnail(appService, bookHash, bookDoc, index)
      .catch(() => null)
      .finally(() => pendingLoads.delete(key));
    pendingLoads.set(key, pending);
  }
  return pending;
};
