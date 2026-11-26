import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// Opening a section preloads the next one. Until that preload renders, its
// iframe holds a blank document: a jump into the section meanwhile must land
// on its target, not read the target from the blank document. And a jump made
// while an earlier one still waits on a load is where the reader ends up.

const makeSection = (body: string) => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><style>body { font: 16px/1.5 serif; }</style></head>
  <body>${body}</body>
</html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { load: () => src, unload: () => {}, size: html.length };
};

// `n` pages, each block after the first on a page of its own
const pages = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<div id="${name}-${i}"${i ? ' style="break-before: column"' : ''}>${name} page ${i}</div>`,
  ).join('');

describe('paginator jumps into a section still preloading (browser)', () => {
  const src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!;
  let paginator: Renderer | null = null;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', src);
    paginator?.destroy();
    paginator?.remove();
    paginator = null;
  });

  // Hold the loads of a section until released, as a loaded machine does
  const hold = (srcValue: string) => {
    const held: (() => void)[] = [];
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...src,
      set(this: HTMLIFrameElement, value: string) {
        if (value === srcValue) held.push(() => src.set!.call(this, value));
        else src.set!.call(this, value);
      },
    });
    return { held, release: () => held.splice(0).forEach((load) => load()) };
  };

  const open = (sections: object[]) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, { width: '800px', height: '600px', display: 'block' });
    document.body.append(el);
    paginator = el;
    const relocations: string[] = [];
    el.addEventListener('relocate', (e) =>
      relocations.push((e as CustomEvent).detail.range.toString()),
    );
    el.open({ sections } as unknown as BookDoc);
    return { el, relocations };
  };

  // Opened at a, with the preload of b held
  const openHeld = async () => {
    const sections = [makeSection(pages('a', 1)), makeSection(pages('b', 6))];
    const bSrc = sections[1]!.load();
    let loads = 0;
    sections[1]!.load = () => (loads++, bSrc);
    const { held, release } = hold(bSrc);
    const { el, relocations } = open(sections);
    await el.goTo({ index: 0 });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    return { el, relocations, release, loads: () => loads };
  };

  const at = (index: number, id: string) => ({
    index,
    anchor: ((doc: Document) => doc.getElementById(id)) as unknown as (doc: Document) => Range,
  });
  const toB4 = at(1, 'b-4');

  it('lands on the anchor once the section renders', async () => {
    const { el, relocations, release } = await openHeld();
    const jump = el.goTo(toB4);
    await new Promise((r) => setTimeout(r, 50));
    release();
    await jump;
    expect(relocations.at(-1), 'where the jump is when goTo resolves').toContain('b page 4');
  });

  it('leaves a later jump where it went', async () => {
    const { el, relocations, release } = await openHeld();
    const first = el.goTo(toB4);
    await new Promise((r) => setTimeout(r, 50));
    await el.goTo({ index: 0 });
    release();
    await first;
    expect(relocations.at(-1), 'the later jump, to a').toContain('a page 0');
  });

  it('drops a jump still waiting when the paginator is destroyed', async () => {
    const { el, loads } = await openHeld();
    const jump = el.goTo(toB4);
    await new Promise((r) => setTimeout(r, 50));
    const before = loads();
    el.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(loads(), 'sections loaded after the reader closed').toBe(before);
    await jump;
  });

  it('leaves a later jump where it went while an earlier one loads its target', async () => {
    const sections = [pages('a', 4), pages('b', 12), pages('c', 4)].map((body) =>
      makeSection(body),
    );
    const { el, relocations } = open(sections);
    await el.goTo({ index: 0 });
    // the fill loads b, which reaches far enough ahead to leave c unloaded
    await vi.waitFor(() => expect(el.getContents().map((c) => c.index)).toContain(1));
    const { held, release } = hold(sections[2]!.load());
    const first = el.goTo({ index: 2 });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await el.goTo(at(0, 'a-2'));
    release();
    await first;
    expect(relocations.at(-1), 'the later jump, to a-2').toContain('a page 2');
  });

  it('leaves a later jump where it went while an earlier one loads the section before its target', async () => {
    // b is shorter than a spread: a jump to it loads a, the section before
    const sections = [pages('a', 6), pages('b', 1), pages('c', 12), pages('d', 6)].map((body) =>
      makeSection(body),
    );
    const { el, relocations } = open(sections);
    await el.goTo({ index: 1 });
    expect(el.columnCount).toBe(2);
    // going to d drops a, three sections away
    await el.goTo({ index: 3 });
    expect(el.getContents().map((c) => c.index)).not.toContain(0);
    const { held, release } = hold(sections[0]!.load());
    const first = el.goTo({ index: 1 });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await el.goTo(at(3, 'd-2'));
    release();
    await first;
    expect(relocations.at(-1), 'the later jump, to d-2').toContain('d page 2');
  });

  it('leaves a later jump the primary section while an earlier one fetches its target', async () => {
    const sections = [pages('a', 4), pages('b', 12)].map((body) => makeSection(body));
    // c takes a while to fetch, as a reader's unzip does
    const c = makeSection(pages('c', 4));
    const cSrc = c.load();
    let unloads = 0;
    const slowC = {
      ...c,
      load: () => new Promise<string>((r) => setTimeout(() => r(cSrc), 100)),
      unload: () => unloads++,
    };
    const { el, relocations } = open([...sections, slowC]);
    await el.goTo({ index: 0 });
    await vi.waitFor(() => expect(el.getContents().map((c) => c.index)).toContain(1));
    const first = el.goTo({ index: 2 });
    await el.goTo(at(0, 'a-2'));
    await first;
    expect(el.primaryIndex, 'the later jump, to a').toBe(0);
    expect(relocations.at(-1)).toContain('a page 2');
    expect(unloads, 'the load of c, released').toBe(1);
  });
});
