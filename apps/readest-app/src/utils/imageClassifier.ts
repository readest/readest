/**
 * Image classification utilities for detecting monochrome line-art diagrams,
 * mathematical formulas, and tables in Dark Mode.
 *
 * Separates invertible graphics from continuous-tone photographs, portraits,
 * oil paintings, and color illustrations using downsampled pixel distribution.
 */

const ANALYSIS_SIZE = 128;
const TOTAL_PIXELS = ANALYSIS_SIZE * ANALYSIS_SIZE; // 16,384

// Shared canvas instance to avoid creating DOM nodes repeatedly.
let sharedCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let sharedCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

const getSharedContext = ():
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null => {
  if (sharedCtx) return sharedCtx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      sharedCanvas = new OffscreenCanvas(ANALYSIS_SIZE, ANALYSIS_SIZE);
      sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = ANALYSIS_SIZE;
      canvas.height = ANALYSIS_SIZE;
      sharedCanvas = canvas;
      sharedCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
  } catch {
    return null;
  }
  return sharedCtx;
};

// In-memory cache mapping image src URL to classification result (boolean).
// Avoids touching canvas repeatedly on page turns.
const classificationCache = new Map<string, boolean>();

export const getDiagramClassificationCache = () => classificationCache;
export const clearDiagramClassificationCache = () => classificationCache.clear();

export interface PixelDistribution {
  chroma: number;
  whiteRatio: number;
  midtoneRatio: number;
  darkRatio: number;
}

/**
 * Analyzes pixel data from an RGBA buffer composited on white.
 */
export const evaluatePixelDistribution = (data: Uint8ClampedArray): PixelDistribution => {
  let totalColorDiff = 0;
  let whiteCount = 0;
  let midtoneCount = 0;
  let darkCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r === undefined || g === undefined || b === undefined) break;

    totalColorDiff += Math.abs(r - g) + Math.abs(g - b);

    // Standard Rec. 601 luma formula matching PIL / OpenCV grayscale conversion
    const lum = (299 * r + 587 * g + 114 * b) / 1000;

    if (lum >= 235) {
      whiteCount++;
    } else if (lum >= 35 && lum <= 220) {
      midtoneCount++;
    } else if (lum <= 30) {
      darkCount++;
    }
  }

  return {
    chroma: totalColorDiff / TOTAL_PIXELS,
    whiteRatio: whiteCount / TOTAL_PIXELS,
    midtoneRatio: midtoneCount / TOTAL_PIXELS,
    darkRatio: darkCount / TOTAL_PIXELS,
  };
};

/**
 * Decides whether a pixel distribution represents an invertible monochrome graphic.
 */
export const isDistributionInvertible = (dist: PixelDistribution): boolean => {
  // 1. Color check (color photographs, illustrations, tinted graphics)
  if (dist.chroma > 10.0) {
    return false;
  }

  // 2. Already dark background diagram (white lines on black background)
  if (dist.darkRatio >= 0.7 && dist.midtoneRatio <= 0.125) {
    return false; // Leave as-is; do not re-invert into white box
  }

  // 3. Two-tier white-background line-art / formula / table rule:
  // Tier 1: General line art (white >= 70% and midtones <= 12.5%)
  // Tier 2: High-white text headings / tables with JPEG compression noise (white >= 80% and midtones <= 15.0%)
  const isTier1 = dist.whiteRatio >= 0.7 && dist.midtoneRatio <= 0.125;
  const isTier2 = dist.whiteRatio >= 0.8 && dist.midtoneRatio <= 0.15;

  return isTier1 || isTier2;
};

/**
 * Classifies an image source (HTMLImageElement, Canvas, or ImageBitmap) to determine
 * if it is an invertible monochrome diagram or formula.
 */
export const isMonochromeGraphic = (img: CanvasImageSource, cacheKey?: string): boolean => {
  if (cacheKey && classificationCache.has(cacheKey)) {
    return classificationCache.get(cacheKey)!;
  }

  const ctx = getSharedContext();
  if (!ctx) return false;

  try {
    // 1. Composite over pure white to handle transparent PNGs and opaque JPEGs identically
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);

    const imageData = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    const dist = evaluatePixelDistribution(imageData.data);
    const result = isDistributionInvertible(dist);

    if (cacheKey) {
      classificationCache.set(cacheKey, result);
    }
    return result;
  } catch {
    // SecurityError / CORS / decode failure -> fail safe to false
    if (cacheKey) {
      classificationCache.set(cacheKey, false);
    }
    return false;
  }
};

/**
 * Identifies candidate standalone images in the document and asynchronously
 * tags invertible monochrome diagrams with class 'monochrome-diagram'.
 */
export const classifyAndTagStandaloneDiagrams = (
  document: Document,
  isDarkMode: boolean,
  isFixedLayout = false,
) => {
  // Never run in light mode or for fixed-layout manga / comics
  if (!isDarkMode || isFixedLayout) return;

  const win = document.defaultView ?? window;

  const isCoverElement = (img: HTMLImageElement): boolean => {
    let curr: Element | null = img;
    while (curr && curr !== document.body) {
      if (curr.classList.contains('cover')) return true;
      const epubType = curr.getAttribute('epub:type');
      if (epubType && epubType.toLowerCase().includes('cover')) return true;
      curr = curr.parentElement;
    }
    return false;
  };

  // Standalone candidates: images that are not inline glyphs/gaiji and not covers
  const candidates = Array.from(
    document.querySelectorAll<HTMLImageElement>(
      'img:not(.has-text-siblings):not([class*="gaiji"])',
    ),
  ).filter((img) => {
    if (img.classList.contains('monochrome-diagram')) return false;
    return !isCoverElement(img);
  });

  if (candidates.length === 0) return;

  // 1. Process cached images synchronously to prevent visual flicker during page turns
  const uncached: HTMLImageElement[] = [];
  for (const img of candidates) {
    const src = img.currentSrc || img.src;
    if (!src) continue;
    if (classificationCache.has(src)) {
      if (classificationCache.get(src)) {
        img.classList.add('monochrome-diagram');
      }
    } else {
      uncached.push(img);
    }
  }

  if (uncached.length === 0) return;

  // 2. Offload uncached images requiring canvas analysis to browser idle time
  const processUncachedImage = (img: HTMLImageElement) => {
    const src = img.currentSrc || img.src;
    if (!src || classificationCache.has(src)) return;

    if (img.complete && img.naturalWidth > 0) {
      if (isMonochromeGraphic(img, src)) {
        img.classList.add('monochrome-diagram');
      }
    } else {
      img.addEventListener(
        'load',
        () => {
          if (isMonochromeGraphic(img, src)) {
            img.classList.add('monochrome-diagram');
          }
        },
        { once: true },
      );
    }
  };

  const schedule =
    typeof win.requestIdleCallback === 'function'
      ? win.requestIdleCallback.bind(win)
      : (cb: () => void) => win.setTimeout(cb, 1);

  schedule(() => {
    for (const img of uncached) {
      processUncachedImage(img);
    }
  });
};
