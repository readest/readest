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
});
