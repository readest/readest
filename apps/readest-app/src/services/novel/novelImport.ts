import { Readability } from '@mozilla/readability';
import { sanitizeHtml, sanitizeForParsing } from '@/utils/sanitize';
import { detectLanguage } from '@/utils/lang';
import { stubTranslation as _ } from '@/utils/misc';
import { buildEpub } from '@/services/send/conversion/buildEpub';
import { generateCoverSvg } from '@/services/send/conversion/coverGenerator';
import { fetchAuthorImage } from '@/services/send/conversion/faviconFetcher';
import {
  safeFileName,
  stableIdentifier,
  stripTags,
} from '@/services/send/conversion/convertToEpub';
import { isLikelyBotBlock, pageNavigateHeaders } from '@/services/send/conversion/httpHeaders';
import { ConversionError } from '@/services/send/conversion/types';
import type { ConvertedBook, EpubChapter, EpubImage } from '@/services/send/conversion/types';
import { parseChapterList } from './chapterList';
import type { NovelToc } from './chapterList';

/** Hard cap — a runaway TOC heuristic must not schedule tens of thousands of
 *  requests. Real novels top out around this size. */
export const MAX_NOVEL_CHAPTERS = 2000;

const PAGE_FETCH_TIMEOUT_MS = 15_000;
const CHAPTER_CONCURRENCY = 4;
/** Below this many characters the "chapter" is a JS-challenge stub or an
 *  extraction miss, not prose. */
const CHAPTER_QUALITY_FLOOR = 100;

export interface FetchedPage {
  html: string;
  finalUrl: string;
}

export type FetchPage = (url: string, signal?: AbortSignal) => Promise<FetchedPage>;
export type FetchCover = (
  url: string,
  referer: string,
) => Promise<{ bytes: ArrayBuffer; mime: string } | null>;

export interface NovelBook extends ConvertedBook {
  chapterCount: number;
  failures: number;
}

export interface NovelDownloadOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  fetchPage?: FetchPage;
  fetchCover?: FetchCover;
  /** Runtime translator for text baked into the EPUB (failure placeholders).
   *  Strings are declared with `stubTranslation` so the i18n scanner sees
   *  them; pass the app's `_` to localize. */
  translate?: (key: string) => string;
}

const abortError = () => new DOMException('novel import cancelled', 'AbortError');

export function isNovelImportCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Fetch a page over the Tauri HTTP client with browser-shaped headers.
 * Novel-site chapter pages are server-rendered, so plain HTTP is enough —
 * spawning a `clip_url` webview per chapter would never scale to hundreds
 * of requests.
 */
const defaultFetchPage: FetchPage = async (url, signal) => {
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PAGE_FETCH_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await tauriFetch(url, {
      headers: pageNavigateHeaders(),
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new ConversionError(
        isLikelyBotBlock(res.status)
          ? `The site blocked the request (HTTP ${res.status}). Try again later.`
          : `Could not fetch the page (HTTP ${res.status}).`,
        'fetch_failed',
      );
    }
    return { html: await res.text(), finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

const defaultFetchCover: FetchCover = (url, referer) =>
  fetchAuthorImage(url, referer).catch(() => null);

export interface FetchNovelTocOptions {
  fetchPage?: FetchPage;
  signal?: AbortSignal;
}

/** Fetch a TOC page and parse it into a capped, ordered chapter list. */
export async function fetchNovelToc(
  url: string,
  options: FetchNovelTocOptions = {},
): Promise<NovelToc> {
  const fetchPage = options.fetchPage ?? defaultFetchPage;
  const { html, finalUrl } = await fetchPage(url, options.signal);
  const toc = parseChapterList(html, finalUrl);
  if (!toc) {
    throw new ConversionError(
      'No chapter list found on this page. Open the novel’s table-of-contents page and try again.',
      'parse_failed',
    );
  }
  return { ...toc, chapters: toc.chapters.slice(0, MAX_NOVEL_CHAPTERS) };
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Selectors novel sites use for the chapter body when Readability mis-scores
// the page (bare `<div id="content">` full of `<br>`-separated text lines is
// common and scores poorly).
const CHAPTER_CONTENT_SELECTORS = [
  '#chaptercontent',
  '#chapter-content',
  '.chapter-content',
  '#booktxt',
  '#content',
  '.read-content',
  'article',
  '.content',
];

const normalizeTitle = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Extract one chapter's prose. Readability first, known content selectors as
 * fallback; images are stripped (a novel EPUB stays self-contained without an
 * unbounded asset download) and the TOC's chapter title is prepended as the
 * canonical heading.
 */
export function extractChapterHtml(pageHtml: string, chapterTitle: string): string | null {
  let content: string | null = null;
  try {
    // Readability mutates the document it scores, so give it its own parse.
    const doc = new DOMParser().parseFromString(sanitizeForParsing(pageHtml), 'text/html');
    content = new Readability(doc).parse()?.content ?? null;
  } catch {
    content = null;
  }
  if (!content || stripTags(content).length < CHAPTER_QUALITY_FLOOR) {
    const doc = new DOMParser().parseFromString(sanitizeForParsing(pageHtml), 'text/html');
    for (const selector of CHAPTER_CONTENT_SELECTORS) {
      const el = doc.querySelector(selector);
      if (el && stripTags(el.innerHTML).length >= CHAPTER_QUALITY_FLOOR) {
        content = el.innerHTML;
        break;
      }
    }
  }
  if (!content || stripTags(content).length < CHAPTER_QUALITY_FLOOR) return null;

  const body = new DOMParser().parseFromString(content, 'text/html').body;
  body.querySelectorAll('img, picture, figure, svg, video, audio').forEach((el) => el.remove());
  // Drop a leading heading that duplicates the TOC title — the canonical
  // heading is prepended below.
  const heading = body.querySelector('h1, h2, h3');
  if (heading && normalizeTitle(heading.textContent || '') === normalizeTitle(chapterTitle)) {
    heading.remove();
  }
  return `<h1>${escapeHtml(chapterTitle)}</h1>\n${sanitizeHtml(body.innerHTML)}`;
}

/**
 * Download every chapter of a parsed novel TOC and assemble a single EPUB.
 * Individual chapter failures become placeholder pages (with the source URL)
 * rather than aborting a long download; `failures` reports the count.
 */
export async function downloadNovel(
  toc: NovelToc,
  sourceUrl: string,
  options: NovelDownloadOptions = {},
): Promise<NovelBook> {
  const fetchPage = options.fetchPage ?? defaultFetchPage;
  const fetchCover = options.fetchCover ?? defaultFetchCover;
  const translate = options.translate ?? ((key: string) => key);
  const { onProgress, signal } = options;

  const chapters = toc.chapters.slice(0, MAX_NOVEL_CHAPTERS);
  const total = chapters.length;
  const results: EpubChapter[] = new Array(total);
  let failures = 0;
  let done = 0;
  let cursor = 0;

  const fetchChapter = async (url: string): Promise<FetchedPage> => {
    try {
      return await fetchPage(url, signal);
    } catch (err) {
      // One retry on transient network errors; user cancellation propagates.
      if (isNovelImportCancelled(err) || signal?.aborted) throw abortError();
      return await fetchPage(url, signal);
    }
  };

  const worker = async () => {
    while (true) {
      if (signal?.aborted) throw abortError();
      const index = cursor++;
      if (index >= total) return;
      const link = chapters[index]!;
      let html: string | null = null;
      try {
        const page = await fetchChapter(link.url);
        html = extractChapterHtml(page.html, link.title);
      } catch (err) {
        if (isNovelImportCancelled(err) || signal?.aborted) throw abortError();
        html = null;
      }
      if (html === null) {
        failures++;
        html =
          `<h1>${escapeHtml(link.title)}</h1>` +
          `<p>${escapeHtml(translate(_('This chapter could not be downloaded.')))}</p>` +
          `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></p>`;
      }
      results[index] = { title: link.title, html };
      done++;
      onProgress?.(done, total);
      // Extraction is main-thread CPU work (Tauri IPC can't run in a Worker) —
      // yield between chapters so a long download doesn't freeze the UI.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHAPTER_CONCURRENCY, total) }, worker));

  let cover: EpubImage | undefined;
  if (toc.coverUrl) {
    const fetched = await fetchCover(toc.coverUrl, sourceUrl);
    if (fetched) {
      const ext = fetched.mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      cover = { path: `cover.${ext}`, bytes: fetched.bytes, mime: fetched.mime };
    }
  }
  if (!cover) {
    const siteName = (() => {
      try {
        return new URL(sourceUrl).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    cover = generateCoverSvg({ title: toc.title, author: toc.author, siteName });
  }

  // Sample prose (not placeholder text) for language detection.
  let sample = '';
  for (const chapter of results) {
    sample += ` ${stripTags(chapter.html)}`;
    if (sample.length >= 2048) break;
  }
  const language = detectLanguage(`${toc.title} ${sample}`.slice(0, 2048)) || 'en';

  const blob = await buildEpub(
    results,
    {
      title: toc.title,
      author: toc.author,
      language,
      identifier: stableIdentifier(sourceUrl),
    },
    [],
    cover,
  );
  const file = new File([blob], `${safeFileName(toc.title)}.epub`, {
    type: 'application/epub+zip',
  });
  return { file, title: toc.title, author: toc.author, chapterCount: total, failures };
}
