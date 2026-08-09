import { MIMETYPES, getFileExtFromMimeType } from '@/libs/document';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import { parseMediaType } from '@/app/opds/utils/opdsUtils';

/** Minimal shape shared by every OPDS link we need to identify a format from. */
export interface FormatLink {
  href?: string;
  type?: string;
  title?: string;
}

// When a feed omits the link `type` (or returns the uninformative
// application/octet-stream), fall back to inferring the format from the
// href extension and the human-readable link title. Order matters here:
// AZW3 must match before AZW, EPUB 3 before plain EPUB.
const INFERENCE_RULES: ReadonlyArray<{ mime: string; href: RegExp; title: RegExp }> = [
  { mime: 'application/epub+zip', href: /\.epub3(?:[?#]|$)/i, title: /\bepub\s*3\b|\bepub3\b/i },
  { mime: 'application/epub+zip', href: /\.epub(?:[?#]|$)/i, title: /\bepub\b/i },
  { mime: 'application/x-mobi8-ebook', href: /\.azw3(?:[?#]|$)/i, title: /\bazw\s*3\b|\bazw3\b/i },
  { mime: 'application/vnd.amazon.ebook', href: /\.azw(?:[?#]|$)/i, title: /\bazw\b/i },
  { mime: 'application/x-mobipocket-ebook', href: /\.mobi(?:[?#]|$)/i, title: /\bmobi\b/i },
  { mime: 'application/pdf', href: /\.pdf(?:[?#]|$)/i, title: /\bpdf\b/i },
  { mime: 'application/vnd.comicbook+zip', href: /\.cbz(?:[?#]|$)/i, title: /\bcbz\b/i },
  { mime: 'application/x-fictionbook+xml', href: /\.fb2(?:[?#]|$)/i, title: /\bfb2\b/i },
];

// Media types that positively identify a document Readest cannot import.
// `text/html` is deliberately absent -- the download handler opens it in a
// browser instead, so it stays a usable path.
const UNSUPPORTED_MIMETYPES = [
  'application/xhtml+xml',
  'application/vnd.adobe.adept+xml',
  'application/vnd.adobe.adept+xml;type=other',
];

// Ebook formats Readest cannot open, distinctive enough to match anywhere in a
// link's path or title. Calibre names the format in the URL
// (`/get/kfx/56/Calibre_Library`) and Calibre-Web puts it in the last segment
// (`/opds/download/123/lit/`), so a bare extension check is not enough.
const UNSUPPORTED_FORMAT_TOKENS = [
  'kfx',
  'azw4',
  'azw8',
  'lit',
  'lrf',
  'lrx',
  'djvu',
  'docx',
  'htmlz',
  'chm',
  'acsm',
  'ibooks',
  'odt',
  'rtf',
  'snb',
  'tcr',
  'pml',
];

// Formats whose token doubles as an ordinary word or path segment (`/opds/doc/`
// is a plausible endpoint). Matched only as a trailing file extension so they
// cannot condemn an unrelated URL.
const UNSUPPORTED_EXTS_ONLY = ['doc', 'rb', 'prc', 'pdb'];

const hrefPath = (href: string): string => href.split(/[?#]/)[0] || '';

const hrefExt = (href: string): string =>
  (hrefPath(href).match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const inferMediaType = (link: FormatLink): string => {
  const href = link.href ?? '';
  const title = link.title ?? '';
  for (const rule of INFERENCE_RULES) {
    if ((href && rule.href.test(href)) || (title && rule.title.test(title))) return rule.mime;
  }
  return '';
};

export const getEffectiveMediaType = (link: FormatLink): string => {
  const declared = parseMediaType(link.type)?.mediaType ?? '';
  // Treat octet-stream as "the server didn't actually tell us" -- most
  // OPDS feeds emit a real media type for known formats, and falling back
  // to href/title inference recovers from servers that don't.
  if (declared && declared !== 'application/octet-stream') return declared;
  return inferMediaType(link);
};

/**
 * The file extension this link would import as, or '' when the format cannot
 * be named. Used for button labels and menu entries.
 */
export const getFormatExt = (link: FormatLink): string => {
  const fromMediaType = getFileExtFromMimeType(getEffectiveMediaType(link));
  if (fromMediaType) return fromMediaType;
  const ext = hrefExt(link.href ?? '');
  return SUPPORTED_BOOK_EXTS.includes(ext) ? ext : '';
};

/**
 * Best human-readable name for the link's format, '' when it cannot be named.
 *
 * Unlike getFormatExt this also names formats Readest cannot import, so a menu
 * listing them stays distinguishable instead of repeating a generic label.
 */
export const getFormatName = (link: FormatLink): string => {
  const supported = getFormatExt(link);
  if (supported) return supported;
  const ext = hrefExt(link.href ?? '');
  if (ext) return ext;
  const tokens = [...tokenize(hrefPath(link.href ?? '')), ...tokenize(link.title ?? '')];
  return (
    tokens.find(
      (token) => UNSUPPORTED_FORMAT_TOKENS.includes(token) || UNSUPPORTED_EXTS_ONLY.includes(token),
    ) ?? ''
  );
};

/**
 * Whether Readest can import what this acquisition link points at.
 *
 * Deliberately asymmetric: a link is only reported `unsupported` when its
 * format is positively named as one we cannot open. Href extensions lie
 * (`/download/book.php?id=1` may well serve an EPUB), so anything we cannot
 * identify stays `unknown` and is kept.
 */
export const classifyAcquisitionLink = (
  link: FormatLink,
): 'supported' | 'unsupported' | 'unknown' => {
  const href = link.href ?? '';
  const declared = parseMediaType(link.type)?.mediaType ?? '';

  // The download handler opens HTML in a browser rather than importing it.
  if (declared === 'text/html') return 'supported';
  if (getFileExtFromMimeType(getEffectiveMediaType(link))) return 'supported';
  const ext = hrefExt(href);
  if (SUPPORTED_BOOK_EXTS.includes(ext)) return 'supported';

  if (declared && UNSUPPORTED_MIMETYPES.includes(declared)) return 'unsupported';
  if (UNSUPPORTED_EXTS_ONLY.includes(ext)) return 'unsupported';

  const tokens = [...tokenize(hrefPath(href)), ...tokenize(link.title ?? '')];
  if (tokens.some((token) => UNSUPPORTED_FORMAT_TOKENS.includes(token))) return 'unsupported';

  return 'unknown';
};

// Tier 0 (best) -> 4 (worst). See getFormatTier for the policy.
export type FormatTier = 0 | 1 | 2 | 3 | 4;

const isAdvancedEpub = (link: FormatLink, mediaType: string): boolean => {
  if (mediaType !== 'application/epub+zip') return false;
  const version = parseMediaType(link.type)?.parameters?.['version'];
  if (version && /^3(\.|$)/.test(version)) return true;
  const title = link.title?.toLowerCase() ?? '';
  if (title.includes('advanced')) return true;
  if (title.includes('epub3') || title.includes('epub 3')) return true;
  if (/\.epub3(?:[?#.]|$)/i.test(link.href ?? '')) return true;
  return false;
};

/**
 * Rank a link by how well Readest reads the format:
 * Advanced EPUB / EPUB3 > EPUB > MOBI/AZW/AZW3 > PDF/CBZ > other.
 */
export const getFormatTier = (link: FormatLink): FormatTier => {
  const mediaType = getEffectiveMediaType(link);
  if (MIMETYPES.EPUB.includes(mediaType)) {
    return isAdvancedEpub(link, mediaType) ? 0 : 1;
  }
  if (
    MIMETYPES.MOBI.includes(mediaType) ||
    MIMETYPES.AZW.includes(mediaType) ||
    MIMETYPES.AZW3.includes(mediaType)
  ) {
    return 2;
  }
  if (MIMETYPES.PDF.includes(mediaType) || MIMETYPES.CBZ.includes(mediaType)) {
    return 3;
  }
  return 4;
};

/** The link Readest would rather download, by format tier then feed order. */
export const pickPreferredLink = <T extends FormatLink>(links: T[]): T | undefined => {
  let best = links[0];
  if (!best) return undefined;
  let bestTier = getFormatTier(best);
  for (let i = 1; i < links.length && bestTier > 0; i++) {
    const tier = getFormatTier(links[i]!);
    if (tier < bestTier) {
      best = links[i]!;
      bestTier = tier;
    }
  }
  return best;
};
