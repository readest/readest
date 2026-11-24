import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';

const mocks = vi.hoisted(() => ({
  preservesMarkup: false,
  translate: vi.fn(async (_texts: string[]) => ['译文']),
  settings: {
    translationEnabled: true,
    translationProvider: 'test',
    translateTargetLang: 'zh',
    showTranslateSource: true,
  },
  setIsLoading: vi.fn(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (state: unknown) => unknown) =>
    select({ getViewSettings: () => mocks.settings, setIsLoading: mocks.setIsLoading }),
}));
vi.mock('@/store/bookDataStore', () => ({ useBookDataStore: () => undefined }));
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => null }));
vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({ translate: mocks.translate, translator: { concurrency: 5 } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/services/translators', () => ({
  getTranslators: () => [{ name: 'test', preservesMarkup: mocks.preservesMarkup }],
}));

const observers: Array<{ targets: Element[]; intersect: () => void }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.translate.mockClear();
  mocks.preservesMarkup = false;
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      targets: Element[] = [];
      constructor(callback: IntersectionObserverCallback) {
        observers.push({
          targets: this.targets,
          intersect: () =>
            callback(
              this.targets.map(
                (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
              ),
              this as unknown as IntersectionObserver,
            ),
        });
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets.length = 0;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const translatePage = async (markup: string) => {
  const view = document.createElement('div');
  view.innerHTML = markup;
  renderHook(() => useTextTranslation('book', view));
  await act(async () => {
    observers.forEach((observer) => observer.intersect());
    await vi.advanceTimersByTimeAsync(50);
  });
  return view;
};

describe('page translation with ruby', () => {
  it.each([
    false,
    true,
  ])('excludes native readings with preservesMarkup=%s', async (preservesMarkup) => {
    mocks.preservesMarkup = preservesMarkup;
    const view = await translatePage(
      '<p><ruby><strong>漢字</strong><rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>を読む。</p>',
    );

    expect(mocks.translate).toHaveBeenCalledExactlyOnceWith([
      preservesMarkup ? '<strong>漢字</strong>を読む。' : '漢字を読む。',
    ]);
    expect(view.querySelector('rt')?.textContent).toBe('かんじ');
    expect(Array.from(view.querySelectorAll('rp'), (node) => node.textContent)).toEqual(['(', ')']);
    expect(view.querySelector('.translation-target')?.textContent).toBe('译文');
  });

  it('does not discover readings or fallback parentheses as separate translation sources', async () => {
    const view = await translatePage(
      '<p><ruby><rb>漢字</rb><rp>(</rp><rt><span>かんじ</span></rt><rp>)</rp></ruby></p>',
    );

    expect(mocks.translate).toHaveBeenCalledExactlyOnceWith(['漢字']);
    expect(view.querySelector('rt')?.innerHTML).toBe('<span>かんじ</span>');
  });

  it('uses cleaned text for WordLens readings with a plain-text provider', async () => {
    await translatePage('<p>The <ruby class="wl-gloss">辞書<rt>じしょ</rt></ruby> is open.</p>');

    expect(mocks.translate).toHaveBeenCalledExactlyOnceWith(['The 辞書 is open.']);
  });

  it('does not request a translation when only a reading remains', async () => {
    await translatePage('<p> <ruby><rt>かんじ</rt></ruby> </p>');

    expect(mocks.translate).not.toHaveBeenCalled();
  });
});
