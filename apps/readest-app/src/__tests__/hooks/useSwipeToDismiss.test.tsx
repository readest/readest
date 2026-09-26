import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasHaptics: true } }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

function Panel({ onDismiss }: { onDismiss: () => void }) {
  const { panelRef, overlayRef, handleVerticalDragStart } = useSwipeToDismiss(onDismiss);
  return (
    <>
      <div ref={overlayRef} />
      <div ref={panelRef}>
        <button onTouchStart={handleVerticalDragStart}>Drag</button>
      </div>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSwipeToDismiss feedback', () => {
  it.each([
    'dismiss',
    'restore',
    'cancel',
  ])('only gives light feedback for dismissal: %s', (action) => {
    const onDismiss = vi.fn();
    const { getByText } = render(<Panel onDismiss={onDismiss} />);
    fireEvent.touchStart(getByText('Drag'), { touches: [{ clientX: 0, clientY: 100 }] });
    act(() => vi.advanceTimersByTime(1000));
    const end = { changedTouches: [{ clientX: 0, clientY: action === 'restore' ? 50 : 900 }] };
    if (action === 'cancel') fireEvent.touchCancel(window, end);
    else fireEvent.touchEnd(window, end);
    act(() => vi.advanceTimersByTime(300));
    if (action === 'dismiss') {
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('light');
    } else {
      expect(onDismiss).not.toHaveBeenCalled();
      expect(impactFeedback).not.toHaveBeenCalled();
    }
    expect(document.querySelector('.drag-shield')).toBeNull();
  });
});
