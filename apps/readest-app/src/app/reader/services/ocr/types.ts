export type OcrWritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';

export interface OcrBoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface OcrTextBlock {
  id: string;
  text: string;
  box: OcrBoundingBox;
  writingMode: OcrWritingMode;
}

export interface OcrPage {
  pageIndex: number;
  width: number;
  height: number;
  blocks: readonly OcrTextBlock[];
}
