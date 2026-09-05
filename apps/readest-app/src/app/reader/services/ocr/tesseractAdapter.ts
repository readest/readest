import type { OcrPage, OcrTextBlock } from '@/app/reader/services/ocr/types';

interface TesseractBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractLine {
  text: string;
  confidence?: number;
  bbox: TesseractBoundingBox;
}

interface TesseractParagraph {
  lines?: readonly TesseractLine[];
}

interface TesseractBlock {
  blocktype?: unknown;
  paragraphs?: readonly TesseractParagraph[];
}

export interface TesseractPageData {
  blocks?: readonly TesseractBlock[] | null;
}

interface AdaptTesseractPageOptions {
  pageIndex: number;
  width: number;
  height: number;
  minimumConfidence?: number;
}

const isValidBox = ({ x0, y0, x1, y1 }: TesseractBoundingBox) =>
  [x0, y0, x1, y1].every(Number.isFinite) && x1 > x0 && y1 > y0;

const isVerticalLine = (block: TesseractBlock, box: TesseractBoundingBox) => {
  if (typeof block.blocktype === 'string' && block.blocktype.toLowerCase().includes('vertical')) {
    return true;
  }
  return box.y1 - box.y0 > (box.x1 - box.x0) * 1.5;
};

export const adaptTesseractPage = (
  data: TesseractPageData,
  { pageIndex, width, height, minimumConfidence = 0 }: AdaptTesseractPageOptions,
): OcrPage => {
  const blocks: OcrTextBlock[] = [];
  for (const [blockIndex, block] of (data.blocks ?? []).entries()) {
    for (const [paragraphIndex, paragraph] of (block.paragraphs ?? []).entries()) {
      for (const [lineIndex, line] of (paragraph.lines ?? []).entries()) {
        const text = line.text.trim();
        if (!text || !isValidBox(line.bbox)) continue;

        const confidence = Number.isFinite(line.confidence) ? line.confidence : undefined;
        if (minimumConfidence > 0 && (confidence === undefined || confidence < minimumConfidence)) {
          continue;
        }
        blocks.push({
          id: `tesseract-${blockIndex}-${paragraphIndex}-${lineIndex}`,
          text,
          ...(confidence === undefined ? {} : { confidence }),
          box: {
            xMin: line.bbox.x0,
            yMin: line.bbox.y0,
            xMax: line.bbox.x1,
            yMax: line.bbox.y1,
          },
          writingMode: isVerticalLine(block, line.bbox) ? 'vertical-rl' : 'horizontal-tb',
        });
      }
    }
  }

  return { pageIndex, width, height, blocks };
};
