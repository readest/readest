import { md5 } from 'js-md5';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

/** A prepared section or stylesheet, as foliate's EPUB loader keeps it. */
export interface ResourceCacheEntry {
  type: string;
  mediaType: string;
  data: string;
  children: string[];
}

export interface ResourceCache {
  get(href: string): Promise<ResourceCacheEntry | null>;
  put(href: string, entry: ResourceCacheEntry): Promise<void>;
}

/**
 * Keeps an EPUB's prepared sections and stylesheets for its next open (foliate's
 * `Loader.resourceCache`). An entry is used only while `getInputs()`, everything the transforms
 * read, is what it was when the entry was kept.
 */
export const createResourceCache = (
  appService: Pick<AppService, 'loadBookCache' | 'saveBookCache'>,
  book: Book,
  getInputs: () => unknown,
): ResourceCache => {
  const name = (href: string) => `res-${md5(href)}.json`;
  // compared whole: hashing it costs more than the comparison on a slow device
  const key = () => JSON.stringify(getInputs());
  return {
    get: async (href) => {
      const kept = await appService.loadBookCache(book, name(href));
      if (!kept) return null;
      try {
        const parsed = JSON.parse(kept);
        return parsed.href === href && parsed.key === key() ? parsed.entry : null;
      } catch {
        return null;
      }
    },
    put: (href, entry) =>
      appService.saveBookCache(book, name(href), JSON.stringify({ href, key: key(), entry })),
  };
};
