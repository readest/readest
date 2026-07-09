import type { FileSystem } from '@/types/system';
import { safeLoadJSON, safeSaveJSON } from '@/services/persistence';
import type { ParsedFeed, RssFeedItem } from '@/types/rss';

export interface FeedArticleEntry {
  id: string;
  slot: number;
  title: string;
  author?: string;
  link: string;
  publishedAt?: string;
  read: boolean;
}

export interface FeedManifest {
  feedUrl: string;
  title: string;
  entries: FeedArticleEntry[];
  lastFetchedAt?: number;
}

export const articleIdOf = (item: RssFeedItem): string => item.id;

export const emptyManifest = (feedUrl: string, title: string): FeedManifest => ({
  feedUrl,
  title,
  entries: [],
});

// Append-only: existing entries keep their slot (and read flag); genuinely new
// ids get the next slot. Order by slot ascending. This is the CFI-stability
// invariant — an article's slot never moves.
export function assignSlots(manifest: FeedManifest, parsed: ParsedFeed): FeedManifest {
  const known = new Map(manifest.entries.map((e) => [e.id, e]));
  let nextSlot = manifest.entries.reduce((m, e) => Math.max(m, e.slot + 1), 0);
  const appended: FeedArticleEntry[] = [];
  for (const item of parsed.items) {
    const id = articleIdOf(item);
    if (known.has(id)) continue;
    const entry: FeedArticleEntry = {
      id,
      slot: nextSlot++,
      title: item.title,
      author: item.author,
      link: item.link,
      publishedAt: item.publishedAt,
      read: false,
    };
    known.set(id, entry);
    appended.push(entry);
  }
  const entries = [...manifest.entries, ...appended].sort((a, b) => a.slot - b.slot);
  return { ...manifest, title: parsed.title || manifest.title, entries };
}

const manifestFile = (feedHash: string) => `${feedHash}/feed-manifest.json`;

export async function loadManifest(
  fs: FileSystem,
  feedHash: string,
  feedUrl: string,
  title: string,
): Promise<FeedManifest> {
  return safeLoadJSON<FeedManifest>(
    fs,
    manifestFile(feedHash),
    'Books',
    emptyManifest(feedUrl, title),
  );
}

export async function saveManifest(
  fs: FileSystem,
  feedHash: string,
  m: FeedManifest,
): Promise<void> {
  await safeSaveJSON(fs, manifestFile(feedHash), 'Books', m);
}
