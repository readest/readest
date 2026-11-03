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

describe('wrappedFoliateView select', () => {
  it('preserves the original method context and selects the resolved range', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const bookDoc = frame.contentDocument!;
    const text = bookDoc.createTextNode('selected search result');
    bookDoc.body.append(text);
    const range = bookDoc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    const view = document.createElement('div') as unknown as FoliateView;
    const originalSelect = vi.fn(function (this: FoliateView) {
      expect(this).toBe(view);
    });
    view.addAnnotation = vi.fn() as unknown as FoliateView['addAnnotation'];
    view.goTo = vi.fn() as unknown as FoliateView['goTo'];
    view.select = originalSelect as unknown as FoliateView['select'];
    view.resolveCFI = vi.fn().mockReturnValue({
      index: 3,
      anchor: () => range,
    });
    view.renderer = {
      getContents: () => [{ index: 3, doc: bookDoc }],
    } as unknown as FoliateView['renderer'];
    try {
      const wrapped = wrappedFoliateView(view);
      const cfi = 'epubcfi(/6/4)';
      await wrapped.select(cfi);
      expect(originalSelect).toHaveBeenCalledWith(cfi);
      expect(view.resolveCFI).toHaveBeenCalledWith(cfi);
      expect(bookDoc.defaultView?.getSelection()?.toString()).toBe('selected search result');
    } finally {
      frame.remove();
    }
  });

  it('does not resolve or create a DOM selection for non-CFI targets', async () => {
    const view = document.createElement('div') as unknown as FoliateView;
    const resolveCFI = vi.fn();
    view.addAnnotation = vi.fn() as unknown as FoliateView['addAnnotation'];
    view.goTo = vi.fn() as unknown as FoliateView['goTo'];
    view.select = vi.fn() as unknown as FoliateView['select'];
    view.resolveCFI = resolveCFI;
    view.renderer = {} as FoliateView['renderer'];
    const wrapped = wrappedFoliateView(view);
    await wrapped.select(2);
    expect(resolveCFI).not.toHaveBeenCalled();
  });
});
