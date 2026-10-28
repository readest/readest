import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOOK_LAYOUT } from '@/services/constants';
import { ViewSettings } from '@/types/book';
import { expectsColumnSpread } from '@/utils/config';
import {
  applyRendererLayout,
  getDuoColumnLayout,
  getDuoPose,
  getDuoSpineGutter,
  getRendererLayout,
  isRendererSpread,
} from '@/utils/duo';

const settings = (overrides: Partial<ViewSettings> = {}) =>
  ({
    ...DEFAULT_BOOK_LAYOUT,
    maxColumnCount: 2,
    maxInlineSize: 720,
    columnGapPx: 0,
    spreadMode: 'none',
    duoBookMode: true,
    scrolled: false,
    vertical: false,
    ...overrides,
  }) as ViewSettings;

const setViewport = (width: number, height: number) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
};

afterEach(() => vi.unstubAllGlobals());

const flatFold = { status: 'open' as const, regionActive: false };
const bookFold = {
  status: 'partial' as const,
  regionActive: true,
  region: { x: 455, y: 0, width: 40.4, height: 669 },
};

describe('getDuoPose', () => {
  it('is off on every other device, whatever the viewport', () => {
    expect(getDuoPose(false, 951, 669)).toBe('off');
    expect(getDuoPose(false, 669, 951)).toBe('off');
  });

  it('names each iPhone Duo display and orientation', () => {
    expect(getDuoPose(true, 466, 678)).toBe('cover');
    expect(getDuoPose(true, 678, 466)).toBe('cover');
    expect(getDuoPose(true, 951, 669)).toBe('inner-landscape');
    expect(getDuoPose(true, 669, 951)).toBe('inner-portrait');
  });

  it('treats half of the inner display in Split View like the cover display', () => {
    expect(getDuoPose(true, 475, 669)).toBe('cover');
    expect(getDuoPose(true, 669, 475)).toBe('cover');
  });
});

describe('getDuoSpineGutter', () => {
  it('is 0 while the display is flat or the region is unknown', () => {
    expect(getDuoSpineGutter(null)).toBe(0);
    expect(getDuoSpineGutter(flatFold)).toBe(0);
    expect(getDuoSpineGutter({ ...bookFold, regionActive: false })).toBe(0);
  });

  it('is the width of an active vertical folding region', () => {
    expect(getDuoSpineGutter(bookFold)).toBe(41);
  });

  it('ignores a horizontal region (the hinge across inner portrait)', () => {
    expect(
      getDuoSpineGutter({
        status: 'partial',
        regionActive: true,
        region: { x: 0, y: 455, width: 669, height: 40 },
      }),
    ).toBe(0);
  });
});

describe('getDuoColumnLayout', () => {
  const columns = (width: number, layout: { maxColumnCount: number; maxInlineSize: number }) =>
    Math.min(layout.maxColumnCount, Math.ceil(width / layout.maxInlineSize));

  it.each([
    300, 400, 720, 900, 2000,
  ])('gives exactly two columns that fill the page for a %ipx max column width', (maxInlineSize) => {
    const layout = getDuoColumnLayout(true, 891, maxInlineSize);
    expect(columns(891, layout)).toBe(2);
    expect(layout.maxInlineSize).toBeGreaterThanOrEqual(891 / 2);
  });

  it('gives one column at the reader’s own width without book mode', () => {
    expect(getDuoColumnLayout(false, 891, 720)).toEqual({ maxColumnCount: 1, maxInlineSize: 720 });
  });
});

describe('getRendererLayout', () => {
  it('keeps the reader’s settings off the Duo and outside the book pose', () => {
    setViewport(951, 669);
    const viewSettings = settings({ maxColumnCount: 3, columnGapPx: 12, spreadMode: 'none' });
    const own = {
      maxColumnCount: 3,
      maxInlineSize: 720,
      spreadMode: 'none',
      columnGapPx: 12,
    };
    expect(getRendererLayout(viewSettings, 'off', 951, bookFold)).toEqual(own);
    expect(getRendererLayout(viewSettings, 'cover', 466, bookFold)).toEqual(own);
    expect(getRendererLayout(viewSettings, 'inner-portrait', 669, bookFold)).toEqual(own);
  });

  it('shows two pages and a two-page spread in book mode', () => {
    setViewport(951, 669);
    const layout = getRendererLayout(
      settings({ maxColumnCount: 1 }),
      'inner-landscape',
      891,
      flatFold,
    );
    expect(layout.maxColumnCount).toBe(2);
    expect(layout.spreadMode).toBe('auto');
    expect(layout.columnGapPx).toBe(0);
  });

  it('shows one page and no spread without book mode', () => {
    setViewport(951, 669);
    const layout = getRendererLayout(
      settings({ duoBookMode: false, spreadMode: 'auto' }),
      'inner-landscape',
      891,
      bookFold,
    );
    expect(layout.maxColumnCount).toBe(1);
    expect(layout.spreadMode).toBe('none');
    expect(layout.columnGapPx).toBe(0);
  });

  it('keeps the crease clear while the device is part way folded', () => {
    setViewport(951, 669);
    expect(getRendererLayout(settings(), 'inner-landscape', 891, bookFold).columnGapPx).toBe(73);
    // A wider gap of the reader's own is kept.
    expect(
      getRendererLayout(settings({ columnGapPx: 120 }), 'inner-landscape', 891, bookFold)
        .columnGapPx,
    ).toBe(120);
  });

  it('leaves vertical writing alone', () => {
    setViewport(951, 669);
    const layout = getRendererLayout(settings({ vertical: true }), 'inner-landscape', 891, null);
    expect(layout.maxColumnCount).toBe(2);
    expect(layout.spreadMode).toBe('none');
  });
});

describe('isRendererSpread', () => {
  it('follows the paginator’s column count for reflowable books', () => {
    setViewport(951, 669);
    const viewSettings = settings();
    const book = getRendererLayout(viewSettings, 'inner-landscape', 891, null);
    expect(isRendererSpread(viewSettings, book, 'inner-landscape', false, 891)).toBe(true);
    const single = getRendererLayout(
      settings({ duoBookMode: false }),
      'inner-landscape',
      891,
      null,
    );
    expect(isRendererSpread(viewSettings, single, 'inner-landscape', false, 891)).toBe(false);
  });

  it('is a fixed-layout spread only on the wide inner display', () => {
    setViewport(951, 669);
    const viewSettings = settings({ spreadMode: 'auto' });
    const layout = getRendererLayout(viewSettings, 'inner-landscape', 891, null);
    expect(isRendererSpread(viewSettings, layout, 'inner-landscape', true, 891)).toBe(true);
    expect(isRendererSpread(viewSettings, layout, 'inner-portrait', true, 669)).toBe(false);
  });
});

// docs/safe-area-insets.md: every Duo rule keeps other devices as they were.
describe('parity off iPhone Duo', () => {
  const viewports: [string, number, number][] = [
    ['iPhone portrait', 393, 852],
    ['iPhone landscape', 852, 393],
    ['iPad', 1024, 1366],
    ['Android with a cutout', 412, 915],
    ['960x640', 960, 640],
    ['1024x680', 1024, 680],
    ['desktop', 1440, 900],
  ];

  it.each(viewports)('%s keeps the reader’s own layout', (_, width, height) => {
    setViewport(width, height);
    const pose = getDuoPose(false, width, height);
    expect(pose).toBe('off');
    for (const viewSettings of [
      settings(),
      settings({ maxColumnCount: 1, spreadMode: 'auto', columnGapPx: 24 }),
      settings({ duoBookMode: false, scrolled: true }),
    ]) {
      const layout = getRendererLayout(viewSettings, pose, width, bookFold);
      expect(layout).toEqual({
        maxColumnCount: viewSettings.maxColumnCount,
        maxInlineSize: 720,
        spreadMode: viewSettings.spreadMode,
        columnGapPx: viewSettings.columnGapPx,
      });
      expect(isRendererSpread(viewSettings, layout, pose, false, width)).toBe(
        expectsColumnSpread(viewSettings, width),
      );
    }
  });
});

describe('scrolled flow in the book pose', () => {
  it('keeps the reader’s layout and is never a spread', () => {
    setViewport(951, 669);
    const viewSettings = settings({ scrolled: true, spreadMode: 'none' });
    const layout = getRendererLayout(viewSettings, 'inner-landscape', 891, bookFold);
    expect(layout.spreadMode).toBe('none');
    expect(layout.maxColumnCount).toBe(2);
    expect(isRendererSpread(viewSettings, layout, 'inner-landscape', true, 891)).toBe(false);
    expect(isRendererSpread(viewSettings, layout, 'inner-landscape', false, 891)).toBe(false);
  });
});

describe('applyRendererLayout', () => {
  const fakeRenderer = (initial: Record<string, string> = {}) => {
    const attrs = new Map(Object.entries(initial));
    const setAttribute = vi.fn((name: string, value: string) => attrs.set(name, value));
    return { attrs, setAttribute, getAttribute: (name: string) => attrs.get(name) ?? null };
  };
  const layout = {
    maxColumnCount: 2,
    maxInlineSize: 668,
    spreadMode: 'auto' as const,
    columnGapPx: 0,
  };

  it('sets columns and inline size for reflowable books, only when they change', () => {
    const renderer = fakeRenderer({ 'max-column-count': '1', 'max-inline-size': '668px' });
    applyRendererLayout(renderer, layout, { layout: 'reflowable' });
    expect(renderer.setAttribute).toHaveBeenCalledTimes(1);
    expect(renderer.attrs.get('max-column-count')).toBe('2');
    applyRendererLayout(renderer, layout, { layout: 'reflowable' });
    expect(renderer.setAttribute).toHaveBeenCalledTimes(1);
  });

  it('sets the spread on the renderer and the rendition for fixed layouts', () => {
    const renderer = fakeRenderer({ spread: 'none' });
    const rendition = { layout: 'pre-paginated', spread: 'none' };
    applyRendererLayout(renderer, layout, rendition);
    expect(renderer.attrs.get('spread')).toBe('auto');
    expect(rendition.spread).toBe('auto');
    expect(renderer.attrs.has('max-column-count')).toBe(false);
  });
});
