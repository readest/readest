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
