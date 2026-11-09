import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// A page turn scrolls the container and relocates right away (#scrollTo ->
// #afterScroll). The container's scroll event then reached the debounced
// listener, which ran #afterScroll('container-scroll') again 250 ms later at
// the same position: a second visible-range walk, CFI and relocate per turn,
// and a second progress commit in the host. A scroll the paginator didn't
// make (native scrolling, a clamp after reflow) must still relocate.

const makeHtml = (writingMode: string) => `<!doctype html><html><head><style>
  html { writing-mode: ${writingMode}; } html, body { margin: 0; }
  p { margin: 0 0 24px; line-height: 24px; }
</style></head><body>${Array.from(
  { length: 200 },
  (_, i) => `<p>Paragraph ${i + 1} of the only chapter, long enough to fill a line.</p>`,
).join('')}</body></html>`;

const makeBook = (dir: string, writingMode: string) => {
  const html = makeHtml(writingMode);
  const src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  return {
    dir,
    sections: [{ id: 'ch1', linear: 'yes', size: html.length, load: async () => src }],
  };
};

type RelocateDetail = { reason: string; fraction: number };
type Paginator = Renderer & { scrollProp: 'scrollLeft' | 'scrollTop' };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cases = [
  { name: 'left to right', dir: 'ltr', writingMode: 'horizontal-tb', step: 1 },
  { name: 'right to left', dir: 'rtl', writingMode: 'horizontal-tb', step: -1 },
  { name: 'vertical', dir: 'ltr', writingMode: 'vertical-rl', step: 1 },
];

describe('Paginator page turn', () => {
  let paginator: Paginator;
  let relocates: RelocateDetail[];

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  const open = async (dir: string, writingMode: string) => {
    paginator = document.createElement('foliate-paginator') as Paginator;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator);
    paginator.open(makeBook(dir, writingMode) as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    // past the debounced scroll of the opening navigation
    await wait(600);
    relocates = [];
    paginator.addEventListener('relocate', (e) => {
      relocates.push((e as CustomEvent<RelocateDetail>).detail);
    });
  };

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
  });

  it.each(cases)('relocates once per turn ($name)', async ({ dir, writingMode }) => {
    await open(dir, writingMode);
    await paginator.next();
    await wait(600);
    expect(relocates.map((d) => d.reason)).toEqual(['page']);

    await paginator.next();
    await wait(600);
    expect(relocates.map((d) => d.reason)).toEqual(['page', 'page']);
  });

  it.each(cases)('still relocates on a scroll the paginator did not make ($name)', async ({
    dir,
    writingMode,
    step,
  }) => {
    await open(dir, writingMode);
    await paginator.next();
    await wait(600);
    const container = paginator.shadowRoot!.getElementById('container')!;
    const turned = relocates[0]!.fraction;
    container[paginator.scrollProp] += step * paginator.size;
    await wait(600);
    expect(relocates.map((d) => d.reason)).toEqual(['page', 'container-scroll']);
    expect(relocates[1]!.fraction).toBeGreaterThan(turned);
  });
});
