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
