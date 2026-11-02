import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// Android's native paper curl keeps the pixels of up to three pages keyed by
// getPageTurnKey(). The key a turn predicts for its destination must be the
// key the renderer reports once it lands there, or the curl reuses the wrong
// page's pixels (or never finds the resident ones).

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

const makeBook = (sectionCount: number, dir: string, spread?: string) => ({
  dir,
  rendition: { viewport: { width: 600, height: 1000 }, spread },
  sections: Array.from({ length: sectionCount }, () => ({
    load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
    linear: 'yes',
  })),
});

type Renderer = HTMLElement & {
  open(book: unknown): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  goToSpread(index: number, side: string, reason?: string): Promise<void>;
  getPageTurnKey(delta?: number): string | null;
  atStart: boolean;
  atEnd: boolean;
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.remove();
  renderer = null;
});

const mount = async (width: number, height: number, dir: string, spread?: string) => {
  renderer = document.createElement('foliate-fxl') as Renderer;
  renderer.style.width = `${width}px`;
  renderer.style.height = `${height}px`;
  renderer.setAttribute('flow', 'paginated');
  document.body.append(renderer);
  renderer.open(makeBook(7, dir, spread));
  await renderer.goToSpread(0, dir === 'rtl' ? 'left' : 'right', 'page');
  return renderer;
};

// Walks to the end and back, checking every prediction against the landing.
const walk = async (r: Renderer) => {
  const seen: string[] = [r.getPageTurnKey()!];
  for (const forward of [true, false]) {
    for (let turns = 0; turns < 20; turns++) {
      const before = r.getPageTurnKey();
      const predicted = r.getPageTurnKey(forward ? 1 : -1);
      await (forward ? r.next() : r.prev());
      const landed = r.getPageTurnKey();
      if (landed === before) {
        // A turn past either end names no page.
        expect(predicted).toBeNull();
        break;
      }
      expect(predicted).toBe(landed);
      if (forward) seen.push(landed!);
    }
  }
  return seen;
};

describe('fixed-layout page-turn keys', () => {
  for (const dir of ['ltr', 'rtl']) {
    it(`predicts each portrait page of a spread (${dir})`, async () => {
      const seen = await walk(await mount(400, 1000, dir));
      // One key per page shown: the blank-sided first spread shows one page.
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it(`predicts each landscape spread (${dir})`, async () => {
      const seen = await walk(await mount(1000, 400, dir));
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
    });
  }

  it('predicts single-page spreads', async () => {
    const seen = await walk(await mount(400, 1000, 'ltr', 'none'));
    expect(seen).toHaveLength(7);
  });

  it('has no key in scrolled mode', async () => {
    const r = await mount(400, 1000, 'ltr');
    r.setAttribute('flow', 'scrolled');
    expect(r.getPageTurnKey()).toBeNull();
  });
});
