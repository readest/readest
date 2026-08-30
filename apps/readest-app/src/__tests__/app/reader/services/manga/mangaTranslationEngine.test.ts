import { describe, expect, it, vi } from 'vitest';

import {
  getMangaOcrEngineOptions,
  MangaTranslationEngine,
  normalizeEnglishTranslation,
  normalizeJapaneseOcrText,
  type JapaneseTextTranslatorFactory,
  type MangaOcrEngineFactory,
} from '@/app/reader/services/manga/mangaTranslationEngine';
import type { OcrPage } from '@/app/reader/services/ocr/types';

const makeOcrPage = (): OcrPage => ({
  pageIndex: 7,
  width: 1200,
  height: 1800,
  blocks: [
    {
      id: 'bubble-0',
      text: 'ずどど\nえやあい\nくっ!!!! R',
      confidence: 62,
      box: { xMin: 120, yMin: 160, xMax: 360, yMax: 500 },
      bubbleBox: { xMin: 80, yMin: 100, xMax: 420, yMax: 620 },
      maskBoxes: [
        { xMin: 260, yMin: 160, xMax: 360, yMax: 500 },
        { xMin: 120, yMin: 180, xMax: 220, yMax: 480 },
      ],
      backgroundColor: 'rgb(250 248 242)',
      writingMode: 'vertical-rl',
    },
    {
      id: 'whole-page-fallback',
      text: 'ページ全体',
      box: { xMin: 10, yMin: 10, xMax: 1100, yMax: 1700 },
      writingMode: 'vertical-rl',
    },
    {
      id: 'noise',
      text: 'R 12 /',
      box: { xMin: 800, yMin: 100, xMax: 900, yMax: 300 },
      bubbleBox: { xMin: 760, yMin: 60, xMax: 940, yMax: 340 },
      maskBoxes: [{ xMin: 800, yMin: 100, xMax: 900, yMax: 300 }],
      writingMode: 'vertical-rl',
    },
    {
      id: 'low-confidence-noise',
      text: '人人むょふん',
      confidence: 28,
      box: { xMin: 950, yMin: 800, xMax: 1100, yMax: 1000 },
      bubbleBox: { xMin: 900, yMin: 750, xMax: 1150, yMax: 1050 },
      maskBoxes: [{ xMin: 950, yMin: 800, xMax: 1100, yMax: 1000 }],
      writingMode: 'vertical-rl',
    },
  ],
});

describe('MangaTranslationEngine', () => {
  it('loads horizontal and vertical Japanese OCR without whole-page fallback', () => {
    expect(getMangaOcrEngineOptions()).toMatchObject({
      languages: ['jpn', 'jpn_vert'],
      mangaMode: true,
      minimumConfidence: 35,
      wholePageFallback: false,
    });
  });

  it('translates only Japanese speech bubbles and preserves their geometry', async () => {
    const ocrEngine = {
      recognize: vi.fn(async () => makeOcrPage()),
      terminate: vi.fn(async () => undefined),
    };
    const translator = {
      translate: vi.fn(async () => [' むんむむん  THe thing happened ?! 即 ']),
      terminate: vi.fn(async () => undefined),
    };
    const createOcrEngine = vi.fn<MangaOcrEngineFactory>(() => ocrEngine);
    const createTranslator = vi.fn<JapaneseTextTranslatorFactory>(() => translator);
    const progress = vi.fn();
    const engine = new MangaTranslationEngine(
      { onProgress: progress },
      { createOcrEngine, createTranslator },
    );

    const page = await engine.translate('blob:page-7', {
      pageIndex: 7,
      width: 1200,
      height: 1800,
    });

    expect(translator.translate).toHaveBeenCalledWith(['ずどどえやあいくっ!!!!']);
    expect(page).toEqual({
      pageIndex: 7,
      width: 1200,
      height: 1800,
      regions: [
        {
          id: 'bubble-0',
          sourceText: 'ずどどえやあいくっ!!!!',
          translatedText: 'The thing happened?!',
          confidence: 62,
          textBox: { xMin: 120, yMin: 160, xMax: 360, yMax: 500 },
          bubbleBox: { xMin: 80, yMin: 100, xMax: 420, yMax: 620 },
          maskBoxes: [
            { xMin: 260, yMin: 160, xMax: 360, yMax: 500 },
            { xMin: 120, yMin: 180, xMax: 220, yMax: 480 },
          ],
          backgroundColor: 'rgb(250 248 242)',
        },
      ],
    });
    expect(progress).toHaveBeenLastCalledWith({
      status: 'translating speech bubbles',
      progress: 1,
    });

    await engine.terminate();
    expect(ocrEngine.terminate).toHaveBeenCalledOnce();
    expect(translator.terminate).toHaveBeenCalledOnce();
  });

  it('does not load the translator when no Japanese bubble text was recognized', async () => {
    const ocrEngine = {
      recognize: vi.fn(async () => ({ ...makeOcrPage(), blocks: [] })),
      terminate: vi.fn(async () => undefined),
    };
    const createTranslator = vi.fn<JapaneseTextTranslatorFactory>();
    const engine = new MangaTranslationEngine(
      {},
      { createOcrEngine: () => ocrEngine, createTranslator },
    );

    await expect(
      engine.translate('blob:page', { pageIndex: 0, width: 1200, height: 1800 }),
    ).resolves.toEqual({ pageIndex: 7, width: 1200, height: 1800, regions: [] });
    expect(createTranslator).not.toHaveBeenCalled();
  });

  it('rejects later work after termination without loading either model', async () => {
    const createOcrEngine = vi.fn<MangaOcrEngineFactory>();
    const createTranslator = vi.fn<JapaneseTextTranslatorFactory>();
    const engine = new MangaTranslationEngine({}, { createOcrEngine, createTranslator });

    await engine.terminate();

    expect(createOcrEngine).not.toHaveBeenCalled();
    expect(createTranslator).not.toHaveBeenCalled();
    await expect(
      engine.translate('blob:page', { pageIndex: 0, width: 100, height: 100 }),
    ).rejects.toThrow('terminated');
  });
});

describe('normalizeEnglishTranslation', () => {
  it('rejects alphanumeric OCR noise while keeping short English dialogue', () => {
    expect(normalizeEnglishTranslation('A69 "')).toBe('');
    expect(normalizeEnglishTranslation('I!')).toBe('I!');
    expect(normalizeEnglishTranslation('go!')).toBe('Go!');
  });
});

describe('normalizeJapaneseOcrText', () => {
  it('preserves meaningful Latin tokens in mixed Japanese text while dropping lone OCR letters', () => {
    expect(normalizeJapaneseOcrText('これは Web comic です R')).toBe('これはWebcomicです');
  });
});
