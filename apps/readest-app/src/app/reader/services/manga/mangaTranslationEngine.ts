import { BergamotJapaneseTranslator } from '@/app/reader/services/manga/bergamotTranslator';
import {
  PaddleMangaOcrEngine,
  type PaddleMangaOcrEngineOptions,
} from '@/app/reader/services/manga/paddleMangaOcrEngine';
import type { OcrBoundingBox, OcrPage, OcrTextBlock } from '@/app/reader/services/ocr/types';

export type MangaPageSource = string | HTMLCanvasElement;

interface MangaPageIdentity {
  pageIndex: number;
  width: number;
  height: number;
}

export interface TranslatedMangaRegion {
  id: string;
  sourceText: string;
  translatedText: string;
  confidence?: number;
  textBox: OcrBoundingBox;
  contentBox?: OcrBoundingBox;
  bubbleBox: OcrBoundingBox;
  maskBoxes: readonly OcrBoundingBox[];
  backgroundColor: string;
}

export interface TranslatedMangaPage {
  pageIndex: number;
  width: number;
  height: number;
  regions: readonly TranslatedMangaRegion[];
}

export interface MangaTranslationDiagnostics {
  pageIndex: number;
  ocrBlocks: number;
  japaneseCandidates: number;
  nonEmptyTranslations: number;
  normalizedEnglish: number;
  finalRegions: number;
}

export interface MangaOcrEngine {
  recognize: (source: MangaPageSource, page: MangaPageIdentity) => Promise<OcrPage>;
  terminate: () => Promise<void>;
}

export interface JapaneseTextTranslator {
  translate: (texts: readonly string[]) => Promise<string[]>;
  terminate: () => Promise<void>;
}

export type MangaOcrEngineFactory = (
  onProgress?: (progress: { status: string; progress: number }) => void,
) => MangaOcrEngine;

export type JapaneseTextTranslatorFactory = (
  onProgress?: (progress: { status: string; progress: number }) => void,
) => JapaneseTextTranslator;

const MINIMUM_MANGA_OCR_CONFIDENCE = 35;

export interface MangaTranslationEngineOptions {
  onProgress?: (progress: { status: string; progress: number }) => void;
  onDiagnostics?: (diagnostics: MangaTranslationDiagnostics) => void;
}

interface MangaTranslationEngineDependencies {
  createOcrEngine: MangaOcrEngineFactory;
  createTranslator: JapaneseTextTranslatorFactory;
}

export const getMangaOcrEngineOptions = (
  onProgress?: (progress: { status: string; progress: number }) => void,
): PaddleMangaOcrEngineOptions => ({
  minimumConfidence: MINIMUM_MANGA_OCR_CONFIDENCE,
  onProgress,
});

const createOcrEngine: MangaOcrEngineFactory = (onProgress) =>
  new PaddleMangaOcrEngine(getMangaOcrEngineOptions(onProgress));

const createTranslator: JapaneseTextTranslatorFactory = (onProgress) =>
  new BergamotJapaneseTranslator({ onProgress });

const containsJapanese = (text: string): boolean =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);

const DUPLICATED_SMALL_KANA_PAIRS: Readonly<Record<string, string>> = {
  ゃ: 'や',
  ゅ: 'ゆ',
  ょ: 'よ',
  ぁ: 'あ',
  ぃ: 'い',
  ぅ: 'う',
  ぇ: 'え',
  ぉ: 'お',
  ャ: 'ヤ',
  ュ: 'ユ',
  ョ: 'ヨ',
  ァ: 'ア',
  ィ: 'イ',
  ゥ: 'ウ',
  ェ: 'エ',
  ォ: 'オ',
};

export const normalizeJapaneseOcrText = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/\b[A-Za-z]\b/gu, '')
    .replace(/[Oo0○◯]{5,}/gu, '…')
    .replace(
      /([ゃゅょぁぃぅぇぉャュョァィゥェォ])([やゆよあいうえおヤユヨアイウエオ])/gu,
      (pair, smallKana: string, followingKana: string) =>
        DUPLICATED_SMALL_KANA_PAIRS[smallKana] === followingKana ? followingKana : pair,
    )
    .replace(/\s+/gu, '')
    .trim();

export const normalizeEnglishTranslation = (text: string): string => {
  const normalized = text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, ' ')
    .replace(/[^\p{Script=Latin}\p{N}\s.,!?;:'"()\-…]/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1');
  if (!/\p{Script=Latin}/u.test(normalized)) return '';
  if (/(\p{Script=Latin})\1{7,}/iu.test(normalized)) return '';
  if (/\b(\p{Script=Latin}+)(?:[\s,]+\1){5,}\b/iu.test(normalized)) return '';
  const latinLetters = normalized.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (latinLetters < 2 && !/^(?:a|i)[.!?]?$/iu.test(normalized)) return '';
  return normalized
    .replace(/\b([A-Z])([A-Z]+)(?=[a-z])/gu, (_match, first: string, rest: string) =>
      first.concat(rest.toLowerCase()),
    )
    .replace(/\p{Script=Latin}/u, (letter) => letter.toUpperCase());
};

const isTranslatableBlock = (
  block: OcrTextBlock,
): block is OcrTextBlock & {
  bubbleBox: OcrBoundingBox;
  maskBoxes: readonly OcrBoundingBox[];
} =>
  !!block.bubbleBox &&
  !!block.maskBoxes?.length &&
  (block.confidence === undefined || block.confidence >= MINIMUM_MANGA_OCR_CONFIDENCE) &&
  containsJapanese(normalizeJapaneseOcrText(block.text));

export class MangaTranslationEngine {
  readonly #onProgress?: (progress: { status: string; progress: number }) => void;
  readonly #onDiagnostics?: (diagnostics: MangaTranslationDiagnostics) => void;
  readonly #createOcrEngine: MangaOcrEngineFactory;
  readonly #createTranslator: JapaneseTextTranslatorFactory;
  #ocrEngine: MangaOcrEngine | null = null;
  #translator: JapaneseTextTranslator | null = null;
  #terminated = false;

  constructor(
    options: MangaTranslationEngineOptions = {},
    dependencies: Partial<MangaTranslationEngineDependencies> = {},
  ) {
    this.#onProgress = options.onProgress;
    this.#onDiagnostics = options.onDiagnostics;
    this.#createOcrEngine = dependencies.createOcrEngine ?? createOcrEngine;
    this.#createTranslator = dependencies.createTranslator ?? createTranslator;
  }

  async translate(source: MangaPageSource, page: MangaPageIdentity): Promise<TranslatedMangaPage> {
    if (this.#terminated) throw new Error('Manga translation engine has been terminated');
    const recognized = await this.#getOcrEngine().recognize(source, page);
    if (this.#terminated) throw new Error('Manga translation engine has been terminated');

    const candidates = recognized.blocks
      .filter(isTranslatableBlock)
      .map((block) => ({ block, sourceText: normalizeJapaneseOcrText(block.text) }));
    if (!candidates.length) {
      this.#reportDiagnostics(recognized.pageIndex, recognized.blocks.length, 0, [], []);
      return {
        pageIndex: recognized.pageIndex,
        width: recognized.width,
        height: recognized.height,
        regions: [],
      };
    }

    this.#onProgress?.({ status: 'translating speech bubbles', progress: 0 });
    const translations = await this.#getTranslator().translate(
      candidates.map(({ sourceText }) => sourceText),
    );
    if (this.#terminated) throw new Error('Manga translation engine has been terminated');

    const normalizedTranslations = candidates.map((_, index) =>
      normalizeEnglishTranslation(translations[index] ?? ''),
    );
    const regions: TranslatedMangaRegion[] = [];
    for (const [index, { block, sourceText }] of candidates.entries()) {
      const translatedText = normalizedTranslations[index] ?? '';
      if (!translatedText) continue;
      regions.push({
        id: block.id,
        sourceText,
        translatedText,
        ...(block.confidence === undefined ? {} : { confidence: block.confidence }),
        textBox: block.box,
        ...(block.contentBox ? { contentBox: block.contentBox } : {}),
        bubbleBox: block.bubbleBox,
        maskBoxes: block.maskBoxes,
        backgroundColor: block.backgroundColor ?? 'rgb(255 255 255)',
      });
    }
    this.#onProgress?.({ status: 'translating speech bubbles', progress: 1 });
    this.#reportDiagnostics(
      recognized.pageIndex,
      recognized.blocks.length,
      candidates.length,
      translations,
      normalizedTranslations,
      regions.length,
    );
    return {
      pageIndex: recognized.pageIndex,
      width: recognized.width,
      height: recognized.height,
      regions,
    };
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    const ocrEngine = this.#ocrEngine;
    const translator = this.#translator;
    this.#ocrEngine = null;
    this.#translator = null;
    await Promise.all([ocrEngine?.terminate(), translator?.terminate()]);
  }

  #getOcrEngine(): MangaOcrEngine {
    if (this.#terminated) throw new Error('Manga translation engine has been terminated');
    this.#ocrEngine ??= this.#createOcrEngine(this.#onProgress);
    return this.#ocrEngine;
  }

  #getTranslator(): JapaneseTextTranslator {
    if (this.#terminated) throw new Error('Manga translation engine has been terminated');
    this.#translator ??= this.#createTranslator(this.#onProgress);
    return this.#translator;
  }

  #reportDiagnostics(
    pageIndex: number,
    ocrBlocks: number,
    japaneseCandidates: number,
    translations: readonly string[],
    normalizedTranslations: readonly string[],
    finalRegions = 0,
  ): void {
    this.#onDiagnostics?.({
      pageIndex,
      ocrBlocks,
      japaneseCandidates,
      nonEmptyTranslations: translations.filter((translation) => translation.trim()).length,
      normalizedEnglish: normalizedTranslations.filter(Boolean).length,
      finalRegions,
    });
  }
}
