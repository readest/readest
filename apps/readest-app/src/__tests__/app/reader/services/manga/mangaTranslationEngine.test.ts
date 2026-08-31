import { describe, expect, it, vi } from 'vitest';

import {
  getMangaOcrEngineOptions,
  MangaTranslationEngine,
  normalizeEnglishTranslation,
  normalizeJapaneseOcrText,
  translateJapaneseMangaExpression,
  translateJapaneseMangaSoundFallback,
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
      text: '何かが\n起きた!!!! R',
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
  it('uses the manga OCR confidence threshold', () => {
    expect(getMangaOcrEngineOptions()).toMatchObject({
      minimumConfidence: 35,
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

    expect(translator.translate).toHaveBeenCalledWith(['何かが起きた!!!!']);
    expect(page).toEqual({
      pageIndex: 7,
      width: 1200,
      height: 1800,
      regions: [
        {
          id: 'bubble-0',
          sourceText: '何かが起きた!!!!',
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

  it('resolves a common manga expression without loading the general translator', async () => {
    const ocrEngine = {
      recognize: vi.fn(async () => ({
        ...makeOcrPage(),
        blocks: [{ ...makeOcrPage().blocks[0]!, text: 'むふん!!!' }],
      })),
      terminate: vi.fn(async () => undefined),
    };
    const createTranslator = vi.fn<JapaneseTextTranslatorFactory>();
    const engine = new MangaTranslationEngine(
      {},
      { createOcrEngine: () => ocrEngine, createTranslator },
    );

    const page = await engine.translate('blob:page', {
      pageIndex: 7,
      width: 1200,
      height: 1800,
    });

    expect(page.regions[0]?.translatedText).toBe('Hmph!');
    expect(createTranslator).not.toHaveBeenCalled();
  });

  it('normalizes clipped manga phrasing before model translation', async () => {
    const ocrEngine = {
      recognize: vi.fn(async () => ({
        ...makeOcrPage(),
        blocks: [{ ...makeOcrPage().blocks[0]!, text: '薪割り\nおしまいっと!!' }],
      })),
      terminate: vi.fn(async () => undefined),
    };
    const translator = {
      translate: vi.fn(async () => ["I'm done with the wood!"]),
      terminate: vi.fn(async () => undefined),
    };
    const engine = new MangaTranslationEngine(
      {},
      { createOcrEngine: () => ocrEngine, createTranslator: () => translator },
    );

    const page = await engine.translate('blob:page', {
      pageIndex: 7,
      width: 1200,
      height: 1800,
    });

    expect(translator.translate).toHaveBeenCalledWith(['薪割りを終えた！']);
    expect(page.regions[0]?.sourceText).toBe('薪割りおしまいっと!!');
    expect(page.regions[0]?.translatedText).toBe("I'm done with the wood!");
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

  it.each([
    'OOOOOOOOOOOOOOOOOOOO',
    'Shhhhhhhhhhhhhhhhhhhhh',
    'No, no, no, no, no, no, no',
  ])('rejects pathological repeated model output: %s', (translation) => {
    expect(normalizeEnglishTranslation(translation)).toBe('');
  });
});

describe('normalizeJapaneseOcrText', () => {
  it('preserves meaningful Latin tokens in mixed Japanese text while dropping lone OCR letters', () => {
    expect(normalizeJapaneseOcrText('これは Web comic です R')).toBe('これはWebcomicです');
  });

  it('removes a duplicated small kana from vertical manga OCR', () => {
    expect(normalizeJapaneseOcrText('ゃやあ\nオッスグ')).toBe('やあオッスグ');
  });

  it('turns repeated round glyph noise after Japanese dialogue into an ellipsis', () => {
    expect(normalizeJapaneseOcrText('ハラ\nへったな\nOOOOOOOOO')).toBe('ハラへったな…');
  });

  it.each([
    ['きゃあ', 'きゃあ'],
    ['じゃあ行こう', 'じゃあ行こう'],
    ['どうでしょう', 'どうでしょう'],
    ['ファイル', 'ファイル'],
  ])('preserves valid small kana in %s', (source, expected) => {
    expect(normalizeJapaneseOcrText(source)).toBe(expected);
  });
});

describe('translateJapaneseMangaExpression', () => {
  it.each([
    ['やあオッス!', 'Hey!'],
    ['えやあ!', 'Hyaaah!'],
    ['むふん', 'Hmph!'],
    ['おしまいっと!!', 'All done!'],
    ['ハラへったな', "I'm hungry."],
  ])('translates the manga expression %s without a general model', (source, expected) => {
    expect(translateJapaneseMangaExpression(source)).toBe(expected);
  });

  it('leaves normal dialogue for the translation model', () => {
    expect(translateJapaneseMangaExpression('悟空は走る')).toBeNull();
  });

  it.each([
    'むんむん',
    'ずどど',
    'すほほーっ!!!!',
    'ずどどえやあ〜っ!!!!',
  ])('leaves ambiguous sound effects for the translation model: %s', (source) => {
    expect(translateJapaneseMangaExpression(source)).toBeNull();
  });

  it.each([
    'オッス、今日はどうした？',
    '今日はこれでおしまいにして帰ろう',
    '腹へったからラーメン食べよう',
    'オッス悟空',
    '悟空おしまい',
    'むふんけど帰ろう',
  ])('leaves longer dialogue for the translation model: %s', (source) => {
    expect(translateJapaneseMangaExpression(source)).toBeNull();
  });

  it.each([
    'やあオッスグ',
    '~ゾ{んむんむんるるるるる',
    'でえっにpie。し',
    'すほほな|つっつっルル',
    'ずどどいをを誰こ',
    'おしまいっとググ',
  ])('rejects corrupt OCR text instead of inventing a translation: %s', (source) => {
    expect(translateJapaneseMangaExpression(source)).toBeNull();
  });
});

describe('translateJapaneseMangaSoundFallback', () => {
  it.each([
    ['む〜〜んむんむん……●', 'Hmmmm...'],
    ['すほほつ!!', 'Hrrrgh!'],
    ['ずどどえやあ〜〜っ!!', 'Hyaaah!'],
  ])('localizes a rejected vocal sound %s as %s', (source, expected) => {
    expect(translateJapaneseMangaSoundFallback(source)).toBe(expected);
  });

  it.each([
    'ずどど',
    'すほほなつっつっルル',
    'むんむん今日は暑い',
  ])('does not guess at ambiguous or corrupt text: %s', (source) => {
    expect(translateJapaneseMangaSoundFallback(source)).toBeNull();
  });
});
