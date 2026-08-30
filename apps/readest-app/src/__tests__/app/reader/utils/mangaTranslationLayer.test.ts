import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslatedMangaPage } from '@/app/reader/services/manga/mangaTranslationEngine';
import {
  findLargestFittingFontSize,
  getMaximumMangaFontSize,
  MANGA_TRANSLATION_LAYER_SELECTOR,
  mountMangaTranslationLayer,
  removeMangaTranslationLayer,
} from '@/app/reader/utils/mangaTranslationLayer';

const makePage = (overrides: Partial<TranslatedMangaPage> = {}): TranslatedMangaPage => ({
  pageIndex: 3,
  width: 1000,
  height: 2000,
  regions: [
    {
      id: 'bubble-0',
      sourceText: '危ない',
      translatedText: 'safe <img src=x onerror=alert(1)> text',
      textBox: { xMin: 150, yMin: 250, xMax: 300, yMax: 450 },
      bubbleBox: { xMin: 100, yMin: 200, xMax: 500, yMax: 600 },
      maskBoxes: [{ xMin: 150, yMin: 250, xMax: 300, yMax: 450 }],
      backgroundColor: 'rgb(250 248 242)',
    },
  ],
  ...overrides,
});

describe('mangaTranslationLayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren(document.createElement('img'));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  it('masks source text and mounts safe English inside the detected bubble', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });

    const layer = mountMangaTranslationLayer(document, makePage());

    expect(layer).not.toBeNull();
    expect(document.querySelectorAll(MANGA_TRANSLATION_LAYER_SELECTOR)).toHaveLength(1);
    expect(layer?.style.pointerEvents).toBe('none');
    expect(layer?.style.overflow).toBe('hidden');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');

    const mask = layer?.querySelector<HTMLElement>('[data-readest-manga-mask]');
    expect(mask?.style.backgroundColor).toBe('rgb(250, 248, 242)');
    expect(Number.parseFloat(mask?.style.left ?? '')).toBeCloseTo(13.8);
    expect(Number.parseFloat(mask?.style.top ?? '')).toBeCloseTo(11.9);
    expect(Number.parseFloat(mask?.style.width ?? '')).toBeCloseTo(17.4);
    expect(Number.parseFloat(mask?.style.height ?? '')).toBeCloseTo(11.2);

    const bubble = layer?.querySelector<HTMLElement>('[data-readest-manga-region-id="bubble-0"]');
    const text = bubble?.querySelector<HTMLElement>('[data-readest-manga-text]');
    expect(bubble?.style.left).toBe('14%');
    expect(bubble?.style.top).toBe('12%');
    expect(bubble?.style.width).toBe('32%');
    expect(bubble?.style.height).toBe('16%');
    expect(bubble?.style.overflow).toBe('hidden');
    expect(bubble?.style.pointerEvents).toBe('none');
    expect(bubble?.style.userSelect).toBe('none');
    expect(text?.textContent).toBe('safe <img src=x onerror=alert(1)> text');
    expect(text?.querySelector('img')).toBeNull();
    expect(text?.style.overflowWrap).toBe('anywhere');
    expect(text?.style.maxWidth).toBe('100%');
    expect(text?.style.overflow).toBe('visible');
    expect(text?.style.transformOrigin).toBe('center center');
    expect(animate).toHaveBeenCalled();
  });

  it('scales text that cannot fit at the minimum font size', () => {
    let fitText: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      fitText = callback;
      return 1;
    });

    const layer = mountMangaTranslationLayer(document, makePage());
    const container = layer?.querySelector<HTMLElement>('[data-readest-manga-region-id]');
    const text = container?.querySelector<HTMLElement>('[data-readest-manga-text]');
    Object.defineProperties(container!, {
      clientWidth: { configurable: true, value: 80 },
      clientHeight: { configurable: true, value: 40 },
    });
    Object.defineProperties(text!, {
      scrollWidth: { configurable: true, value: 160 },
      scrollHeight: { configurable: true, value: 120 },
    });

    fitText?.(0);

    expect(text?.style.fontSize).toBe('4px');
    const scale = Number.parseFloat(text?.style.transform.match(/scale\(([^)]+)\)/u)?.[1] ?? '1');
    expect(160 * scale).toBeLessThanOrEqual(80);
    expect(120 * scale).toBeLessThanOrEqual(40);
  });

  it('clamps masks and bubble text to the page and skips invalid regions', () => {
    const page = makePage({
      regions: [
        {
          ...makePage().regions[0]!,
          id: 'clamped',
          textBox: { xMin: -50, yMin: -50, xMax: 1200, yMax: 2200 },
          bubbleBox: { xMin: -100, yMin: -100, xMax: 1100, yMax: 2100 },
          maskBoxes: [{ xMin: -50, yMin: -50, xMax: 1200, yMax: 2200 }],
        },
        {
          ...makePage().regions[0]!,
          id: 'invalid',
          translatedText: '   ',
        },
      ],
    });

    const layer = mountMangaTranslationLayer(document, page);

    expect(layer?.querySelectorAll('[data-readest-manga-region-id]')).toHaveLength(1);
    const bubble = layer?.querySelector<HTMLElement>('[data-readest-manga-region-id="clamped"]');
    expect(Number.parseFloat(bubble?.style.left ?? '')).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(bubble?.style.top ?? '')).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(bubble?.style.width ?? '')).toBeLessThanOrEqual(100);
    expect(Number.parseFloat(bubble?.style.height ?? '')).toBeLessThanOrEqual(100);
  });

  it('disables motion when the reader requests reduced motion', () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);

    mountMangaTranslationLayer(document, makePage());

    expect(animate).not.toHaveBeenCalled();
  });

  it('replaces and removes stale layers and rejects invalid pages', () => {
    mountMangaTranslationLayer(document, makePage());
    mountMangaTranslationLayer(document, makePage({ pageIndex: 4 }));
    expect(document.querySelectorAll(MANGA_TRANSLATION_LAYER_SELECTOR)).toHaveLength(1);

    removeMangaTranslationLayer(document);
    expect(document.querySelector(MANGA_TRANSLATION_LAYER_SELECTOR)).toBeNull();
    expect(mountMangaTranslationLayer(document, makePage({ width: 0 }))).toBeNull();
    expect(mountMangaTranslationLayer(document, makePage({ regions: [] }))).toBeNull();
  });
});

describe('findLargestFittingFontSize', () => {
  it('finds the largest fitting size without exceeding the bounds', () => {
    const size = findLargestFittingFontSize({
      minimum: 4,
      maximum: 40,
      fits: (candidate) => candidate <= 17.25,
    });

    expect(size).toBeGreaterThanOrEqual(17);
    expect(size).toBeLessThanOrEqual(17.25);
  });

  it('returns the minimum when no tested size fits', () => {
    expect(findLargestFittingFontSize({ minimum: 4, maximum: 40, fits: () => false })).toBe(4);
  });
});

describe('getMaximumMangaFontSize', () => {
  it('keeps comic text proportional to its bubble', () => {
    expect(getMaximumMangaFontSize(144, 146)).toBe(36);
    expect(getMaximumMangaFontSize(500, 500)).toBe(48);
    expect(getMaximumMangaFontSize(8, 8)).toBe(4);
  });
});
