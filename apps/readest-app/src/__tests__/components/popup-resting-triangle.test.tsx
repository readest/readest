import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// Key handling is irrelevant to the resting triangle DOM.
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

import Popup from '@/components/Popup';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// WebKitGTK present-path regression (#5609 and the sidebar-close variant on
// #5618): FootnotePopup keeps a closed <Popup> mounted in every book cell, so
// the pointer-triangle divs sit at the cell origin with no position at all.
// Since #5351 the outer triangle carries a `drop-shadow` filter; an
// always-mounted filtered element at the window origin makes WebKitGTK stop
// presenting an ~80x124 device-px rect there (stale/black square on Linux,
// bisected to #5351 and verified fixed by removing the filter). The popup must
// not render the triangles at all while it has no triangle position.
describe('Popup resting state (no position)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('renders no triangle elements without a trianglePosition', () => {
    const { container } = render(
      <Popup width={200} height={44}>
        <div />
      </Popup>,
    );
    expect(container.querySelector('.popup-triangle-outer')).toBeNull();
    expect(container.querySelector('.popup-triangle-inner')).toBeNull();
    cleanup();
  });

  test('drops the drop-shadow filter while the triangle is hidden', () => {
    // Triangle point inside the popup rect -> triangleHidden. The invisible
    // element must not keep the filter: visibility hides the pixels but the
    // filter still creates the pathological compositor state.
    const { container } = render(
      <Popup
        width={200}
        height={44}
        position={{ point: { x: 100, y: 400 }, dir: 'down' }}
        trianglePosition={{ point: { x: 150, y: 420 }, dir: 'down' }}
      >
        <div />
      </Popup>,
    );
    const outer = container.querySelector('.popup-triangle-outer');
    expect(outer).not.toBeNull();
    expect(outer!.classList.contains('invisible')).toBe(true);
    expect(outer!.className).not.toContain('drop-shadow');
    cleanup();
  });
});
