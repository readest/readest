import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// Key handling is irrelevant to triangle layering and drags in EnvContext.
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

import Popup from '@/components/Popup';

// E-ink popup pointer triangle regression: the popup is outlined by stacking a
// white inner triangle over a black outer one. Popup positions itself above a
// selection (dir 'up') using its ResizeObserver-measured height, and demotes
// the inner triangle behind the outer whenever the triangle point falls inside
// the popup rect. In e-ink mode the container gains a 1px border, so a
// content-box measurement under-reports the rendered height by 2px, the popup
// lands 2px too low, the point registers as "inside", and the inner white
// triangle hides behind the black outer -> a solid black triangle. The
// measurement must use the border box.

let roCallback: ResizeObserverCallback | undefined;

class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    roCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// A browser-faithful entry for a 44px-tall border-box container with 1px
// e-ink borders: contentRect reports the 42px content box.
const einkEntry = (target: Element) =>
  [
    {
      target,
      contentRect: { height: 42 },
      borderBoxSize: [{ blockSize: 44, inlineSize: 200 }],
    } as unknown as ResizeObserverEntry,
  ] as ResizeObserverEntry[];

describe('Popup e-ink triangle (popup above selection)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    roCallback = undefined;
  });

  test('keeps the inner triangle on top when the popup sits above the selection', () => {
    const { container } = render(
      <Popup
        width={200}
        height={44}
        position={{ point: { x: 100, y: 400 }, dir: 'up' }}
        trianglePosition={{ point: { x: 150, y: 560 }, dir: 'up' }}
      >
        <div />
      </Popup>,
    );

    const popup = container.querySelector('#popup-container')!;
    act(() => {
      roCallback!(einkEntry(popup), new MockResizeObserver(() => {}) as unknown as ResizeObserver);
    });

    // The popup bottom must land exactly on the triangle attachment point
    // (560 = point.y), not 2px past it.
    const popupEl = popup as HTMLElement;
    expect(popupEl.style.top).toBe('516px');

    // The white inner triangle must stay above the black outer one, or e-ink
    // renders a solid black triangle. `triangleHidden` now hides both triangles
    // outright instead of demoting the inner one, so assert on visibility too --
    // a z-index-only check passes vacuously once the demotion is gone.
    const inner = container.querySelector('.popup-triangle-inner')!;
    expect(inner.className).toContain('z-50');
    expect(inner.className).not.toContain('z-10');
    expect(inner.className).not.toContain('invisible');
    expect(container.querySelector('.popup-triangle-outer')!.className).not.toContain('invisible');
  });
});
