import { z } from 'zod';

export const getOcrLineSeparator = (language?: string): string =>
  /^(?:ja|jpn|zh|zho|chi)(?:[-_]|$)/iu.test(language?.trim() ?? '') ? '' : ' ';

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
  lines?: readonly string[];
  fontSize?: number;
  confidence?: number;
  box: OcrBoundingBox;
  writingMode: OcrWritingMode;
}

export interface OcrPage {
  pageIndex: number;
  width: number;
  height: number;
  language?: string;
  blocks: readonly OcrTextBlock[];
}

const pageDimensions = {
  pageIndex: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};

export const ocrRequestPayloadSchema = z.strictObject({
  image: z.union([
    z.string().min(1),
    z.custom<ImageBitmap>(
      (value) => typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap,
    ),
  ]),
  page: z.strictObject(pageDimensions),
  options: z.strictObject({
    languages: z.array(z.string().min(1).max(32)).min(1).max(16).readonly().optional(),
    mangaMode: z.boolean().optional(),
    textLanguage: z.string().max(35).optional(),
  }),
});

export const ocrPageSchema: z.ZodType<OcrPage> = z.strictObject({
  ...pageDimensions,
  language: z.string().max(35).optional(),
  blocks: z
    .array(
      z.strictObject({
        id: z.string().max(256),
        text: z.string().max(100_000),
        lines: z.array(z.string().max(100_000)).max(2_000).optional(),
        fontSize: z.number().positive().optional(),
        confidence: z.number().optional(),
        box: z.strictObject({
          xMin: z.number(),
          yMin: z.number(),
          xMax: z.number(),
          yMax: z.number(),
        }),
        writingMode: z.enum(['horizontal-tb', 'vertical-rl', 'vertical-lr']),
      }),
    )
    .max(10_000),
});
