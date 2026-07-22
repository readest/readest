import { Book } from '@/types/book';

import libraryEn from '@/data/demo/library.en.json';
import libraryZh from '@/data/demo/library.zh.json';

export const demoLibraries = {
  en: libraryEn,
  zh: libraryZh,
};

const demoBookUrls = new Set([...libraryEn.library, ...libraryZh.library]);

/**
 * Demo books are the sample shelf an anonymous web visitor gets (issue #5049).
 * They are imported as ordinary url-backed rows so the library isn't empty, but
 * they are not the user's content: they must never be pushed to the cloud, and
 * a cloud row must never be merged back over one. Identifying them by url also
 * covers rows imported before this rule existed.
 */
export const isDemoBook = (book: Book): boolean => !!book.url && demoBookUrls.has(book.url);
