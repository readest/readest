import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { getCoverFilename } from './book';

/**
 * True when the URL is fetchable by external services (Readwise, markdown
 * readers), i.e. not a local dev server or the Tauri asset protocol.
 */
export const isPublicImageUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

type CacheEntry = { url: string | null; expiresAt: number };
const publishedCoverCache = new Map<string, CacheEntry>();
// A published URL is content-addressed and durable, so a success is final for
// the session. Failures (offline, signed out, no cover) retry soon: the
// Readwise auto-sync calls this on every debounced push and must not turn an
// outage into an upload loop.
const FAILURE_TTL = 60 * 1000;

/**
 * Resolve a publicly accessible cover image URL for the book, or undefined
 * when none can be provided. A public `coverImageUrl` from the book metadata
 * wins; otherwise the local cover.png is published to the public bucket under
 * media/book_covers/<user-seg>/<coverHash>.png (served via assets.readest.com).
 */
export const getPublicCoverUrl = async (
  book: Book,
  appService: AppService | null,
): Promise<string | undefined> => {
  if (isPublicImageUrl(book.coverImageUrl)) return book.coverImageUrl;
  if (!appService) return undefined;

  const cached = publishedCoverCache.get(book.hash);
  if (cached && (cached.url || Date.now() < cached.expiresAt)) {
    return cached.url ?? undefined;
  }

  try {
    const fp = getCoverFilename(book);
    if (!(await appService.exists(fp, 'Books'))) {
      publishedCoverCache.set(book.hash, { url: null, expiresAt: Date.now() + FAILURE_TTL });
      return undefined;
    }
    // Books imported before coverHash existed fall back to the book hash,
    // which is just as stable per book (mirrors the Discord presence upload).
    const fileName = `${book.coverHash || book.hash}.png`;
    const url = await appService.uploadFileToCloud(
      fp,
      fileName,
      'Books',
      () => {},
      book.hash,
      false,
      'book_covers',
    );
    publishedCoverCache.set(book.hash, {
      url: url ?? null,
      expiresAt: Date.now() + FAILURE_TTL,
    });
    return url ?? undefined;
  } catch (error) {
    console.warn('Failed to publish book cover:', error);
    publishedCoverCache.set(book.hash, { url: null, expiresAt: Date.now() + FAILURE_TTL });
    return undefined;
  }
};
