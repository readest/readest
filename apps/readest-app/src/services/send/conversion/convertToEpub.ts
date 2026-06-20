import { Readability } from '@mozilla/readability';
import { detectLanguage } from '@/utils/lang';
// `mammoth` (DOCX → HTML) and `TxtToEpubConverter` are dynamically imported
// inside their respective `case` bodies in `convertToEpub`. They're heavy
// (≈500 KB combined) and only needed for the docx/txt input kinds — the
// browser extension imports `convertPageToEpub` and never reaches those
// branches, so dynamic imports let webpack code-split them out of the
// extension bundle entirely.
import { sanitizeHtml, sanitizeForParsing } from '@/utils/sanitize';
import { buildEpub } from './buildEpub';
import { bundleAssets } from './assetBundler';
import { generateCoverSvg } from './coverGenerator';
import { fetchAuthorImage, fetchBestFavicon } from './faviconFetcher';
import { findSiteRule, META_FALLBACK, type SiteRule } from './siteRules';
import { extractHeadings } from './toc';
import { ConversionError } from './types';
import type { ConvertibleMime, ConvertedBook, EpubChapter, EpubImage, TocEntry } from './types';

/** Discriminated input — the caller resolves the kind from the MIME type. */
export type ConvertInput =
  | { kind: 'docx'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'rtf'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'html'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'txt'; file: File }
  | { kind: 'article'; html: string; url: string }
  /** Self-contained page clip: like `article` but fetches every referenced
   *  image and embeds it in the EPUB. Only safe from a CORS-free context
   *  (Tauri webview, browser-extension content script). */
  | { kind: 'page'; html: string; url: string };

const MIME_TO_KIND: Record<ConvertibleMime, ConvertInput['kind']> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/plain': 'txt',
  'text/uri-list': 'article',
};

/** Whether a MIME type needs conversion before the normal import pipeline. */
export function isConvertible(mime: string): mime is ConvertibleMime {
  return mime in MIME_TO_KIND;
}

export function mimeToKind(mime: ConvertibleMime): ConvertInput['kind'] {
  return MIME_TO_KIND[mime];
}

// djb2 — a deterministic content hash so re-converting the same source yields
// the same EPUB identifier (and, with zeroed zip timestamps, identical bytes).
function stableIdentifier(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) >>> 0;
  }
  return `readest:${h.toString(16)}`;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
  return base.slice(0, 120);
}

/** Escape text content for inline insertion into HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Prepend the article title (as `<h1>`) and the byline (as `<p>`) to the
 * extracted body. Readability and the per-site rules give us title and
 * byline as separate fields — they're stripped out of the body content
 * during extraction, so the EPUB chapter would otherwise open with the
 * first body paragraph and the user wouldn't see who wrote it or what
 * it's called inside the book. The `<h1>` also becomes the top-level
 * navMap entry (via `extractHeadings`) so the TOC sidebar shows the
 * article title.
 */
function composeArticleContent(title: string, byline: string, body: string): string {
  const parts = [`<h1>${escapeHtml(title)}</h1>`];
  const trimmedByline = byline.trim();
  if (trimmedByline) {
    parts.push(`<p>${escapeHtml(trimmedByline)}</p>`);
  }
  parts.push(body);
  return parts.join('\n');
}

/** Assemble an EPUB from a single block of sanitized HTML (optionally with
 *  pre-fetched image resources to embed). Extracts an in-chapter heading
 *  TOC so the EPUB reader's sidebar shows the article's sections.
 *
 *  `identityKey` is the input the EPUB's `dc:identifier` is derived from.
 *  Callers choose what to feed it:
 *   - Page / article clips pass the canonical URL — the identifier then
 *     stays stable across edits of the same article, so a re-clip after
 *     the publisher tweaks a paragraph is recognised as the same work.
 *   - Local file inputs (docx / html / rtf) pass the sanitized chapter
 *     HTML — there's no URL, and content is the only stable handle. */
async function htmlToBook(
  rawHtml: string,
  title: string,
  author: string,
  identityKey: string,
  images: EpubImage[] = [],
  coverImage?: EpubImage,
): Promise<ConvertedBook> {
  // Assign stable ids to headings BEFORE sanitization so the strict
  // `sanitizeHtml` step (which now allows `id`) preserves them — those
  // ids are what `toc.ncx` links to.
  const { html: withIds, headings } = extractHeadings(rawHtml);
  const html = sanitizeHtml(withIds);
  const text = stripTags(html);
  if (!text) {
    throw new ConversionError('Document has no readable content', 'empty_input');
  }
  const language = detectLanguage(text.slice(0, 2048)) || 'en';
  const chapter: EpubChapter = { title, html };
  const toc: TocEntry[] | undefined = headings.length > 0 ? headings : undefined;
  if (toc) {
    console.log('[clip/toc] headings', {
      count: toc.length,
      levels: toc.map((h) => h.level),
    });
  }
  const blob = await buildEpub(
    [chapter],
    {
      title,
      author,
      language,
      identifier: stableIdentifier(identityKey),
      toc,
    },
    images,
    coverImage,
  );
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const file = new File([fileBytes], `${safeFileName(title)}.epub`, {
    type: 'application/epub+zip',
  });
  return { file, title, author };
}

interface RuleExtracted {
  content: string;
  title?: string;
  byline?: string;
}

/**
 * Apply a `SiteRule` to a full HTML document. Returns the article body
 * (innerHTML of the rule's `content` selector, with `strip` selectors
 * removed) plus the rule-extracted title and byline if present.
 *
 * Returns null when the content selector matches nothing — the caller falls
 * through to Readability so a stale rule never blocks extraction.
 */
function extractWithSiteRule(rawHtml: string, rule: SiteRule): RuleExtracted | null {
  const doc = new DOMParser().parseFromString(sanitizeForParsing(rawHtml), 'text/html');
  const contentEl = doc.querySelector(rule.content);
  if (!contentEl) return null;
  if (rule.strip?.length) {
    for (const sel of rule.strip) {
      for (const el of Array.from(contentEl.querySelectorAll(sel))) {
        el.parentNode?.removeChild(el);
      }
    }
  }
  // Rule selectors first, OpenGraph / Twitter Card meta tags second.
  // The meta-tag layer is what saves us when the site ships a frontend
  // redesign and our CSS hooks stop matching — every reputable publisher
  // keeps these tags stable for crawlers.
  const ruleTitle = rule.title ? (doc.querySelector(rule.title)?.textContent?.trim() ?? '') : '';
  const ruleByline = rule.byline ? (doc.querySelector(rule.byline)?.textContent?.trim() ?? '') : '';
  const title = ruleTitle || pickMetaContent(doc, META_FALLBACK.title) || '';
  const byline = ruleByline || pickMetaContent(doc, META_FALLBACK.byline) || '';
  return {
    content: contentEl.innerHTML,
    title: title || undefined,
    byline: byline || undefined,
  };
}

/**
 * Pick the article body without Readability — useful when its scoring trips
 * on a custom layout (e.g. an article body wrapped in a non-semantic div
 * that's revealed by JS, plus heavy page chrome that outscores it).
 *
 * Walks a prioritized selector list, picks the element with the most stripped
 * text, returns its innerHTML if it clears the quality floor.
 */
const ARTICLE_FALLBACK_SELECTORS = [
  '#js_content',
  'article',
  'main article',
  'main',
  '[role="article"]',
  '[itemprop="articleBody"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.post-body',
  '.markdown-body',
  '#content',
];

function extractArticleFallback(rawHtml: string, minTextChars: number): string | null {
  const doc = new DOMParser().parseFromString(sanitizeForParsing(rawHtml), 'text/html');
  let bestHtml = '';
  let bestText = 0;
  for (const selector of ARTICLE_FALLBACK_SELECTORS) {
    let els: NodeListOf<Element>;
    try {
      els = doc.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of Array.from(els)) {
      const text = stripTags(el.innerHTML);
      if (text.length > bestText) {
        bestText = text.length;
        bestHtml = el.innerHTML;
      }
    }
  }
  return bestText >= minTextChars ? bestHtml : null;
}

/**
 * Pick the site name for the synthetic cover. Tries Open Graph + Twitter
 * metadata first (most reliable; publishers set these for previews), falls
 * through to `<meta name="application-name">`, then degrades to the URL's
 * hostname stripped of the leading `www.` so e.g. `https://nytimes.com/foo`
 * yields "nytimes.com".
 */
/**
 * Walk a list of meta-tag selectors and return the first non-empty
 * `content` attribute. Used as the universal safety net when a per-site
 * rule's selector missed (site re-skinned and our CSS hooks no longer
 * match) — see `META_FALLBACK` in `siteRules.ts` for the canonical
 * lists per field.
 */
function pickMetaContent(doc: Document, selectors: readonly string[]): string | null {
  for (const sel of selectors) {
    const value = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Variant of `pickMetaContent` that resolves the picked URL against the
 * page URL — meta `og:image` values are often root-relative. Returns
 * null if nothing matched or the URL was unparseable.
 */
function resolveMetaImage(
  doc: Document,
  selectors: readonly string[],
  pageUrl: string,
): string | null {
  const raw = pickMetaContent(doc, selectors);
  if (!raw) return null;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractSiteName(doc: Document, pageUrl: string): string {
  const metaSelectors = [
    'meta[property="og:site_name"]',
    'meta[name="og:site_name"]',
    'meta[name="application-name"]',
    'meta[name="apple-mobile-web-app-title"]',
    'meta[property="twitter:site"]',
  ];
  for (const sel of metaSelectors) {
    const value = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Build a synthetic cover for a clipped article. Parses the page HTML once
 * to find the site name and favicon, then hands those off to
 * `generateCoverSvg`. Returns `undefined` only when the cover can't be
 * generated at all (e.g. the parser threw) — the favicon-fetch failing is
 * already handled by the cover generator's initial-letter fallback.
 */
async function buildArticleCover(
  pageHtml: string,
  pageUrl: string,
  title: string,
  author: string,
  rule: SiteRule | null,
): Promise<EpubImage | undefined> {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(sanitizeForParsing(pageHtml), 'text/html');
  } catch {
    return generateCoverSvg({ title, author, siteName: hostnameFallback(pageUrl) });
  }
  const siteName = extractSiteName(doc, pageUrl);

  // Prefer an author profile image (richer than a site-wide favicon).
  // Three layers, in order of richness:
  //   1. The site rule's `authorImage` selector — handcrafted, e.g. the
  //      WeChat account avatar or the X profile picture.
  //   2. OpenGraph / Twitter Card `og:image` — every publisher sets this
  //      for link unfurlers. Works when no rule matched, AND when the
  //      rule's selector missed because the site reshuffled its DOM.
  //   3. Favicon (handled below).
  // Site-rule miss is silent — `pickImageUrlFromSelector` returns null,
  // we fall through to the meta layer.
  let authorImage: { bytes: ArrayBuffer; mime: string } | undefined;
  const ruleImageUrl = rule?.authorImage
    ? pickImageUrlFromSelector(doc, rule.authorImage, pageUrl)
    : null;
  const metaImageUrl = ruleImageUrl
    ? null
    : resolveMetaImage(doc, META_FALLBACK.authorImage, pageUrl);
  const candidateImageUrl = ruleImageUrl || metaImageUrl;
  if (candidateImageUrl) {
    authorImage =
      (await fetchAuthorImage(candidateImageUrl, pageUrl).catch(() => null)) ?? undefined;
  }

  // Favicon is only fetched when we don't already have an author image —
  // saves a wasted HTTP round-trip on WeChat (and any other rule that
  // sets `authorImage`).
  const favicon = authorImage
    ? undefined
    : ((await fetchBestFavicon(doc, pageUrl).catch(() => null)) ?? undefined);

  return generateCoverSvg({ title, author, siteName, authorImage, favicon });
}

/** Walk the rule's `authorImage` selector list and return the first usable
 *  `src` or `data-src` URL, resolved against the page URL. */
function pickImageUrlFromSelector(doc: Document, selector: string, pageUrl: string): string | null {
  let els: NodeListOf<Element>;
  try {
    els = doc.querySelectorAll(selector);
  } catch {
    return null;
  }
  for (const el of Array.from(els)) {
    const raw =
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-original') ||
      el.getAttribute('href');
    if (!raw) continue;
    try {
      return new URL(raw, pageUrl).toString();
    } catch {
      // unparseable href — try the next element
    }
  }
  return null;
}

function hostnameFallback(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Pull a title from the document, in declining order of trust:
 *  OpenGraph / Twitter Card title → `<title>` → first `<h1>` → fallback. */
function extractHtmlTitle(html: string, fallback: string): string {
  try {
    const doc = new DOMParser().parseFromString(sanitizeForParsing(html), 'text/html');
    const meta = pickMetaContent(doc, META_FALLBACK.title);
    if (meta) return meta;
    const t = doc.querySelector('title')?.textContent?.trim();
    if (t) return t;
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    if (h1) return h1;
  } catch {
    /* fall through */
  }
  return fallback;
}

// Best-effort RTF → plain text: drop control words, unescape hex, strip groups.
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\r/g, '')
    .trim();
}

function baseName(fileName: string | undefined, fallback: string): string {
  if (!fileName) return fallback;
  return fileName.replace(/\.[^.]+$/, '').trim() || fallback;
}

/**
 * Convert a single web page (rendered HTML + URL) into a self-contained
 * EPUB — Readability extraction, per-site rule fast-paths, inlined images,
 * cover, headings-as-TOC. Shared between every "self-contained page clip"
 * caller:
 *
 *   - The Tauri desktop / mobile `/send` URL field (Tauri-only path).
 *   - The browser extension's service worker (`extensions/send-to-readest`).
 *   - Future: any other channel that captures the rendered DOM and wants
 *     the same EPUB out the other side.
 *
 * Centralising it here is the only way to guarantee that the same URL
 * produces byte-identical EPUBs across desktop, mobile, and extension —
 * which is what the import-time hash dedup relies on.
 *
 * Only valid from a CORS-free caller (Tauri webview or browser-extension
 * service worker with broad `host_permissions`). A plain web page hitting
 * this would fail on the image fetches.
 */
export async function convertPageToEpub(html: string, url: string): Promise<ConvertedBook> {
  console.log('[clip/page] input', {
    url,
    html_bytes: html.length,
  });

  // Fast path: per-site rule. Skips Readability entirely on sites we know
  // it mis-scores. Falls through if the rule's content selector matches
  // nothing or the extracted text is below the quality floor.
  const rule = findSiteRule(url);
  if (rule) {
    const ruleResult = extractWithSiteRule(html, rule);
    const ruleText = ruleResult ? stripTags(ruleResult.content) : '';
    console.log('[clip/page] site rule', {
      name: rule.name,
      matched: !!ruleResult,
      text_chars: ruleText.length,
      title: ruleResult?.title || null,
    });
    if (ruleResult && ruleText.length >= 400) {
      const title = ruleResult.title || extractHtmlTitle(html, url);
      const byline = ruleResult.byline || '';
      const bundle = await bundleAssets(ruleResult.content, url);
      const cover = await buildArticleCover(html, url, title, byline, rule);
      return htmlToBook(
        composeArticleContent(title, byline, bundle.html),
        title,
        byline,
        url,
        bundle.images,
        cover,
      );
    }
  }

  let parsed: { title?: string | null; content?: string | null; byline?: string | null } | null;
  try {
    const doc = new DOMParser().parseFromString(sanitizeForParsing(html), 'text/html');
    parsed = new Readability(doc).parse();
  } catch (err) {
    console.warn('[clip/page] readability threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ConversionError(`Could not extract article: ${String(err)}`, 'parse_failed');
  }
  if (!parsed?.content) {
    console.warn('[clip/page] readability returned no content');
    throw new ConversionError('No readable article found at the URL', 'parse_failed');
  }
  let articleHtml = parsed.content;
  let contentText = stripTags(articleHtml);
  console.log('[clip/page] readability', {
    title: parsed.title || null,
    byline: parsed.byline || null,
    content_chars: articleHtml.length,
    text_chars: contentText.length,
  });
  // Readability sometimes scores the wrong container on sites with custom
  // markup (e.g. an article body wrapped in a non-semantic div revealed
  // by JS). When the extracted text is tiny but the page HTML is
  // substantial, try a known-selector fallback before giving up.
  const QUALITY_FLOOR = 400;
  if (contentText.length < QUALITY_FLOOR && html.length > 50_000) {
    const fallback = extractArticleFallback(html, QUALITY_FLOOR);
    if (fallback) {
      articleHtml = fallback;
      contentText = stripTags(articleHtml);
      console.log('[clip/page] fallback selector picked up the article', {
        text_chars: contentText.length,
      });
    }
  }
  // Bot-detection screens, paywall stubs and "please enable JavaScript"
  // pages all slip past Readability AND the selector fallback with a
  // tiny scrap of text. Refuse to import them — never save a junk EPUB.
  if (contentText.length < QUALITY_FLOOR) {
    throw new ConversionError(
      'Could not read this page — it looks like a verification screen or a login wall. Open it in a browser first.',
      'parse_failed',
    );
  }
  // Readability gives us content reliably but byline misses on sites with
  // non-standard author markup (most SPAs, anything class-mangled). Meta
  // tags fill the gap — see `META_FALLBACK` in siteRules.ts.
  let metaDoc: Document | null = null;
  try {
    metaDoc = new DOMParser().parseFromString(sanitizeForParsing(html), 'text/html');
  } catch {
    /* meta fallback unavailable; keep going with what Readability gave us */
  }
  const title =
    parsed.title?.trim() ||
    (metaDoc ? pickMetaContent(metaDoc, META_FALLBACK.title) : null) ||
    extractHtmlTitle(html, url);
  const byline =
    parsed.byline?.trim() ||
    (metaDoc ? pickMetaContent(metaDoc, META_FALLBACK.byline) : null) ||
    '';
  const bundle = await bundleAssets(articleHtml, url);
  const cover = await buildArticleCover(html, url, title, byline, rule);
  return htmlToBook(
    composeArticleContent(title, byline, bundle.html),
    title,
    byline,
    url,
    bundle.images,
    cover,
  );
}

/**
 * Convert a document Readest cannot open natively into an EPUB. Runs entirely
 * client-side (browser or Tauri webview) — meant to be called inside a Web
 * Worker so the heavy parsing never blocks the UI thread.
 */
export async function convertToEpub(input: ConvertInput): Promise<ConvertedBook> {
  switch (input.kind) {
    case 'txt': {
      const { TxtToEpubConverter } = await import('@/utils/txt');
      const result = await new TxtToEpubConverter().convert({ file: input.file });
      return { file: result.file, title: result.bookTitle, author: '' };
    }
    case 'docx': {
      if (input.bytes.byteLength === 0) {
        throw new ConversionError('Empty .docx file', 'empty_input');
      }
      let html: string;
      try {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.convertToHtml({ arrayBuffer: input.bytes });
        html = result.value;
      } catch (err) {
        throw new ConversionError(`Could not parse .docx: ${String(err)}`, 'parse_failed');
      }
      // Local files have no URL — hash their content for the identifier.
      return htmlToBook(html, baseName(input.fileName, 'Document'), '', html);
    }
    case 'html': {
      const raw = new TextDecoder('utf-8').decode(input.bytes);
      const title = extractHtmlTitle(raw, baseName(input.fileName, 'Document'));
      return htmlToBook(raw, title, '', raw);
    }
    case 'rtf': {
      const rtf = new TextDecoder('utf-8').decode(input.bytes);
      const text = rtfToText(rtf);
      if (!text) {
        throw new ConversionError('Could not extract text from .rtf', 'parse_failed');
      }
      const html = text
        .split(/\n+/)
        .map((line) => `<p>${line.replace(/[<>&]/g, ' ').trim()}</p>`)
        .join('');
      return htmlToBook(html, baseName(input.fileName, 'Document'), '', html);
    }
    case 'article': {
      let parsed: { title?: string | null; content?: string | null; byline?: string | null } | null;
      try {
        const doc = new DOMParser().parseFromString(sanitizeForParsing(input.html), 'text/html');
        parsed = new Readability(doc).parse();
      } catch (err) {
        throw new ConversionError(`Could not extract article: ${String(err)}`, 'parse_failed');
      }
      if (!parsed?.content) {
        throw new ConversionError('No readable article found at the URL', 'parse_failed');
      }
      const title = parsed.title?.trim() || extractHtmlTitle(input.html, input.url);
      const byline = parsed.byline?.trim() || '';
      const cover = await buildArticleCover(
        input.html,
        input.url,
        title,
        byline,
        findSiteRule(input.url),
      );
      return htmlToBook(
        composeArticleContent(title, byline, parsed.content),
        title,
        byline,
        input.url,
        [],
        cover,
      );
    }
    case 'page': {
      return convertPageToEpub(input.html, input.url);
    }
    default: {
      throw new ConversionError(
        `Unsupported conversion input: ${(input as { kind: string }).kind}`,
        'unsupported_type',
      );
    }
  }
}
