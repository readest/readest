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
  let paginator: Renderer | null = null;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
    paginator = null;
  });

  it('lands on the anchor once the section renders', async () => {
    const sections = [makeSection(pages('a', 1)), makeSection(pages('b', 6))];
    // hold the next section's load, as a loaded machine does
    const src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!;
    const held: (() => void)[] = [];
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...src,
      set(this: HTMLIFrameElement, value: string) {
        if (value === sections[1]!.load()) held.push(() => src.set!.call(this, value));
        else src.set!.call(this, value);
      },
    });
    let last: { range: Range } | undefined;
    try {
      const el = document.createElement('foliate-paginator') as Renderer;
      Object.assign(el.style, { width: '800px', height: '600px', display: 'block' });
      document.body.append(el);
      paginator = el;
      el.addEventListener('relocate', (e) => (last = (e as CustomEvent).detail));
      el.open({ sections } as unknown as BookDoc);
      await el.goTo({ index: 0 });
      await vi.waitFor(() => expect(held).toHaveLength(1));
      const jump = el.goTo({
        index: 1,
        anchor: ((doc: Document) => doc.getElementById('b-4')) as unknown as (
          doc: Document,
        ) => Range,
      });
      await new Promise((r) => setTimeout(r, 50));
      held.splice(0).forEach((load) => load());
      await jump;
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', src);
    }
    expect(last!.range.toString(), 'where the jump is when goTo resolves').toContain('b page 4');
  });
});
