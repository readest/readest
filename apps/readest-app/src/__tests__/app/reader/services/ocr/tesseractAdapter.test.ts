import { describe, expect, it } from 'vitest';

import { adaptTesseractPage } from '@/app/reader/services/ocr/tesseractAdapter';

describe('adaptTesseractPage', () => {
  it('flattens OCR lines in detector order with stable IDs and confidence', () => {
    const page = adaptTesseractPage(
      {
        blocks: [
          {
            blocktype: 'FLOWING_TEXT',
            paragraphs: [
              {
                lines: [
                  {
                    text: 'first line\n',
                    confidence: 94,
                    bbox: { x0: 100, y0: 200, x1: 700, y1: 260 },
                  },
                  {
                    text: 'second line',
                    confidence: 88,
                    bbox: { x0: 120, y0: 270, x1: 680, y1: 330 },
                  },
                ],
              },
            ],
          },
          {
            blocktype: 'VERTICAL_TEXT',
            paragraphs: [
              {
                lines: [
                  {
                    text: '縦書き',
                    confidence: 81,
                    bbox: { x0: 900, y0: 180, x1: 980, y1: 900 },
                  },
                ],
              },
            ],
          },
        ],
      },
      { pageIndex: 7, width: 1200, height: 1800 },
    );

    expect(page).toEqual({
      pageIndex: 7,
      width: 1200,
      height: 1800,
      blocks: [
        {
          id: 'tesseract-0-0-0',
          text: 'first line',
          confidence: 94,
          box: { xMin: 100, yMin: 200, xMax: 700, yMax: 260 },
          writingMode: 'horizontal-tb',
        },
        {
          id: 'tesseract-0-0-1',
          text: 'second line',
          confidence: 88,
          box: { xMin: 120, yMin: 270, xMax: 680, yMax: 330 },
          writingMode: 'horizontal-tb',
        },
        {
          id: 'tesseract-1-0-0',
          text: '縦書き',
          confidence: 81,
          box: { xMin: 900, yMin: 180, xMax: 980, yMax: 900 },
          writingMode: 'vertical-rl',
        },
      ],
    });
  });

  it('detects tall text lines as vertical when block metadata is absent', () => {
    const page = adaptTesseractPage(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: '日本語',
                    confidence: 75,
                    bbox: { x0: 20, y0: 20, x1: 70, y1: 300 },
                  },
                ],
              },
            ],
          },
        ],
      },
      { pageIndex: 0, width: 500, height: 800 },
    );

    expect(page.blocks[0]?.writingMode).toBe('vertical-rl');
  });

  it('filters low-confidence, empty, non-finite, and degenerate lines', () => {
    const page = adaptTesseractPage(
      {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: 'keep',
                    confidence: 50,
                    bbox: { x0: 0, y0: 0, x1: 20, y1: 10 },
                  },
                  {
                    text: 'too uncertain',
                    confidence: 49,
                    bbox: { x0: 0, y0: 0, x1: 20, y1: 10 },
                  },
                  {
                    text: ' ',
                    confidence: 90,
                    bbox: { x0: 0, y0: 0, x1: 20, y1: 10 },
                  },
                  {
                    text: 'non-finite',
                    confidence: 90,
                    bbox: { x0: 0, y0: 0, x1: Number.POSITIVE_INFINITY, y1: 10 },
                  },
                  {
                    text: 'degenerate',
                    confidence: 90,
                    bbox: { x0: 20, y0: 10, x1: 10, y1: 5 },
                  },
                ],
              },
            ],
          },
        ],
      },
      { pageIndex: 0, width: 100, height: 100, minimumConfidence: 50 },
    );

    expect(page.blocks.map(({ text }) => text)).toEqual(['keep']);
  });

  it('returns an empty page when Tesseract detects no blocks', () => {
    expect(
      adaptTesseractPage({ blocks: null }, { pageIndex: 2, width: 1000, height: 1400 }).blocks,
    ).toEqual([]);
  });
});
