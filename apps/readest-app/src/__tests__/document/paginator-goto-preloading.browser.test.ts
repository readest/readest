import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// Opening a section preloads the next one. Until that preload renders, its
// iframe holds a blank document: a jump into the section meanwhile must land
// on its target, not read the target from the blank document.

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

  // Opened at a, with the preload of b held as a loaded machine holds it
  const openHeld = async () => {
    const sections = [makeSection(pages('a', 1)), makeSection(pages('b', 6))];
    const bSrc = sections[1]!.load();
    let loads = 0;
    sections[1]!.load = () => (loads++, bSrc);
    const held: (() => void)[] = [];
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...src,
      set(this: HTMLIFrameElement, value: string) {
        if (value === bSrc) held.push(() => src.set!.call(this, value));
        else src.set!.call(this, value);
      },
    });
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, { width: '800px', height: '600px', display: 'block' });
    document.body.append(el);
    paginator = el;
    const relocations: string[] = [];
    el.addEventListener('relocate', (e) =>
      relocations.push((e as CustomEvent).detail.range.toString()),
    );
    el.open({ sections } as unknown as BookDoc);
    await el.goTo({ index: 0 });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const release = () => held.splice(0).forEach((load) => load());
    return { el, relocations, release, loads: () => loads };
  };

  const toB4 = {
    index: 1,
    anchor: ((doc: Document) => doc.getElementById('b-4')) as unknown as (doc: Document) => Range,
  };

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
});
