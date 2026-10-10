// Paints a quote card layout onto a canvas (#5830). The preview and the
// exported PNG both come from here, so they cannot drift apart. Canvas 2D
// rather than a DOM snapshot: SVG foreignObject rasterizing is unreliable in
// WebKit, and a canvas gives the same pixels on every webview.
import {
  type QuoteCardColors,
  type QuoteCardRun,
  type QuoteCardLayoutId,
  type QuoteCardShape,
} from './quoteCard';
import { encode } from 'uqr';
import { QUOTE_CARD_LAYOUTS } from './quoteCardLayouts';

export interface QuoteCardContent {
  text: string;
  title?: string;
  author?: string;
  chapter?: string;
  date?: string;
  // Must be same-origin (e.g. a blob URL) or the canvas can't be exported.
  coverUrl?: string;
  // Link to the passage, drawn as a QR code when the style asks for one.
  qrUrl?: string;
  // The quote as styled runs (bold / italic); `text` is used when absent.
  runs?: QuoteCardRun[];
  // The signature beside the QR code, e.g. a translated "via Readest".
  brand?: string;
}

export interface QuoteCardStyle {
  layout: QuoteCardLayoutId;
  colors: QuoteCardColors;
  // A CSS font-family list, normally the reader's serif or sans-serif chain.
  fontFamily: string;
  shape: QuoteCardShape;
  showBookInfo: boolean;
  showQr: boolean;
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// One cover at a time: re-renders of a card reuse it, the next card replaces it.
let coverImage: { src: string; image: Promise<HTMLImageElement | null> } | null = null;

const loadCover = (src: string) => {
  if (coverImage?.src !== src) coverImage = { src, image: loadImage(src) };
  return coverImage.image;
};

// Web fonts only paint on a canvas once loaded; the sample text pulls in the
// unicode-range subsets the quote needs. Offline, the system fallback draws.
const loadFonts = async (family: string, sample: string) => {
  try {
    await Promise.all([
      document.fonts.load(`400 40px ${family}`, sample),
      document.fonts.load(`600 40px ${family}`, sample),
      document.fonts.load(`italic 400 40px ${family}`, sample),
      document.fonts.load(`700 40px ${family}`, sample),
      document.fonts.load(`italic 700 40px ${family}`, sample),
    ]);
  } catch (error) {
    console.warn('Quote card fonts failed to load:', error);
  }
};

const roundedPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

// Modules in the card's text color on a faint tile of the same color, with the
// standard four-module quiet zone, so the code belongs to the card. Module
// edges snap to whole pixels: anti-aliased seams between neighbouring modules
// make the code harder to read.
const drawQr = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
) => {
  const { data, size: count } = encode(value, { ecc: 'L', border: 4 });
  const m = size / count;
  const px = (i: number, origin: number) => Math.round(origin + i * m);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.06;
  roundedPath(ctx, x, y, size, size, size * 0.06);
  ctx.fill();
  ctx.globalAlpha = 1;
  data.forEach((row, r) => {
    for (let c = 0; c < count; c++) {
      if (!row[c]) continue;
      let end = c;
      while (end + 1 < count && row[end + 1]) end++;
      ctx.fillRect(px(c, x), px(r, y), px(end + 1, x) - px(c, x), px(r + 1, y) - px(r, y));
      c = end;
    }
  });
};

// Fill the box like CSS object-fit: cover, cropping the image's overflow.
const drawCover = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
};

export const renderQuoteCard = async (
  canvas: HTMLCanvasElement,
  content: QuoteCardContent,
  style: QuoteCardStyle,
): Promise<{ truncated: boolean }> => {
  const [cover] = await Promise.all([
    content.coverUrl && style.showBookInfo ? loadCover(content.coverUrl) : null,
    loadFonts(
      style.fontFamily,
      `${content.text.slice(0, 200)}${content.title ?? ''}${content.author ?? ''}`,
    ),
  ]);

  const ctx = canvas.getContext('2d')!;
  const measure = (text: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const layout = QUOTE_CARD_LAYOUTS[style.layout](
    {
      ...content,
      showBookInfo: style.showBookInfo,
      coverAspect: cover ? cover.naturalWidth / cover.naturalHeight : undefined,
      shape: style.shape,
      fontFamily: style.fontFamily,
      qrUrl: style.showQr ? content.qrUrl : undefined,
    },
    measure,
  );

  // Resizing resets the context state.
  canvas.width = layout.width;
  canvas.height = layout.height;
  ctx.fillStyle = style.colors.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = 'middle';

  for (const el of layout.elements) {
    ctx.globalAlpha = el.type === 'text' || el.type === 'rect' ? (el.alpha ?? 1) : 1;
    if (el.type === 'text') {
      ctx.font = el.font;
      ctx.fillStyle = style.colors[el.color];
      ctx.textAlign = el.align;
      ctx.direction = el.dir;
      ctx.fillText(el.text, el.x, el.y);
    } else if (el.type === 'rect') {
      ctx.fillStyle = style.colors[el.color];
      roundedPath(ctx, el.x, el.y, el.w, el.h, el.radius ?? 0);
      ctx.fill();
    } else if (el.type === 'qr') {
      drawQr(ctx, el.value, el.x, el.y, el.w, style.colors.fg);
    } else {
      if (!cover) continue;
      ctx.save();
      roundedPath(ctx, el.x, el.y, el.w, el.h, el.radius ?? 0);
      ctx.clip();
      drawCover(ctx, cover, el.x, el.y, el.w, el.h);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  return { truncated: layout.truncated };
};

export const quoteCardToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      'image/png',
    ),
  );
