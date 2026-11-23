import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// A comic's wide pages are measured as it opens and marked
// `pageSpread: 'center'`, each a spread of its own. Two of them in a row must
// stay two spreads: readest#7836 showed only the last wide page of a run, and
// a comic of wide pages only opened on its last page.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

const makeBook = (wide: number[], count: number) => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'auto' },
  sections: Array.from({ length: count }, (_, i) => ({
    linear: 'yes',
    pageSpread: wide.includes(i) ? 'center' : undefined,
    load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
  })),
});

type Renderer = HTMLElement & {
  open(book: unknown): void;
  next(): Promise<void>;
  goToSpread(index: number, side: string, reason?: string): Promise<void>;
  readonly atEnd: boolean;
};

const frames = (renderer: HTMLElement) =>
  Array.from(renderer.shadowRoot!.querySelectorAll<HTMLIFrameElement>('iframe'));
// The sections on screen, in page order.
const shown = (renderer: HTMLElement) =>
  frames(renderer)
    .filter((f) => f.dataset['sectionIndex'] && f.parentElement!.style.visibility === 'visible')
    .map((f) => Number(f.dataset['sectionIndex']))
    .sort((a, b) => a - b);

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

const mount = (wide: number[], count: number) => {
  renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = '1200px';
  renderer.style.height = '600px';
  renderer.setAttribute('flow', 'paginated');
  document.body.append(renderer);
  renderer.open(makeBook(wide, count));
  return renderer;
};

// Every spread from the first, turning forward to the end.
const readThrough = async (r: Renderer) => {
  await r.goToSpread(0, 'left', 'page');
  const spreads = [shown(r)];
  for (let i = 0; i < 20 && !r.atEnd; i++) {
    await r.next();
    spreads.push(shown(r));
  }
  return spreads;
};

describe('fixed-layout keeps consecutive wide pages apart', () => {
  it('shows every page of a comic made only of wide pages', async () => {
    const r = mount([0, 1, 2, 3], 4);
    expect(await readThrough(r)).toEqual([[0], [1], [2], [3]]);
  });

  it('shows every wide page of a run between portrait pages', async () => {
    // The reporter's mix: three portrait, five wide, two portrait.
    const r = mount([3, 4, 5, 6, 7], 10);
    expect(await readThrough(r)).toEqual([[0], [1, 2], [3], [4], [5], [6], [7], [8, 9]]);
  });
});
