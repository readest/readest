export type OcrWritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';

export interface OcrBoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface OcrPoint {
  x: number;
  y: number;
}

export interface OcrTextBlock {
  id: string;
  text: string;
  confidence?: number;
  box: OcrBoundingBox;
  backgroundColor?: string;
  bubbleBox?: OcrBoundingBox;
  contentBox?: OcrBoundingBox;
  maskBoxes?: readonly OcrBoundingBox[];
  maskPolygons?: readonly (readonly OcrPoint[])[];
  writingMode: OcrWritingMode;
}

export interface OcrPage {
  pageIndex: number;
  width: number;
  height: number;
  blocks: readonly OcrTextBlock[];
}
