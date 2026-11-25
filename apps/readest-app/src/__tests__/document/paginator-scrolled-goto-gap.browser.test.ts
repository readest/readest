import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// readest#7883: in scrolled mode, going to a chapter that isn't loaded kept
// the loaded chapters up to two away. With the strip ending at chapter 1, a
// jump to chapter 3 kept chapter 1 and rendered chapter 3 straight after it,
// so chapter 2 never loaded and scrolling up from chapter 3 went into chapter 1.

type Paginator = Renderer & { primaryIndex: number };

let paginator: Paginator;
const urls: string[] = [];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const container = () => paginator.shadowRoot!.getElementById('container')!;
const loaded = () => paginator.getContents().map((c) => c.index ?? -1);

const chapter = (i: number) =>
  `<!doctype html><html><head><style>html,body{margin:0}p{margin:0;line-height:24px}</style></head><body><h1>Chapter ${i}</h1>${Array.from(
    { length: 80 },
    (_, p) => `<p>${p} The text of chapter ${i} goes on here.</p>`,
  ).join('')}</body></html>`;

// Sections whose load waits until released, to land a preload after a jump.
let held: Record<number, Promise<void>> = {};
const requested: number[] = [];
// Loads taken and released per section: an EPUB counts its resources.
const taken: number[] = [];
const released: number[] = [];

const open = () => {
  taken.length = 0;
  released.length = 0;
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
  const sections = Array.from({ length: 8 }, (_, i) => {
    const html = chapter(i);
    return {
      id: `s${i}`,
      linear: 'yes',
      size: html.length,
      load: async () => {
        requested.push(i);
        taken[i] = (taken[i] ?? 0) + 1;
        await held[i];
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        urls.push(url);
        return url;
      },
      unload: () => {
        released[i] = (released[i] ?? 0) + 1;
      },
    };
  });
  paginator.open({ dir: 'ltr', sections } as unknown as BookDoc);
};

// Let the fill finish: the loaded set stops changing.
const settle = async () => {
  let last = '';
  let stable = 0;
  for (const start = Date.now(); stable < 5; await pause(100)) {
    if (Date.now() - start > 10000) throw new Error(`loaded sections never settled: ${last}`);
    const now = loaded().join();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
};

// The chapter whose text is at the top of the viewport.
const chapterAtTop = () => {
  const top = container().getBoundingClientRect().top;
  const view = Array.from(container().children).find(
    (child) => child.querySelector('iframe') && child.getBoundingClientRect().bottom > top + 1,
  );
  return view?.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent;
};

describe('Scrolled mode: going to a chapter that is not loaded', () => {
  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  });

  afterEach(() => {
    held = {};
    requested.length = 0;
    paginator?.destroy();
    paginator?.remove();
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  });

  it('scrolls up from it into the chapter before it', async () => {
    open();
    await paginator.goTo({ index: 0 });
    await settle();
    const last = Math.max(...loaded());
    const target = last + 2;
    expect(loaded()).not.toContain(target - 1);

    await paginator.goTo({ index: target });
    await settle();
    expect(paginator.primaryIndex).toBe(target);
    expect(chapterAtTop()).toBe(`Chapter ${target}`);

    // Scroll up a little past the start of the target chapter.
    container().scrollTop -= 300;
    await pause(400);
    expect(chapterAtTop()).toBe(`Chapter ${target - 1}`);
  });

  it('scrolls down out of it into the chapter after it', async () => {
    open();
    await paginator.goTo({ index: 6 });
    await settle();
    const first = Math.min(...loaded());
    const target = first - 2;
    expect(loaded()).not.toContain(target + 1);

    await paginator.goTo({ index: target });
    await settle();
    expect(paginator.primaryIndex).toBe(target);

    // Scroll to just past the end of the target chapter.
    const view = Array.from(container().children).find(
      (child) =>
        child.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent ===
        `Chapter ${target}`,
    )!;
    container().scrollTop +=
      view.getBoundingClientRect().bottom - container().getBoundingClientRect().top + 100;
    await pause(400);
    expect(chapterAtTop()).toBe(`Chapter ${target + 1}`);
  });

  it('leaves no hole when a preload that started before a jump lands after it', async () => {
    let release = () => {};
    held[1] = new Promise<void>((resolve) => (release = resolve));
    open();
    await paginator.goTo({ index: 0 });
    // The fill after chapter 0 is waiting on chapter 1.
    const start = Date.now();
    while (!requested.includes(1)) {
      if (Date.now() - start > 5000) throw new Error('chapter 1 was never preloaded');
      await pause(20);
    }

    await paginator.goTo({ index: 4 });
    release();
    await settle();

    const strip = [...loaded()].sort((a, b) => a - b);
    const holes = strip.slice(1).filter((index, i) => index !== strip[i]! + 1);
    expect(strip, 'chapters in the strip').toContain(4);
    expect(holes, `chapters in the strip: ${strip.join(',')}`).toEqual([]);
    // Each chapter still holds one load while in the strip, none once out of it.
    const stillHeld = Array.from({ length: 8 }, (_, i) => (taken[i] ?? 0) - (released[i] ?? 0));
    expect(stillHeld, 'loads still held per chapter').toEqual(
      Array.from({ length: 8 }, (_, i) => (strip.includes(i) ? 1 : 0)),
    );
  });
});
