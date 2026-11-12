// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHandwriting } from '@/app/reader/hooks/useHandwriting';

// A page turn writes styles all over the paginator's shadow root, and each
// burst made the hook re-render and re-anchor the ink for the new layout
// (two React commits), several times a turn. With no ink in the book and the
// pen off there is nothing to place, so a layout change must cost nothing.

const h = vi.hoisted(() => {
  const readerState = {
    viewStates: { 'book-1': { drawingEnabled: false } },
    setDrawingEnabled: () => {},
    getView: (): unknown => null,
    getViewSettings: () => ({ scrolled: false }),
  };
  const settingsState = {
    settings: {
      globalReadSettings: {
        handwritingTool: 'pen',
        handwritingColor: '#1a1a1a',
        handwritingWidth: 0.004,
        handwritingMarkerColor: '#ffeb3b',
        handwritingMarkerWidth: 0.02,
      },
    },
  };
  return { readerState, settingsState, booknotes: [] as unknown[] };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    (selector?: (state: typeof h.readerState) => unknown) =>
      selector ? selector(h.readerState) : h.readerState,
    { getState: () => h.readerState },
  ),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => h.settingsState, { getState: () => h.settingsState }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({ isFixedLayout: false }),
    getConfig: () => ({ booknotes: h.booknotes }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  })),
}));
vi.mock('@/store/readerProgressStore', () => {
  const progress = { location: 'epubcfi(/6/4!/4/2)', section: { current: 1 } };
  return {
    useBookProgressValue: (key: string | null, select: (p: typeof progress) => unknown) =>
      key ? select(progress) : undefined,
  };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
const createInkAnchoring = vi.hoisted(() => vi.fn(() => ({ place: () => null })));
vi.mock('@/app/reader/utils/inkAnchoring', () => ({ createInkAnchoring }));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);

/** A reflowable view: the paginator with its shadow root. */
const mountView = () => {
  const view = document.createElement('foliate-view') as HTMLElement & {
    renderer: HTMLElement & { getContents: () => unknown[] };
  };
  const renderer = document.createElement('div') as unknown as typeof view.renderer;
  const root = renderer.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  root.appendChild(container);
  view.appendChild(renderer);
  view.renderer = renderer;
  document.body.appendChild(view);
  renderer.getContents = () => [];
  return { view, container };
};

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));

/** Mounts the hook, lets it settle, then writes a style in the paginator as a turn does. */
const renderAndTurn = async () => {
  const { view, container } = mountView();
  h.readerState.getView = () => view;
  let renders = 0;
  const { result } = renderHook(() => {
    renders++;
    return useHandwriting('book-1');
  });
  const cell = document.createElement('div');
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 600,
    height: 800,
    right: 600,
    bottom: 800,
  } as DOMRect);
  act(() => result.current.containerRef(cell));
  await settle();
  renders = 0;
  createInkAnchoring.mockClear();
  act(() => {
    container.style.transform = 'translateX(-600px)';
  });
  await settle();
  return { renders, anchorings: createInkAnchoring.mock.calls.length };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  h.booknotes = [];
  h.readerState.viewStates['book-1'].drawingEnabled = false;
});

describe('useHandwriting on a layout change', () => {
  it('does nothing in a book with no ink and the pen off', async () => {
    expect(await renderAndTurn()).toEqual({ renders: 0, anchorings: 0 });
  });

  it('re-anchors the ink of a book that has some', async () => {
    h.booknotes = [
      {
        id: 'ink-1',
        type: 'ink',
        cfi: 'epubcfi(/6/4!/4/2)',
        ink: [
          {
            points: [
              [0.1, 0.1],
              [0.2, 0.2],
            ],
            color: '#000',
            width: 0.004,
          },
        ],
        updatedAt: 1,
      },
    ];
    const { renders, anchorings } = await renderAndTurn();
    expect(renders).toBeGreaterThan(0);
    expect(anchorings).toBeGreaterThan(0);
  });

  it('re-anchors for new strokes while the pen is on', async () => {
    h.readerState.viewStates['book-1'].drawingEnabled = true;
    expect((await renderAndTurn()).anchorings).toBeGreaterThan(0);
  });
});
