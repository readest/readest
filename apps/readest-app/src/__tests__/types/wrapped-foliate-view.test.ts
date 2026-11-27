// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { wrappedFoliateView, type FoliateView } from '@/types/view';

function makeFakeView(goToImpl: (href: string) => Promise<void>) {
  const el = document.createElement('div') as unknown as FoliateView;
  el.addAnnotation = vi.fn() as unknown as FoliateView['addAnnotation'];
  el.goTo = goToImpl as unknown as FoliateView['goTo'];
  return el;
}

describe('wrappedFoliateView goTo events', () => {
  it('dispatches navigate-start before and navigate-end after goTo resolves', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const view = makeFakeView(() => gate);
    view.addEventListener('navigate-start', () => order.push('start'));
    view.addEventListener('navigate-end', () => order.push('end'));
    const wrapped = wrappedFoliateView(view);
    const nav = wrapped.goTo('5');
    expect(order).toEqual(['start']); // start fired synchronously, end pending
    release();
    await nav;
    expect(order).toEqual(['start', 'end']);
  });

  it('emits the previous and next chapters only for an explicit jump with a new location', async () => {
    const view = makeFakeView(async (href) => {
      view.lastLocation = { cfi: href, tocItem: { label: href, href, id: 0, index: 0 } };
    });
    view.lastLocation = { cfi: 'A', tocItem: { label: 'A', href: 'A', id: 0, index: 0 } };
    const showReturn = vi.fn();
    view.addEventListener('reader-jump', showReturn);
    const wrapped = wrappedFoliateView(view);

    await wrapped.goTo('B', { focus: true });
    expect(showReturn).toHaveBeenCalledOnce();
    expect(showReturn.mock.calls[0]?.[0].detail).toEqual({ from: 'A', to: 'B' });

    await wrapped.goTo('B', { focus: true });
    await wrapped.goTo('C');
    expect(showReturn).toHaveBeenCalledOnce();
  });

  it('keeps the place before a run of steps through results', async () => {
    // Mirrors foliate: goTo moves the page and pushes the target; replaceState
    // swaps the current entry without an index-change.
    const entries: unknown[] = ['A'];
    let index = 0;
    const view = makeFakeView(async (href) => {
      await view.renderer.goTo(view.resolveNavigation(href));
      entries.length = ++index;
      entries[index] = href;
      view.history.dispatchEvent(new Event('index-change'));
    });
    view.history = Object.assign(new EventTarget(), {
      canGoBack: true,
      canGoForward: false,
      back: vi.fn(),
      forward: vi.fn(),
      clear: vi.fn(),
      replaceState: (x: unknown) => {
        entries[index] = x;
      },
    });
    view.resolveNavigation = ((href: string | number) => ({
      index: 0,
      anchor: href,
    })) as unknown as FoliateView['resolveNavigation'];
    view.renderer = {
      goTo: async ({ anchor }: { anchor?: unknown }) => {
        const label = String(anchor).split('-')[0]!;
        view.lastLocation = {
          cfi: String(anchor),
          tocItem: { label, href: label, id: 0, index: 0 },
        };
      },
    } as unknown as FoliateView['renderer'];
    view.lastLocation = { cfi: 'A', tocItem: { label: 'A', href: 'A', id: 0, index: 0 } };
    const showReturn = vi.fn();
    view.addEventListener('reader-jump', showReturn);
    const wrapped = wrappedFoliateView(view);

    await wrapped.goTo('B-1', { focus: true, step: true });
    await wrapped.goTo('B-2', { focus: true, step: true });
    await wrapped.goTo('C-1', { focus: true, step: true });
    expect(entries).toEqual(['A', 'C-1']);
    expect(showReturn.mock.calls.map(([e]) => e.detail)).toEqual([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
    ]);

    // Any other jump ends the run: the next step stacks a new entry again.
    await wrapped.goTo('D', { focus: true });
    await wrapped.goTo('E-1', { focus: true, step: true });
    expect(entries).toEqual(['A', 'C-1', 'D', 'E-1']);
    expect(showReturn.mock.lastCall?.[0].detail).toEqual({ from: 'D', to: 'E' });

    // Reading on from a result (a page turn replaces the entry) ends the run
    // too: the next step keeps the page that was being read.
    view.lastLocation = { cfi: 'E-9', tocItem: { label: 'E', href: 'E', id: 0, index: 0 } };
    view.history.replaceState('E-9');
    await wrapped.goTo('F-1', { focus: true, step: true });
    expect(entries).toEqual(['A', 'C-1', 'D', 'E-9', 'F-1']);
    expect(showReturn.mock.lastCall?.[0].detail).toEqual({ from: 'E', to: 'F' });

    // Slider moves are steps without focus: they still arm the return.
    view.lastLocation = { cfi: 'F-9', tocItem: { label: 'F', href: 'F', id: 0, index: 0 } };
    view.history.replaceState('F-9');
    await wrapped.goTo('G-1', { step: true });
    await wrapped.goTo('H-1', { step: true });
    expect(entries).toEqual(['A', 'C-1', 'D', 'E-9', 'F-9', 'H-1']);
    expect(showReturn.mock.lastCall?.[0].detail).toEqual({ from: 'F', to: 'H' });
  });

  it('dispatches navigate-end even when goTo rejects', async () => {
    const order: string[] = [];
    const view = makeFakeView(() => Promise.reject(new Error('nav failed')));
    view.addEventListener('navigate-start', () => order.push('start'));
    view.addEventListener('navigate-end', () => order.push('end'));
    const wrapped = wrappedFoliateView(view);
    await expect(wrapped.goTo('5')).rejects.toThrow('nav failed');
    expect(order).toEqual(['start', 'end']);
  });
});
