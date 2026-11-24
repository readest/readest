import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { ViewSettings } from '@/types/book';
import type { Renderer } from '@/types/view';
import { getStyles } from '@/utils/style';
import {
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';

const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
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
    ...overrides,
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

describe('Scrolled mode keeps the text in view across a restyle (browser)', () => {
  let book: BookDoc;
  let paginator: Renderer;

  beforeAll(async () => {
    const buffer = await (await fetch(EPUB_URL)).arrayBuffer();
    const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
    ({ book } = await new DocumentLoader(file).open());
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      paginator.destroy();
    } catch {
      /* iframe body may already be torn down */
    }
    paginator.remove();
  });

  /**
   * setStyles re-anchors once every document's fonts are ready and its view
   * has expanded; wait for the same fonts, then two frames for the scroll.
   */
  const settled = async () => {
    await Promise.all(paginator.getContents().map(({ doc }) => doc.fonts.ready));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  /** Open the longest section in scrolled mode, scrolled to its middle. */
  const openAtMiddle = async () => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');
    paginator.setStyles?.(getStyles(makeViewSettings({ defaultFontSize: 16 }), undefined, []));
    const sections = book.sections!;
    const idx = sections.reduce(
      (best, s, i) => ((s.size ?? 0) > (sections[best]!.size ?? 0) ? i : best),
      0,
    );
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx, anchor: 0.5 });
    await stabilized;
    await settled();
    // The character 100px below the top of the viewport, as a one-character
    // range so it has a rect.
    const y = paginator.getBoundingClientRect().top + 100;
    for (const { doc } of paginator.getContents()) {
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      if (y < frame.top || y >= frame.bottom) continue;
      const caret = doc.caretPositionFromPoint(frame.width / 2, y - frame.top);
      if (caret?.offsetNode.nodeType !== Node.TEXT_NODE) continue;
      const text = caret.offsetNode as Text;
      const range = doc.createRange();
      range.setStart(text, Math.min(caret.offset, text.length - 1));
      range.setEnd(text, range.startOffset + 1);
      return range;
    }
    throw new Error('no text 100px below the top of the viewport');
  };

  /** Top of `range` relative to the paginator's top edge. */
  const topInViewport = (range: Range) => {
    const frame = range.startContainer.ownerDocument!.defaultView!.frameElement!;
    const top = frame.getBoundingClientRect().top + range.getBoundingClientRect().top;
    return top - paginator.getBoundingClientRect().top;
  };

  it('keeps the text in view when the font size grows or shrinks (#7599)', async () => {
    const range = await openAtMiddle();

    for (const defaultFontSize of [24, 12]) {
      paginator.setStyles?.(getStyles(makeViewSettings({ defaultFontSize }), undefined, []));
      await settled();
      const top = topInViewport(range);
      expect(top, `top of the text in view at ${defaultFontSize}px`).toBeGreaterThanOrEqual(-30);
      expect(top, `top of the text in view at ${defaultFontSize}px`).toBeLessThan(600);
    }
  }, 30000);

  it('does not move the text when a restyle does not reflow it', async () => {
    const range = await openAtMiddle();
    const before = topInViewport(range);
    paginator.setStyles?.(
      getStyles(makeViewSettings({ defaultFontSize: 16, overrideColor: true }), undefined, []),
    );
    await settled();
    expect(topInViewport(range)).toBeCloseTo(before, 0);
  }, 30000);
});
