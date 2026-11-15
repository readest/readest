import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingRuler from '@/app/reader/components/ReadingRuler';
import { clearBookProgress, getBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookFormat, BookProgress, ViewSettings } from '@/types/book';

vi.mock('@/context/EnvContext', () => {
  const env = { envConfig: {} };
  return { useEnv: () => env };
});
vi.mock('@/store/readerStore', () => {
  const getProgress = (key: string) => getBookProgress(key);
  const getView = () => ({ renderer: { columnCount: 1, getContents: () => [] } });
  const store = { getProgress, getView };
  return { useReaderStore: () => store };
});
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
};

const turnTo = (location: string) =>
  act(() => {
    setBookProgress('book-1', {
      range: null,
      location,
      fraction: 0.1,
      pageinfo: { current: 4 },
    } as unknown as BookProgress);
  });

beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 1000,
        width: 800,
        height: 1000,
      }) as DOMRect,
  );
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  });
});
afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
});

// The cell no longer re-renders the ruler on a page turn: it follows the
// reading position from the progress it subscribes to.
describe('ReadingRuler on a page turn', () => {
  it('resets to the top of the new page with no re-render from its parent', async () => {
    turnTo('epubcfi(/6/2!/4/2)');
    const { container } = render(
      <ReadingRuler
        bookKey='book-1'
        isVertical={false}
        rtl={false}
        lines={2}
        position={96.9}
        opacity={0.5}
        color='transparent'
        bookFormat={'EPUB' as BookFormat}
        viewSettings={{ defaultFontSize: 16, lineHeight: 1.5 } as ViewSettings}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );
    const rulerTop = () =>
      parseFloat((container.querySelector('.ruler') as HTMLDivElement).style.top);
    expect(rulerTop()).toBeCloseTo(96.9, 5);
    // Let the mount's own follow-up renders finish, so nothing but the turn
    // can re-render the ruler.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));

    turnTo('epubcfi(/6/2!/4/18)');

    await waitFor(() => expect(rulerTop()).toBeLessThan(20));
  });
});
