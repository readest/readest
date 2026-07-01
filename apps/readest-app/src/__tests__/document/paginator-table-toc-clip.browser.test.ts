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

// repro-4439.epub: a decorative table-of-contents page laid out as nested
// tables. The inner contents table has a negative top margin and the CONTENTS
// heading uses line-height:1em. Wrapping the table in a `.scroll-wrapper`
// (#4400) turned it into an overflow:auto clip box, and the negative margin bled
// the top of the heading above that box, cutting the glyphs in half (#4439).
const TOC_EPUB_URL = new URL('../fixtures/data/repro-4439.epub', import.meta.url).href;
// The contents page is the second spine item (cover, contents, ch1).
const TOC_SECTION_INDEX = 1;
const TOLERANCE_PX = 2;

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

const getSectionDoc = (paginator: Renderer, index: number): Document | null =>
  paginator.getContents().find((c) => c.index === index)?.doc ?? null;

// Nearest ancestor that clips its overflow (the scroll-wrapper, when scrollable).
const nearestClipAncestor = (el: HTMLElement): HTMLElement | null => {
  let cur: HTMLElement | null = el.parentElement;
  const win = el.ownerDocument.defaultView!;
  while (cur) {
    if (win.getComputedStyle(cur).overflow !== 'visible') return cur;
    cur = cur.parentElement;
  }
  return null;
};

let tocBook: BookDoc;

describe('Paginator decorative TOC table', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    tocBook = await loadEPUB(TOC_EPUB_URL, 'repro-4439.epub');
    await import('foliate-js/paginator.js');
  }, 30000);

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

  it('does not clip the top of a heading inside a wrapped layout table', async () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '320px',
      height: '800px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    paginator = el;

    paginator.open(tocBook);
    paginator.setStyles?.(getStyles(makeViewSettings(), undefined, []));

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: TOC_SECTION_INDEX });
    await stabilized;

    const doc = getSectionDoc(paginator, TOC_SECTION_INDEX);
    expect(doc, 'contents section doc').toBeTruthy();
    paginator.setStyles?.(getStyles(makeViewSettings(), undefined, []));
    applyScrollableStyle(doc!);

    const heading = [...doc!.querySelectorAll<HTMLElement>('p.title')].find((p) =>
      /CONTENTS/.test(p.textContent ?? ''),
    );
    expect(heading, 'CONTENTS heading').toBeTruthy();

    // It must sit inside a scroll-wrapper (otherwise the test would not be
    // exercising the clip path that #4400 introduced).
    expect(heading!.closest(`.${SCROLL_WRAPPER_CLASS}`), 'heading is wrapped').toBeTruthy();

    const clip = nearestClipAncestor(heading!);
    if (clip) {
      const headTop = heading!.getBoundingClientRect().top;
      const clipTop = clip.getBoundingClientRect().top;
      expect(
        headTop,
        `CONTENTS top (${headTop.toFixed(1)}) is clipped above its overflow box top (${clipTop.toFixed(1)})`,
      ).toBeGreaterThanOrEqual(clipTop - TOLERANCE_PX);
    }
  }, 60000);
});
