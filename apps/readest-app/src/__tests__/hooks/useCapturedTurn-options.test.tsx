import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FoliateView } from '@/types/view';

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
  getInitializedAppService: () => null,
}));

import { useCapturedTurn } from '@/app/reader/hooks/useCapturedTurn';

// On Tauri the hook wraps view.next/prev to run captured page-turn effects.
// A turn it leaves to the paginator must keep the caller's options: a tap's
// `discrete` lets it turn again once the last turned page is on screen.
describe('useCapturedTurn view.next/prev wrappers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes the options of a turn it leaves to the paginator', async () => {
    const renderer = Object.assign(document.createElement('div'), {
      atStart: false,
      atEnd: false,
      columnCount: 1,
      getContents: () => [],
    });
    const next = vi.fn(async () => {});
    const prev = vi.fn(async () => {});
    const view = Object.assign(document.createElement('div'), {
      renderer,
      next,
      prev,
    }) as unknown as FoliateView;

    const { unmount } = renderHook(() => useCapturedTurn('book-1', { current: view }));
    expect(view.next).not.toBe(next);

    await view.next(undefined, { discrete: true });
    await view.prev(undefined, { discrete: true });
    expect(next).toHaveBeenCalledWith(undefined, { discrete: true });
    expect(prev).toHaveBeenCalledWith(undefined, { discrete: true });
    unmount();
  });
});
