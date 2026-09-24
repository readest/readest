import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HardwarePageTurnerSettings } from '@/types/settings';
import { eventDispatcher } from '@/utils/event';
import { useLibraryPagination } from '@/app/library/hooks/useLibraryPagination';

const h = vi.hoisted(() => ({
  hardware: undefined as HardwarePageTurnerSettings | undefined,
  acquire: vi.fn(),
  release: vi.fn(),
  forward: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobileApp: true } }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: { settings: { hardwarePageTurner?: HardwarePageTurnerSettings } }) => unknown,
  ) => selector({ settings: { hardwarePageTurner: h.hardware } }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: {
    getState: () => ({
      acquirePageTurnerKeyInterception: h.acquire,
      releasePageTurnerKeyInterception: h.release,
      ensureKeyForwarding: h.forward,
    }),
  },
}));
let scroller: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  h.hardware = {
    enabled: true,
    bindings: {
      pageNext: { source: 'dom', id: 'ArrowRight', label: 'Ctrl + Right', ctrlKey: true },
      pagePrev: { source: 'native', id: 'MediaPrevious', label: 'Media Previous' },
      sectionNext: null,
      sectionPrev: null,
      refresh: null,
    },
  };
  scroller = document.createElement('div');
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  scroller.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('library page-turn bindings', () => {
  it('respects modifiers, claims repeats without turning again, and leaves inputs alone', () => {
    renderHook(() => useLibraryPagination(scroller, true));
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'instant' });
    const repeat = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      repeat: true,
      cancelable: true,
    });
    window.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'PageDown', code: 'PageDown' });
    input.remove();
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
  });
  it('handles native page keys and releases interception on unmount', async () => {
    scroller.scrollTop = 500;
    const { unmount } = renderHook(() => useLibraryPagination(scroller, true));
    expect(h.acquire).toHaveBeenCalledOnce();
    expect(h.forward).toHaveBeenCalledOnce();
    await act(() => eventDispatcher.dispatch('native-key-down', { keyName: 'MediaPrevious' }));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    unmount();
    expect(h.release).toHaveBeenCalledOnce();
    vi.mocked(scroller.scrollTo).mockClear();
    await eventDispatcher.dispatch('native-key-down', { keyName: 'MediaPrevious' });
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
  it('does not register navigation when disabled or intercept media keys for Pencil bindings', () => {
    const { rerender } = renderHook(({ enabled }) => useLibraryPagination(scroller, enabled), {
      initialProps: { enabled: false },
    });
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' });
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(h.acquire).not.toHaveBeenCalled();
    h.hardware!.bindings.pagePrev = { source: 'native', id: 'PencilDoubleTap', label: 'Pencil' };
    rerender({ enabled: true });
    expect(h.forward).toHaveBeenCalledOnce();
    expect(h.acquire).not.toHaveBeenCalled();
  });
});
