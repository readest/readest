import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { ViewSettings } from '@/types/book';
import type { Renderer } from '@/types/view';
import { applyImageStyle, applyScrollModeClass, getStyles } from '@/utils/style';
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

// A section that holds nothing but one image (a cover, a plate) has it sized to
// the page. Readest's paragraph spacing put a top margin on the image's <p>,
// and an inline image sits on the baseline with the line's descent below it, so
// its line came out taller than a page. Chromium lets that overflow into the
// bottom margin; WebKit carries it onto the next page, so on macOS and iOS the
// bottom of the cover showed at the top of the next page and the cover lost
// its centred spread (readest#6676). Run with `--browser.name=webkit` to see
// the WebKit failure; Chromium passes either way.

const makeViewSettings = () =>
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

// A portrait cover, taller than the page at any column width
const COVER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#933"/></svg>',
)}`;

const makeSection = (body: string, pageSpread = '') => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><style>body { font: 16px/1.4 serif; }</style></head>
  <body>${body}</body>
</html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { load: () => src, unload: () => {}, size: html.length, pageSpread };
};

const TEXT = '<p>Text after the cover.</p>';

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

const frames = (n = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(n);
  });

describe('a section holding only an image fits one page (readest#6676)', () => {
  let paginator: Renderer | null = null;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(async () => {
    if (paginator) {
      await frames();
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
      paginator = null;
    }
  });

  // Two pages to a spread, with the reader's page margins, as on a desktop
  const open = async (cover: string) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '1200px',
      height: '700px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    el.setAttribute('max-inline-size', '720px');
    el.setAttribute('max-column-count', '2');
    el.setAttribute('gap', '5%');
    for (const side of ['top', 'right', 'bottom', 'left'])
      el.setAttribute(`margin-${side}`, '44px');
    // The load-time fix-ups FoliateViewer runs on each section
    el.addEventListener('load', (e) => {
      const { doc } = (e as CustomEvent<{ doc: Document }>).detail;
      applyImageStyle(doc);
      applyScrollModeClass(doc, false);
    });
    document.body.appendChild(el);
    paginator = el;
    const book = { sections: [makeSection(cover, 'center'), makeSection(TEXT)] };
    el.open(book as unknown as BookDoc);
    el.setStyles?.(getStyles(makeViewSettings(), undefined, []));
    const stabilized = waitForStabilized(el);
    await el.goTo({ index: 0 });
    await stabilized;
    const doc = el.getContents().find((c) => c.index === 0)!.doc;
    const img = doc.querySelector('img, svg') as Element;
    if (img instanceof HTMLImageElement && !img.complete) {
      await new Promise((r) => img.addEventListener('load', r, { once: true }));
    }
    await frames(6);
    return { el, doc, img };
  };

  // Where an element's middle is, in pages from the start of the strip
  const middleOf = (el: Renderer, node: Element) => {
    const box = (el as unknown as HTMLElement).shadowRoot!.querySelector(
      '#container',
    ) as HTMLElement;
    const c = box.getBoundingClientRect();
    const frame = (
      node.ownerDocument.defaultView!.frameElement as HTMLElement
    ).getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return (frame.left + r.left + r.width / 2 - c.left + box.scrollLeft) / (c.width / 2);
  };

  it.each([
    ['a paragraph', `<p><img alt="" src="${COVER}" width="100%"/></p>`],
    ['a div', `<div><img alt="" src="${COVER}"/></div>`],
    [
      'an svg wrapper',
      `<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid meet"><image width="600" height="900" xlink:href="${COVER}"/></svg></div>`,
    ],
  ])('keeps a cover image in %s whole on one centred page', async (_, cover) => {
    const { el, doc, img } = await open(cover);
    // Every line box of the section stays on its one page: nothing of the
    // image, nor a blank strip of its line, moves to the next page
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const lefts = new Set([...range.getClientRects()].map((r) => Math.round(r.left)));
    expect([...lefts]).toHaveLength(1);
    expect(img.getClientRects()).toHaveLength(1);
    // and its page, which the image's wrapper spans, sits in the middle of
    // the spread
    expect(middleOf(el, doc.body.firstElementChild!)).toBeCloseTo(1, 1);
  });
});
