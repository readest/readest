import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { formatAuthors, formatTitle, getCoverFilename } from './book';
import { getTextDirection } from './quoteCard';

// Cover art keeps its color across themes and metadata edits. Keep this palette
// and mapping stable so a synced book has the same cover on every device.
const FALLBACK_COVER_COLORS = [
  '#8d642e',
  '#77566e',
  '#a15543',
  '#386456',
  '#486780',
  '#356c70',
  '#935c6b',
  '#4d557b',
];
export const getFallbackCoverColor = (bookHash: string) => {
  let hash = 2166136261;
  for (let i = 0; i < bookHash.length; i++) {
    hash = Math.imul(hash ^ bookHash.charCodeAt(i), 16777619);
  }
  return FALLBACK_COVER_COLORS[(hash >>> 0) % FALLBACK_COVER_COLORS.length]!;
};

/**
 * Break text into at most `maxLines` lines no wider than `maxWidth`, at spaces
 * where it can and between characters where it must (CJK titles have no
 * spaces). Text that doesn't fit ends in an ellipsis.
 */
export const wrapCoverText = (
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (s: string) => number,
): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(text.trim().replace(/\s+/g, ' '))) {
    if (!line || measure(line + ch) <= maxWidth) {
      line += ch;
      continue;
    }
    const space = line.lastIndexOf(' ');
    if (ch !== ' ' && space > 0) {
      lines.push(line.slice(0, space));
      line = line.slice(space + 1) + ch;
    } else {
      lines.push(line.trimEnd());
      line = ch === ' ' ? '' : ch;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  let last = lines[maxLines - 1]!;
  while (last && measure(`${last}…`) > maxWidth) last = Array.from(last).slice(0, -1).join('');
  return [...lines.slice(0, maxLines - 1), `${last.trimEnd()}…`];
};

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 1600;

/**
 * Draw the library's placeholder cover (title and author on the book's color)
 * as a PNG, for books whose file has no cover image.
 */
export const renderFallbackCover = async (book: Book): Promise<ArrayBuffer> => {
  const canvas = document.createElement('canvas');
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  const foreground = '#fff8e7';
  const pad = COVER_WIDTH * 0.1;
  const left = COVER_WIDTH * 0.14;
  const textWidth = COVER_WIDTH - left - pad;
  const centerX = left + textWidth / 2;

  ctx.fillStyle = getFallbackCoverColor(book.hash);
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
  ctx.fillStyle = foreground;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(COVER_WIDTH * 0.04, 0, 3, COVER_HEIGHT);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let bottom = COVER_HEIGHT - pad;
  const author = formatAuthors(book.author || book.metadata?.author || '');
  if (author) {
    const size = 52;
    const lineHeight = size * 1.35;
    ctx.font = `500 ${size}px serif`;
    // Like the library's dir='auto': each block takes its own first strong letter.
    ctx.direction = getTextDirection(author);
    const lines = wrapCoverText(author, textWidth, 2, (s) => ctx.measureText(s).width);
    lines.forEach((text, i) => {
      ctx.fillText(text, centerX, bottom - (lines.length - i - 0.5) * lineHeight);
    });
    bottom -= lines.length * lineHeight + 32;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(centerX - 36, bottom - 2, 72, 2);
    ctx.globalAlpha = 1;
    bottom -= 48;
  }

  const size = 96;
  const lineHeight = size * 1.25;
  ctx.font = `500 ${size}px serif`;
  const title = formatTitle(book.title);
  ctx.direction = getTextDirection(title);
  const lines = wrapCoverText(title, textWidth, 4, (s) => ctx.measureText(s).width);
  const top = pad + (bottom - pad - lines.length * lineHeight) / 2;
  lines.forEach((text, i) => {
    ctx.fillText(text, centerX, top + (i + 0.5) * lineHeight);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to encode the fallback cover');
  return blob.arrayBuffer();
};

/**
 * True when the URL is fetchable by external services (Readwise, markdown
 * readers), i.e. not a local dev server or the Tauri asset protocol.
 */
export const isPublicImageUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

type CacheEntry = { url: string | null; expiresAt: number };
const publishedCoverCache = new Map<string, CacheEntry>();
// A published URL is content-addressed and durable, so a success is final for
// the session. Failures (offline, signed out, no cover) retry soon: the
// Readwise auto-sync calls this on every debounced push and must not turn an
// outage into an upload loop.
const FAILURE_TTL = 60 * 1000;

/**
 * Resolve a publicly accessible cover image URL for the book, or undefined
 * when none can be provided. A public `coverImageUrl` from the book metadata
 * wins; otherwise the local cover.png is published to the public bucket under
 * media/book_covers/<user-seg>/<coverHash>.png (served via assets.readest.com).
 */
export const getPublicCoverUrl = async (
  book: Book,
  appService: AppService | null,
): Promise<string | undefined> => {
  if (isPublicImageUrl(book.coverImageUrl)) return book.coverImageUrl;
  if (!appService) return undefined;

  const cached = publishedCoverCache.get(book.hash);
  if (cached && (cached.url || Date.now() < cached.expiresAt)) {
    return cached.url ?? undefined;
  }

  try {
    const fp = getCoverFilename(book);
    if (!(await appService.exists(fp, 'Books'))) {
      publishedCoverCache.set(book.hash, { url: null, expiresAt: Date.now() + FAILURE_TTL });
      return undefined;
    }
    // Books imported before coverHash existed fall back to the book hash,
    // which is just as stable per book (mirrors the Discord presence upload).
    const fileName = `${book.coverHash || book.hash}.png`;
    const url = await appService.uploadFileToCloud(
      fp,
      fileName,
      'Books',
      () => {},
      book.hash,
      false,
      'book_covers',
    );
    publishedCoverCache.set(book.hash, {
      url: url ?? null,
      expiresAt: Date.now() + FAILURE_TTL,
    });
    return url ?? undefined;
  } catch (error) {
    console.warn('Failed to publish book cover:', error);
    publishedCoverCache.set(book.hash, { url: null, expiresAt: Date.now() + FAILURE_TTL });
    return undefined;
  }
};
