import type { EpubImage } from './types';

/**
 * Synthetic cover image for clipped articles. Produces a 600×900 SVG
 * (2:3 — the standard book-cover aspect ratio Readest uses everywhere
 * else) with a vivid two-tone layout:
 *
 *  - colored top block (theme color hashed from the author, so the same
 *    public-account / writer always gets the same cover style);
 *  - large multi-line title in white, left-aligned in the upper block;
 *  - circular avatar centered on a wave divider — either the author's
 *    profile image (when one was found and fetched) or the site favicon;
 *  - lighter shade in the lower block;
 *  - author / byline at the bottom in dark type. Falls back to the
 *    site name when no byline was extracted.
 *
 * SVG is the right format here:
 *  - vector text + shapes stay crisp at every cover-thumb size;
 *  - no canvas-render step, so the page-clip pipeline stays main-thread-
 *    only and doesn't need OffscreenCanvas;
 *  - file size is well under 50 KB even with an embedded avatar;
 *  - foliate-js's epub reader (`packages/foliate-js/epub.js`) treats the
 *    cover blob as opaque bytes with `media-type` honored, so SVG works
 *    transparently with the `<meta name="cover">` route the EPUB
 *    builder uses.
 */

const VIEW_W = 600;
const VIEW_H = 900;
const TITLE_FONT_SIZE = 56;
const TITLE_LINE_HEIGHT = 72;
const TITLE_MAX_LINES = 5;
const TITLE_LEFT_PAD = 56;
const TITLE_RIGHT_PAD = 56;
const TITLE_TOP_Y = 100;
const AUTHOR_FONT_SIZE = 32;
const AUTHOR_Y = 830;

const WAVE_Y = 540;
const WAVE_DIP = 80;
const AVATAR_CX = VIEW_W / 2;
const AVATAR_CY = WAVE_Y + WAVE_DIP / 2;
const AVATAR_R = 60;
const AVATAR_RING_R = 66;

const FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export interface CoverInput {
  title: string;
  siteName: string;
  /** Byline / author for the article. Drives the theme color (so the same
   *  author always gets the same cover style) AND shows up as the bottom
   *  identifier. Falls back to siteName for both purposes when empty. */
  author?: string;
  /** Author profile image (e.g. WeChat public-account avatar). When
   *  provided, used as the circular cover avatar in place of the site
   *  favicon. */
  authorImage?: { bytes: ArrayBuffer; mime: string };
  /** Site favicon. Used as the avatar when no `authorImage` is provided. */
  favicon?: { bytes: ArrayBuffer; mime: string };
}

/**
 * Curated theme palette. Each entry is a (top, bottom) pair — the top
 * tone covers the upper block and the bottom tone the lower. The top
 * tones all have enough contrast against white title text; the bottom
 * tones are light enough that dark byline text stays legible.
 *
 * Ordering doesn't matter — the author hash picks an index uniformly.
 */
const PALETTE: readonly { top: string; bottom: string }[] = [
  { top: '#0EBAE3', bottom: '#E2F4F9' }, // cyan
  { top: '#3E89C7', bottom: '#E5EEF6' }, // blue
  { top: '#E27D5C', bottom: '#F7DDD0' }, // coral
  { top: '#5D9D7E', bottom: '#DCE8E1' }, // sage
  { top: '#9B6BAC', bottom: '#E5D9EB' }, // lavender
  { top: '#D8A55E', bottom: '#F4E5C9' }, // ochre
  { top: '#2A9D8F', bottom: '#D5EAE7' }, // teal
  { top: '#7E6C6C', bottom: '#E5DDDD' }, // mauve
  { top: '#3E5C76', bottom: '#D9DEE4' }, // navy
  { top: '#A36677', bottom: '#E8D6DA' }, // wine
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// `btoa` only takes a binary string; chunk to stay under the per-call argument
// limit on large images (some Apple touch icons / avatar PNGs run >100 KB).
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * djb2 over the author / site name. Same input → same theme color, so a
 * public account's covers are visually consistent across articles.
 */
export function pickTheme(key: string): { top: string; bottom: string } {
  const trimmed = key.trim();
  if (!trimmed) return PALETTE[0]!;
  let h = 5381;
  for (let i = 0; i < trimmed.length; i++) {
    h = ((h << 5) + h + trimmed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length]!;
}

/** Treat CJK chars (≈1 em wide) and Latin chars (≈0.55 em wide) separately
 *  when estimating how much title text fits on one line. Without this the
 *  heuristic either wraps Chinese articles way too tight or lets Latin
 *  titles overflow the cover. */
function isCjkChar(code: number): boolean {
  // CJK Unified Ideographs, Hiragana, Katakana, CJK Ext A, Hangul Syllables,
  // CJK Symbols and Punctuation (including 、 。「」『』 etc.), and the
  // Halfwidth/Fullwidth Forms block (full-width comma 「，」, colon 「：」,
  // and Latin glyphs). Width estimates fold them all into the ~1em column
  // CJK fonts actually render them at, so the line-wrap budget doesn't
  // under-count Chinese punctuation.
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

function estimateTextWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += isCjkChar(ch.codePointAt(0) ?? 0) ? 1.0 : 0.55;
  }
  return w;
}

/** Right-attaching CJK punctuation that should never start a line — glues
 *  to the preceding character/word. Covers Chinese, Japanese, and the
 *  ASCII members (commas/periods) that appear inline with CJK. */
const CJK_RIGHT_PUNCT = /[、。，．：；！？”’）］〕」』〉》】〗…,.:;!?)\]—]/;
/** Left-attaching CJK punctuation that should never end a line — glues
 *  to the following character/word. */
const CJK_LEFT_PUNCT = /[“‘（［〔「『〈《【〖([]/;

interface TitleChunk {
  /** The chunk's text — either a single CJK character (possibly with a
   *  trailing right-punctuation glyph) or a run of Latin characters. */
  text: string;
  /** Whitespace that appeared before this chunk in the input, preserved
   *  verbatim. Dropped when this chunk starts a fresh line. */
  sep: string;
}

/**
 * Pick the ICU locale that gives the best word-segmentation for a title.
 *
 * `Intl.Segmenter` uses dictionaries when available — Chinese, Japanese,
 * Korean, Thai, Khmer, Burmese, Lao all get word-level breaks instead of
 * character-by-character. With locale `undefined` ICU falls back to a
 * generic rule set, which for CJK ends up at character granularity. So we
 * sniff the dominant script and pass the matching locale; everything
 * else (Latin, Cyrillic, Arabic, Thai, …) gets the runtime default and
 * Intl handles it from there.
 */
function pickSegmenterLocale(text: string): string | undefined {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Hiragana / Katakana → Japanese dictionary
    if (code >= 0x3040 && code <= 0x30ff) return 'ja';
    // Hangul → Korean dictionary
    if (code >= 0xac00 && code <= 0xd7af) return 'ko';
    // CJK Unified Ideographs → Chinese dictionary
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df)
    ) {
      return 'zh';
    }
    // Thai → Thai dictionary
    if (code >= 0x0e00 && code <= 0x0e7f) return 'th';
    // Khmer → Khmer dictionary
    if (code >= 0x1780 && code <= 0x17ff) return 'km';
    // Burmese → Burmese dictionary
    if (code >= 0x1000 && code <= 0x109f) return 'my';
  }
  return undefined;
}

/**
 * Split a title into wrap-friendly chunks. Prefers `Intl.Segmenter` with
 * `granularity: 'word'` for language-aware breaks (handles Thai, Khmer,
 * Japanese, Chinese 2-character compounds, etc. via ICU's dictionaries);
 * falls back to a hand-rolled CJK-aware tokenizer when the runtime
 * doesn't have `Intl.Segmenter` (older WebViews).
 *
 * On top of the segmenter we apply:
 *  - right-attaching punctuation (commas, periods, colons, closing
 *    quotes) glues to the preceding chunk so a line never *starts* with
 *    one;
 *  - left-attaching punctuation (opening quotes / brackets) glues to the
 *    following chunk so a line never *ends* with a dangling opener.
 */
function tokenizeTitle(text: string): TitleChunk[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      return tokenizeWithSegmenter(text);
    } catch {
      // Some environments don't ship full ICU data — fall through.
    }
  }
  return tokenizeFallback(text);
}

function tokenizeWithSegmenter(text: string): TitleChunk[] {
  const locale = pickSegmenterLocale(text);
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  const chunks: TitleChunk[] = [];
  let pendingSep = '';
  let pendingLeftPunct = '';

  for (const { segment } of segmenter.segment(text)) {
    if (!segment) continue;
    if (/^\s+$/.test(segment)) {
      pendingSep = ' ';
      continue;
    }
    if (CJK_RIGHT_PUNCT.test(segment) && chunks.length > 0 && !pendingLeftPunct) {
      // Right-attaching punctuation — glue to the previous chunk so it
      // never lands at the start of a line.
      chunks[chunks.length - 1]!.text += segment;
      pendingSep = '';
      continue;
    }
    if (CJK_LEFT_PUNCT.test(segment)) {
      pendingLeftPunct += segment;
      continue;
    }
    chunks.push({ text: pendingLeftPunct + segment, sep: pendingSep });
    pendingLeftPunct = '';
    pendingSep = '';
  }
  if (pendingLeftPunct) {
    chunks.push({ text: pendingLeftPunct, sep: pendingSep });
  }
  return chunks;
}

/** Hand-rolled tokenizer for runtimes without `Intl.Segmenter`. Treats
 *  each CJK char as its own chunk (so line breaks can happen between any
 *  two ideographs) and Latin runs as single chunks. Less linguistically
 *  aware than the segmenter — CJK words like 拆解 may break mid-compound
 *  — but always available. */
function tokenizeFallback(text: string): TitleChunk[] {
  const chunks: TitleChunk[] = [];
  let pendingSep = '';
  let pendingLeftPunct = '';
  let latinBuf = '';

  const flushLatin = () => {
    if (latinBuf) {
      chunks.push({ text: pendingLeftPunct + latinBuf, sep: pendingSep });
      latinBuf = '';
      pendingLeftPunct = '';
      pendingSep = '';
    }
  };

  for (const ch of text) {
    if (/\s/.test(ch)) {
      flushLatin();
      pendingSep = pendingSep || ' ';
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (CJK_RIGHT_PUNCT.test(ch) && chunks.length > 0 && !latinBuf) {
      chunks[chunks.length - 1]!.text += ch;
      pendingSep = '';
      continue;
    }
    if (CJK_LEFT_PUNCT.test(ch)) {
      flushLatin();
      pendingLeftPunct += ch;
      continue;
    }
    if (isCjkChar(code)) {
      flushLatin();
      chunks.push({ text: pendingLeftPunct + ch, sep: pendingSep });
      pendingLeftPunct = '';
      pendingSep = '';
      continue;
    }
    latinBuf += ch;
  }
  flushLatin();
  if (pendingLeftPunct) {
    chunks.push({ text: pendingLeftPunct, sep: pendingSep });
  }
  return chunks;
}

/** Approximate em width of an inter-chunk space character. */
const SPACE_WIDTH_EM = 0.28;

/**
 * Wrap a title into at most `TITLE_MAX_LINES` lines using chunk-aware
 * breaking — Latin words stay whole, CJK breaks between any two chars,
 * and punctuation never lands alone at a line edge. If we run out of
 * lines, the last line is truncated with an ellipsis.
 */
function wrapTitle(title: string, maxEmPerLine: number): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const chunks = tokenizeTitle(trimmed);
  if (chunks.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  const flush = (): boolean => {
    if (!current) return true;
    if (lines.length >= TITLE_MAX_LINES) {
      // Out of lines — fold the rest of the title into a trailing
      // ellipsis on the last kept line so the start is still readable.
      const last = lines.pop() ?? '';
      lines.push(truncateLineWithEllipsis(last, maxEmPerLine));
      current = '';
      currentWidth = 0;
      return false;
    }
    lines.push(current);
    current = '';
    currentWidth = 0;
    return true;
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const sepWidth = chunk.sep && current ? SPACE_WIDTH_EM : 0;
    const chunkWidth = estimateTextWidthEm(chunk.text);

    if (!current) {
      // Starting a fresh line — drop any leading whitespace separator.
      current = chunk.text;
      currentWidth = chunkWidth;
    } else if (currentWidth + sepWidth + chunkWidth <= maxEmPerLine) {
      current += (chunk.sep ? ' ' : '') + chunk.text;
      currentWidth += sepWidth + chunkWidth;
    } else {
      if (!flush()) return lines;
      current = chunk.text;
      currentWidth = chunkWidth;
    }

    // A single chunk wider than the budget can only be a very long Latin
    // word (CJK chunks are at most one char + punctuation). Hard-wrap it
    // across multiple lines so the cover doesn't overflow.
    while (currentWidth > maxEmPerLine) {
      const split = hardSplit(current, maxEmPerLine);
      lines.push(split.head);
      if (lines.length >= TITLE_MAX_LINES) {
        const last = lines.pop() ?? '';
        lines.push(truncateLineWithEllipsis(last, maxEmPerLine));
        return lines;
      }
      current = split.tail;
      currentWidth = estimateTextWidthEm(current);
    }
  }
  if (current) lines.push(current);
  if (lines.length > TITLE_MAX_LINES) {
    const head = lines.slice(0, TITLE_MAX_LINES);
    const last = head.pop() ?? '';
    head.push(truncateLineWithEllipsis(last, maxEmPerLine));
    return head;
  }
  return lines;
}

function truncateLineWithEllipsis(line: string, maxEmPerLine: number): string {
  const ELLIPSIS = '…';
  const ellipsisWidth = estimateTextWidthEm(ELLIPSIS);
  let s = line;
  while (s.length > 0 && estimateTextWidthEm(s) + ellipsisWidth > maxEmPerLine) {
    s = s.slice(0, -1);
  }
  return `${s.trimEnd()}${ELLIPSIS}`;
}

function hardSplit(token: string, maxEmPerLine: number): { head: string; tail: string } {
  let head = '';
  let i = 0;
  while (i < token.length) {
    const next = head + token[i]!;
    if (estimateTextWidthEm(next) > maxEmPerLine) break;
    head = next;
    i++;
  }
  return { head: head || token.slice(0, 1), tail: token.slice(head.length || 1) };
}

/**
 * Generate a 600×900 SVG cover suitable for embedding in an EPUB as
 * `image/svg+xml`. The output is a single self-contained document — no
 * external font, no external image, no script.
 */
export function generateCoverSvg(input: CoverInput): EpubImage {
  const title = input.title?.trim() || 'Untitled';
  const siteName = input.siteName?.trim() || '';
  const author = input.author?.trim() || '';

  // The hash key drives theme stability — same author → same colors. When
  // no author was parsed we fall back to the site name so per-site clips
  // still get a stable look.
  const theme = pickTheme(author || siteName);

  // Title font width budget — viewport - L pad - R pad.
  const titleBudgetPx = VIEW_W - TITLE_LEFT_PAD - TITLE_RIGHT_PAD;
  const maxEmPerLine = titleBudgetPx / TITLE_FONT_SIZE;
  const titleLines = wrapTitle(title, maxEmPerLine);

  const titleTspans = titleLines
    .map((line, i) => {
      const y = TITLE_TOP_Y + TITLE_FONT_SIZE + i * TITLE_LINE_HEIGHT;
      return `<text x="${TITLE_LEFT_PAD}" y="${y}" text-anchor="start" fill="#ffffff" font-family="${FAMILY}" font-size="${TITLE_FONT_SIZE}" font-weight="700" letter-spacing="0.5">${escapeXml(line)}</text>`;
    })
    .join('\n  ');

  // Wave divider: starts flat at the left edge, dips down through the
  // center where the avatar sits, returns flat at the right edge. The
  // colored top block "owns" the wave so its top half hugs the avatar.
  const wavePath = `M 0 ${WAVE_Y} C 120 ${WAVE_Y} 180 ${WAVE_Y + WAVE_DIP} ${VIEW_W / 2} ${WAVE_Y + WAVE_DIP} C ${VIEW_W - 180} ${WAVE_Y + WAVE_DIP} ${VIEW_W - 120} ${WAVE_Y} ${VIEW_W} ${WAVE_Y} L ${VIEW_W} 0 L 0 0 Z`;

  // Avatar: profile image if we have one, else favicon, else an initial
  // tile. Always rendered as a circle with a white ring.
  const avatarImage = input.authorImage ?? input.favicon ?? null;
  const avatarContent = avatarImage
    ? renderAvatarImage(avatarImage)
    : renderInitialAvatar(author || siteName);

  // Bottom block text: author when present, else site name. Truncated to
  // a single line so the bottom never overflows. Dark theme color so it
  // reads on the light bottom shade.
  const bottomText = author || siteName;
  const bottomBudgetEm = (VIEW_W - 80) / AUTHOR_FONT_SIZE;
  const bottomLine = bottomText ? fitOneLine(bottomText, bottomBudgetEm) : '';
  const bottomTextEl = bottomLine
    ? `<text x="${VIEW_W / 2}" y="${AUTHOR_Y}" text-anchor="middle" fill="#2b2b2b" font-family="${FAMILY}" font-size="${AUTHOR_FONT_SIZE}" font-weight="600" letter-spacing="1">${escapeXml(bottomLine)}</text>`
    : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" preserveAspectRatio="xMidYMid meet">
  <defs>
    <clipPath id="avatar-clip">
      <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="${AVATAR_R}"/>
    </clipPath>
  </defs>
  <rect width="${VIEW_W}" height="${VIEW_H}" fill="${theme.bottom}"/>
  <path d="${wavePath}" fill="${theme.top}"/>
  ${titleTspans}
  <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="${AVATAR_RING_R}" fill="#ffffff"/>
  ${avatarContent}
  ${bottomTextEl}
</svg>`;

  const bytes = new TextEncoder().encode(svg).buffer as ArrayBuffer;
  return { path: 'cover.svg', bytes, mime: 'image/svg+xml' };
}

function renderAvatarImage(image: { bytes: ArrayBuffer; mime: string }): string {
  const base64 = bytesToBase64(image.bytes);
  const mime = image.mime || 'image/png';
  const x = AVATAR_CX - AVATAR_R;
  const y = AVATAR_CY - AVATAR_R;
  const size = AVATAR_R * 2;
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)" href="data:${escapeXml(mime)};base64,${base64}"/>`;
}

function renderInitialAvatar(label: string): string {
  // First non-whitespace character — handles "Site Name" → "S", "机器之心" → "机".
  const first = label.replace(/\s+/g, '').slice(0, 1) || '·';
  const cy = AVATAR_CY + AVATAR_R * 0.18;
  return `<circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="${AVATAR_R}" fill="#eef0f2"/>
  <text x="${AVATAR_CX}" y="${cy}" text-anchor="middle" fill="#3a3a3a" font-family="${FAMILY}" font-size="${(AVATAR_R * 1.1).toFixed(0)}" font-weight="700">${escapeXml(first)}</text>`;
}

/** Truncate a single line to fit a width budget, appending an ellipsis. */
function fitOneLine(text: string, maxEmPerLine: number): string {
  const t = text.trim();
  if (!t || estimateTextWidthEm(t) <= maxEmPerLine) return t;
  return truncateLineWithEllipsis(t, maxEmPerLine);
}
