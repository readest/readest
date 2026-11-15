// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (value: number) => value,
}));
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: vi.fn(),
}));

import Popup from '@/components/Popup';

describe('Popup capture state', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());

  it('marks only an open popup as capture-blocking', () => {
    const { container, rerender } = render(
      <Popup isOpen={false} width={240}>
        Footnote
      </Popup>,
    );
    const popup = container.querySelector<HTMLElement>('.popup-container')!;

    expect(popup.getAttribute('aria-hidden')).toBe('true');
    expect(popup.hasAttribute('data-capture-blocking-overlay')).toBe(false);

    rerender(
      <Popup isOpen width={240}>
        Footnote
      </Popup>,
    );

    expect(popup.getAttribute('aria-hidden')).toBe('false');
    expect(popup.getAttribute('data-capture-blocking-overlay')).toBe('true');
  });

  it('clamps upward popups above safeAreaInsets.top (#7389)', () => {
    const props = {
      isOpen: true,
      width: 240,
      position: { point: { x: 20, y: 120 }, dir: 'up' as const },
      trianglePosition: { point: { x: 140, y: 40 }, dir: 'up' as const },
    };
    const { container, rerender } = render(<Popup {...props}>Footnote</Popup>);
    const popup = container.querySelector<HTMLElement>('.popup-container')!;
    expect(popup.style.top).toBe('40px');

    rerender(
      <Popup {...props} safeAreaInsets={{ top: 59, right: 0, bottom: 34, left: 0 }}>
        Footnote
      </Popup>,
    );
    expect(popup.style.top).toBe('69px');
  });
});
