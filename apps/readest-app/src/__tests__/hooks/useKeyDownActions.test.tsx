// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useRef } from 'react';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));

import { useKeyDownActions } from '@/hooks/useKeyDownActions';

afterEach(cleanup);

describe('useKeyDownActions', () => {
  // A dialog whose confirm handler closes over state (e.g. "has changes") must
  // get the handler from its latest render, not the one from its first.
  it('calls the latest callbacks after a rerender', () => {
    const first = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const latest = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = renderHook((props) => useKeyDownActions(props), { initialProps: first });
    rerender(latest);

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(latest.onConfirm).toHaveBeenCalledTimes(1);
    expect(latest.onCancel).toHaveBeenCalledTimes(1);
    expect(first.onConfirm).not.toHaveBeenCalled();
    expect(first.onCancel).not.toHaveBeenCalled();
  });

  // Popup and Menu pass their container as elementRef. Each time the effect
  // runs (StrictMode in dev, or `enabled` turning off and on), the container
  // must end with one listener, and none while disabled.
  describe('with an element ref', () => {
    const Host = ({ onCancel, enabled }: { onCancel: () => void; enabled: boolean }) => {
      const ref = useRef<HTMLDivElement>(null);
      useKeyDownActions({ onCancel, enabled, elementRef: ref });
      return <div ref={ref} role='dialog' />;
    };

    it('cancels once on Escape under StrictMode', () => {
      const onCancel = vi.fn();
      render(
        <StrictMode>
          <Host onCancel={onCancel} enabled />
        </StrictMode>,
      );

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('cancels once after being disabled and enabled again', () => {
      const onCancel = vi.fn();
      const { rerender } = render(<Host onCancel={onCancel} enabled />);
      rerender(<Host onCancel={onCancel} enabled={false} />);

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onCancel).not.toHaveBeenCalled();

      rerender(<Host onCancel={onCancel} enabled />);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });
});
