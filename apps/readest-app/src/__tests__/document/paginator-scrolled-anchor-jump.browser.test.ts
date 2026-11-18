import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Renderer } from '@/types/view';

// readest#7555: in continuous scrolled mode several sections are mounted side
// by side. A jump to an element or range (a TOC fragment, a bookmark's CFI)
// must land on that anchor in its own section, not one or more sections
// further on.

let paginator: Renderer;
const urls: string[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const container = () => paginator.shadowRoot!.getElementById('container')!;

// Sections of different sizes, so mounting neighbours changes the total.
const SIZES = [1300, 2100, 1700, 2600, 1500, 1900, 2300];

const open = async (vertical: boolean, continuous: boolean) => {
  paginator = document.createElement('foliate-paginator') as Renderer;
  Object.assign(paginator.style, {
    width: '800px',
    height: '600px',
    position: 'absolute',
    top: '0',
    left: '0',
  });
  for (const side of ['top', 'right', 'bottom', 'left'])
    paginator.setAttribute(`margin-${side}`, '16px');
  paginator.setAttribute('flow', 'scrolled');
  if (!continuous) paginator.setAttribute('no-continuous-scroll', '');
  document.body.append(paginator);
  const lines = '<p>Reading across a chapter boundary.</p>'.repeat(20);
  const sections = SIZES.map((size, i) => {
    const html = `<!doctype html><html><head><style>html,body{margin:0}${vertical ? 'html{writing-mode:vertical-rl}' : ''}main{${vertical ? 'width' : 'height'}:${size}px}h1,p{margin:0;line-height:24px;font-size:16px}</style></head><body><main><h1 id="head">Chapter ${i}</h1>${lines}<p id="mid">Bookmarked line.</p>${lines}</main></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    urls.push(url);
    return { id: `chapter-${i}`, linear: 'yes', size: html.length, load: async () => url };
  });
  paginator.open({ dir: vertical ? 'rtl' : 'ltr', sections } as unknown as Parameters<
    Renderer['open']
  >[0]);
  await paginator.goTo({ index: 0, anchor: 0 });
  await settle();
};

// Wait until the mounted set stops changing and the container is shown.
const settle = async () => {
  let last = '';
  for (let stable = 0; stable < 5; ) {
    await pause(100);
    const now = paginator
      .getContents()
      .map((c) => c.index)
      .join();
    stable = now === last && container().style.opacity !== '0' ? stable + 1 : 0;
    last = now;
  }
};

// Distance from the viewport start to the start of `el` along the scroll
// axis: the right edge for vertical-rl, the top edge for horizontal text.
const distanceFromViewportStart = (el: Element, vertical: boolean) => {
  const frame = el.ownerDocument.defaultView!.frameElement!.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const viewport = container().getBoundingClientRect();
  return vertical
    ? viewport.right - (frame.left + rect.right)
    : frame.top + rect.top - viewport.top;
};

const jump = async (index: number, target: 'head' | 'mid') => {
  await paginator.goTo({
    index,
    anchor: (doc: Document) => {
      const el = doc.getElementById(target)!;
      if (target === 'head') return el; // a TOC fragment resolves to the element
      const range = doc.createRange(); // a bookmark's CFI resolves to a range
      range.selectNodeContents(el);
      return range;
    },
  } as unknown as Parameters<Renderer['goTo']>[0]);
  await settle();
  const doc = paginator.getContents().find((c) => c.index === index)!.doc;
  return doc.getElementById(target)!;
};

beforeAll(async () => {
  await import('foliate-js/paginator.js');
});
afterEach(() => {
  paginator?.destroy();
  paginator?.remove();
  urls.splice(0).forEach(URL.revokeObjectURL);
});

describe('scrolled-mode jumps to an element or range anchor', () => {
  it.each([
    ['vertical-rl, continuous scroll', true, true],
    ['vertical-rl, single section scroll', true, false],
    ['horizontal, continuous scroll', false, true],
  ])('%s: a TOC jump lands at the chapter head', async (_, vertical, continuous) => {
    await open(vertical, continuous);
    const head = await jump(3, 'head');
    expect(paginator.getContents().length > 1, 'neighbours mounted').toBe(continuous);
    const distance = distanceFromViewportStart(head, vertical);
    expect(distance, 'chapter head distance from the viewport start').toBeGreaterThanOrEqual(0);
    expect(distance, 'chapter head distance from the viewport start').toBeLessThan(32);
  });

  it.each([
    ['vertical-rl, continuous scroll', true, true],
    ['horizontal, continuous scroll', false, true],
  ])('%s: a bookmark jump lands at the bookmarked line', async (_, vertical, continuous) => {
    await open(vertical, continuous);
    const line = await jump(4, 'mid');
    expect(paginator.getContents().length > 1, 'neighbours mounted').toBe(continuous);
    const distance = distanceFromViewportStart(line, vertical);
    expect(distance, 'bookmarked line distance from the viewport start').toBeGreaterThanOrEqual(0);
    expect(distance, 'bookmarked line distance from the viewport start').toBeLessThan(32);
  });

  // The scroll relocate anchors to the section at the viewport centre, while
  // the primary section is the one at its start. A re-render (resize, margin
  // change) re-anchors to that range, which is in a section after the primary.
  it.each([
    ['vertical-rl', true],
    ['horizontal', false],
  ])('%s: a re-render keeps a section head that sits below the viewport start', async (_, vertical) => {
    await open(vertical, true);
    const head = await jump(3, 'head');
    const { size } = paginator;
    // Scroll back until the head sits a third of the way into the viewport.
    // The first relocate after a jump is skipped, so nudge a few times.
    const back = (px: number) => {
      if (vertical) container().scrollLeft += px;
      else container().scrollTop -= px;
      container().dispatchEvent(new Event('scroll'));
      return pause(350);
    };
    await back(0.35 * size - distanceFromViewportStart(head, vertical));
    for (const nudge of [2, -2]) await back(nudge);
    expect(paginator.primaryIndex, 'section at the viewport start').toBe(2);
    (paginator as unknown as { render: () => void }).render();
    await settle();
    const distance = distanceFromViewportStart(head, vertical);
    expect(distance, 'section head distance from the viewport start').toBeGreaterThanOrEqual(0);
    expect(distance, 'section head distance from the viewport start').toBeLessThan(size / 2);
  });
});
