import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type Progress = { location: string } | null;

const h = vi.hoisted(() => {
  // Zustand-like store mock. Supports both destructure form `store()`
  // and selector form `store((s) => s.method)`.
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as {
      (): T;
      <R>(selector: (s: T) => R): R;
      getState: () => T;
    };
  };

  const state = {
    config: { location: 'cfi-loc', updatedAt: 1000 } as { location: string; updatedAt: number },
    progress: { location: 'cfi-loc' } as Progress,
    previewMode: false,
  };

  return {
    makeStore,
    state,
    saveConfigMock: vi.fn(async () => {}),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { name: 'env' } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    saveConfig: h.saveConfigMock,
  }),
  // Named export consumed by the hook for unmount-time best-effort flush.
  flushPendingLibrarySave: vi.fn(async () => {}),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getProgress: () => h.state.progress,
    getViewState: () => ({ previewMode: h.state.previewMode }),
  }),
}));

// Progress moved to its own store to keep high-frequency setProgress
// writes from re-rendering the whole reader tree. The hook now reads via
// useBookProgress, so the test's mock state needs to flow through here.
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => h.state.progress,
  getBookProgress: () => h.state.progress,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({ settings: { version: 1 } }),
}));

import { useProgressAutoSave } from '@/app/reader/hooks/useProgressAutoSave';

const flushDebouncedSave = async () => {
  await act(async () => {
    // debounce 1000ms + inner setTimeout 500ms + slack
    vi.advanceTimersByTime(2000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.saveConfigMock.mockClear();
  h.state.config = { location: 'cfi-loc', updatedAt: 1000 };
  h.state.progress = { location: 'cfi-loc' };
  h.state.previewMode = false;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useProgressAutoSave', () => {
  test('skips save on book open when location matches the loaded config', async () => {
    // Bug from issue #4222: opening a book where the in-memory location still
    // matches what was loaded from disk should not call saveConfig — doing so
    // would artificially bump config.updatedAt and let a stale local push
    // overwrite a newer server-side config (the progress someone else just
    // read on another device).
    renderHook(() => useProgressAutoSave('h1-view1'));
    await flushDebouncedSave();

    expect(h.saveConfigMock).not.toHaveBeenCalled();
  });

  test('saves once the location advances past the loaded position', async () => {
    const { rerender } = renderHook(() => useProgressAutoSave('h1-view1'));
    await flushDebouncedSave();
    expect(h.saveConfigMock).not.toHaveBeenCalled();

    // Simulate the reader advancing to a new location (either user pagination
    // or applyRemoteProgress.view.goTo). The config's location is what
    // setProgress would have updated, and progress reference changes too.
    h.state.config = { location: 'cfi-loc-next', updatedAt: 1000 };
    h.state.progress = { location: 'cfi-loc-next' };
    rerender();
    await flushDebouncedSave();

    expect(h.saveConfigMock).toHaveBeenCalledTimes(1);
  });

  test('saves when applyRemoteProgress moves the view to a newer remote location', async () => {
    // Mirrors the cross-device sync case: device opens at the local position
    // (loaded from disk), then the pull lands a newer remote position and
    // view.goTo(remote) fires. Auto-save must persist the new location so the
    // outgoing push carries the remote-applied progress, not the stale local.
    const { rerender } = renderHook(() => useProgressAutoSave('h1-view1'));
    await flushDebouncedSave();
    expect(h.saveConfigMock).not.toHaveBeenCalled();

    h.state.config = { location: 'cfi-remote', updatedAt: 1000 };
    h.state.progress = { location: 'cfi-remote' };
    rerender();
    await flushDebouncedSave();

    expect(h.saveConfigMock).toHaveBeenCalledTimes(1);
  });

  test('skips save while in preview mode', async () => {
    h.state.previewMode = true;
    h.state.config = { location: 'cfi-different', updatedAt: 1000 };
    h.state.progress = { location: 'cfi-different' };
    renderHook(() => useProgressAutoSave('h1-view1'));
    await flushDebouncedSave();

    expect(h.saveConfigMock).not.toHaveBeenCalled();
  });
});
