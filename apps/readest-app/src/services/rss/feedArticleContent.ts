import { Readability } from '@mozilla/readability';
import { sanitizeHtml, sanitizeForParsing } from '@/utils/sanitize';
import type { FileSystem } from '@/types/system';
import type { RssFeedItem } from '@/types/rss';

export const MIN_FEED_CONTENT = 200;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolveArticleHtml(item: RssFeedItem): { html: string } | { needsPage: true } {
  if (item.contentHtml && item.contentHtml.length >= MIN_FEED_CONTENT) {
    return { html: item.contentHtml };
  }
  return { needsPage: true };
}

export function extractArticle(pageHtml: string, url: string): string {
  const doc = new DOMParser().parseFromString(sanitizeForParsing(pageHtml), 'text/html');
  if (doc.head && !doc.querySelector('base')) {
    const base = doc.createElement('base');
    base.setAttribute('href', url);
    doc.head.prepend(base);
  }
  const parsed = new Readability(doc).parse();
  if (!parsed?.content) throw new Error('No readable content');
  const parts = [`<h1>${escapeHtml(parsed.title ?? '')}</h1>`];
  if (parsed.byline) {
    parts.push(`<p>${escapeHtml(parsed.byline)}</p>`);
  }
  parts.push(parsed.content);
  return sanitizeHtml(parts.join('\n'));
}

export function articleCachePath(feedHash: string, id: string): string {
  return `${feedHash}/articles/${encodeURIComponent(id)}.html`;
}

export async function loadArticleCache(
  fs: FileSystem,
  feedHash: string,
  id: string,
): Promise<string | null> {
  const path = articleCachePath(feedHash, id);
  if (await fs.exists(path, 'Books')) {
    return (await fs.readFile(path, 'Books', 'text')) as string;
  }
  return null;
}

export async function saveArticleCache(
  fs: FileSystem,
  feedHash: string,
  id: string,
  html: string,
): Promise<void> {
  const path = articleCachePath(feedHash, id);
  if (!(await fs.exists(path, 'Books'))) {
    await fs.writeFile(path, 'Books', html);
  }
}
