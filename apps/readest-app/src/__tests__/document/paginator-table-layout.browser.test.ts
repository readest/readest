import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { ViewSettings } from '@/types/book';
import type { Renderer } from '@/types/view';
import { getStyles } from '@/utils/style';
import { applyScrollableStyle, SCROLL_WRAPPER_CLASS } from '@/utils/scrollable';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

// sample-table-layout.epub: CSS layout tables (fixed em widths, images +
// wrapping prose) for character/glossary pages. They are designed to fit the
// reading column, so they must NOT get a horizontal scrollbar. Before the fix,
// `.readest-table-scroll > table { width: max-content }` forced every table to
// its unwrapped width, which overflowed the column and showed a scrollbar.
const LAYOUT_EPUB_URL = new URL('../fixtures/data/sample-table-layout.epub', import.meta.url).href;
// sample-table-wide.epub: a single section with a genuinely wide (many-column,
// non-wrapping) data table — it cannot fit the column, so it must SCROLL rather
// than be clipped.
const WIDE_EPUB_URL = new URL('../fixtures/data/sample-table-wide.epub', import.meta.url).href;

// Spine indices of sample-table-layout.epub whose sections contain <table>.
const TABLE_SECTION_INDICES = [2, 3, 4, 9, 10];
// Ignore sub-pixel / border slop when deciding whether a table really overflows.
const TOLERANCE_PX = 4;

const loadEPUB = async (url: string, name: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const { book } = await new DocumentLoader(file).open();
  return book;
};

const makeViewSettings = (): ViewSettings =>
  ({
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
  }) as ViewSettings;

const waitForStabilized = (el: HTMLElement, timeout = 10000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stabilized timeout')), timeout);
    el.addEventListener(
      'stabilized',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const poll = async (fn: () => boolean, timeout = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return fn();
};

const getSectionDoc = (paginator: Renderer, index: number): Document | null =>
  paginator.getContents().find((c) => c.index === index)?.doc ?? null;

const overflow = (w: HTMLElement) => w.scrollWidth - w.clientWidth;
const overflowX = (w: HTMLElement) => w.ownerDocument.defaultView!.getComputedStyle(w).overflowX;
const showsScrollbar = (w: HTMLElement) =>
  ['auto', 'scroll'].includes(overflowX(w)) && overflow(w) > TOLERANCE_PX;
const isClipped = (w: HTMLElement) =>
  !['auto', 'scroll'].includes(overflowX(w)) && overflow(w) > TOLERANCE_PX;

let layoutBook: BookDoc;
let wideBook: BookDoc;

describe('Paginator table layout', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    layoutBook = await loadEPUB(LAYOUT_EPUB_URL, 'sample-table-layout.epub');
    wideBook = await loadEPUB(WIDE_EPUB_URL, 'sample-table-wide.epub');
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = (width: number) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: `${width}px`,
      height: '800px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    return el;
  };

  afterEach(() => {
    if (paginator) {
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
  });

  it('renders layout tables without a horizontal scrollbar', async () => {
    paginator = createPaginator(320);
    paginator.open(layoutBook);
    paginator.setStyles?.(getStyles(makeViewSettings(), undefined, []));

    let checked = 0;
    // Measure each section while it is still loaded (the paginator unloads
    // sections as we navigate, so earlier docs would be detached afterwards).
    for (const index of TABLE_SECTION_INDICES) {
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index });
      await stabilized;
      const doc = getSectionDoc(paginator, index);
      expect(doc, `section ${index} doc`).toBeTruthy();
      paginator.setStyles?.(getStyles(makeViewSettings(), undefined, []));
      applyScrollableStyle(doc!);

      for (const wrapper of doc!.querySelectorAll<HTMLElement>(`.${SCROLL_WRAPPER_CLASS}`)) {
        expect(showsScrollbar(wrapper), `section ${index}: layout table shows a scrollbar`).toBe(
          false,
        );
        expect(isClipped(wrapper), `section ${index}: layout table is clipped`).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60000);

  it('scrolls a table too wide for its column instead of clipping it', async () => {
    paginator = createPaginator(600);
    paginator.open(wideBook);
    paginator.setStyles?.(getStyles(makeViewSettings(), undefined, []));

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;
    const doc = getSectionDoc(paginator, 0);
    expect(doc, 'wide section doc').toBeTruthy();
    paginator.setStyles?.(getStyles(makeViewSettings(), undefined, []));
    applyScrollableStyle(doc!);

    const wrapper = doc!.querySelector<HTMLElement>(`.${SCROLL_WRAPPER_CLASS}`)!;
    expect(wrapper, 'wide-table wrapper').toBeTruthy();
    const table = wrapper.querySelector(':scope > table') as HTMLElement;

    // Confirm this really is a wide table whose non-wrapping cells can't shrink
    // to fit a reading column.
    table.style.width = 'min-content';
    const minContent = table.getBoundingClientRect().width;
    table.style.removeProperty('width');
    expect(minContent, 'wide table min-content width').toBeGreaterThan(500);

    // Constrain the wrapper well below the table — the real-app situation where a
    // wide table can't fit its column. (The bare paginator otherwise widens the
    // column to fit content, so we reproduce the column constraint explicitly.)
    wrapper.style.width = '250px';
    wrapper.style.maxWidth = '250px';
    // The wrapper is statically overflow-x:auto, so an over-wide table scrolls.
    await poll(() => overflow(wrapper) > TOLERANCE_PX);

    expect(overflow(wrapper), 'wide table should overflow its constrained column').toBeGreaterThan(
      TOLERANCE_PX,
    );
    expect(['auto', 'scroll'], 'wide table overflow-x').toContain(overflowX(wrapper));
    expect(isClipped(wrapper), 'wide table is clipped instead of scrolling').toBe(false);
  }, 60000);
});
