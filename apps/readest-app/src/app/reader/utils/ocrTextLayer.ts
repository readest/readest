import type { OcrBoundingBox, OcrPage, OcrTextBlock } from '@/app/reader/services/ocr/types';

export const OCR_TEXT_LAYER_SELECTOR = '[data-readest-ocr-layer]';

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
  const element = doc.createElement('span');
  element.setAttribute('data-readest-ocr-block-id', block.id);
  Object.assign(element.style, {
    position: 'absolute',
    left: toRelativeUnit(box.xMin, page.width, '%'),
    top: toRelativeUnit(box.yMin, page.height, '%'),
    width: toRelativeUnit(width, page.width, '%'),
    height: toRelativeUnit(height, page.height, '%'),
    color: 'transparent',
    backgroundColor: 'transparent',
    cursor: 'text',
    fontFamily: 'sans-serif',
    fontSize: vertical
      ? toRelativeUnit(width, page.width, 'vw')
      : toRelativeUnit(height, page.height, 'vh'),
    forcedColorAdjust: 'none',
    lineHeight: '1',
    overflow: 'hidden',
    pointerEvents: 'auto',
    textOrientation: 'mixed',
    textSizeAdjust: 'none',
    userSelect: 'text',
    whiteSpace: 'pre-wrap',
    writingMode: block.writingMode,
  });
  element.append(doc.createTextNode(block.text));
  return element;
};

export const removeOcrTextLayer = (doc: Document): void => {
  for (const layer of doc.querySelectorAll(OCR_TEXT_LAYER_SELECTOR)) layer.remove();
};

export const mountOcrTextLayer = (doc: Document, page: OcrPage): HTMLDivElement | null => {
  removeOcrTextLayer(doc);
  if (!Number.isFinite(page.width) || page.width <= 0) return null;
  if (!Number.isFinite(page.height) || page.height <= 0) return null;

  const layer = doc.createElement('div');
  layer.setAttribute('data-readest-ocr-layer', '');
  layer.setAttribute('data-readest-ocr-page-index', String(page.pageIndex));
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

  for (const block of page.blocks) {
    const element = createTextBlock(doc, page, block);
    if (element) layer.append(element);
  }
  doc.body.append(layer);
  return layer;
};
