import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// Vite serves fixture files; fetch the EPUB at runtime in the browser.
const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

let book: BookDoc;

const loadEPUB = async () => {
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

/**
 * Wait for the paginator to emit 'stabilized'.
 * MUST be called BEFORE the action that triggers stabilization (e.g. goTo),
 * because #display dispatches 'stabilized' synchronously before returning.
 */
const waitForStabilized = (el: HTMLElement, timeout = 10000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stabilized timeout')), timeout);
    el.addEventListener(
      'stabilized',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Wait for fill to complete by polling until getContents count stabilizes. */
const waitForFillComplete = async (el: Renderer, timeout = 10000) => {
  const start = Date.now();
  let lastCount = -1;
  let stableFor = 0;
  while (Date.now() - start < timeout) {
    const count = el.getContents().length;
    if (count === lastCount) {
      stableFor += 100;
      if (stableFor >= 500) return;
    } else {
      stableFor = 0;
      lastCount = count;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('Paginator scrolled mode (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    book = await loadEPUB();
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    // The paginator needs non-zero dimensions for layout calculations
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    return el;
  };

  afterEach(() => {
    if (paginator) {
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
  });

  it('should support flow=scrolled attribute', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');
    const idx = book.sections!.findIndex((s) => s.linear !== 'no');
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    expect(paginator.scrolled).toBe(true);
    expect(paginator.primaryIndex).toBe(idx);
  });

  it('should use columnCount=1 in scrolled mode regardless of width', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');
    const idx = book.sections!.findIndex((s) => s.linear !== 'no');
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: idx });
    await stabilized;
    // Scrolled mode always uses 1 column
    expect(paginator.columnCount).toBe(1);
  });

  // Regression for issue #3987: toggling scrolled mode off shortly after
  // scrolling into the next section reverted the position to the previous
  // section because the debounced scroll handler had not yet updated
  // #primaryIndex / #anchor.
  it('should not revert to previous section when toggling scrolled mode off mid-scroll', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const linearIndices = book
      .sections!.map((s, i) => (s.linear !== 'no' ? i : -1))
      .filter((i) => i >= 0);
    if (linearIndices.length < 2) return;

    const startIdx = linearIndices[0]!;
    const nextIdx = linearIndices[1]!;

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: startIdx });
    await stabilized;
    await waitForFillComplete(paginator);

    const contents = paginator.getContents();
    if (!contents.some((c) => c.index === nextIdx)) return;

    const container = paginator.shadowRoot!.getElementById('container')!;
    const viewElements = Array.from(container.children).filter((c): c is HTMLElement =>
      Boolean((c as HTMLElement).querySelector?.('iframe')),
    );
    expect(viewElements.length).toBeGreaterThanOrEqual(2);
    const firstViewHeight = viewElements[0]!.getBoundingClientRect().height;
    expect(firstViewHeight).toBeGreaterThan(0);

    // Scroll past the first section into the second, then immediately
    // toggle scrolled mode off without giving the 250 ms debounce a chance
    // to fire.
    container.scrollTop = firstViewHeight + 100;
    const stabilized2 = waitForStabilized(paginator);
    paginator.setAttribute('flow', 'paginated');
    await stabilized2;

    expect(paginator.primaryIndex).toBe(nextIdx);
  });

  // Regression for issue #4112: in scrolled mode, navigating one section
  // back lands the target as the top-most view at scrollTop 0. The debounced
  // backward-preload then inserts the *previous* section above it. Browser
  // scroll anchoring is suppressed at scrollTop 0, so the inserted section
  // pushes the target down and the viewport drifts to the previous section
  // (the reader appears to "jump" to chapter n-1).
  it('should not drift to the previous section when it preloads above at scrollTop 0', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const sections = book.sections!;
    const isLinear = (i: number) => i >= 0 && i < sections.length && sections[i]!.linear !== 'no';
    // F is a tall section that will become the top-most view at scrollTop 0.
    // It needs a linear neighbour on each side: F-1 (prepended above) and
    // F+1 (navigated to first, which preloads F as its previous section).
    let F = -1;
    for (let i = 1; i < sections.length - 1; i++) {
      if (isLinear(i) && isLinear(i - 1) && isLinear(i + 1) && (sections[i]!.size ?? 0) > 8000) {
        F = i;
        break;
      }
    }
    expect(F).toBeGreaterThan(0);
    const M = F + 1;

    // Which loaded section currently sits at the top of the viewport.
    const visibleTopIndex = (): number | null => {
      const c = paginator.shadowRoot!.getElementById('container')!;
      const cTop = c.getBoundingClientRect().top;
      const contents = paginator.getContents();
      for (const child of Array.from(c.children) as HTMLElement[]) {
        const iframe = child.querySelector('iframe');
        if (!iframe) continue;
        const r = child.getBoundingClientRect();
        if (r.top - cTop <= 1 && r.bottom - cTop > 1) {
          const match = contents.find((x) => x.doc === iframe.contentDocument);
          return match ? (match.index as number) : null;
        }
      }
      return null;
    };

    // 1) Navigate to M so #display preloads F above it. Assert the loaded set
    //    the instant #display stabilizes: #display only pulls in the immediate
    //    previous section (F), and the scroll-handler backward buffer stays
    //    suppressed while #stabilizing. Everything below — up to the goTo(F)
    //    that is meant to prepend F-1 — runs synchronously, so the eager
    //    backward buffer can't pull F-1 in early and steal the measurement.
    //    (Waiting for the fill to settle first is racy: once #stabilizing ends
    //    the minPages backward buffer may pull F-1 in — readest/readest#4112.)
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: M, anchor: 0 });
    await stabilized;

    // F is loaded as the top view; F-1 has not been pulled in yet.
    const loadedIndices = () => paginator.getContents().map((c) => c.index);
    expect(loadedIndices()).toContain(F);
    expect(loadedIndices()).not.toContain(F - 1);

    // 2) Arm the measurement: capture the section shown at the top of the
    //    viewport the instant F-1 is prepended above the target.
    const driftAtPrepend = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('F-1 was never preloaded')), 8000);
      const onCreate = (e: Event) => {
        if ((e as CustomEvent).detail.index !== F - 1) return;
        paginator.removeEventListener('create-overlayer', onCreate as EventListener);
        clearTimeout(timer);
        requestAnimationFrame(() => resolve(visibleTopIndex()));
      };
      paginator.addEventListener('create-overlayer', onCreate as EventListener);
    });

    // 3) Navigate one section back to F. It is already loaded, so the
    //    paginator re-anchors to scrollTop 0 with F as the top view. The
    //    debounced backward-preload then inserts F-1 above it.
    await paginator.goTo({ index: F, anchor: 0 });

    const visibleWhenPrepended = await driftAtPrepend;
    expect(visibleWhenPrepended).toBe(F);
  });

  // Regression for issue #4112 (second symptom): after navigating one
  // section back in scrolled mode the target sits at the very top, so the
  // user must be able to scroll up into the previous section. The paginator
  // must therefore pre-load that previous section above the target.
  it('should preload the previous section after navigating one section back in scrolled mode', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const sections = book.sections!;
    const isLinear = (i: number) => i >= 0 && i < sections.length && sections[i]!.linear !== 'no';
    let F = -1;
    for (let i = 1; i < sections.length - 1; i++) {
      if (isLinear(i) && isLinear(i - 1) && isLinear(i + 1) && (sections[i]!.size ?? 0) > 8000) {
        F = i;
        break;
      }
    }
    expect(F).toBeGreaterThan(0);
    const M = F + 1;

    // Navigate to M (preloads F above it). Assert F-1 is not loaded the instant
    // #display stabilizes — #display only pulls in the immediate previous
    // section (F), and the scroll-handler backward buffer is suppressed while
    // #stabilizing. Asserting after the fill settles is racy: once
    // stabilization ends the eager minPages backward buffer may pull F-1 in
    // (readest/readest#4112). It doing so later is fine — that is exactly what
    // we want once we navigate back, below.
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: M, anchor: 0 });
    await stabilized;
    expect(paginator.getContents().map((c) => c.index)).not.toContain(F - 1);
    await waitForFillComplete(paginator);

    // Navigate one section back to F. The previous section (F-1) must be
    // pre-loaded so the user can immediately scroll up into it.
    await paginator.goTo({ index: F, anchor: 0 });
    expect(paginator.primaryIndex).toBe(F);
    expect(paginator.getContents().map((c) => c.index)).toContain(F - 1);
  });

  // Regression for issue #4112 (UX follow-up): navigating between adjacent
  // already-loaded sections in continuous scrolled mode must not fade the
  // container to opacity 0 — that produced a hard blank-screen flash. The
  // target view is already rendered, so we scroll straight to it.
  it('should not blank the container when navigating to an adjacent section in scrolled mode', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const linear = book.sections!.map((s, i) => (s.linear !== 'no' ? i : -1)).filter((i) => i >= 0);
    expect(linear.length).toBeGreaterThan(4);
    const K = linear[3]!;

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: K, anchor: 0 });
    await stabilized;
    await waitForFillComplete(paginator);

    // Pick an adjacent section that is already loaded.
    const loaded = paginator.getContents().map((c) => c.index);
    const adjacent = [K + 1, K - 1].find((i) => loaded.includes(i));
    expect(adjacent).toBeDefined();

    // Record every value the container's inline opacity takes during the
    // navigation (via the old value carried on each style mutation).
    const container = paginator.shadowRoot!.getElementById('container')!;
    const styleHistory: string[] = [];
    const obs = new MutationObserver((records) => {
      for (const r of records) if (r.oldValue != null) styleHistory.push(r.oldValue);
      styleHistory.push(container.getAttribute('style') ?? '');
    });
    obs.observe(container, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    });

    await paginator.goTo({ index: adjacent!, anchor: 0 });
    await new Promise((r) => setTimeout(r, 100));
    obs.disconnect();

    const blanked = styleHistory.some((s) => /opacity:\s*0(?![.\d])/.test(s));
    expect(blanked).toBe(false);
    expect(paginator.primaryIndex).toBe(adjacent);
  });

  // Regression for issue #4112 (UX follow-up): the backward preload used to
  // fire only within one viewport of the top (and only after the debounce),
  // so scrolling up could dead-end at the top-most loaded section until the
  // user nudged back down. It must mirror the eager forward buffer and load
  // the previous section while still a few viewports away from the top.
  it('should preload the previous section when scrolled within a few viewports of the top', async () => {
    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const sections = book.sections!;
    const isLinear = (i: number) => i >= 0 && i < sections.length && sections[i]!.linear !== 'no';
    const firstLinear = sections.findIndex((s) => s.linear !== 'no');
    // Deepest section with two linear neighbours before it, so there is
    // room to preload backward without immediately hitting the book start.
    let K = -1;
    for (let i = sections.length - 1; i >= 2; i--) {
      if (isLinear(i) && isLinear(i - 1) && isLinear(i - 2)) {
        K = i;
        break;
      }
    }
    expect(K).toBeGreaterThan(firstLinear + 1);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: K, anchor: 0 });
    await stabilized;
    await waitForFillComplete(paginator);

    const loadedMin = () => Math.min(...paginator.getContents().map((c) => c.index as number));
    const firstBefore = loadedMin();
    if (firstBefore <= firstLinear) return; // already at the book start

    // Position ~2 viewports below the top of loaded content — past the old
    // one-viewport gate, but inside the forward-mirrored backward buffer.
    const container = paginator.shadowRoot!.getElementById('container')!;
    container.scrollTop = 2 * paginator.size;

    const start = Date.now();
    while (
      Date.now() - start < 3000 &&
      !paginator.getContents().some((c) => c.index === firstBefore - 1)
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(paginator.getContents().map((c) => c.index)).toContain(firstBefore - 1);
  });
});
