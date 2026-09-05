import type { OcrBoundingBox, OcrPage, OcrTextBlock } from '@/app/reader/services/ocr/types';

export const OCR_TEXT_LAYER_SELECTOR = '[data-readest-ocr-layer]';
const OCR_TEXT_LAYER_STYLE_SELECTOR = '[data-readest-ocr-style]';
const OCR_TEXT_BLOCK_SELECTOR = '[data-readest-ocr-block-id]';
const OCR_TEXT_LINE_SELECTOR = '[data-readest-ocr-line]';

const OCR_TEXT_LAYER_STYLES = `
${OCR_TEXT_LAYER_SELECTOR} ${OCR_TEXT_BLOCK_SELECTOR} {
  background-color: transparent;
  color: transparent;
  transition: background-color 100ms ease-out, color 100ms ease-out;
}
${OCR_TEXT_LAYER_SELECTOR} ${OCR_TEXT_BLOCK_SELECTOR}:hover,
${OCR_TEXT_LAYER_SELECTOR} ${OCR_TEXT_BLOCK_SELECTOR}:active {
  background-color: #fff;
  color: #000;
  z-index: 1;
}
${OCR_TEXT_LAYER_SELECTOR} ${OCR_TEXT_LINE_SELECTOR}:not(:last-child)::after {
  content: '\\A';
  white-space: pre;
}
@media (prefers-reduced-motion: reduce) {
  ${OCR_TEXT_LAYER_SELECTOR} ${OCR_TEXT_BLOCK_SELECTOR} {
    transition: none;
  }
}`;

const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));

const normalizeBox = (
  box: OcrBoundingBox,
  page: Pick<OcrPage, 'width' | 'height'>,
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

const toRelativeUnit = (value: number, total: number, unit: '%' | 'vh' | 'vw') =>
  `${(value / total) * 100}${unit}`;

const getFontSize = (
  detectedFontSize: number | undefined,
  lines: readonly string[],
  width: number,
  height: number,
  vertical: boolean,
): number => {
  const lineCount = Math.max(1, lines.length);
  const crossAxisFit = (vertical ? width : height) / lineCount / 1.1;
  if (detectedFontSize !== undefined && Number.isFinite(detectedFontSize)) {
    return Math.min(detectedFontSize, crossAxisFit);
  }
  const longestLine = Math.max(1, ...lines.map((line) => Array.from(line).length));
  return (
    0.9 *
    Math.min(
      vertical ? width / lineCount : height / lineCount,
      (vertical ? height : width) / longestLine,
    )
  );
};

const createTextBlock = (
  doc: Document,
  page: Pick<OcrPage, 'width' | 'height'>,
  block: OcrTextBlock,
): HTMLSpanElement | null => {
  if (!block.text.trim()) return null;
  const box = normalizeBox(block.box, page);
  if (!box) return null;

  const width = box.xMax - box.xMin;
  const height = box.yMax - box.yMin;
  const vertical = block.writingMode.startsWith('vertical');
  const detectedLines = block.lines?.filter((line) => line.trim());
  const lines = detectedLines?.length ? detectedLines : [block.text];
  const element = doc.createElement('span');
  element.setAttribute('data-readest-ocr-block-id', block.id);
  Object.assign(element.style, {
    position: 'absolute',
    left: toRelativeUnit(box.xMin, page.width, '%'),
    top: toRelativeUnit(box.yMin, page.height, '%'),
    width: toRelativeUnit(width, page.width, '%'),
    height: toRelativeUnit(height, page.height, '%'),
    cursor: vertical ? 'vertical-text' : 'text',
    fontFamily: '"Noto Sans JP", sans-serif',
    fontSize: toRelativeUnit(
      getFontSize(block.fontSize, lines, width, height, vertical),
      page.width,
      'vw',
    ),
    forcedColorAdjust: 'none',
    lineHeight: '1.1',
    overflow: 'hidden',
    pointerEvents: 'auto',
    textOrientation: 'mixed',
    textSizeAdjust: 'none',
    userSelect: 'text',
    whiteSpace: 'pre-wrap',
    writingMode: block.writingMode,
  });
  for (const line of lines) {
    const lineElement = doc.createElement('span');
    lineElement.setAttribute('data-readest-ocr-line', '');
    lineElement.append(doc.createTextNode(line));
    element.append(lineElement);
  }
  return element;
};

export const removeOcrTextLayer = (doc: Document): void => {
  for (const element of doc.querySelectorAll(
    `${OCR_TEXT_LAYER_SELECTOR}, ${OCR_TEXT_LAYER_STYLE_SELECTOR}`,
  )) {
    element.remove();
  }
};

export const mountOcrTextLayer = (doc: Document, page: OcrPage): HTMLDivElement | null => {
  removeOcrTextLayer(doc);
  if (!Number.isFinite(page.width) || page.width <= 0) return null;
  if (!Number.isFinite(page.height) || page.height <= 0) return null;

  const layer = doc.createElement('div');
  layer.setAttribute('data-readest-ocr-layer', '');
  layer.setAttribute('data-readest-ocr-page-index', String(page.pageIndex));
  if (page.language) layer.lang = page.language;
  Object.assign(layer.style, {
    inset: '0',
    lineHeight: '1',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    textAlign: 'initial',
    textSizeAdjust: 'none',
    transformOrigin: '0 0',
    zIndex: '1',
  });

  const style = doc.createElement('style');
  style.setAttribute('data-readest-ocr-style', '');
  style.textContent = OCR_TEXT_LAYER_STYLES;
  (doc.head ?? doc.documentElement).append(style);

  for (const block of page.blocks) {
    const element = createTextBlock(doc, page, block);
    if (element) layer.append(element);
  }
  layer.addEventListener('click', (event) => {
    const block = (event.target as Element | null)?.closest?.(OCR_TEXT_BLOCK_SELECTOR);
    if (!block || !layer.contains(block)) return;
    const selection = doc.getSelection();
    if (!selection) return;
    if (!selection.isCollapsed) {
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (
        !range ||
        !layer.contains(range.startContainer) ||
        !layer.contains(range.endContainer) ||
        range.intersectsNode(block)
      ) {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    const range = doc.createRange();
    range.selectNodeContents(block);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  doc.body.append(layer);
  return layer;
};

export const restoreOcrTextLayer = (
  doc: Document,
  pageIndex: number,
  pages: ReadonlyMap<number, OcrPage>,
): HTMLDivElement | null => {
  const page = pages.get(pageIndex);
  if (!page) {
    removeOcrTextLayer(doc);
    return null;
  }
  return mountOcrTextLayer(doc, page);
};
