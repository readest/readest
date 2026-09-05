import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

/**
 * Foreground recovery for Nearby BookDrop.
 *
 * iOS reclaims a suspended app's listening socket but never wakes the accept
 * loop, so `ServerEventV2::ListenerFailed` is never emitted and the store keeps
 * `running: true` on a service no peer can reach. The manager used to branch on
 * that flag, so returning to the foreground only re-announced presence on a
 * dead listener and the phone stayed invisible to every peer until the user
 * toggled the setting off and on. It must probe liveness instead.
 */

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { osPlatform: 'ios', isIOSApp: true, isAndroidApp: false, hasHaptics: false },
  }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free', customizationPurchased: false }),
}));
vi.mock('@/services/localsend/devicePrefs', () => ({
  DEFAULT_ALIAS_NAMED_KEY: "{{name}}'s Readest",
  getLocalSendAlias: () => 'Test Device',
  isLocalSendEnabled: () => true,
}));
vi.mock('@/utils/bridge', () => ({ setMulticastLock: vi.fn(async () => {}) }));
vi.mock('@/services/localsend/sounds', () => ({
  playTransferCue: vi.fn(),
  primeTransferCues: vi.fn(),
}));
vi.mock('@/services/ingestService', () => ({ ingestFile: vi.fn() }));
vi.mock('@/services/localsend/bookFile', () => ({ resolveBookSendFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const startLocalSend = vi.fn(async (_alias: string, _deviceModel: string) => ({
  running: true,
  alias: 'Test Device',
  port: 53318,
  fingerprint: 'fp',
  deviceModel: 'iOS',
  localIps: ['192.168.2.99'],
  multicastError: null,
}));
const stopLocalSend = vi.fn(async () => {});
const setLocalSendDiscoverable = vi.fn(async (_active: boolean) => {});
const isLocalSendAlive = vi.fn(async () => true);

vi.mock('@/services/localsend/service', () => ({
  startLocalSend: (alias: string, deviceModel: string) => startLocalSend(alias, deviceModel),
  stopLocalSend: () => stopLocalSend(),
  setLocalSendDiscoverable: (active: boolean) => setLocalSendDiscoverable(active),
  isLocalSendAlive: () => isLocalSendAlive(),
  respondLocalSend: vi.fn(async () => true),
  cancelLocalSendReceive: vi.fn(async () => {}),
}));

import LocalSendManager from '@/components/localsend/LocalSendManager';

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
};

/** Fire `visibilitychange` and let the handler's awaits settle. */
const changeVisibilityTo = async (state: 'visible' | 'hidden') => {
  setVisibility(state);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mountManager = async () => {
  await act(async () => {
    render(<LocalSendManager />);
  });
  // Ignore the service start the mount itself performs.
  startLocalSend.mockClear();
};

beforeEach(() => {
  vi.clearAllMocks();
  isLocalSendAlive.mockResolvedValue(true);
  setVisibility('visible');
});
afterEach(() => cleanup());

describe('LocalSendManager foreground presence', () => {
  it('rebuilds the service when the listener did not survive suspension', async () => {
    await mountManager();

    // The status still says running - this is exactly the iOS zombie state.
    isLocalSendAlive.mockResolvedValue(false);
    await changeVisibilityTo('visible');

    expect(stopLocalSend).toHaveBeenCalled();
    expect(startLocalSend).toHaveBeenCalled();
    expect(setLocalSendDiscoverable).not.toHaveBeenCalledWith(true);
  });

  it('only re-announces presence when the listener is still alive', async () => {
    await mountManager();

    isLocalSendAlive.mockResolvedValue(true);
    await changeVisibilityTo('visible');

    expect(setLocalSendDiscoverable).toHaveBeenCalledWith(true);
    expect(stopLocalSend).not.toHaveBeenCalled();
    expect(startLocalSend).not.toHaveBeenCalled();
  });

  it('goes quiet on the way out without probing', async () => {
    await mountManager();

    await changeVisibilityTo('hidden');

    expect(setLocalSendDiscoverable).toHaveBeenCalledWith(false);
    expect(isLocalSendAlive).not.toHaveBeenCalled();
    expect(stopLocalSend).not.toHaveBeenCalled();
  });
});
