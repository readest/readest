import { BergamotJapaneseTranslator } from '@/app/reader/services/manga/bergamotTranslator';
import { TesseractOcrEngine } from '@/app/reader/services/ocr/tesseractEngine';
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

interface MangaTranslationEngineOptions {
  onProgress?: (progress: { status: string; progress: number }) => void;
}

interface MangaTranslationEngineDependencies {
  createOcrEngine: MangaOcrEngineFactory;
  createTranslator: JapaneseTextTranslatorFactory;
}

const createOcrEngine: MangaOcrEngineFactory = (onProgress) =>
  new TesseractOcrEngine({
    languages: ['jpn_vert'],
    mangaMode: true,
    minimumConfidence: MINIMUM_MANGA_OCR_CONFIDENCE,
    onProgress,
  });

const createTranslator: JapaneseTextTranslatorFactory = (onProgress) =>
  new BergamotJapaneseTranslator({ onProgress });

const containsJapanese = (text: string): boolean =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);

export const normalizeJapaneseOcrText = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[A-Za-z]+/gu, '')
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

    const regions: TranslatedMangaRegion[] = [];
    for (const [index, { block, sourceText }] of candidates.entries()) {
      const translatedText = normalizeEnglishTranslation(translations[index] ?? '');
      if (!translatedText) continue;
      regions.push({
        id: block.id,
        sourceText,
        translatedText,
        ...(block.confidence === undefined ? {} : { confidence: block.confidence }),
        textBox: block.box,
        bubbleBox: block.bubbleBox,
        maskBoxes: block.maskBoxes,
        backgroundColor: block.backgroundColor ?? 'rgb(255 255 255)',
      });
    }
    this.#onProgress?.({ status: 'translating speech bubbles', progress: 1 });
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
}
