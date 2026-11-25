import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

/**
 * The drag handles Readest draws for a selection once a lookup popup has shed
 * the platform's own (#7897). The text can move under a live selection while
 * the selection itself stays the same object: the reader scrolls, or Pin to
 * Notebook narrows the book cell and the page reflows. The handles have to
 * follow the text, not stay at the old window coordinates over the Notebook.
 */

const h = vi.hoisted(() => ({
  renderer: new EventTarget(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: true } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: { isEink: false }, globalReadSettings: {} },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ renderer: h.renderer }),
    getViewSettings: () => ({ scrolled: true, isEink: false, vertical: false }),
  }),
}));

import SelectionRangeEditor from '@/app/reader/components/annotator/SelectionRangeEditor';
import { TextSelection } from '@/utils/sel';

const BOOK_KEY = 'book-1';

let resizeCallbacks: (() => void)[] = [];
class FakeResizeObserver {
  constructor(callback: () => void) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  disconnect() {}
}

// A word in the host document, so its client rects are window coordinates.
let wordRect = new DOMRect(660, 200, 40, 20);
const makeSelection = (): TextSelection => {
  const node = document.createTextNode('finger');
  document.body.appendChild(node);
  const range = document.createRange();
  range.selectNodeContents(node);
  range.getClientRects = () => [wordRect] as unknown as DOMRectList;
  return { key: BOOK_KEY, text: 'finger', range, index: 3, page: 8, handlesSuppressed: true };
};

const renderEditor = () =>
  render(
    <SelectionRangeEditor
      bookKey={BOOK_KEY}
      isVertical={false}
      selection={makeSelection()}
      handleColor={'#ffcc00'}
      onDragTo={vi.fn(async () => null)}
      onStartDrag={vi.fn()}
      noteAutoTurnPoint={vi.fn()}
      cancelAutoTurn={vi.fn()}
      onAutoTurn={vi.fn(() => () => {})}
    />,
  );

const handleLefts = () =>
  screen.getAllByTestId('selection-handle').map((el) => parseFloat(el.style.left));

const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe('SelectionRangeEditor after the text moves', () => {
  beforeEach(() => {
    wordRect = new DOMRect(660, 200, 40, 20);
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const cell = document.createElement('div');
    cell.id = `gridcell-${BOOK_KEY}`;
    document.body.appendChild(cell);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('moves the handles onto the word when the book cell narrows', async () => {
    renderEditor();
    const [startBefore, endBefore] = handleLefts();

    // Pin to Notebook: the cell narrows and the word reflows to the left.
    wordRect = new DOMRect(257, 344, 40, 20);
    act(() => resizeCallbacks.forEach((callback) => callback()));
    await nextFrame();

    const [start, end] = handleLefts();
    expect(start).toBe(startBefore! - (660 - 257));
    expect(end).toBe(endBefore! - (660 - 257));
  });

  it('moves the handles with the word when the reader scrolls', async () => {
    renderEditor();
    const [startBefore] = handleLefts();
    const topBefore = parseFloat(screen.getAllByTestId('selection-handle')[0]!.style.top);

    wordRect = new DOMRect(660, 80, 40, 20);
    act(() => {
      h.renderer.dispatchEvent(new Event('scroll'));
    });
    await nextFrame();

    expect(handleLefts()[0]).toBe(startBefore);
    expect(parseFloat(screen.getAllByTestId('selection-handle')[0]!.style.top)).toBe(
      topBefore - 120,
    );
  });
});
