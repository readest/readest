import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHandwriting } from '@/app/reader/hooks/useHandwriting';

const h = vi.hoisted(() => {
  const readerState = {
    viewStates: { 'book-1': { drawingEnabled: true } },
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
  return { readerState, settingsState };
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
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: true }),
    getConfig: () => ({ booknotes: [] }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: 'page-2', section: { current: 1 } }),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);

const rect = (left: number) =>
  ({ left, top: 150, width: 412, height: 616, right: left + 412, bottom: 766 }) as DOMRect;

/** A fixed-layout view showing one page frame, as foliate-view lays it out. */
const mountView = () => {
  const view = document.createElement('foliate-view') as HTMLElement & {
    renderer: HTMLElement & { getContents: () => unknown[] };
  };
  const renderer = document.createElement('div') as unknown as typeof view.renderer;
  const root = renderer.attachShadow({ mode: 'open' });
  const page = document.createElement('div');
  const frame = document.createElement('iframe');
  page.appendChild(frame);
  root.appendChild(page);
  view.appendChild(renderer);
  view.renderer = renderer;
  document.body.appendChild(view);
  renderer.getContents = () => [{ doc: { defaultView: { frameElement: frame } }, index: 1 }];
  return { view, frame };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useHandwriting after a page turn', () => {
  it('re-measures the page once a push turn slides the view into place', async () => {
    const { view, frame } = mountView();
    h.readerState.getView = () => view;
    // Mid-turn: the push animation has the view one page width to the side.
    let frameLeft = 412;
    vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => rect(frameLeft));

    const { result } = renderHook(() => useHandwriting('book-1'));
    act(() => result.current.containerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.pageRect.left).toBe(412));
    // Let the measuring frames scheduled on mount run before the turn lands.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    // The turn settles: its last frame writes the resting transform on the view.
    frameLeft = 0;
    act(() => {
      view.style.transform = 'translate3d(0px, 0, 0)';
    });

    await waitFor(() => expect(result.current.pageRect.left).toBe(0));
  });
});
