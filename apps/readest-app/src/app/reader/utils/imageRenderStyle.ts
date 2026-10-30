import type { FoliateView } from '@/types/view';

/**
 * How the book page drew a particular `<img>`, captured so the image viewer can
 * reproduce it.
 *
 * The viewer shows the raw bitmap on a dimmed backdrop, which is not what the
 * page paints. A drawing whose white background is *transparency* — the usual
 * shape of a chapter ornament or a scanned line illustration — is propped up on
 * a white plate by the book's dark-mode CSS, or inverted by the reader; neither
 * treatment reaches the viewer, so its dark ink lands on a dark backdrop and the
 * art disappears (哈利·波特与死亡圣器 chapter ornaments in night mode).
 */
export interface ImageRenderStyle {
  /** The CSS `filter` the page applied to the image; `'none'` when it applied none. */
  filter: string;
  /** Opaque color the page fills the image's transparent areas with. */
  plate: string | null;
}

const NO_RENDER_STYLE: ImageRenderStyle = { filter: 'none', plate: null };

/** Split a computed `box-shadow` into its individual shadows (commas inside `rgb()` are not separators). */
const splitShadowList = (value: string): string[] => {
  const shadows: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      shadows.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  shadows.push(value.slice(start).trim());
  return shadows.filter(Boolean);
};

/**
 * Whether a computed color paints nothing.
 *
 * Computed colors reach us as `rgb()` / `rgba()`, a hex, `transparent`, or — for
 * a color authored in a modern space — `oklab(… / 0.5)`. Only the fully
 * transparent ones matter here, so the alpha is read from the last component.
 */
export const isTransparentColor = (color: string): boolean => {
  const value = (color ?? '').trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none') return true;
  const slashAlpha = /\/\s*([\d.]+%?)\s*\)$/.exec(value);
  if (slashAlpha) return parseFloat(slashAlpha[1]!) === 0;
  const functional = /^rgba?\(([^)]*)\)$/.exec(value);
  if (functional) {
    const parts = functional[1]!.split(/[,/]/).map((part) => part.trim());
    return parts.length >= 4 ? parseFloat(parts[3]!) === 0 : false;
  }
  return false;
};

/**
 * The color of an inset shadow that is really a solid plate behind the image.
 *
 * A book that cannot use `background-color` (the reader overrides it with
 * `!important`) fills the transparent area with
 * `box-shadow: inset 0 0 0 999px #fff`. Zero blur plus a positive spread is what
 * separates that idiom from a decorative inner shadow, which would look nothing
 * like a fill once painted as one.
 */
export const plateColorFromBoxShadow = (boxShadow: string): string | null => {
  if (!boxShadow || boxShadow === 'none') return null;
  for (const shadow of splitShadowList(boxShadow)) {
    if (!/\binset\b/.test(shadow)) continue;
    const lengths = shadow.match(/-?[\d.]+px/g) ?? [];
    if (lengths.length < 4) continue;
    const blur = Math.abs(parseFloat(lengths[2]!));
    const spread = Math.abs(parseFloat(lengths[3]!));
    if (blur !== 0 || spread === 0) continue;
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(shadow)?.[1];
    if (color && !isTransparentColor(color)) return color;
  }
  return null;
};

/** The opaque fill the page puts behind the image's transparent areas, if any. */
const plateColorFor = (style: CSSStyleDeclaration): string | null => {
  if (!isTransparentColor(style.backgroundColor)) return style.backgroundColor;
  return plateColorFromBoxShadow(style.boxShadow);
};

/** Read the render style the page gave an image element. */
export const readImageRenderStyle = (img: HTMLImageElement): ImageRenderStyle => {
  const view = img.ownerDocument.defaultView;
  const style = view?.getComputedStyle(img);
  if (!style) return NO_RENDER_STYLE;
  const filter = style.filter && style.filter !== 'none' ? style.filter : 'none';
  return { filter, plate: plateColorFor(style) };
};

/**
 * Find the `<img>` the reader handed us — by its resolved `src`, which is the
 * same blob/object URL the page element carries — and read how it was drawn.
 * Sections that are not on screen are not in `getContents()`; an image reached
 * by paging the gallery backwards may well not be, which is why a miss is not
 * an error.
 */
export const captureImageRenderStyle = (
  view: FoliateView | null,
  src: string,
): ImageRenderStyle | null => {
  const contents = view?.renderer?.getContents?.() ?? [];
  for (const { doc } of contents) {
    if (!doc) continue;
    for (const img of doc.querySelectorAll('img')) {
      if (img.src === src) return readImageRenderStyle(img);
    }
  }
  return null;
};

/** What the image's own pixels say about it. */
export interface ImageInk {
  /** Fraction of sampled pixels with no ink at all. */
  transparentRatio: number;
  /** Fraction of the inked pixels that are dark, i.e. line art rather than a photograph. */
  darkInkRatio: number;
}

// Sample a small grid rather than the full bitmap: the question is only "is
// there paper here, and is the ink dark", which a 48px thumbnail answers.
const INK_SAMPLE_SIZE = 48;
// Below this, the image covers its own box and nothing behind it could show.
const TRANSPARENT_THRESHOLD = 0.02;
// A drawing is ink on paper: most inked pixels are near-black. A photograph's
// opaque pixels average out near mid-grey, so it stays below this.
const DARK_INK_LUMINANCE = 96;
const DARK_INK_THRESHOLD = 0.6;
// Luma above which a fill can serve as paper for dark ink.
const PAPER_LUMINANCE = 160;

/**
 * Read the image's own alpha and ink from a thumbnail.
 *
 * The page's rendering is the preferred source (see {@link ImageRenderStyle}),
 * but it cannot be trusted to be there: a section is stamped with the theme it
 * had when it loaded, so a drawing whose plate came from the book's night CSS
 * loses that plate the moment the reader switches theme — and then the raw
 * bitmap is all we have. The pixels always tell the truth about whether this is
 * a transparent drawing, which is the only thing the plate needs to know.
 */
export const probeImageInk = async (src: string): Promise<ImageInk | null> => {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = INK_SAMPLE_SIZE;
    canvas.height = INK_SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    // Transparent pixels must stay transparent for the alpha count to mean
    // anything, so no background fill first.
    context.clearRect(0, 0, INK_SAMPLE_SIZE, INK_SAMPLE_SIZE);
    context.drawImage(image, 0, 0, INK_SAMPLE_SIZE, INK_SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, INK_SAMPLE_SIZE, INK_SAMPLE_SIZE);

    let sampled = 0;
    let transparent = 0;
    let inked = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      sampled += 1;
      const alpha = data[i + 3]!;
      if (alpha < 8) {
        transparent += 1;
        continue;
      }
      inked += 1;
      // Rec. 601 luma; alpha-weighted so a half-transparent edge does not read
      // as a dark stroke.
      const luminance =
        (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) * (alpha / 255);
      if (luminance < DARK_INK_LUMINANCE) dark += 1;
    }
    if (!sampled) return null;
    return {
      transparentRatio: transparent / sampled,
      darkInkRatio: inked ? dark / inked : 0,
    };
  } catch {
    return null;
  }
};

/**
 * Whether a color is light enough to be paper behind dark ink.
 *
 * `null` when the color cannot be parsed — callers must treat that as "not
 * known to be light" rather than guessing.
 */
export const isLightColor = (color: string | null | undefined): boolean | null => {
  const value = (color ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'white') return true;
  if (value === 'black') return false;
  let r: number;
  let g: number;
  let b: number;
  const functional = /^rgba?\(([^)]*)\)$/.exec(value);
  if (functional) {
    const parts = functional[1]!.split(/[,/]/).map((part) => parseFloat(part.trim()));
    [r, g, b] = parts as [number, number, number];
  } else {
    const hex = /^#([0-9a-f]{3,8})$/.exec(value);
    if (!hex) return null;
    let digits = hex[1]!;
    if (digits.length <= 4) {
      digits = digits
        .split('')
        .map((digit) => digit + digit)
        .join('');
    }
    r = parseInt(digits.slice(0, 2), 16);
    g = parseInt(digits.slice(2, 4), 16);
    b = parseInt(digits.slice(4, 6), 16);
  }
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
  return 0.299 * r + 0.587 * g + 0.114 * b >= PAPER_LUMINANCE;
};

/**
 * The plate the viewer has to paint behind the image, if any.
 *
 * The page's own fill is the preferred answer, but it is not automatically the
 * right one: the reader rewrites a book's light backgrounds to the theme color
 * in dark mode, so a drawing that the page props up with a white inset shadow
 * can still carry `background-color: #1e1e1e` from the book's own dark-mode
 * block. Taking that as the plate painted exactly that grey under the ink.
 *
 * So the pixels have the last word: dark ink on transparency needs paper, and
 * paper is either what the page chose (when it is actually light) or white. An
 * inverting filter already turns the ink light, where paper would erase it.
 */
export const resolveImagePlate = ({
  pagePlate,
  filter,
  ink,
}: {
  pagePlate: string | null;
  filter?: string | null;
  ink?: ImageInk | null;
}): string | null => {
  const inverts = !!filter && /invert\s*\(/i.test(filter);
  if (inverts) return pagePlate ?? null;
  const darkDrawing =
    !!ink &&
    ink.transparentRatio >= TRANSPARENT_THRESHOLD &&
    ink.darkInkRatio >= DARK_INK_THRESHOLD;
  if (darkDrawing && isLightColor(pagePlate) !== true) return '#ffffff';
  return pagePlate ?? null;
};
