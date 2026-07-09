import type { FileSystem } from '@/types/system';
import type { BookDoc } from '@/libs/document';
import type { ParsedFeed } from '@/types/rss';
import {
  assignSlots,
  loadManifest,
  saveManifest,
  type FeedManifest,
  type FeedArticleEntry,
} from './feedManifest';
import { fetchAndParseFeed } from './feedClient';
import {
  resolveArticleHtml,
  extractArticle,
  loadArticleCache,
  saveArticleCache,
} from './feedArticleContent';
import { guardedFetchText } from './feedGuardedFetch';
import { makeFeedBook } from './makeFeedBook';

export interface RefreshDeps {
  fetchAndParse?: (feedUrl: string) => Promise<ParsedFeed>;
  extractFor?: (entry: FeedArticleEntry) => Promise<string>;
}

export interface OpenFeedDeps extends RefreshDeps {
  refresh?: typeof refreshFeedManifest;
}

const defaultExtractFor = async (entry: FeedArticleEntry): Promise<string> =>
  extractArticle(await guardedFetchText(entry.link), entry.link);

// Fetch the feed, append-only assign slots, and cache content for entries not
// cached yet (new ones): feed-content-first, page-fetch fallback. Existing
// entries are already cached (immutable) so their content and slots never move.
export async function refreshFeedManifest(
  fs: FileSystem,
  feedHash: string,
  feedUrl: string,
  title: string,
  deps: RefreshDeps = {},
): Promise<FeedManifest> {
  const fetchAndParse = deps.fetchAndParse ?? fetchAndParseFeed;
  const extractFor = deps.extractFor ?? defaultExtractFor;
  const prev = await loadManifest(fs, feedHash, feedUrl, title);
  const parsed = await fetchAndParse(feedUrl);
  const manifest = assignSlots(prev, parsed);
  const itemById = new Map(parsed.items.map((it) => [it.id, it]));
  for (const entry of manifest.entries) {
    if ((await loadArticleCache(fs, feedHash, entry.id)) !== null) continue;
    try {
      const item = itemById.get(entry.id);
      const decision = item ? resolveArticleHtml(item) : ({ needsPage: true } as const);
      const html = 'html' in decision ? decision.html : await extractFor(entry);
      await saveArticleCache(fs, feedHash, entry.id, html);
    } catch {
      // One article failing (network, extraction) must not abort the refresh:
      // the entry keeps its slot, renders as an offline placeholder, and is
      // retried on the next refresh.
    }
  }
  const updated: FeedManifest = { ...manifest, lastFetchedAt: Date.now() };
  await saveManifest(fs, feedHash, updated);
  return updated;
}

export async function buildFeedBookDoc(
  fs: FileSystem,
  feedHash: string,
  manifest: FeedManifest,
): Promise<BookDoc> {
  return makeFeedBook(manifest, async (entry) => {
    const cached = await loadArticleCache(fs, feedHash, entry.id);
    return cached ?? '<p>Article content unavailable offline.</p>';
  });
}

// Stale-while-revalidate open: when the manifest already has entries, build
// the BookDoc from local data immediately and refresh in the background
// (new articles are persisted and appear on the next open). Only a first
// open (empty manifest) blocks on the network — there is nothing to show yet.
export async function openFeedBookDoc(
  fs: FileSystem,
  feedHash: string,
  feedUrl: string,
  title: string,
  deps: OpenFeedDeps = {},
): Promise<BookDoc> {
  const refresh = deps.refresh ?? refreshFeedManifest;
  const prev = await loadManifest(fs, feedHash, feedUrl, title);
  if (prev.entries.length > 0) {
    void refresh(fs, feedHash, feedUrl, title, deps).catch(() => {
      // Background refresh failure is silent: the reader already has content
      // and the next open retries.
    });
    return buildFeedBookDoc(fs, feedHash, prev);
  }
  let manifest = prev;
  try {
    manifest = await refresh(fs, feedHash, feedUrl, title, deps);
  } catch {
    // First-open fetch failed: fall through to the (empty) local manifest so
    // the reader shows the book shell instead of crashing.
  }
  return buildFeedBookDoc(fs, feedHash, manifest);
}
