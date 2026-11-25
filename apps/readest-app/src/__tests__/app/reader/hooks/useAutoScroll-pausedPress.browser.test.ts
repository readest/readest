import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { userEvent } from 'vitest/browser';

import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';

await import('@/styles/globals.css');

// A paginated Auto Scroll session (#7575) wipes the next page in under a still
// copy of the page being read. A pause held the wipe, copy and all, and the
// copy's layer took every press, so no text could be selected until the
// session ended. A pause now shows the page being read, live, as before #7869.
// Real presses and hit testing need a layout engine: the browser lane.

const h = vi.hoisted(() => ({
  bookKey: 'book-1',
  viewSettings: {
    scrolled: false,
    vertical: false,
    rtl: false,
    autoScrollSpeed: 500,
    autoScrollRunning: false,
  } as Record<string, unknown>,
}));

vi.mock('@/store/readerStore', () => {
  const state = {
    hoveredBookKey: null,
    viewStates: { [h.bookKey]: { inited: true, previewMode: false } },
    getViewSettings: () => h.viewSettings,
    getViewState: () => ({ inited: true, previewMode: false }),
    setAutoScrollEnabled: () => {},
  };
  const useReaderStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useReaderStore.getState = () => state;
  return { useReaderStore };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: () => {} }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: () => {} }));

import { useAutoScroll } from '@/app/reader/hooks/useAutoScroll';

const BOOK_KEY = h.bookKey;

const LINE = 40;
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
const lines = (word: string) => Array.from({ length: 10 }, (_, i) => `<p>${word}${i}</p>`).join('');

describe('a paused paginated Auto Scroll session', () => {
  let cell: HTMLDivElement;
  let section: HTMLIFrameElement;

  beforeEach(() => {
    // The book's grid cell: the paginator's page area with its section, and
    // over it the layer FoliateViewer renders for the copy.
    cell = document.createElement('div');
    cell.style.cssText = 'position: fixed; left: 0; top: 0; width: 400px; height: 400px';
    section = document.createElement('iframe');
    section.style.cssText = 'position: absolute; inset: 0; width: 400px; height: 400px; border: 0';
    cell.append(section);
    document.body.append(cell);
    const doc = section.contentDocument!;
    doc.open();
    doc.write(
      `<!DOCTYPE html><style>body { margin: 0; font: 32px/${LINE}px sans-serif } p { margin: 0; padding-left: 8px }</style>`,
    );
    doc.close();
    doc.body.innerHTML = lines('read');
  });

  afterEach(() => {
    cleanup();
    cell.remove();
  });

  const startPausedWipe = async () => {
    const doc = section.contentDocument!;
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; inset: 0; pointer-events: none';
    cell.append(container);
    const renderer = {
      scrolled: false,
      isConnected: true,
      atEnd: false,
      columnCount: 1,
      // The live view turns to the next page under the copy.
      next: async () => {
        doc.body.innerHTML = lines('next');
      },
      prev: async () => {
        doc.body.innerHTML = lines('read');
      },
      hasAttribute: () => false,
      setAttribute: () => {},
      removeAttribute: () => {},
      toggleAttribute: () => {},
      shadowRoot: { getElementById: () => container },
      getContents: () => [{ doc }],
    };
    const viewRef = {
      current: {
        isFixedLayout: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        next: async () => {},
        prev: async () => {},
        renderer,
      },
    } as unknown as React.RefObject<FoliateView | null>;

    const host = document.createElement('div');
    host.className = 'pointer-events-none absolute inset-0';
    const line = document.createElement('div');
    cell.append(host, line);
    const rendered = renderHook(() => useAutoScroll(BOOK_KEY, viewRef));
    Object.assign(rendered.result.current.wipeCopyRef, { current: host });
    Object.assign(rendered.result.current.wipeLineRef, { current: line });

    await act(async () => {
      await eventDispatcher.dispatch('autoscroll-toggle', { bookKey: BOOK_KEY });
    });
    // Let the divider cross the first four lines of the next page.
    const divider = () => Number(/translate\([^,]+, ([\d.]+)px\)/.exec(line.style.transform)?.[1]);
    await vi.waitFor(() => expect(divider()).toBeGreaterThan(LINE * 4), { timeout: 10000 });
    const y = divider();
    act(() => rendered.result.current.togglePause());
    expect(rendered.result.current.paused).toBe(true);
    expect(y).toBeLessThan(LINE * 8);
    // The turn back under the copy, and the copy going two frames on.
    await frames(6);
    const copy = () => host.querySelector<HTMLElement>('[data-page-wipe-copy]')!;
    return { ...rendered, doc, line, copy, divider, held: y };
  };

  // Where line `i` of the page is.
  const lineAt = (i: number) => ({ x: 24, y: i * LINE + LINE / 2 });

  test('selects any word of the page being read', { timeout: 20000 }, async () => {
    const { doc, held, line } = await startPausedWipe();
    const below = Math.ceil(held / LINE) + 1;

    await userEvent.dblClick(section, { position: lineAt(below), force: true });
    expect(doc.getSelection()!.toString()).toBe(`read${below}`);

    await userEvent.dblClick(section, { position: lineAt(1), force: true });
    expect(doc.getSelection()!.toString()).toBe('read1');
    // No divider over a page that is the same on both sides of it.
    expect(line.style.display).toBe('none');
  });

  test('plays on from where the divider was, and a press pauses', { timeout: 20000 }, async () => {
    const { doc, copy, divider, held, result } = await startPausedWipe();

    act(() => result.current.togglePause());
    await vi.waitFor(() => expect(copy().style.visibility).toBe(''), { timeout: 5000 });
    // The next page is back above the divider, which goes on from where it was.
    expect(doc.body.textContent).toContain('next1');
    expect(divider()).toBeGreaterThanOrEqual(held - 1);
    expect(divider()).toBeLessThan(held + LINE);

    const pressed = vi.fn();
    doc.addEventListener('mousedown', pressed);
    await userEvent.click(section, { position: lineAt(1), force: true });
    expect(result.current.paused).toBe(true);
    expect(pressed).not.toHaveBeenCalled();
  });
});
