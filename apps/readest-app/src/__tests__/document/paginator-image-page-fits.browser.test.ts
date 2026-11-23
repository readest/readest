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
// its centred spread (readest#6676). `pnpm test:browser:webkit` runs this file
// in WebKit, as CI does; Chromium passes the cover tests either way, while a
// plate that opens its section broke in both.

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
  const open = async (cover: string, pageSpread = 'center') => {
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
    const book = { sections: [makeSection(cover, pageSpread), makeSection(TEXT)] };
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

  // Page-tall images later in a chapter, as in the reporter's book. The
  // descent under an image made its line taller than a page, and WebKit, which
  // never moves anything taller than a page, cut it across two pages where it
  // fell. Once it fits, WebKit carried the paragraph's bottom margin onto the
  // next page and pushed the second image a page further, leaving a blank
  // page. Chromium moves the image whole and drops a margin at a page break.
  it('keeps page-tall images after text whole on consecutive pages', async () => {
    const text = `<p>${'Some text before the example. '.repeat(40)}</p>`;
    const figure = `<p style="margin-bottom: 1em"><img alt="" height="100%" src="${COVER}"/><br/></p>`;
    const { el, doc } = await open(`${text}${figure}${figure}${TEXT}`, '');
    const [first, second] = doc.querySelectorAll('img');
    expect(first!.getClientRects()).toHaveLength(1);
    expect(second!.getClientRects()).toHaveLength(1);
    expect(middleOf(el, second!) - middleOf(el, first!)).toBeCloseTo(1, 1);
  });

  // Plates that open their section, as in the reporter's second book. A top
  // margin on the image's <p> put a page-tall image below the top of the first
  // page, where nothing before it could move to an earlier page: WebKit cut
  // its bottom onto the next page, and Chromium moved it there whole and left
  // the first page blank. The plate now gives up that 1em of its height.
  const PLATE = `<style>p.image { margin: 1em 0 0 0; text-align: center; }</style><div class="wrap"><p class="image"><span id="page_1"></span><img alt="" src="${COVER}"/></p><p>IMAGE SUBTITLE</p></div>`;
  const availableHeight = (doc: Document) =>
    Number(doc.documentElement.style.getPropertyValue('--available-height'));

  // A box that starts a new formatting context keeps its own top margin apart
  // from its children's, so the two add up instead of collapsing into one; a
  // negative margin collapses with a positive one by adding to it. Text or an
  // image that isn't shown doesn't count as coming before the plate.
  it.each([
    ['with only its caption', PLATE, 16],
    ['opening a chapter', `${PLATE}<h1>Chapter</h1><p>${'Chapter text. '.repeat(400)}</p>`, 16],
    [
      'in a box with its own margin',
      `<div style="display: flow-root; margin-top: 1em">${PLATE}</div>`,
      32,
    ],
    ['in a box with a negative margin', `<div style="margin-top: -0.5em">${PLATE}</div>`, 8],
    ['after a hidden heading', `<h1 style="display: none">Plate</h1>${PLATE}`, 16],
    ['after a hidden image', `<img alt="" style="display: none" src="${COVER}"/>${PLATE}`, 16],
    // like the reader's "skip to last reading position" link
    [
      'after an out-of-flow element',
      `<div style="position: absolute; width: 1px; height: 1px; overflow: hidden"></div>${PLATE}`,
      16,
    ],
    [
      'after an out-of-flow label',
      `<div style="position: absolute; top: 0; left: 0">Label</div>${PLATE}`,
      16,
    ],
    [
      'after an out-of-flow image',
      `<img alt="" style="position: absolute; width: 10px; height: 10px" src="${COVER}"/>${PLATE}`,
      16,
    ],
    // a block image's own margin collapses with its parents'
    [
      "shown as a block, its margin joining its box's",
      `<div class="wrap" style="margin-top: 1em"><p class="image" style="margin: 0"><img alt="" style="display: block; margin: 1em auto 0" src="${COVER}"/></p><p>IMAGE SUBTITLE</p></div>`,
      16,
    ],
    [
      'alone, with its own top margin',
      `<p class="image" style="text-align: center"><img alt="" style="margin-top: 1em" src="${COVER}"/></p>`,
      16,
    ],
  ])('keeps a page-tall plate %s whole on the first page', async (_, body, space) => {
    const { el, doc } = await open(body, '');
    const img = doc.querySelector('p.image img')!;
    expect(img.getClientRects()).toHaveLength(1);
    expect(middleOf(el, img)).toBeCloseTo(0.5, 1);
    expect(img.getBoundingClientRect().height).toBe(availableHeight(doc) - space);
  });

  // After text or an empty block with a height, the plate moves to the next
  // page and its margin is dropped at the break, so it keeps the whole page
  // height
  it.each([
    ['text', `<p>${'Some text before. '.repeat(40)}</p>`],
    ['an empty block', '<div style="height: 100px"></div>'],
  ])('keeps the full page height for a plate after %s', async (_, before) => {
    const { el, doc } = await open(`${before}${PLATE}`, '');
    const img = doc.querySelector('p.image img')!;
    expect(img.getClientRects()).toHaveLength(1);
    expect(middleOf(el, img)).toBeCloseTo(1.5, 1);
    expect(img.getBoundingClientRect().height).toBe(availableHeight(doc));
  });

  // Only a plate that fills the page changes: a short image, or one that the
  // column width keeps short (even when the book lifts the width cap, which
  // the paginator puts back), opening a section keeps its margin, the
  // page-height clamp and the book's alignment
  const SQUARE = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#339"/></svg>',
  )}`;
  const WIDE = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900"><rect width="1800" height="900" fill="#393"/></svg>',
  )}`;
  it.each([
    ['a short', `<img alt="" src="${COVER}" height="100"/>`],
    ['a wide', `<img alt="" src="${WIDE}"/>`],
    [
      'an uncapped square',
      `<style>img { max-width: none !important; }</style><img alt="" src="${SQUARE}"/>`,
    ],
  ])('leaves %s image that opens a section as the book set it', async (_, image) => {
    const small = `<style>p.image { margin: 1em 0 0 0; }</style><p class="image">${image}</p><p>Text after the ornament.</p>`;
    const { doc, img } = await open(small, '');
    const root = doc.documentElement;
    const pageTop =
      root.getBoundingClientRect().top + parseFloat(getComputedStyle(root).paddingTop);
    expect(img.getBoundingClientRect().top - pageTop).toBe(16);
    expect((img as HTMLElement).style.maxHeight).toBe(`${availableHeight(doc)}px`);
    expect((img as HTMLElement).style.verticalAlign).toBe('');
  });

  // A plate that stops filling the page after a resize gets the book's
  // alignment, its own inline one included, and the whole page-height clamp
  // back
  it.each([
    ['', PLATE],
    ['middle', PLATE.replace('<img ', '<img style="vertical-align: middle" ')],
  ])('restores a plate that no longer fills the page after a resize (%j)', async (align, body) => {
    const { el, doc, img } = await open(body, '');
    expect((img as HTMLElement).style.verticalAlign).toBe('top');
    const stabilized = waitForStabilized(el);
    el.style.height = '2000px';
    await stabilized;
    await frames(6);
    expect((img as HTMLElement).style.verticalAlign).toBe(align);
    expect((img as HTMLElement).style.maxHeight).toBe(`${availableHeight(doc)}px`);
  });

  // A restyle that grows the space above the plate (a bigger font under an
  // em margin) fits it again without a new layout
  it('fits a plate again after a restyle grows the space above it', async () => {
    const { el, doc } = await open(PLATE, '');
    const img = doc.querySelector('p.image img')!;
    expect(img.getBoundingClientRect().height).toBe(availableHeight(doc) - 16);
    el.setStyles?.(
      `${getStyles(makeViewSettings(), undefined, [])} p.image { margin-top: 2em !important; }`,
    );
    await doc.fonts.ready;
    await frames(10);
    expect(img.getClientRects()).toHaveLength(1);
    expect(middleOf(el, img)).toBeCloseTo(0.5, 1);
    expect(img.getBoundingClientRect().height).toBe(availableHeight(doc) - 32);
  });

  // Only an image alone on its line is top-aligned: a linked icon before text
  // keeps the book's own alignment
  it("keeps the book's alignment for a linked icon before text", async () => {
    const icon = `<style>img.icon { vertical-align: middle; }</style><p><a href="#n"><img class="icon" alt="" src="${COVER}" height="16"/></a> Text after the icon.</p>`;
    const { img } = await open(icon, '');
    expect(getComputedStyle(img).verticalAlign).toBe('middle');
  });
});
