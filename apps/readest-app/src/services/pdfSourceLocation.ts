export interface PdfPoint {
  x: number;
  y: number;
}

const viewportDimensions = (doc: Document): { width: number; height: number } | null => {
  const content = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;
  const width = Number(content?.match(/(?:^|,)\s*width=([\d.]+)/)?.[1]);
  const height = Number(content?.match(/(?:^|,)\s*height=([\d.]+)/)?.[1]);
  return width > 0 && height > 0 ? { width, height } : null;
};

export const pdfPointFromRange = (range: Range): PdfPoint | null => {
  const doc = range.commonAncestorContainer.ownerDocument;
  if (!doc) return null;
  const viewport = viewportDimensions(doc);
  const canvas = doc.querySelector<HTMLCanvasElement>('#canvas canvas');
  if (!viewport || !canvas) return null;
  const pageRect = canvas.getBoundingClientRect();
  const selectionRect = range.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;
  return {
    x:
      ((selectionRect.left + selectionRect.width / 2 - pageRect.left) / pageRect.width) *
      viewport.width,
    y:
      ((selectionRect.top + selectionRect.height / 2 - pageRect.top) / pageRect.height) *
      viewport.height,
  };
};
