import { describe, expect, it, vi } from 'vitest';

import type { TranslatedMangaPage } from '@/app/reader/services/manga/mangaTranslationEngine';
import {
  MangaTranslationSession,
  type MangaTranslationSessionEngine,
} from '@/app/reader/services/manga/mangaTranslationSession';
import { MANGA_TRANSLATION_LAYER_SELECTOR } from '@/app/reader/utils/mangaTranslationLayer';

const makePage = (pageIndex: number): TranslatedMangaPage => ({
  pageIndex,
  width: 1200,
  height: 1800,
  regions: [
    {
      id: `bubble-${pageIndex}`,
      sourceText: '危ない',
      translatedText: `Watch out on page ${pageIndex}!`,
      textBox: { xMin: 200, yMin: 300, xMax: 400, yMax: 600 },
      bubbleBox: { xMin: 150, yMin: 250, xMax: 500, yMax: 700 },
      maskBoxes: [{ xMin: 200, yMin: 300, xMax: 400, yMax: 600 }],
      backgroundColor: 'rgb(255 255 255)',
    },
  ],
});

const makeDocument = (pageIndex: number): Document => {
  const doc = document.implementation.createHTMLDocument();
  const image = doc.createElement('img');
  image.src = `blob:manga-page-${pageIndex}`;
  Object.defineProperties(image, {
    naturalWidth: { value: 1200 },
    naturalHeight: { value: 1800 },
  });
  doc.body.append(image);
  return doc;
};

const makeEngine = (): MangaTranslationSessionEngine => ({
  translate: vi.fn(async (_source, { pageIndex }) => makePage(pageIndex)),
  terminate: vi.fn(async () => undefined),
});

describe('MangaTranslationSession', () => {
  it('translates registered pages only after activation and restores cached reloads', async () => {
    const engine = makeEngine();
    const onPageTranslated = vi.fn();
    const session = new MangaTranslationSession({
      createEngine: () => engine,
      onPageTranslated,
    });
    const firstDocument = makeDocument(3);

    await session.processDocument(firstDocument, 3);
    expect(engine.translate).not.toHaveBeenCalled();
    await session.setEnabled(true);

    expect(engine.translate).toHaveBeenCalledWith('blob:manga-page-3', {
      pageIndex: 3,
      width: 1200,
      height: 1800,
    });
    expect(firstDocument.querySelector(MANGA_TRANSLATION_LAYER_SELECTOR)?.textContent).toContain(
      'Watch out on page 3!',
    );
    expect(onPageTranslated).toHaveBeenCalledOnce();

    const replacement = makeDocument(3);
    await session.processDocument(replacement, 3);
    expect(engine.translate).toHaveBeenCalledTimes(1);
    expect(replacement.querySelector(MANGA_TRANSLATION_LAYER_SELECTOR)?.textContent).toContain(
      'Watch out on page 3!',
    );
  });

  it('removes translations and releases the engine when disabled', async () => {
    const engine = makeEngine();
    const session = new MangaTranslationSession({ createEngine: () => engine });
    const doc = makeDocument(1);
    await session.processDocument(doc, 1);
    await session.setEnabled(true);

    await session.setEnabled(false);

    expect(doc.querySelector(MANGA_TRANSLATION_LAYER_SELECTOR)).toBeNull();
    expect(engine.terminate).toHaveBeenCalledOnce();
  });

  it('does not mount a result that completes after deactivation', async () => {
    let finish!: (page: TranslatedMangaPage) => void;
    const engine = makeEngine();
    vi.mocked(engine.translate).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const session = new MangaTranslationSession({ createEngine: () => engine });
    const doc = makeDocument(4);
    await session.processDocument(doc, 4);

    const activation = session.setEnabled(true);
    await vi.waitFor(() => expect(engine.translate).toHaveBeenCalledOnce());
    await session.setEnabled(false);
    finish(makePage(4));
    await activation;

    expect(doc.querySelector(MANGA_TRANSLATION_LAYER_SELECTOR)).toBeNull();
  });

  it('translates pages serially through one engine', async () => {
    let finishFirst!: (page: TranslatedMangaPage) => void;
    const engine = makeEngine();
    vi.mocked(engine.translate)
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockImplementationOnce(async (_source, { pageIndex }) => makePage(pageIndex));
    const session = new MangaTranslationSession({ createEngine: () => engine });
    await session.processDocument(makeDocument(0), 0);
    await session.processDocument(makeDocument(1), 1);

    const activation = session.setEnabled(true);
    await vi.waitFor(() => expect(engine.translate).toHaveBeenCalledTimes(1));
    finishFirst(makePage(0));
    await activation;

    expect(engine.translate).toHaveBeenCalledTimes(2);
  });

  it('reports failures without persisting or mounting a partial page', async () => {
    const error = new Error('translation failed');
    const engine = makeEngine();
    vi.mocked(engine.translate).mockRejectedValueOnce(error);
    const onError = vi.fn();
    const session = new MangaTranslationSession({ createEngine: () => engine, onError });
    const doc = makeDocument(8);
    await session.setEnabled(true);

    expect(await session.processDocument(doc, 8)).toBeNull();
    expect(onError).toHaveBeenCalledWith(error, 8);
    expect(doc.querySelector(MANGA_TRANSLATION_LAYER_SELECTOR)).toBeNull();
  });
});
