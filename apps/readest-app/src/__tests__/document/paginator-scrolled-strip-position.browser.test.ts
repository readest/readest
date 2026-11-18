import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// readest#7586: in scrolled mode every loaded section sits in one strip, so a
// section that is added, dropped or resized before the one being read moves
// the reader's text unless the scroll offset follows. The browser's scroll
// anchoring covers that for horizontal books (it adjusts scrollTop), but not
// for vertical-rl ones, which scroll along scrollLeft.

type Paginator = Renderer & { primaryIndex: number; start: number };

let paginator: Paginator;
let unloaded: number[] = [];
const urls: string[] = [];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = (n = 2) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve());
    step(n);
  });
const container = () => paginator.shadowRoot!.getElementById('container')!;
const loaded = () => paginator.getContents().map((c) => c.index);

const section = (vertical: boolean, title: string, paragraphs: number) =>
  `<!doctype html><html><head><style>html,body{margin:0}${
    vertical ? 'body{writing-mode:vertical-rl}' : ''
  }p{margin:0;line-height:24px}</style></head><body><h1 id="head">${title}</h1>${Array.from(
    { length: paragraphs },
    (_, i) => `<p id="p${i}">${i} 本文がここに続きます。本文がここに続きます。</p>`,
  ).join('')}</body></html>`;

// A book whose first section (front matter) runs in the other writing mode
// from its chapters, as EBPAJ books do.
const open = (vertical: boolean, frontMatterVertical = !vertical) => {
  unloaded = [];
  paginator = document.createElement('foliate-paginator') as Paginator;
  Object.assign(paginator.style, {
    width: '800px',
    height: '600px',
    position: 'absolute',
    top: '0',
    left: '0',
  });
  paginator.setAttribute('flow', 'scrolled');
  document.body.append(paginator);
  const sections = [frontMatterVertical, vertical, vertical, vertical].map((v, i) => {
    const html = section(v, i ? `Chapter ${i}` : 'Front matter', i ? 80 : 3);
    return {
      id: `s${i}`,
      linear: 'yes',
      size: html.length,
      load: async () => {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        urls.push(url);
        return url;
      },
      unload: () => unloaded.push(i),
    };
  });
  paginator.open({ dir: vertical ? 'rtl' : 'ltr', sections } as unknown as BookDoc);
};

const waitFor = async (check: () => boolean, what: string, timeout = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await pause(20);
  }
};

// Let the forward fill finish: the loaded set stops changing.
const settle = async () => {
  let last = '';
  let stable = 0;
  for (let i = 0; i < 100 && stable < 5; i++) {
    const now = loaded().join();
    stable = now === last ? stable + 1 : 0;
    last = now;
    await pause(100);
  }
};

// Screen position of an element of a loaded section along the scroll axis:
// its block-start edge, i.e. its right edge in vertical-rl.
const position = (index: number, id: string, vertical: boolean) => {
  const doc = paginator.getContents().find((c) => c.index === index)!.doc;
  const iframe = Array.from(container().querySelectorAll('iframe')).find(
    (f) => f.contentDocument === doc,
  )!;
  const frame = iframe.getBoundingClientRect();
  const rect = doc.getElementById(id)!.getBoundingClientRect();
  return vertical ? frame.left + rect.right : frame.top + rect.top;
};

// The scroll offset from the start of the strip, positive in both modes.
const scrollStart = (vertical: boolean) =>
  vertical ? -container().scrollLeft : container().scrollTop;
const scrollTo = (offset: number, vertical: boolean) => {
  if (vertical) container().scrollLeft = -offset;
  else container().scrollTop = offset;
};
const viewStart = (index: number, vertical: boolean) => {
  const doc = paginator.getContents().find((c) => c.index === index)!.doc;
  const el = Array.from(container().children).find(
    (child) => child.querySelector('iframe')?.contentDocument === doc,
  )!;
  const c = container().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return scrollStart(vertical) + (vertical ? c.right - r.right : r.top - c.top);
};

beforeAll(async () => {
  await import('foliate-js/paginator.js');
});

afterEach(() => {
  paginator?.destroy();
  paginator?.remove();
  urls.splice(0).forEach(URL.revokeObjectURL);
});

describe('Scrolled strip keeps the reading position (browser)', () => {
  it('opens a vertical chapter at its head with horizontal front matter before it', async () => {
    open(true);
    await paginator.goTo({ index: 1, anchor: 0 });
    await waitFor(() => unloaded.includes(0), 'the front matter to be dropped');
    await settle();
    expect(loaded()).not.toContain(0);
    expect(Math.abs(paginator.start)).toBeLessThanOrEqual(2);
  });

  // A TOC jump to a chapter that is already loaded scrolls first, then
  // preloads the section before it. In a vertical book that is the
  // horizontal front matter, inserted and dropped again beside the chapter.
  it.each([
    ['vertical', true],
    ['horizontal', false],
  ])('keeps a %s chapter head still when the jump to it preloads and drops the front matter', async (_, vertical) => {
    open(vertical);
    await paginator.goTo({ index: 2, anchor: 0 });
    await settle();
    expect(loaded()).toContain(1);
    expect(loaded()).not.toContain(0);

    // Sample every frame from the moment the front matter is inserted, which
    // happens after the jump has scrolled to the chapter.
    const heads: number[] = [];
    let sampling = true;
    const sample = () => {
      if (!sampling) return;
      if (heads.length || loaded().includes(0))
        heads.push(Math.round(position(1, 'head', vertical)));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await paginator.goTo({ index: 1, anchor: 0 });
    await waitFor(() => unloaded.includes(0), 'the front matter to be dropped');
    await settle();
    sampling = false;
    const final = Math.round(position(1, 'head', vertical));
    const shift = Math.max(...heads.map((h) => Math.abs(h - final)));
    expect(shift, `chapter head moved while the front matter came and went: ${heads}`).toBe(0);
  });

  // The reader scrolls back into the first chapter; the front matter is
  // preloaded before it and dropped for its writing mode while they read.
  it.each([
    ['vertical', true],
    ['horizontal', false],
  ])('keeps the %s text in view still when scrolling back drops the front matter', async (_, vertical) => {
    open(vertical);
    await paginator.goTo({ index: 2, anchor: 0 });
    await settle();
    expect(loaded()).toContain(1);

    scrollTo(viewStart(1, vertical) + 600, vertical);
    const before = position(1, 'p20', vertical);
    await waitFor(() => unloaded.includes(0), 'the front matter to be dropped');
    await frames(3);
    const after = position(1, 'p20', vertical);
    expect(Math.round(after - before), 'text in view moved when the front matter was dropped').toBe(
      0,
    );
  });

  // A chapter before the one being read grows after it rendered (a late image
  // or font). The text in view must not move.
  it.each([
    ['vertical', true],
    ['horizontal', false],
  ])('keeps the %s text in view still when an earlier chapter grows', async (_, vertical) => {
    open(vertical, vertical);
    await paginator.goTo({ index: 2, anchor: 0.3 });
    await settle();
    expect(loaded()).toContain(1);
    expect(paginator.primaryIndex).toBe(2);

    const before = position(2, 'p30', vertical);
    const doc = paginator.getContents().find((c) => c.index === 1)!.doc;
    const block = doc.createElement('div');
    block.style[vertical ? 'width' : 'height'] = '500px';
    doc.body.prepend(block);
    await frames(4);
    const after = position(2, 'p30', vertical);
    expect(Math.round(after - before), 'text in view moved when chapter 1 grew').toBe(0);
  });
});
