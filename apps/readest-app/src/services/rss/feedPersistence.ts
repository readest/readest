import { safeLoadJSON, safeSaveJSON } from '@/services/persistence';
import type { FileSystem } from '@/types/system';
import type { RssFeed } from '@/types/rss';

const FEEDS_FILE = 'feeds.json';

export async function loadFeeds(fs: FileSystem): Promise<RssFeed[]> {
  const data = await safeLoadJSON<{ feeds: RssFeed[] }>(fs, FEEDS_FILE, 'Settings', { feeds: [] });
  return Array.isArray(data.feeds) ? data.feeds : [];
}

export async function saveFeeds(fs: FileSystem, feeds: RssFeed[]): Promise<void> {
  await safeSaveJSON(fs, FEEDS_FILE, 'Settings', { feeds });
}
