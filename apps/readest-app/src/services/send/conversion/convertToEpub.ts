import mammoth from 'mammoth';
import { Readability } from '@mozilla/readability';
import { TxtToEpubConverter } from '@/utils/txt';
import { detectLanguage } from '@/utils/lang';
import { sanitizeHtml, sanitizeForParsing } from './sanitizeHtml';
import { buildEpub } from './buildEpub';
import { ConversionError } from './types';
import type { ConvertibleMime, ConvertedBook, EpubChapter } from './types';

/** Discriminated input — the caller resolves the kind from the MIME type. */
export type ConvertInput =
  | { kind: 'docx'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'rtf'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'html'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'txt'; file: File }
  | { kind: 'article'; html: string; url: string };

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

/** Assemble an EPUB from a single block of sanitized HTML. */
async function htmlToBook(rawHtml: string, title: string, author: string): Promise<ConvertedBook> {
  const html = sanitizeHtml(rawHtml);
  const text = stripTags(html);
  if (!text) {
    throw new ConversionError('Document has no readable content', 'empty_input');
  }
  const language = detectLanguage(text.slice(0, 2048)) || 'en';
  const chapter: EpubChapter = { title, html };
  const blob = await buildEpub([chapter], {
    title,
    author,
    language,
    identifier: stableIdentifier(html),
  });
  const file = new File([blob], `${safeFileName(title)}.epub`, {
    type: 'application/epub+zip',
  });
  return { file, title, author };
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
      return htmlToBook(parsed.content, title, parsed.byline?.trim() || '');
    }
    default: {
      throw new ConversionError(
        `Unsupported conversion input: ${(input as { kind: string }).kind}`,
        'unsupported_type',
      );
    }
  }
}
