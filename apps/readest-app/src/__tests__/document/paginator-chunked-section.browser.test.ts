import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';
import { CHUNK_ATTRIBUTE } from 'foliate-js/section-chunks.js';

// A book whose middle spine item holds ~1.2 MB in one file, like a
// single-file book or a concordance: the paginator renders it in chunks but
// must keep reporting spine index 1 and section-wide fractions.
const PARAGRAPHS = 9000;
const FILLER = 'In the beginning was the Word, and the Word was with God. '.repeat(2);

const html = (body: string) =>
  `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;

const makeSection = (id: string, body: string) => {
  const content = html(body);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  return {
    id,
    linear: 'yes',
    size: content.length,
    load: () => url,
    loadContent: () => content,
    unload: () => {},
  };
};

const makeBook = () => {
  const big = Array.from({ length: PARAGRAPHS }, (_, i) => `<p id="p${i}">${i}. ${FILLER}</p>`);
  return {
    dir: 'ltr',
    sections: [
      makeSection('a.html', '<p id="a0">Before</p>'),
      makeSection('big.html', big.join('\n')),
      makeSection('c.html', '<p id="c0">After</p>'),
    ],
  } as unknown as BookDoc;
};

const waitFor = (el: HTMLElement, type: string, timeout = 15000) =>
  new Promise<Event>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), timeout);
    el.addEventListener(
      type,
      (e) => {
        clearTimeout(timer);
        resolve(e);
      },
      { once: true },
    );
  });

describe('Paginator chunked section (browser)', () => {
  let paginator: Renderer;
  let relocations: { index: number; fraction: number }[];

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  });

  afterEach(() => {
    paginator?.destroy?.();
    paginator?.remove();
  });

  const open = () => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, { width: '800px', height: '600px', display: 'block' });
    document.body.append(paginator);
    relocations = [];
    paginator.addEventListener('relocate', (e) => {
      const { index, fraction } = (e as CustomEvent).detail;
      relocations.push({ index, fraction });
    });
    paginator.open(makeBook());
  };

  it('lands on an anchor deep in a chunked section and reports the spine index', async () => {
    open();
    const target = 6000;
    const stabilized = waitFor(paginator, 'stabilized');
    const t0 = performance.now();
    await paginator.goTo({
      index: 1,
      anchor: ((doc: Document) => doc.getElementById(`p${target}`)) as unknown as (
        doc: Document,
      ) => Range,
    });
    await stabilized;
    const elapsed = performance.now() - t0;

    expect(paginator.primaryIndex).toBe(1);
    const contents = paginator.getContents();
    expect(contents.every((c) => [0, 1, 2].includes(c.index ?? -1))).toBe(true);
    const holder = contents.find(
      (c) => c.index === 1 && !c.doc.getElementById(`p${target}`)?.hasAttribute(CHUNK_ATTRIBUTE),
    );
    expect(holder).toBeDefined();
    const el = holder!.doc.getElementById(`p${target}`)!;
    // the chunk holds the real paragraph, and only part of the section
    expect(el.textContent).toContain(`${target}.`);
    const real = holder!.doc.body.querySelectorAll(`:scope > :not([${CHUNK_ATTRIBUTE}])`).length;
    expect(real).toBeLessThan(PARAGRAPHS / 2);

    const last = relocations.at(-1)!;
    expect(last.index).toBe(1);
    expect(last.fraction).toBeGreaterThan(target / PARAGRAPHS - 0.1);
    expect(last.fraction).toBeLessThan(target / PARAGRAPHS + 0.1);
    // a 1.2 MB section rendered whole takes far longer than one chunk
    expect(elapsed).toBeLessThan(5000);
  });

  it('pages forward across a chunk boundary within the same section', async () => {
    open();
    const stabilized = waitFor(paginator, 'stabilized');
    // the last paragraph of the first chunk
    await paginator.goTo({ index: 1, anchor: 0.2 });
    await stabilized;
    const start = relocations.at(-1)!;
    expect(start.index).toBe(1);

    for (let i = 0; i < 40; i++) await paginator.next();
    const end = relocations.at(-1)!;
    expect(end.index).toBe(1);
    expect(end.fraction).toBeGreaterThan(start.fraction);
  });
});
