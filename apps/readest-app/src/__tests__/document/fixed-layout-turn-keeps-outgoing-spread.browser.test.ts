import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// Regression test for the frozen backward page curl on PDF/CBZ (readest#6239
// follow-up). A captured page turn navigates the live view instantly under an
// overlay while the reader's finger is still down on the outgoing page's
// iframe. `goToSpread` then trims the prerendered-spread cache by access time,
// and the outgoing spread — stamped when it was shown, older than any preload
// created since — was the eviction victim on every backward turn. Detaching
// the iframe the finger is on destroys its document, and the browser drops the
// rest of that touch sequence without a touchend, so the drag never ends.
//
// Traced on a Xiaomi 13: the touched frame's `isConnected` flipped false
// ~90 ms into the turn and no touch event reached it again; refusing that one
// removal let the same gesture complete. The outgoing spread must survive the
// turn that leaves it.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
</style></head><body></body></html>`;

const makeBook = (sectionCount: number) => ({
  dir: 'ltr',
  rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
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
  index: number;
};

const frames = (renderer: HTMLElement) =>
  Array.from(renderer.shadowRoot!.querySelectorAll<HTMLIFrameElement>('iframe'));
const frameOf = (renderer: HTMLElement, section: number) =>
  frames(renderer).find((f) => f.dataset['sectionIndex'] === String(section)) ?? null;
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

describe('fixed-layout page turn keeps the outgoing spread', () => {
  const mountAt = async (index: number) => {
    renderer = document.createElement('foliate-fxl') as Renderer;
    renderer.style.width = '600px';
    renderer.style.height = '400px';
    renderer.setAttribute('flow', 'paginated');
    document.body.append(renderer);
    renderer.open(makeBook(6));
    await renderer.goToSpread(index, 'center', 'page');
    // The forward preload of index + 1 is what overflows the cache.
    await waitFor(
      () => frameOf(renderer!, index) !== null && frameOf(renderer!, index + 1) !== null,
    );
    return renderer;
  };

  it('does not detach the page the finger left when turning back', async () => {
    const r = await mountAt(2);
    const outgoing = frameOf(r, 2)!;
    await r.prev();
    expect(r.index).toBe(1);
    // Still in the DOM: the touch sequence that started on it can end on it.
    expect(outgoing.isConnected).toBe(true);
    expect(frameOf(r, 2)).toBe(outgoing);
  });

  it('does not detach the page the finger left when turning forward', async () => {
    const r = await mountAt(2);
    const outgoing = frameOf(r, 2)!;
    await r.next();
    expect(r.index).toBe(3);
    expect(outgoing.isConnected).toBe(true);
  });

  // The cache is a memory budget for heavy PDF pages; keeping the outgoing
  // spread alive must not turn it into a leak.
  it('still trims spreads that are two turns behind', async () => {
    const r = await mountAt(2);
    const twoBack = frameOf(r, 2)!;
    await r.prev();
    await r.prev();
    await waitFor(() => !twoBack.isConnected);
    expect(twoBack.isConnected).toBe(false);
  });
});
