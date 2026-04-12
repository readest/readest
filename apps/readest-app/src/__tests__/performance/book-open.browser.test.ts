import { describe, it, expect, beforeAll } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';

/**
 * End-to-end timing for the book-open critical path on a real long book
 * (Reverend_Insanity.epub, 13 MB, ~2000 chapters).
 *
 * Measures the same code path that runs on a book-tile click: file →
 * DocumentLoader.open → foliate-view → first stabilized event.
 *
 * A beforeAll warmup pre-loads all dynamic imports and JIT-compiles the
 * code paths so that the "cold" run measures EPUB parse cost, not Vite
 * module transform or V8 JIT cold-start. This matches production where
 * modules are pre-bundled and JIT-compiled at page load.
 *
 * Output via console.warn (vitest.browser.config.mts suppresses stdout).
 *   pnpm test:browser -- src/__tests__/performance/book-open.browser.test.ts
 */

const EPUB_URL = new URL('../fixtures/data/reverend-insanity.epub', import.meta.url).href;
const WARMUP_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

type Row = { step: string; ms: number };

type FoliateViewElement = HTMLElement & {
  open: (book: BookDoc) => Promise<void>;
  goToFraction: (frac: number) => Promise<void>;
  renderer: HTMLElement;
};

const waitForStabilized = (el: HTMLElement, timeout = 30000) =>
  new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stabilized timeout')), timeout);
    el.addEventListener(
      'stabilized',
      () => {
        clearTimeout(timer);
        resolve(performance.now());
      },
      { once: true },
    );
  });

const measureOpen = async (): Promise<Row[]> => {
  const rows: Row[] = [];
  const totalStart = performance.now();

  // 1. Fetch EPUB bytes and build a File (matches what appService.loadBookContent returns).
  let t = performance.now();
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'reverend-insanity.epub', {
    type: 'application/epub+zip',
  });
  rows.push({ step: 'fetch + File', ms: performance.now() - t });

  // 2. DocumentLoader.open — the single biggest suspected contributor.
  //    Internally: magic-byte check, zip loader (zip.js), foliate EPUB.init
  //    (container → OPF → resources → spine → nav/ncx → #prepareSubItems).
  t = performance.now();
  const { book: bookDoc } = await new DocumentLoader(file).open();
  rows.push({ step: 'DocumentLoader.open', ms: performance.now() - t });

  // 3. Dynamic import of foliate-view. FoliateViewer.tsx:460 does this too.
  t = performance.now();
  await import('foliate-js/view.js');
  await customElements.whenDefined('foliate-view');
  rows.push({ step: "import 'foliate-js/view.js'", ms: performance.now() - t });

  // 4. Create element, size it (paginator needs non-zero container), mount.
  const view = document.createElement('foliate-view') as FoliateViewElement;
  Object.assign(view.style, {
    width: '800px',
    height: '600px',
    position: 'absolute',
    left: '0',
    top: '0',
  });
  document.body.appendChild(view);

  // 5. view.open — creates the internal foliate-paginator and wires listeners.
  t = performance.now();
  await view.open(bookDoc);
  rows.push({ step: 'view.open(bookDoc)', ms: performance.now() - t });

  // 6. view.goToFraction(0) → first stabilized event (page visible).
  //    Matches FoliateViewer.tsx:563 path for a fresh book with no lastLocation.
  //    IMPORTANT: register the stabilized listener BEFORE triggering, because
  //    paginator dispatches 'stabilized' synchronously inside its #display.
  const stabilizedPromise = waitForStabilized(view.renderer);
  t = performance.now();
  await view.goToFraction(0);
  const stabilizedAt = await stabilizedPromise;
  rows.push({ step: 'view.goToFraction(0) → first stabilized', ms: stabilizedAt - t });

  rows.push({ step: '── TOTAL click → first visible ──', ms: performance.now() - totalStart });

  // 7. Post-paint work that the user feels as "loading the text":
  //    ensureSubItemsResolved() walks every TOC-referenced section's XHTML.
  //    This runs inside runIdleTask(updateToc) in the real app and is NOT
  //    on the critical path, but we measure it so we know how bad it is.
  const bookDocEpub = bookDoc as BookDoc & { ensureSubItemsResolved?: () => Promise<void> };
  if (typeof bookDocEpub.ensureSubItemsResolved === 'function') {
    t = performance.now();
    await bookDocEpub.ensureSubItemsResolved();
    rows.push({ step: '[post-paint] ensureSubItemsResolved', ms: performance.now() - t });
  }

  view.remove();
  return rows;
};

const formatReport = (title: string, cold: Row[], warm: Row[]): string => {
  const header = `\n=== ${title} ===`;
  const widthStep = Math.max(...cold.map((r) => r.step.length), 6);
  const lines: string[] = [];
  lines.push(header);
  lines.push(
    `${'Step'.padEnd(widthStep)}  ${'cold (ms)'.padStart(10)}  ${'warm (ms)'.padStart(10)}`,
  );
  lines.push(`${'─'.repeat(widthStep)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}`);
  for (let i = 0; i < cold.length; i++) {
    const coldMs = cold[i]!.ms.toFixed(1);
    const warmMs = warm[i]?.ms.toFixed(1) ?? '—';
    lines.push(
      `${cold[i]!.step.padEnd(widthStep)}  ${coldMs.padStart(10)}  ${warmMs.padStart(10)}`,
    );
  }
  return lines.join('\n');
};

describe('Book-open timing — Reverend_Insanity.epub (13 MB, ~2000 chapters)', () => {
  // Pre-warm all dynamic imports and JIT-compile code paths on a small EPUB
  // so that measured runs reflect production-like conditions, not cold-start.
  beforeAll(async () => {
    const resp = await fetch(WARMUP_URL);
    const buf = await resp.arrayBuffer();
    const file = new File([buf], 'warmup.epub', { type: 'application/epub+zip' });
    const { book } = await new DocumentLoader(file).open();
    await import('foliate-js/view.js');
    await customElements.whenDefined('foliate-view');
    const view = document.createElement('foliate-view') as FoliateViewElement;
    Object.assign(view.style, { width: '800px', height: '600px', position: 'absolute' });
    document.body.appendChild(view);
    await view.open(book);
    const p = waitForStabilized(view.renderer);
    await view.goToFraction(0);
    await p;
    view.remove();
  }, 30000);

  it('measures cold and warm open paths', async () => {
    const cold = await measureOpen();
    const warm = await measureOpen();

    // stdout is suppressed by vitest.browser.config.mts onConsoleLog; warn goes to stderr.
    // eslint-disable-next-line no-console
    console.warn(formatReport('Reverend_Insanity.epub open timing', cold, warm));

    const totalRow = cold.find((r) => r.step.includes('TOTAL'))!;
    // Loose upper bound: flag a catastrophic regression, don't flake.
    expect(totalRow.ms).toBeLessThan(15000);
  }, 120000);
});
