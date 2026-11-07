import { afterEach, describe, expect, it } from 'vitest';

// Registers the <foliate-fxl> custom element (the fixed-layout / PDF renderer).
import 'foliate-js/fixed-layout.js';

// view.select() in scrolled mode waits for the target page to load. Going
// somewhere else meanwhile (a page jump, a page turn) supersedes it: when the
// page loads later, the old select must not select its match, pull the view
// back to it, or report a 'selection' relocation.

const PAGE_HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 1000px; }
  p { margin: 600px 0 0; }
</style></head><body><p>match</p></body></html>`;

const waitFor = async (condition: () => boolean, timeout = 4000): Promise<void> => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

type Target = { index: number; anchor?: (doc: Document) => Range; select?: boolean };

type Renderer = HTMLElement & {
  open(book: unknown): void;
  destroy(): void;
  goTo(target: Target): Promise<void>;
  prev(distance?: number): Promise<void>;
  getContents(): { doc: Document; index: number }[];
};

let renderer: Renderer | null = null;

afterEach(() => {
  renderer?.destroy();
  renderer?.remove();
  renderer = null;
});

const TARGET = 4;

// Six 1000px pages in a 600x400 scrolled view; page TARGET loads only once
// released.
const mount = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started = false;
  const page = { src: 'srcdoc', data: PAGE_HTML };
  const r = document.createElement('foliate-fxl') as Renderer;
  r.style.width = '600px';
  r.style.height = '400px';
  r.setAttribute('flow', 'scrolled');
  const selections: unknown[] = [];
  r.addEventListener('relocate', (e) => {
    const { detail } = e as CustomEvent;
    if (detail.reason === 'selection') selections.push(detail);
  });
  document.body.append(r);
  r.open({
    dir: 'ltr',
    rendition: { viewport: { width: 600, height: 1000 }, spread: 'none' },
    sections: Array.from({ length: 6 }, (_, i) => ({
      linear: 'yes',
      load: async () => {
        if (i === TARGET) {
          started = true;
          await gate;
        }
        return page;
      },
    })),
  });
  renderer = r;
  return { r, release, started: () => started, selections };
};

const anchor = (doc: Document) => {
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector('p')!);
  return range;
};

const targetSelection = (r: Renderer) =>
  r
    .getContents()
    .find((c) => c.index === TARGET)
    ?.doc.getSelection()
    ?.toString() ?? '';

describe('fixed-layout view.select() superseded while its page loads', () => {
  it('is dropped when a page jump comes first', async () => {
    const { r, release, started, selections } = mount();

    const select = r.goTo({ index: TARGET, anchor, select: true });
    await waitFor(started);
    await r.goTo({ index: TARGET - 1 });
    const scrollTop = r.scrollTop;
    release();
    await select;

    expect(selections).toEqual([]);
    expect(targetSelection(r)).toBe('');
    expect(r.scrollTop).toBe(scrollTop);
  });

  it('is dropped when a page turn comes first', async () => {
    const { r, release, started, selections } = mount();

    const select = r.goTo({ index: TARGET, anchor, select: true });
    await waitFor(started);
    await r.prev();
    release();
    await select;

    expect(selections).toEqual([]);
    expect(targetSelection(r)).toBe('');
  });
});
