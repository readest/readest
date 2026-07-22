import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '@/components/Overlay';

describe('Overlay capture state', () => {
  afterEach(cleanup);

  it('blocks capture by default and supports a closed-parent opt-out', () => {
    const { container, rerender } = render(<Overlay onDismiss={vi.fn()} />);
    const overlay = container.firstElementChild!;

    expect(overlay.getAttribute('data-capture-blocking-overlay')).toBe('true');

    rerender(<Overlay onDismiss={vi.fn()} captureBlocking={false} />);
    expect(overlay.hasAttribute('data-capture-blocking-overlay')).toBe(false);
  });
});
