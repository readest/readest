/**
 * Heuristic chapter-list extraction for web-novel table-of-contents pages.
 *
 * Parses the RAW page HTML with `DOMParser` — a detached document has no
 * browsing context, so nothing executes or loads; we only read strings out of
 * it. (`sanitizeForParsing` is deliberately NOT used here: DOMPurify's
 * defaults strip every `<meta>` tag, and `og:novel:*` metadata is the best
 * title/author signal on most novel sites.) Everything extracted is either
 * XML-escaped by `buildEpub` or run through `sanitizeHtml` before it reaches
 * a rendered page.
 */

export interface NovelChapterLink {
  title: string;
  url: string;
}

export interface NovelToc {
  title: string;
  author: string;
  coverUrl: string | null;
  chapters: NovelChapterLink[];
}

/** Fewer links than this is not a chapter list. */
const MIN_CHAPTER_LINKS = 5;

/**
 * The chosen container must hold at least this fraction of all chapter-like
 * links on the page. "Latest chapters" sidebars (a handful of links) fail the
 * bar; the full list passes; when the full list is split across siblings the
 * common parent wins instead.
 */
const CONTAINER_COVERAGE = 0.8;

const CHAPTER_TEXT_PATTERNS = [
  /第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章节回卷集部篇话]/,
  /\bchapter\s*[0-9]+/i,
  /\bch\.?\s*[0-9]+\b/i,
  /\bepisode\s*[0-9]+/i,
  /^[0-9]+\s*[、.．:：\-]/,
];

const isChapterText = (text: string): boolean => CHAPTER_TEXT_PATTERNS.some((p) => p.test(text));

/** Collapse digit runs so `/book/1/482.html` and `/book/1/7.html` compare equal. */
const hrefTemplate = (url: URL): string => url.origin + url.pathname.replace(/[0-9]+/g, '#');

interface LinkEntry {
  el: Element;
  text: string;
  url: URL;
  template: string;
}

const collectLinks = (doc: Document, pageUrl: string): LinkEntry[] => {
  const entries: LinkEntry[] = [];
  for (const el of doc.querySelectorAll('a[href]')) {
    const href = el.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    entries.push({ el, text, url, template: hrefTemplate(url) });
  }
  return entries;
};

const majorityTemplate = (entries: LinkEntry[]): { template: string; count: number } | null => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.template, (counts.get(entry.template) || 0) + 1);
  }
  let best: { template: string; count: number } | null = null;
  for (const [template, count] of counts) {
    if (!best || count > best.count) best = { template, count };
  }
  return best;
};

const elementDepth = (el: Element): number => {
  let depth = 0;
  for (let node = el.parentElement; node; node = node.parentElement) depth++;
  return depth;
};

/**
 * The deepest element containing at least `CONTAINER_COVERAGE` of the
 * chapter-like links — tight enough to exclude sidebars, wide enough to span
 * a list split across columns.
 */
const findChapterContainer = (candidates: LinkEntry[]): Element | null => {
  const counts = new Map<Element, number>();
  for (const { el } of candidates) {
    for (let node = el.parentElement; node; node = node.parentElement) {
      counts.set(node, (counts.get(node) || 0) + 1);
    }
  }
  const threshold = Math.max(MIN_CHAPTER_LINKS, Math.ceil(CONTAINER_COVERAGE * candidates.length));
  let container: Element | null = null;
  let containerDepth = -1;
  for (const [el, count] of counts) {
    if (count < threshold) continue;
    const depth = elementDepth(el);
    if (depth > containerDepth) {
      container = el;
      containerDepth = depth;
    }
  }
  return container;
};

/** First arabic chapter number in the title, else the last digit run in the
 *  URL path — used only to detect newest-first ordering. */
const chapterNumber = (entry: LinkEntry): number | null => {
  const numbered =
    entry.text.match(/(?:第|\bchapter|\bch\.?|\bepisode)\s*([0-9]+)/i) ||
    entry.text.match(/^([0-9]+)\s*[、.．:：\-]/);
  if (numbered?.[1]) return parseInt(numbered[1], 10);
  const pathDigits = entry.url.pathname.match(/([0-9]+)(?=[^0-9]*$)/);
  return pathDigits?.[1] ? parseInt(pathDigits[1], 10) : null;
};

/** Newest-first lists read backwards — reverse when numbers mostly descend. */
const orderChapters = (entries: LinkEntry[]): LinkEntry[] => {
  let descending = 0;
  let ascending = 0;
  let prev: number | null = null;
  for (const entry of entries) {
    const num = chapterNumber(entry);
    if (num !== null && prev !== null) {
      if (num < prev) descending++;
      else if (num > prev) ascending++;
    }
    if (num !== null) prev = num;
  }
  return descending > ascending ? entries.slice().reverse() : entries;
};

const metaContent = (doc: Document, selectors: string[]): string | null => {
  for (const selector of selectors) {
    const content = doc.querySelector(selector)?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return null;
};

/** "斗破苍穹最新章节_笔趣阁" → "斗破苍穹"; "Title - Read Online" → "Title". */
const cleanTitleTag = (raw: string): string => {
  const first = raw.split(/\s*[|_｜]\s*|\s+[-–—]\s+/)[0]?.trim() || raw.trim();
  return first.replace(/(最新章节列表|最新章节|章节列表|章节目录|全文阅读|无弹窗)+$/, '').trim();
};

const extractMetadata = (
  doc: Document,
  pageUrl: string,
): { title: string; author: string; coverUrl: string | null } => {
  const title =
    metaContent(doc, [
      'meta[property="og:novel:book_name"]',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ||
    cleanTitleTag(doc.querySelector('title')?.textContent || '') ||
    new URL(pageUrl).hostname;

  const author =
    metaContent(doc, [
      'meta[property="og:novel:author"]',
      'meta[property="books:author"]',
      'meta[name="author"]',
    ]) ||
    doc.body?.textContent?.match(/作者[:：]\s*([^\s，,。；;、]{1,32})/)?.[1] ||
    '';

  const rawCover = metaContent(doc, ['meta[property="og:image"]']);
  let coverUrl: string | null = null;
  if (rawCover) {
    try {
      const resolved = new URL(rawCover, pageUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        coverUrl = resolved.href;
      }
    } catch {
      /* unparseable cover URL — cover is optional */
    }
  }
  return { title, author, coverUrl };
};

/**
 * Parse a web-novel TOC page into title/author/cover metadata plus an ordered
 * chapter list. Returns `null` when the page doesn't look like a chapter list
 * (fewer than `MIN_CHAPTER_LINKS` chapter-like links).
 */
export function parseChapterList(html: string, pageUrl: string): NovelToc | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = collectLinks(doc, pageUrl);

  // Chapter-like links: recognizable chapter titles, or — when titles carry
  // no numbers ("Prologue", "The End") — the page's dominant href template.
  let candidates = links.filter((entry) => isChapterText(entry.text));
  if (candidates.length < MIN_CHAPTER_LINKS) {
    const majority = majorityTemplate(links);
    if (!majority || majority.count < MIN_CHAPTER_LINKS) return null;
    candidates = links.filter((entry) => entry.template === majority.template);
  }

  const container = findChapterContainer(candidates);
  if (!container) return null;

  // Keep the container's chapter-like links in document order; also admit
  // same-template links whose titles didn't match (a "Prologue" row inside a
  // numbered list). Dedup by URL — many lists repeat entries.
  const candidateSet = new Set(candidates);
  const template = majorityTemplate(candidates)?.template;
  const seen = new Set<string>();
  const contained: LinkEntry[] = [];
  for (const entry of links) {
    if (!container.contains(entry.el)) continue;
    if (!candidateSet.has(entry) && entry.template !== template) continue;
    if (seen.has(entry.url.href)) continue;
    seen.add(entry.url.href);
    contained.push(entry);
  }
  if (contained.length < MIN_CHAPTER_LINKS) return null;

  const ordered = orderChapters(contained);
  return {
    ...extractMetadata(doc, pageUrl),
    chapters: ordered.map((entry) => ({ title: entry.text, url: entry.url.href })),
  };
}
