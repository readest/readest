export type OcrCanvas = HTMLCanvasElement | OffscreenCanvas;

export const isHtmlCanvas = (canvas: unknown): canvas is HTMLCanvasElement =>
  typeof canvas === 'object' &&
  canvas !== null &&
  'tagName' in canvas &&
  canvas.tagName === 'CANVAS' &&
  'ownerDocument' in canvas;

export const isOcrCanvas = (canvas: unknown): canvas is OcrCanvas =>
  isHtmlCanvas(canvas) ||
  (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas);

export const createOcrCanvas = (
  width: number,
  height: number,
  source?: HTMLCanvasElement,
): OcrCanvas => {
  let canvas: OcrCanvas;
  if (source || typeof document !== 'undefined') {
    const doc =
      source?.ownerDocument.defaultView?.frameElement?.ownerDocument ??
      source?.ownerDocument ??
      document;
    canvas = doc.createElement('canvas');
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    throw new Error('OCR could not create a canvas');
  }
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
