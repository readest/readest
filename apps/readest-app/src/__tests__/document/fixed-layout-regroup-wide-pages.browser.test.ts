import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// A streamed comic (OPDS-PSE) can only measure a page when its image arrives,
// so a double-page spread turns out wide as its section loads: it then marks
// itself `pageSpread: 'center'`. That page, and every page after it, has to be
// regrouped before the reader sees the spread, and nothing cached for the old
// grouping may be shown.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

type Section = { pageSpread?: string; load: () => Promise<unknown>; linear: string };

// Eight portrait pages; `wide` marks itself a spread of its own once loaded.
const makeBook = (wide: number) => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'auto' },
  sections: Array.from({ length: 8 }, (_, i): Section => {
    const section: Section = {
      linear: 'yes',
      load: async () => {
        if (i === wide) section.pageSpread = 'center';
        return { src: 'srcdoc', data: PAGE_HTML };
      },
    };
    return section;
  }),
});

type Renderer = HTMLElement & {
  open(book: unknown): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  goToSpread(index: number, side: string, reason?: string): Promise<void>;
};

const frames = (renderer: HTMLElement) =>
  Array.from(renderer.shadowRoot!.querySelectorAll<HTMLIFrameElement>('iframe'));
const frameOf = (renderer: HTMLElement, section: number) =>
  frames(renderer).find((f) => f.dataset['sectionIndex'] === String(section)) ?? null;
// The sections on screen, in page order.
const shown = (renderer: HTMLElement) =>
  frames(renderer)
    .filter((f) => f.dataset['sectionIndex'] && f.parentElement!.style.visibility === 'visible')
    .map((f) => Number(f.dataset['sectionIndex']))
    .sort((a, b) => a - b);
const waitFor = async (check: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

// Spreads before any page is known wide (the first page opens on the right):
// [0] [1 2] [3 4] [5 6] [7]
const mount = (wide: number) => {
  renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = '1200px';
  renderer.style.height = '600px';
  renderer.setAttribute('flow', 'paginated');
  document.body.append(renderer);
  renderer.open(makeBook(wide));
  return renderer;
};

describe('fixed-layout regroups spreads when a page loads wide', () => {
  it('regroups ahead of the reader when the preload finds the wide page', async () => {
    const r = mount(3);
    await r.goToSpread(1, 'left', 'page');
    expect(shown(r)).toEqual([1, 2]);
    // The preload of [3 4] finds page 3 wide: [0] [1 2] [3] [4 5] [6 7]
    await waitFor(() => frameOf(r, 3) !== null && frameOf(r, 4) === null);
    await r.next();
    expect(shown(r)).toEqual([3]);
    await r.next();
    expect(shown(r)).toEqual([4, 5]);
  });

  it('shows the regrouped spread when a jump lands on the wide page', async () => {
    const r = mount(4);
    // [3 4] loads, page 4 is wide: [0] [1 2] [3] [4] [5 6] [7]
    await r.goToSpread(2, 'left', 'page');
    expect(shown(r)).toEqual([3]);
    await r.next();
    expect(shown(r)).toEqual([4]);
    await r.next();
    expect(shown(r)).toEqual([5, 6]);
  });

  it('turns back onto the regrouped spread and keeps the page it left', async () => {
    const r = mount(3);
    await r.goToSpread(3, 'left', 'page');
    expect(shown(r)).toEqual([5, 6]);
    const outgoing = frameOf(r, 6)!;
    // Back to [3 4], page 3 is wide: [0] [1 2] [3] [4 5] [6 7]. Turning back
    // aimed at page 4, which now pairs with 5; the cached [5 6] is stale.
    await r.prev();
    expect(shown(r)).toEqual([4, 5]);
    // The touch that turned the page may still be on it (readest#6239).
    expect(outgoing.isConnected).toBe(true);
    await r.prev();
    expect(shown(r)).toEqual([3]);
  });
});
