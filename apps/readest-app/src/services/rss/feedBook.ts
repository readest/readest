import { md5 } from '@/utils/md5';
import { buildFeedBookUrl } from './feedBookUrl';
import type { ParsedFeed } from '@/types/rss';
import type { Book } from '@/types/book';

export function feedBookHash(feedUrl: string): string {
  return md5(buildFeedBookUrl(feedUrl));
}

export function createFeedBook(feedUrl: string, parsed: ParsedFeed): Book {
  const now = Date.now();
  return {
    hash: feedBookHash(feedUrl),
    url: buildFeedBookUrl(feedUrl),
    format: 'EPUB',
    title: parsed.title,
    author: '',
    metadata: { title: parsed.title, author: '', language: '', feedUrl },
    createdAt: now,
    updatedAt: now,
    downloadedAt: now,
    uploadedAt: null,
    deletedAt: null,
  };
}
