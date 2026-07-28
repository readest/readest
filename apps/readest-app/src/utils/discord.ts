import { invoke } from '@tauri-apps/api/core';
import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { getCoverFilename } from './book';
import { processDiscordCover } from './image';

type CacheEntry = {
  url: string | null;
  expiresAt: number;
  failures: number;
};

const coverUrlCache = new Map<string, CacheEntry>();
// A resolved URL is content-addressed and therefore stable; we only re-upload
// often enough to stay ahead of the temp bucket's retention.
const SUCCESS_TTL = 60 * 60 * 1000;
// No cover.png on disk is a durable state, but a synced cover can still land
// later, so keep re-checking on the same slow cadence.
const MISSING_COVER_TTL = 60 * 60 * 1000;
// A failed upload is almost always the network. Caching that for an hour is
// what made covers "stop working" long after connectivity came back (issue
// #5352), so retry soon — and back off, because the presence tick fires every
// 15s and must not turn an outage into an upload loop.
const RETRY_BASE_TTL = 60 * 1000;
const RETRY_MAX_TTL = 15 * 60 * 1000;

const remember = (bookHash: string, url: string | null, ttl: number) => {
  coverUrlCache.set(bookHash, { url, expiresAt: Date.now() + ttl, failures: 0 });
};

const rememberFailure = (bookHash: string) => {
  const failures = (coverUrlCache.get(bookHash)?.failures ?? 0) + 1;
  const ttl = Math.min(RETRY_BASE_TTL * 2 ** (failures - 1), RETRY_MAX_TTL);
  coverUrlCache.set(bookHash, { url: null, expiresAt: Date.now() + ttl, failures });
};

type BookPresence = {
  bookHash: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  sessionStart: number;
};

/**
 * Get an HTTPS cover URL suitable for Discord Rich Presence
 * - Caches successful uploads for an hour
 * - Caches a missing cover for an hour, but retries upload failures quickly
 * - Processes cover with Readest icon overlay
 */
const getCoverUrlForDiscord = async (
  book: Book,
  appService: AppService,
): Promise<string | undefined> => {
  const cached = coverUrlCache.get(book.hash);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.url ?? undefined;
  }

  try {
    const fp = getCoverFilename(book);

    const exists = await appService.exists(fp, 'Books');
    if (!exists) {
      remember(book.hash, null, MISSING_COVER_TTL);
      return undefined;
    }

    // Name the upload after the cover's content hash so the public URL is
    // identical across sessions and devices — Discord then reuses the external
    // asset it already resolved. Books imported before coverHash existed fall
    // back to the book hash, which is just as stable per book.
    const cacheKey = `drp_${book.coverHash || book.hash}.jpg`;
    // Check if processed image exists in cache
    const cachedExists = await appService.exists(cacheKey, 'Cache');
    if (cachedExists) {
      const downloadUrl = await appService.uploadFileToCloud(
        cacheKey,
        cacheKey,
        'Cache',
        () => {},
        book.hash,
        true,
      );

      if (downloadUrl) {
        remember(book.hash, downloadUrl, SUCCESS_TTL);
        return downloadUrl;
      }
    }

    const fullPath = await appService.resolveFilePath(fp, 'Books');
    const coverUrl = await appService.getImageURL(fullPath);
    const iconUrl = '/icon-tiny.png';

    const processedBlob = await processDiscordCover(coverUrl, iconUrl);
    console.log('Processed Discord cover for book:', book.title);
    const arrayBuffer = await processedBlob.arrayBuffer();
    await appService.writeFile(cacheKey, 'Cache', arrayBuffer);
    const downloadUrl = await appService.uploadFileToCloud(
      cacheKey,
      cacheKey,
      'Cache',
      () => {},
      book.hash,
      true,
    );

    if (downloadUrl) {
      remember(book.hash, downloadUrl, SUCCESS_TTL);
      return downloadUrl;
    }
    rememberFailure(book.hash);
    return undefined;
  } catch (error) {
    console.warn('Failed to process/upload cover for Discord:', error);
    rememberFailure(book.hash);
    return undefined;
  }
};

/**
 * Update Discord Rich Presence with current book information
 */
export const updateDiscordPresence = async (
  book: Book,
  sessionStart: number,
  appService: AppService,
): Promise<void> => {
  if (!appService?.isDesktopApp) return;

  try {
    const coverUrl = await getCoverUrlForDiscord(book, appService);
    const bookPresence: BookPresence = {
      bookHash: book.hash,
      title: book.title,
      author: book.author || null,
      coverUrl: coverUrl || null,
      sessionStart,
    };

    await invoke('update_book_presence', { presence: bookPresence });
  } catch (error) {
    console.warn('Failed to update Discord presence:', error);
  }
};

/**
 * Clear Discord Rich Presence
 */
export const clearDiscordPresence = async (appService: AppService): Promise<void> => {
  if (!appService?.isDesktopApp) return;

  try {
    await invoke('clear_book_presence');
  } catch (error) {
    console.warn('Failed to clear Discord presence:', error);
  }
};
