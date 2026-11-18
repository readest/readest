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
// Called when the front matter starts loading, before it enters the strip.
let beforeFrontMatter: (() => void) | null = null;
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
        if (i === 0) beforeFrontMatter?.();
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
  const owner = paginator;
  let last = '';
  let stable = 0;
  for (const start = Date.now(); stable < 5; await pause(100)) {
    if (paginator !== owner) throw new Error('the paginator was replaced while settling');
    if (Date.now() - start > 10000) throw new Error(`loaded sections never settled: ${last}`);
    const now = loaded().join();
    stable = now === last ? stable + 1 : 0;
    last = now;
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
  return Math.round(vertical ? frame.left + rect.right : frame.top + rect.top);
};

// Records that position on every frame until stopped, with whether the front
// matter was in the strip at the time.
const track = (index: number, id: string, vertical: boolean) => {
  const samples: { at: number; frontMatter: boolean }[] = [];
  const step = () => {
    if (loaded().includes(index))
      samples.push({ at: position(index, id, vertical), frontMatter: loaded().includes(0) });
    frame = requestAnimationFrame(step);
  };
  let frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    return samples;
  };
};

// The scroll offset from the start of the strip, positive in both modes.
const scrollStart = (vertical: boolean) =>
  vertical ? -container().scrollLeft : container().scrollTop;
const scrollTo = (offset: number, vertical: boolean) => {
  if (vertical) container().scrollLeft = -offset;
  else container().scrollTop = offset;
};
const viewElement = (index: number) => {
  const doc = paginator.getContents().find((c) => c.index === index)!.doc;
  return Array.from(container().children).find(
    (child) => child.querySelector('iframe')?.contentDocument === doc,
  )!;
};
const viewStart = (index: number, vertical: boolean) => {
  const c = container().getBoundingClientRect();
  const r = viewElement(index).getBoundingClientRect();
  return scrollStart(vertical) + (vertical ? c.right - r.right : r.top - c.top);
};

// Opens at chapter 2 and waits for the forward fill to end: while it runs,
// the paginator holds back the preload of the front matter.
const openAtChapter2 = async (vertical: boolean) => {
  open(vertical);
  await paginator.goTo({ index: 2, anchor: 0 });
  await waitFor(() => loaded().includes(3), 'the forward fill to reach chapter 3');
  await settle();
  expect(loaded()).toContain(1);
  expect(loaded()).not.toContain(0);
};

const moves = (samples: { at: number }[], from: number) =>
  samples.map((s) => s.at - from).filter((d) => d !== 0);

beforeAll(async () => {
  await import('foliate-js/paginator.js');
});

afterEach(() => {
  beforeFrontMatter = null;
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
    await openAtChapter2(vertical);

    // Where the head is when the front matter starts loading is where it
    // has to stay.
    let before: number | undefined;
    let stop: (() => { at: number; frontMatter: boolean }[]) | undefined;
    beforeFrontMatter = () => {
      if (before !== undefined) return;
      before = position(1, 'head', vertical);
      stop = track(1, 'head', vertical);
    };
    let samples: { at: number; frontMatter: boolean }[] = [];
    try {
      await paginator.goTo({ index: 1, anchor: 0 });
      await waitFor(() => unloaded.includes(0), 'the front matter to be dropped');
      await settle();
    } finally {
      samples = stop?.() ?? [];
    }
    expect(
      samples.some((s) => s.frontMatter),
      'sampled with the front matter in the strip',
    ).toBe(true);
    const shifts = moves([...samples, { at: position(1, 'head', vertical) }], before!);
    expect(shifts, 'chapter head moved while the front matter came and went').toEqual([]);
  });

  // The reader scrolls back into the first chapter; the front matter is
  // preloaded before it and dropped for its writing mode while they read.
  it.each([
    ['vertical', true],
    ['horizontal', false],
  ])('keeps the %s text in view still when scrolling back drops the front matter', async (_, vertical) => {
    await openAtChapter2(vertical);

    scrollTo(viewStart(1, vertical) + 600, vertical);
    const before = position(1, 'p20', vertical);
    const stop = track(1, 'p20', vertical);
    let samples: { at: number; frontMatter: boolean }[] = [];
    try {
      await waitFor(() => unloaded.includes(0), 'the front matter to be dropped');
      await frames(3);
    } finally {
      samples = stop();
    }
    expect(
      samples.some((s) => s.frontMatter),
      'sampled with the front matter in the strip',
    ).toBe(true);
    expect(
      moves(samples, before),
      'text in view moved while the front matter came and went',
    ).toEqual([]);
  });

  // The same, with the reader at the far end of the strip when the front
  // matter is dropped: the strip gets shorter and the browser clamps the
  // scroll offset to it before the paginator corrects it.
  it.each([
    ['vertical', true],
    ['horizontal', false],
  ])('keeps the %s text in view still when the front matter is dropped at the strip end', async (_, vertical) => {
    await openAtChapter2(vertical);

    const atStripEnd = new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const step = () => {
        if (Date.now() - start > 5000) return reject(new Error('the front matter never loaded'));
        if (!loaded().includes(0)) return void requestAnimationFrame(step);
        const c = container();
        if (vertical) c.scrollLeft = -(c.scrollWidth - c.clientWidth);
        else c.scrollTop = c.scrollHeight - c.clientHeight;
        resolve();
      };
      requestAnimationFrame(step);
    });
    scrollTo(viewStart(1, vertical) + 600, vertical);
    await atStripEnd;
    const before = position(3, 'p79', vertical);
    const stop = track(3, 'p79', vertical);
    let samples: { at: number; frontMatter: boolean }[] = [];
    try {
      await waitFor(() => unloaded.includes(0), 'the front matter to be dropped');
      await frames(3);
    } finally {
      samples = stop();
    }
    expect(
      samples.some((s) => s.frontMatter),
      'sampled with the front matter in the strip',
    ).toBe(true);
    expect(
      moves(samples, before),
      'text at the strip end moved when the front matter was dropped',
    ).toEqual([]);
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

    const side = vertical ? 'width' : 'height';
    const size = () => viewElement(1).getBoundingClientRect()[side];
    const sizeBefore = size();
    const before = position(2, 'p30', vertical);
    const doc = paginator.getContents().find((c) => c.index === 1)!.doc;
    const block = doc.createElement('div');
    block.style[side] = '500px';
    doc.body.prepend(block);
    await waitFor(() => size() >= sizeBefore + 500, 'chapter 1 to grow in the strip');
    await frames(2);
    // View sizes have fractions of a pixel (1999.875 px here) and the scroll
    // offset doesn't, so the text can end up 1 px off.
    const moved = Math.abs(position(2, 'p30', vertical) - before);
    expect(moved, 'text in view moved when chapter 1 grew').toBeLessThanOrEqual(1);
  });
});
