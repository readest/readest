import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => true };
});

// Only the window the OS launched the app into reads a cold-start link, so only
// it may hold the Library blank while it checks; a spawned window's Library
// would otherwise never get released.
describe('libraryStore — launch link gate', () => {
  afterEach(() => vi.doUnmock('@/utils/window'));

  it.each([
    ['the launch window', true, true],
    ['a spawned window', false, false],
  ])('starts %s as %s', async (_name, isMain, expected) => {
    vi.resetModules();
    vi.doMock('@/utils/window', () => ({ isMainAppWindow: () => isMain }));
    const { useLibraryStore } = await import('@/store/libraryStore');
    expect(useLibraryStore.getState().checkPendingLaunchLink).toBe(expected);
  });
});
