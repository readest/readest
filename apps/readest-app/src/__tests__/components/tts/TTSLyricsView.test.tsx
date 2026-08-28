import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key) : key,
}));

const dispatchToast = vi.fn();
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (name: string, detail: unknown) => dispatchToast(name, detail),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import TTSLyricsView from '@/app/reader/components/tts/TTSLyricsView';

// jsdom has no layout engine: every offset is 0, so the geometry the view
// measures has to be supplied. Lines are 40px tall, stacked under the
// half-viewport top spacer, in a 200px-tall scroller.
const LINE_HEIGHT = 40;
const VIEWPORT = 200;
const SPACER = VIEWPORT / 2;

const lines = ['First sentence.', 'Second sentence.', 'Third sentence.', 'Fourth sentence.'];
// Centres the view should derive: 120, 160, 200, 240.
const centerOf = (index: number) => SPACER + index * lineHeight + lineHeight / 2;

let scrollTop = 0;
// Current wrapped height of a lyric line; a narrower sheet re-wraps them.
let lineHeight = LINE_HEIGHT;
let resizeCallbacks: (() => void)[] = [];

const installLayout = () => {
  scrollTop = 0;
  lineHeight = LINE_HEIGHT;
  resizeCallbacks = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(cb: () => void) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('no-scrollbar') ? VIEWPORT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-lyric-line') ? lineHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute('data-lyric-line')) return 0;
      const all = Array.from(document.querySelectorAll('[data-lyric-line]'));
      return SPACER + all.indexOf(this) * lineHeight;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  // jsdom does not implement scrollTo; the view calls it optionally.
  HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions) {
    if (typeof options?.top === 'number') scrollTop = options.top;
  }) as unknown as typeof HTMLElement.prototype.scrollTo;
};

const scroller = () => document.querySelector('.no-scrollbar') as HTMLElement;

// Park the sheet on `index`: a real gesture, then the scroll it produces.
const dragTo = (index: number) => {
  const el = scroller();
  fireEvent.touchMove(el);
  scrollTop = centerOf(index) - VIEWPORT / 2;
  fireEvent.scroll(el);
};

const defaults = {
  lines,
  activeIndex: 0,
  buffering: false,
  isEink: false,
  onGetLyricPage: vi.fn().mockResolvedValue({ current: 6, next: 7, total: 30 }),
  onPlayFrom: vi.fn().mockResolvedValue(undefined),
};

const renderView = (overrides: Partial<React.ComponentProps<typeof TTSLyricsView>> = {}) =>
  render(<TTSLyricsView {...defaults} {...overrides} />);

beforeEach(() => {
  vi.clearAllMocks();
  installLayout();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TTSLyricsView', () => {
  test('renders every sentence and marks the spoken one', () => {
    renderView({ activeIndex: 2 });
    for (const line of lines) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText('Third sentence.').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('First sentence.').getAttribute('aria-current')).toBeNull();
  });

  test('follows the voice by centring the spoken line', () => {
    const { rerender } = renderView({ activeIndex: 0 });
    rerender(<TTSLyricsView {...defaults} activeIndex={2} />);
    // Line 2's centre is 200; a 200px viewport parks it at scrollTop 100.
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 100, behavior: 'smooth' }),
    );
  });

  test('lands a long move outright and glides a short one', () => {
    // Opening onto the middle of a chapter is a jump of thousands of pixels;
    // animating that is a blur past text nobody is reading.
    const many = Array.from({ length: 40 }, (_, i) => `Sentence ${i}.`);
    const props = { ...defaults, lines: many };
    const { rerender } = render(<TTSLyricsView {...props} activeIndex={30} />);
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 1220, behavior: 'auto' }),
    );
    // The next sentence is one line away.
    rerender(<TTSLyricsView {...props} activeIndex={31} />);
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 1260, behavior: 'smooth' }),
    );
  });

  test('does not animate the follow scroll on e-ink', () => {
    const { rerender } = renderView({ activeIndex: 0, isEink: true });
    // Past the initial snap: every later move stays instant too.
    rerender(<TTSLyricsView {...defaults} isEink activeIndex={1} />);
    rerender(<TTSLyricsView {...defaults} isEink activeIndex={2} />);
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });

  test('parks a sentence taller than the window at its opening words', () => {
    // Line 2 wraps to 300px in a 200px window — centring it would scroll past
    // the words the voice is about to say.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.hasAttribute('data-lyric-line')) return 0;
        const all = Array.from(document.querySelectorAll('[data-lyric-line]'));
        return all.indexOf(this) === 2 ? 300 : LINE_HEIGHT;
      },
    });
    const { rerender } = renderView({ activeIndex: 0 });
    rerender(<TTSLyricsView {...defaults} activeIndex={2} />);
    // Line 2 starts at SPACER + 2 * LINE_HEIGHT = 180.
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 180 }));
  });

  test('re-parks the spoken line when a resize re-wraps the sentences', () => {
    const { rerender } = renderView({ activeIndex: 0 });
    rerender(<TTSLyricsView {...defaults} activeIndex={3} />);
    // Original geometry: line 3's centre is 240, so scrollTop 140.
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 140 }));

    // A narrower sheet wraps every sentence onto two rows. The scroller's own
    // height never changes, so only watching it would leave this stale.
    lineHeight = 80;
    act(() => {
      resizeCallbacks.forEach((cb) => cb());
    });
    // New geometry: line 3's centre is 380, so scrollTop 280.
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 280 }));
  });

  test('shows no seek row until the reader actually drags', () => {
    renderView();
    expect(screen.queryByLabelText('Play')).toBeNull();
    // A programmatic follow scroll must never be mistaken for a gesture.
    fireEvent.scroll(scroller());
    expect(screen.queryByLabelText('Play')).toBeNull();
  });

  test('a tap does not arm seeking, so the next follow scroll stays silent', () => {
    renderView({ activeIndex: 0 });
    const el = scroller();
    fireEvent.pointerDown(el);
    fireEvent.pointerUp(el);
    // The voice moves on and the view scrolls itself: still not a drag.
    scrollTop = centerOf(1) - VIEWPORT / 2;
    fireEvent.scroll(el);
    expect(screen.queryByLabelText('Play')).toBeNull();
  });

  test('a drag raises the seek row with the dragged line page number', async () => {
    renderView();
    dragTo(3);
    expect(screen.getByLabelText('Play')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Page 7')).toBeTruthy());
    expect(defaults.onGetLyricPage).toHaveBeenCalledWith(3);
  });

  test('drops a carried-over pick when playback crosses into a new chapter', () => {
    const { rerender } = renderView({ activeIndex: 0 });
    dragTo(3);
    expect(screen.getByLabelText('Play')).toBeTruthy();

    // New chapter, new ordinals: pressing play on index 3 of the old sheet
    // would seek to whatever sentence sits there now.
    rerender(
      <TTSLyricsView {...defaults} lines={['Fresh chapter.', 'Second line.']} activeIndex={0} />,
    );
    expect(screen.queryByLabelText('Play')).toBeNull();
  });

  test('drops a committed line when the chapter changes before its audio lands', async () => {
    const { rerender } = renderView({ activeIndex: 0 });
    dragTo(2);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(document.querySelector('.loading-spinner')).toBeTruthy();

    rerender(<TTSLyricsView {...defaults} lines={['Fresh chapter.']} activeIndex={0} buffering />);
    // Otherwise it spins against an ordinal the new chapter will never report.
    await waitFor(() => expect(document.querySelector('.loading-spinner')).toBeNull());
  });

  test('the play button reads from the dragged line, not the spoken one', () => {
    renderView({ activeIndex: 0 });
    dragTo(2);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(defaults.onPlayFrom).toHaveBeenCalledWith(2);
  });

  test('the button spins while the committed line waits for audio', async () => {
    const { rerender } = renderView({ activeIndex: 0 });
    dragTo(2);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(document.querySelector('.loading-spinner')).toBeTruthy();

    // The commit resolves only when that line is both current AND audible.
    rerender(<TTSLyricsView {...defaults} activeIndex={2} buffering />);
    expect(document.querySelector('.loading-spinner')).toBeTruthy();

    rerender(<TTSLyricsView {...defaults} activeIndex={2} buffering={false} />);
    await waitFor(() => expect(screen.queryByLabelText('Play')).toBeNull());
  });

  test('a failed seek drops the spinner and says why', async () => {
    const onPlayFrom = vi.fn().mockRejectedValue(new Error('offline'));
    renderView({ onPlayFrom });
    dragTo(1);
    fireEvent.click(screen.getByLabelText('Play'));
    await waitFor(() => expect(screen.queryByLabelText('Play')).toBeNull());
    expect(dispatchToast).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ message: 'Failed to seek', type: 'error' }),
    );
  });

  test('an abandoned drag slides back to the spoken line', () => {
    vi.useFakeTimers();
    renderView({ activeIndex: 0 });
    dragTo(3);
    expect(screen.getByLabelText('Play')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByLabelText('Play')).toBeNull();
    expect(scroller().scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 20 }));
  });
});
