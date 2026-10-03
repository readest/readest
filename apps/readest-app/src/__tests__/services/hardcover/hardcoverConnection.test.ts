import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvConfigType } from '@/services/environment';

const h = vi.hoisted(() => ({
  state: { settings: {} as object, setSettings: vi.fn(), saveSettings: vi.fn() },
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => h.state } }));

import {
  isHardcoverConnected,
  saveHardcoverTokens,
} from '@/services/hardcover/hardcoverConnection';

const tokens = { accessToken: 'new', refreshToken: 'rt', expiresAt: 1 };

describe('saveHardcoverTokens', () => {
  const old = { ...tokens, accessToken: 'old' };
  const save = (previous = old) => saveHardcoverTokens({} as EnvConfigType, tokens, previous);

  beforeEach(() => vi.clearAllMocks());

  it('saves only into the session the refresh started from', async () => {
    h.state.settings = { hardcover: { enabled: true, oauth: old } };
    await save();
    expect(h.state.saveSettings).toHaveBeenCalledTimes(1);

    // Disconnected, or disconnected and reconnected with a newer session: keep hands off.
    h.state.settings = { hardcover: { enabled: false, accessToken: '', lastSyncedAt: 0 } };
    await save();
    h.state.settings = {
      hardcover: { enabled: true, oauth: { ...old, accessToken: 'newer', refreshToken: 'rt2' } },
    };
    await save();
    expect(h.state.saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe('isHardcoverConnected', () => {
  const base = { enabled: true, lastSyncedAt: 0 };

  it.each([
    [{ ...base, accessToken: 'pat' }, true],
    [{ ...base, accessToken: '', oauth: tokens }, true],
    [{ ...base, accessToken: '', oauth: { ...tokens, refreshToken: undefined } }, true],
    [{ ...base, accessToken: '', oauth: { ...tokens, accessToken: '' } }, false],
    [{ ...base, accessToken: '' }, false],
    [undefined, false],
  ])('%j -> %s', (settings, expected) => {
    expect(isHardcoverConnected(settings)).toBe(expected);
  });
});
