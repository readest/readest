import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

// jsdom has no Touch/TouchEvent constructors; the hook only reads
// touches[0].clientX/clientY, so a plain Event with the fields grafted on is a
// faithful stand-in.
const touchEvent = (type: string, x: number, y: number): Event => {
  const e = new Event(type, { bubbles: true });
  const touch = { clientX: x, clientY: y };
  Object.assign(e, { touches: [touch], changedTouches: [touch] });
  return e;
};

// The library scroller holds the recently-read shelf (Virtuoso Header) and the
// book grid (Virtuoso List) as siblings, each tagged .transform-wrapper. The
// pull gesture must drag every wrapper, not just the first, or the shelf stays
// pinned while the grid slides down.
const Harness = ({ onRefresh }: { onRefresh: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  usePullToRefresh(ref, onRefresh);
  return (
    <div>
      <div data-testid='scroller' ref={ref}>
        <div data-testid='recent-shelf' className='transform-wrapper' />
        <div data-testid='book-grid' className='transform-wrapper' />
      </div>
    </div>
  );
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockPlatform = (userAgent: string) =>
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 16; 2211133C; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

// jsdom reports every scroll metric as 0; pin the ones the hook reads.
const mockScrollMetrics = (
  el: HTMLElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
) => {
  let scrollTop = metrics.scrollTop;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: metrics.clientHeight });
};

describe('usePullToRefresh', () => {
  it('drags every transform-wrapper in the scroller during the pull', () => {
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');

    scroller.dispatchEvent(touchEvent('touchstart', 0, 0));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 50));

    const shelfTransform = getByTestId('recent-shelf').style.transform;
    const gridTransform = getByTestId('book-grid').style.transform;
    expect(gridTransform).toMatch(/^translate3d\(0, .+px, 0\)$/);
    expect(shelfTransform).toBe(gridTransform);
  });

  // The library scroller is the only place native rubber-band is wanted
  // (#5148). The hook used to pin overscroll-behavior: none on it so the JS
  // pull resistance stayed visible, which also killed the bounce at the bottom
  // edge and on every platform; the scroller's overscroll must be left alone.
  it('does not suppress the native overscroll of the scroller', () => {
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);

    expect(getByTestId('scroller').style.overscrollBehavior).toBe('');
  });

  // iOS WKWebView bounces a nested scroller natively, so there the bounce moves
  // the content and the hook must not stack its own translate on top; it still
  // owns the spinner and the release trigger.
  it('on iOS leaves the content to the native bounce but keeps the spinner and trigger', () => {
    mockPlatform(IOS_UA);
    const onRefresh = vi.fn();
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const scroller = getByTestId('scroller');

    scroller.dispatchEvent(touchEvent('touchstart', 0, 0));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 50));

    expect(getByTestId('recent-shelf').style.transform).toBe('');
    expect(getByTestId('book-grid').style.transform).toBe('');
    expect(scroller.parentElement!.querySelector('.pull-refresh-loading')).not.toBeNull();

    scroller.dispatchEvent(touchEvent('touchmove', 0, 150));
    scroller.dispatchEvent(touchEvent('touchend', 0, 150));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getByTestId('book-grid').style.transform).toBe('');
  });

  // Chromium never draws an overscroll effect for a nested scroller (and the
  // Android WebView draws none for a document that does not scroll), so on
  // Android the bookshelf's bottom edge gets the same damped rubber-band the
  // top edge already has, springing back on release.
  it('rubber-bands the bottom edge on Android and springs back on release', () => {
    mockPlatform(ANDROID_UA);
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');
    mockScrollMetrics(scroller, { scrollTop: 1200, scrollHeight: 2000, clientHeight: 800 });

    scroller.dispatchEvent(touchEvent('touchstart', 0, 300));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 200));

    const pulled = getByTestId('book-grid').style.transform;
    expect(pulled).toMatch(/^translate3d\(0, -.+px, 0\)$/);
    expect(getByTestId('recent-shelf').style.transform).toBe(pulled);
    expect(scroller.parentElement!.querySelector('.pull-refresh-loading')).toBeNull();

    scroller.dispatchEvent(touchEvent('touchend', 0, 200));

    expect(getByTestId('book-grid').style.transform).toBe('translateY(0)');
  });

  it('does not rubber-band the bottom edge while the scroller can still scroll', () => {
    mockPlatform(ANDROID_UA);
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');
    mockScrollMetrics(scroller, { scrollTop: 600, scrollHeight: 2000, clientHeight: 800 });

    scroller.dispatchEvent(touchEvent('touchstart', 0, 300));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 200));

    expect(getByTestId('book-grid').style.transform).toBe('');
  });

  // Virtuoso can grow the scroller between touchstart and the first move (a
  // programmatic jump lands before the rows below are measured); once the
  // scroller can scroll again the drag must scroll it, not rubber-band it.
  it('stops rubber-banding when the scroller grows under the finger', () => {
    mockPlatform(ANDROID_UA);
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');
    mockScrollMetrics(scroller, { scrollTop: 1200, scrollHeight: 2000, clientHeight: 800 });

    scroller.dispatchEvent(touchEvent('touchstart', 0, 300));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 260));
    expect(getByTestId('book-grid').style.transform).toMatch(/^translate3d\(0, -.+px, 0\)$/);

    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 3000 });
    scroller.dispatchEvent(touchEvent('touchmove', 0, 200));

    expect(getByTestId('book-grid').style.transform).toBe('');
  });

  // A cancelled touch never reaches touchend, so the pull must snap back and
  // let go of its move/end listeners from touchcancel, without refreshing.
  it('snaps back and detaches when the browser cancels the touch', () => {
    mockPlatform(ANDROID_UA);
    const onRefresh = vi.fn();
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const scroller = getByTestId('scroller');
    mockScrollMetrics(scroller, { scrollTop: 1200, scrollHeight: 2000, clientHeight: 800 });

    scroller.dispatchEvent(touchEvent('touchstart', 0, 300));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 200));
    expect(getByTestId('book-grid').style.transform).toMatch(/^translate3d\(0, -.+px, 0\)$/);

    scroller.dispatchEvent(touchEvent('touchcancel', 0, 200));

    expect(getByTestId('book-grid').style.transform).toBe('translateY(0)');
    expect(onRefresh).not.toHaveBeenCalled();

    // The gesture is over: a stray move must not be handled any more.
    scroller.dispatchEvent(touchEvent('touchmove', 0, 100));
    expect(getByTestId('book-grid').style.transform).toBe('translateY(0)');
  });

  it('hides the spinner when a top pull is cancelled', () => {
    mockPlatform(ANDROID_UA);
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');

    scroller.dispatchEvent(touchEvent('touchstart', 0, 0));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 60));
    expect(scroller.parentElement!.querySelector('.pull-refresh-loading')).not.toBeNull();

    scroller.dispatchEvent(touchEvent('touchcancel', 0, 60));

    expect(scroller.parentElement!.querySelector('.pull-refresh-loading')).toBeNull();
    expect(getByTestId('book-grid').style.transform).toBe('translateY(0)');
  });

  it('on iOS leaves the bottom edge to the native bounce', () => {
    mockPlatform(IOS_UA);
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');
    mockScrollMetrics(scroller, { scrollTop: 1200, scrollHeight: 2000, clientHeight: 800 });

    scroller.dispatchEvent(touchEvent('touchstart', 0, 300));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 200));

    expect(getByTestId('book-grid').style.transform).toBe('');
  });

  it('resets every transform-wrapper when the pull is released early', () => {
    const { getByTestId } = render(<Harness onRefresh={() => {}} />);
    const scroller = getByTestId('scroller');

    scroller.dispatchEvent(touchEvent('touchstart', 0, 0));
    scroller.dispatchEvent(touchEvent('touchmove', 0, 50));
    scroller.dispatchEvent(touchEvent('touchend', 0, 50));

    expect(getByTestId('recent-shelf').style.transform).toBe('translateY(0)');
    expect(getByTestId('book-grid').style.transform).toBe('translateY(0)');
  });
});
