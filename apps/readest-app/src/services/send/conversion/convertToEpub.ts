import mammoth from 'mammoth';
import { Readability } from '@mozilla/readability';
import { TxtToEpubConverter } from '@/utils/txt';
import { detectLanguage } from '@/utils/lang';
import { sanitizeHtml, sanitizeForParsing } from './sanitizeHtml';
import { buildEpub } from './buildEpub';
import { bundleAssets } from './assetBundler';
import { findSiteRule, type SiteRule } from './siteRules';
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
  return `send-to-readest:${h.toString(16)}`;
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
 *  TOC so the EPUB reader's sidebar shows the article's sections. */
async function htmlToBook(
  rawHtml: string,
  title: string,
  author: string,
  images: EpubImage[] = [],
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
      identifier: stableIdentifier(html),
      toc,
    },
    images,
  );
  const file = new File([blob], `${safeFileName(title)}.epub`, {
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
  const ruleTitle = rule.title ? (doc.querySelector(rule.title)?.textContent?.trim() ?? '') : '';
  const ruleByline = rule.byline ? (doc.querySelector(rule.byline)?.textContent?.trim() ?? '') : '';
  return {
    content: contentEl.innerHTML,
    title: ruleTitle || undefined,
    byline: ruleByline || undefined,
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

/** Pull `<title>` / first `<h1>` out of a full HTML document. */
function extractHtmlTitle(html: string, fallback: string): string {
  try {
    const doc = new DOMParser().parseFromString(sanitizeForParsing(html), 'text/html');
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
 * Convert a document Readest cannot open natively into an EPUB. Runs entirely
 * client-side (browser or Tauri webview) — meant to be called inside a Web
 * Worker so the heavy parsing never blocks the UI thread.
 */
export async function convertToEpub(input: ConvertInput): Promise<ConvertedBook> {
  switch (input.kind) {
    case 'txt': {
      const result = await new TxtToEpubConverter().convert({ file: input.file });
      return { file: result.file, title: result.bookTitle, author: '' };
    }
    case 'docx': {
      if (input.bytes.byteLength === 0) {
        throw new ConversionError('Empty .docx file', 'empty_input');
      }
      let html: string;
      try {
        const result = await mammoth.convertToHtml({ arrayBuffer: input.bytes });
        html = result.value;
      } catch (err) {
        throw new ConversionError(`Could not parse .docx: ${String(err)}`, 'parse_failed');
      }
      return htmlToBook(html, baseName(input.fileName, 'Document'), '');
    }
    case 'html': {
      const raw = new TextDecoder('utf-8').decode(input.bytes);
      const title = extractHtmlTitle(raw, baseName(input.fileName, 'Document'));
      return htmlToBook(raw, title, '');
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
      return htmlToBook(html, baseName(input.fileName, 'Document'), '');
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
      return htmlToBook(composeArticleContent(title, byline, parsed.content), title, byline);
    }
    case 'page': {
      // Same as `article`, but fetch every referenced image and inline it so
      // the EPUB is fully offline-readable. Only valid from a CORS-free
      // caller (Tauri webview or extension content script).
      console.log('[clip/page] input', {
        url: input.url,
        html_bytes: input.html.length,
      });

      // Fast path: per-site rule. Skips Readability entirely on sites we
      // know it mis-scores. Falls through if the rule's content selector
      // matches nothing or the extracted text is below the floor.
      const rule = findSiteRule(input.url);
      if (rule) {
        const ruleResult = extractWithSiteRule(input.html, rule);
        const ruleText = ruleResult ? stripTags(ruleResult.content) : '';
        console.log('[clip/page] site rule', {
          name: rule.name,
          matched: !!ruleResult,
          text_chars: ruleText.length,
          title: ruleResult?.title || null,
        });
        if (ruleResult && ruleText.length >= 400) {
          const title = ruleResult.title || extractHtmlTitle(input.html, input.url);
          const byline = ruleResult.byline || '';
          const bundle = await bundleAssets(ruleResult.content, input.url);
          return htmlToBook(
            composeArticleContent(title, byline, bundle.html),
            title,
            byline,
            bundle.images,
          );
        }
      }

      let parsed: { title?: string | null; content?: string | null; byline?: string | null } | null;
      try {
        const doc = new DOMParser().parseFromString(sanitizeForParsing(input.html), 'text/html');
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
      if (contentText.length < QUALITY_FLOOR && input.html.length > 50_000) {
        const fallback = extractArticleFallback(input.html, QUALITY_FLOOR);
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
          'Could not read this page — it looks like a verification screen or a login wall. Open it in a browser first, or wait for the upcoming browser extension.',
          'parse_failed',
        );
      }
      const title = parsed.title?.trim() || extractHtmlTitle(input.html, input.url);
      const byline = parsed.byline?.trim() || '';
      const bundle = await bundleAssets(articleHtml, input.url);
      return htmlToBook(
        composeArticleContent(title, byline, bundle.html),
        title,
        byline,
        bundle.images,
      );
    }
    default: {
      throw new ConversionError(
        `Unsupported conversion input: ${(input as { kind: string }).kind}`,
        'unsupported_type',
      );
    }
  }
}
