import { md5 } from '@/utils/md5';
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

// 48 bits of md5 -> integer slot. Deterministic per articleId on every device,
// exact in a JS number (< 2^53), and CFI.fake.fromIndex(slot) stays integral.
const SLOT_HEX_DIGITS = 12;
export const slotForArticleId = (id: string): number =>
  parseInt(md5(id).slice(0, SLOT_HEX_DIGITS), 16);

// Append-only: existing entries keep their slot (and read flag); genuinely new
// ids get a content-hash-derived slot. Order is first-seen append order.
// This is the CFI-stability invariant — an article's slot never moves,
// and every device independently derives the same slot for the same article.
export function assignSlots(manifest: FeedManifest, parsed: ParsedFeed): FeedManifest {
  const known = new Map(manifest.entries.map((e) => [e.id, e]));
  const taken = new Set(manifest.entries.map((e) => e.slot));
  const appended: FeedArticleEntry[] = [];
  for (const item of parsed.items) {
    const id = articleIdOf(item);
    if (known.has(id)) continue;
    let slot = slotForArticleId(id);
    let n = 0;
    while (taken.has(slot)) slot = slotForArticleId(`${id}#${++n}`);
    taken.add(slot);
    const entry: FeedArticleEntry = {
      id,
      slot,
      title: item.title,
      author: item.author,
      link: item.link,
      publishedAt: item.publishedAt,
      read: false,
    };
    known.set(id, entry);
    appended.push(entry);
  }
  const entries = [...manifest.entries, ...appended];
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
