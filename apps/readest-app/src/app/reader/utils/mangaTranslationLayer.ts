import type { TranslatedMangaPage } from '@/app/reader/services/manga/mangaTranslationEngine';
import type { OcrBoundingBox } from '@/app/reader/services/ocr/types';

export const MANGA_TRANSLATION_LAYER_SELECTOR = '[data-readest-manga-translation-layer]';

const layerCleanups = new WeakMap<Element, () => void>();

const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));

const normalizeBox = (
  box: OcrBoundingBox,
  page: Pick<TranslatedMangaPage, 'width' | 'height'>,
): OcrBoundingBox | null => {
  const coordinates = [box.xMin, box.yMin, box.xMax, box.yMax];
  if (!coordinates.every(Number.isFinite)) return null;

  const normalized = {
    xMin: clamp(box.xMin, page.width),
    yMin: clamp(box.yMin, page.height),
    xMax: clamp(box.xMax, page.width),
    yMax: clamp(box.yMax, page.height),
  };
  if (normalized.xMax <= normalized.xMin || normalized.yMax <= normalized.yMin) return null;
  return normalized;
};

const insetBox = (box: OcrBoundingBox, ratio: number): OcrBoundingBox => {
  const inset = Math.min(box.xMax - box.xMin, box.yMax - box.yMin) * ratio;
  return {
    xMin: box.xMin + inset,
    yMin: box.yMin + inset,
    xMax: box.xMax - inset,
    yMax: box.yMax - inset,
  };
};

const expandAndClipMask = (mask: OcrBoundingBox, bubble: OcrBoundingBox): OcrBoundingBox | null => {
  const padding = Math.min(mask.xMax - mask.xMin, mask.yMax - mask.yMin) * 0.08;
  const bubbleClip = insetBox(bubble, 0.015);
  const clipped = {
    xMin: Math.max(mask.xMin - padding, bubbleClip.xMin),
    yMin: Math.max(mask.yMin - padding, bubbleClip.yMin),
    xMax: Math.min(mask.xMax + padding, bubbleClip.xMax),
    yMax: Math.min(mask.yMax + padding, bubbleClip.yMax),
  };
  return clipped.xMax > clipped.xMin && clipped.yMax > clipped.yMin ? clipped : null;
};

const percentage = (value: number, total: number) =>
  `${Number.parseFloat(((value / total) * 100).toFixed(6))}%`;

const positionElement = (
  element: HTMLElement,
  box: OcrBoundingBox,
  page: Pick<TranslatedMangaPage, 'width' | 'height'>,
) => {
  Object.assign(element.style, {
    left: percentage(box.xMin, page.width),
    top: percentage(box.yMin, page.height),
    width: percentage(box.xMax - box.xMin, page.width),
    height: percentage(box.yMax - box.yMin, page.height),
  });
};

const textColorFor = (backgroundColor: string): string => {
  const channels = backgroundColor
    .match(/[\d.]+/gu)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return '#111';
  }
  const [red = 255, green = 255, blue = 255] = channels;
  const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
  return luminance > 0.52 ? '#111' : '#fff';
};

interface FontFitOptions {
  minimum: number;
  maximum: number;
  fits: (size: number) => boolean;
}

export const findLargestFittingFontSize = ({ minimum, maximum, fits }: FontFitOptions): number => {
  if (!fits(minimum)) return minimum;
  let lower = minimum;
  let upper = Math.max(minimum, maximum);
  for (let attempt = 0; attempt < 12 && upper - lower > 0.1; attempt += 1) {
    const candidate = (lower + upper) / 2;
    if (fits(candidate)) lower = candidate;
    else upper = candidate;
  }
  return lower;
};

export const getMaximumMangaFontSize = (width: number, height: number): number =>
  Math.max(4, Math.min(48, width * 0.25, height * 0.3));

const animateLayer = (element: HTMLElement, keyframes: Keyframe[], duration: number) => {
  if (typeof element.animate !== 'function') return;
  element.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
};

export const removeMangaTranslationLayer = (doc: Document): void => {
  for (const layer of doc.querySelectorAll(MANGA_TRANSLATION_LAYER_SELECTOR)) {
    layerCleanups.get(layer)?.();
    layerCleanups.delete(layer);
    layer.remove();
  }
};

export const mountMangaTranslationLayer = (
  doc: Document,
  page: TranslatedMangaPage,
): HTMLDivElement | null => {
  removeMangaTranslationLayer(doc);
  if (!Number.isFinite(page.width) || page.width <= 0) return null;
  if (!Number.isFinite(page.height) || page.height <= 0 || !page.regions.length) return null;

  const layer = doc.createElement('div');
  layer.setAttribute('data-readest-manga-translation-layer', '');
  layer.setAttribute('data-readest-manga-page-index', String(page.pageIndex));
  Object.assign(layer.style, {
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    textSizeAdjust: 'none',
    transformOrigin: '0 0',
    zIndex: '2',
  });

  const textElements: HTMLElement[] = [];
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  for (const region of page.regions) {
    if (!region.translatedText.trim()) continue;
    const bubble = normalizeBox(region.bubbleBox, page);
    if (!bubble) continue;

    for (const rawMask of region.maskBoxes) {
      const mask = normalizeBox(rawMask, page);
      if (!mask) continue;
      const clippedMask = expandAndClipMask(mask, bubble);
      if (!clippedMask) continue;
      const maskElement = doc.createElement('span');
      maskElement.setAttribute('data-readest-manga-mask', '');
      Object.assign(maskElement.style, {
        backgroundColor: region.backgroundColor,
        borderRadius: '16%',
        position: 'absolute',
      });
      positionElement(maskElement, clippedMask, page);
      layer.append(maskElement);
      if (!reducedMotion) animateLayer(maskElement, [{ opacity: 0 }, { opacity: 1 }], 120);
    }

    const textBox = normalizeBox(insetBox(bubble, 0.1), page);
    if (!textBox) continue;
    const container = doc.createElement('span');
    container.setAttribute('data-readest-manga-region-id', region.id);
    Object.assign(container.style, {
      alignItems: 'center',
      display: 'flex',
      justifyContent: 'center',
      overflow: 'hidden',
      pointerEvents: 'auto',
      position: 'absolute',
      textAlign: 'center',
      userSelect: 'text',
    });
    positionElement(container, textBox, page);

    const text = doc.createElement('span');
    text.setAttribute('data-readest-manga-text', '');
    Object.assign(text.style, {
      color: textColorFor(region.backgroundColor),
      display: 'block',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 'clamp(4px, 4vh, 48px)',
      fontWeight: '600',
      letterSpacing: '-0.01em',
      lineHeight: '1.08',
      maxHeight: '100%',
      maxWidth: '100%',
      overflow: 'hidden',
      overflowWrap: 'anywhere',
      whiteSpace: 'normal',
    });
    text.append(doc.createTextNode(region.translatedText));
    container.append(text);
    layer.append(container);
    textElements.push(text);
    if (!reducedMotion) {
      animateLayer(
        container,
        [
          { opacity: 0, transform: 'scale(.96)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        160,
      );
    }
  }

  if (!textElements.length) return null;
  doc.body.append(layer);

  const fitText = () => {
    for (const text of textElements) {
      const container = text.parentElement;
      if (!container || container.clientWidth <= 0 || container.clientHeight <= 0) continue;
      const maximum = getMaximumMangaFontSize(container.clientWidth, container.clientHeight);
      const size = findLargestFittingFontSize({
        minimum: 4,
        maximum,
        fits: (candidate) => {
          text.style.fontSize = `${candidate}px`;
          return (
            text.scrollWidth <= container.clientWidth + 0.5 &&
            text.scrollHeight <= container.clientHeight + 0.5
          );
        },
      });
      text.style.fontSize = `${size}px`;
    }
  };

  const win = doc.defaultView;
  let frame = win?.requestAnimationFrame?.(fitText);
  const ResizeObserverConstructor = win?.ResizeObserver;
  const observer = ResizeObserverConstructor ? new ResizeObserverConstructor(fitText) : null;
  if (observer) for (const text of textElements) observer.observe(text.parentElement!);
  void doc.fonts?.ready.then(() => fitText());
  layerCleanups.set(layer, () => {
    if (frame !== undefined) win?.cancelAnimationFrame?.(frame);
    frame = undefined;
    observer?.disconnect();
  });
  return layer;
};
