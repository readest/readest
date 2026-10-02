import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import '@/styles/globals.css';

// E-ink mode disables transitions with `body.no-transitions`, but a descendant selector
// stops at the first shadow boundary, so the reader's page gate was left out: the
// paginator's `#container` fades `opacity` over 50ms on every section reveal, and on an
// e-ink panel each alpha step is its own greyscale refresh (the flash just after a
// chapter opens). The rule that reaches it is `.no-transitions
// foliate-view::part(container)` -- `container` is re-exported by view.js.

const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

let book: BookDoc;
let view: FoliateView | null = null;

const containerOf = (el: FoliateView) =>
  el.renderer?.shadowRoot?.querySelector<HTMLElement>('[part=container]') ?? null;

const openView = async () => {
  await import('foliate-js/paginator.js');
  await import('foliate-js/view.js');
  const el = document.createElement('foliate-view') as FoliateView;
  Object.assign(el.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '800px',
    height: '600px',
  });
  document.body.appendChild(el);
  await el.open(book);
  for (let i = 0; i < 200 && !containerOf(el); i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  view = el;
  const container = containerOf(el);
  if (!container) throw new Error('paginator container not found');
  return container;
};

describe('e-ink reveal fade', () => {
  beforeAll(async () => {
    const resp = await fetch(EPUB_URL);
    const file = new File([await resp.arrayBuffer()], 'sample-alice.epub', {
      type: 'application/epub+zip',
    });
    book = (await new DocumentLoader(file).open()).book;
  }, 30000);

  afterEach(() => {
    view?.remove();
    view = null;
    document.body.classList.remove('no-transitions');
  });

  it('drops the container opacity fade only in e-ink mode', async () => {
    const container = await openView();

    document.body.classList.remove('no-transitions');
    expect(getComputedStyle(container).transitionProperty).toBe('opacity');
    expect(getComputedStyle(container).transitionDuration).toBe('0.05s');

    document.body.classList.add('no-transitions');
    expect(getComputedStyle(container).transitionDuration).toBe('0s');
  });

  it('runs no opacity transition across the reveal in e-ink mode', async () => {
    const container = await openView();
    // events, not sampled animation objects: a 50ms transition can finish inside the
    // two frames the control takes to look, whereas transitionrun either fired or not
    const seen: string[] = [];
    const note = (e: Event) => {
      if (e.target !== container) return;
      if ((e as TransitionEvent).propertyName !== 'opacity') return;
      seen.push(e.type);
    };
    for (const ty of ['transitionrun', 'transitionstart', 'transitionend'] as const) {
      container.addEventListener(ty, note, true);
    }
    const reveal = async () => {
      container.style.opacity = '0';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      container.style.opacity = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    };

    // control: the stock build really does animate the reveal, so the empty list below
    // is the rule working, not an instrument that never sees anything
    document.body.classList.remove('no-transitions');
    await reveal();
    expect(seen).toContain('transitionrun');

    seen.length = 0;
    document.body.classList.add('no-transitions');
    await reveal();
    expect(seen).toEqual([]);
  });
});
