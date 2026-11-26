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
