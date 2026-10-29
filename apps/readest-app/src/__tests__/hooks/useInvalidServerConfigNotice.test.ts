import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { eventDispatcher } from '@/utils/event';
import { SERVER_CONFIG_STORAGE_KEY } from '@/services/serverConfig';

const fakeI18n = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  return {
    isInitialized: true,
    t: vi.fn((key: string) => `translated:${key}`),
    on: vi.fn((event: string, cb: () => void) => listeners.set(event, cb)),
    off: vi.fn((event: string) => listeners.delete(event)),
    emit: (event: string) => listeners.get(event)?.(),
  };
});
vi.mock('@/i18n/i18n', () => ({ default: fakeI18n }));

// The hook runs in Providers, which renders before i18next has registered with
// react-i18next. react-i18next's useTranslation calls no hooks until then and
// several once it has, so using it there changes the hook count between
// renders (React error #311). The hook must not use it.
vi.mock('react-i18next', () => ({
  useTranslation: () => {
    throw new Error('useInvalidServerConfigNotice must not use react-i18next hooks');
  },
}));

import { useInvalidServerConfigNotice } from '@/hooks/useInvalidServerConfigNotice';

const MESSAGE = 'Saved server settings were invalid and have been reset';

describe('useInvalidServerConfigNotice', () => {
  const dispatch = vi.spyOn(eventDispatcher, 'dispatch');

  beforeEach(() => {
    dispatch.mockClear();
    fakeI18n.t.mockClear();
    fakeI18n.isInitialized = true;
    localStorage.clear();
  });

  afterEach(() => {
    delete window.__READEST_SERVER_CONFIG_INVALID;
  });

  it('clears the invalid entry and tells the user once', () => {
    localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, '{oops');
    window.__READEST_SERVER_CONFIG_INVALID = true;

    const { rerender } = renderHook(() => useInvalidServerConfigNotice());
    rerender();

    expect(localStorage.getItem(SERVER_CONFIG_STORAGE_KEY)).toBeNull();
    expect(window.__READEST_SERVER_CONFIG_INVALID).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('toast', {
      type: 'warning',
      message: `translated:${MESSAGE}`,
    });
  });

  it('waits for i18next to initialize before translating the notice', () => {
    fakeI18n.isInitialized = false;
    window.__READEST_SERVER_CONFIG_INVALID = true;

    renderHook(() => useInvalidServerConfigNotice());
    expect(dispatch).not.toHaveBeenCalled();

    fakeI18n.emit('initialized');
    expect(dispatch).toHaveBeenCalledWith('toast', {
      type: 'warning',
      message: `translated:${MESSAGE}`,
    });
  });

  it('does nothing when the stored entry was valid or absent', () => {
    renderHook(() => useInvalidServerConfigNotice());
    expect(dispatch).not.toHaveBeenCalled();
  });
});
