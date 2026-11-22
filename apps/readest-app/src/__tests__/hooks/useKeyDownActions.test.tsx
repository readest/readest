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

  // With focus in the book, Escape arrives as an `iframe-keydown` message: a
  // popup opened from the book (the instant dictionary) must still close.
  // Enter typed in the book must not confirm anything, such as an Alert.
  it('cancels on Escape typed in the book, and ignores Enter from it', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderHook(() => useKeyDownActions({ onCancel, onConfirm }));
    const fromBook = (key: string) =>
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'iframe-keydown', bookKey: 'b', key } }),
      );

    fromBook('Enter');
    fromBook('Escape');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
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

    it('lets dnd-kit handle activation and drag keys without dismissing the menu', () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();
      const DndHost = ({ dragging }: { dragging: boolean }) => {
        const ref = useRef<HTMLDivElement>(null);
        useKeyDownActions({ onCancel, onConfirm, elementRef: ref });
        return (
          <div ref={ref} role='dialog'>
            <div data-dnd-dragging={dragging ? 'true' : undefined}>
              <button type='button' data-dnd-sortable-handle='true'>
                Drag
              </button>
            </div>
          </div>
        );
      };

      const { rerender } = render(<DndHost dragging={false} />);
      const handle = screen.getByText('Drag');
      fireEvent.keyDown(handle, { key: ' ' });
      fireEvent.keyDown(handle, { key: 'Enter' });
      expect(onConfirm).not.toHaveBeenCalled();

      rerender(<DndHost dragging />);
      fireEvent.keyDown(handle, { key: 'ArrowDown' });
      fireEvent.keyDown(handle, { key: 'Escape' });
      expect(onCancel).not.toHaveBeenCalled();

      rerender(<DndHost dragging={false} />);
      fireEvent.keyDown(handle, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('keeps a single Escape from cancelling the menu even if dnd-kit clears dragging before window handles it', () => {
      const onCancel = vi.fn();
      const DndCancelHost = () => {
        const ref = useRef<HTMLDivElement>(null);
        useKeyDownActions({ onCancel, elementRef: ref });
        return (
          <div ref={ref} role='dialog'>
            <div id='dnd-list' data-dnd-dragging='true'>
              <button type='button' data-dnd-sortable-handle='true'>
                Drag
              </button>
            </div>
          </div>
        );
      };

      render(<DndCancelHost />);
      const list = document.getElementById('dnd-list')!;
      const clearDraggingOnDocument = () => list.removeAttribute('data-dnd-dragging');
      document.addEventListener('keydown', clearDraggingOnDocument, { once: true });

      const handle = screen.getByText('Drag');
      fireEvent.keyDown(handle, { key: 'Escape' });
      expect(onCancel).not.toHaveBeenCalled();

      fireEvent.keyDown(handle, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });
});
