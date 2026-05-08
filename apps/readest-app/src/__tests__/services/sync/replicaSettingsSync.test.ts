import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const publishMock = vi.fn();
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: (...args: unknown[]) => publishMock(...args),
}));

let isUnlocked = true;
vi.mock('@/libs/crypto/session', () => ({
  cryptoSession: { isUnlocked: () => isUnlocked },
}));

// Default behavior: the gate "succeeds" by flipping isUnlocked to true
// (mimicking a successful passphrase setup/unlock). Individual tests
// override to simulate cancellation or a missing prompter.
const ensurePassphraseMock = vi.fn(async () => {
  isUnlocked = true;
});
vi.mock('@/services/sync/passphraseGate', () => ({
  ensurePassphraseUnlocked: () => ensurePassphraseMock(),
}));

import {
  __resetSettingsSyncForTests,
  applyRemoteSettings,
  publishSettingsIfChanged,
} from '@/services/sync/replicaSettingsSync';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const baseHighlight = {
  customThemes: [],
  customHighlightColors: { yellow: '#ffeb3b' },
  userHighlightColors: [],
  defaultHighlightLabels: {},
  customTtsHighlightColors: [],
};

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    globalReadSettings: { ...baseHighlight },
    kosync: { serverUrl: '', username: '', userkey: '', password: '' },
    readwise: { accessToken: '' },
    hardcover: { accessToken: '' },
    ...overrides,
  }) as unknown as SystemSettings;

const makeEnvConfig = (): EnvConfigType => ({ getAppService: vi.fn() }) as unknown as EnvConfigType;

beforeEach(() => {
  publishMock.mockReset();
  ensurePassphraseMock.mockReset();
  ensurePassphraseMock.mockImplementation(async () => {
    isUnlocked = true;
  });
  __resetSettingsSyncForTests();
  isUnlocked = true;
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
    applyUILanguage: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

afterEach(() => {
  __resetSettingsSyncForTests();
});

describe('publishSettingsIfChanged', () => {
  test('first call publishes every populated whitelisted field', async () => {
    await publishSettingsIfChanged(makeSettings());
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [kind, record, replicaId] = publishMock.mock.calls[0]!;
    expect(kind).toBe('settings');
    expect(replicaId).toBe('singleton');
    const patch = (record as { patch: Partial<SystemSettings> }).patch;
    expect(patch.globalReadSettings?.customHighlightColors).toEqual(
      baseHighlight.customHighlightColors,
    );
  });

  test('second call with no changes is a no-op', async () => {
    await publishSettingsIfChanged(makeSettings());
    publishMock.mockReset();
    await publishSettingsIfChanged(makeSettings());
    expect(publishMock).not.toHaveBeenCalled();
  });

  test('publishes only changed fields on subsequent calls', async () => {
    await publishSettingsIfChanged(makeSettings());
    publishMock.mockReset();
    const next = makeSettings({
      globalReadSettings: {
        ...baseHighlight,
        userHighlightColors: [{ name: 'mint', color: '#a8e6cf' }],
      } as unknown as SystemSettings['globalReadSettings'],
    });
    await publishSettingsIfChanged(next);
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.globalReadSettings?.userHighlightColors).toEqual([
      { name: 'mint', color: '#a8e6cf' },
    ]);
    // Unchanged fields stay out of the diff
    expect(patch.globalReadSettings?.customHighlightColors).toBeUndefined();
    expect(patch.kosync).toBeUndefined();
  });

  test('detects nested changes (kosync.serverUrl)', async () => {
    await publishSettingsIfChanged(makeSettings());
    publishMock.mockReset();
    await publishSettingsIfChanged(
      makeSettings({
        kosync: {
          serverUrl: 'https://kosync.example',
          username: '',
          userkey: '',
          password: '',
        } as SystemSettings['kosync'],
      }),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.kosync?.serverUrl).toBe('https://kosync.example');
  });

  test('triggers the passphrase gate when an encrypted field gets meaningful content while locked', async () => {
    isUnlocked = false;
    await publishSettingsIfChanged(
      makeSettings({
        kosync: {
          serverUrl: '',
          username: '',
          userkey: '',
          password: 'hunter2',
        } as SystemSettings['kosync'],
      }),
    );
    expect(ensurePassphraseMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  test('empty encrypted credential is dropped from publish entirely (no gate, no patch)', async () => {
    isUnlocked = false;
    // makeSettings has all kosync credentials as ''. Plaintext changes
    // (highlight palette) trigger the publish; encrypted empty fields
    // should NOT appear in the patch and should NOT trigger the gate.
    await publishSettingsIfChanged(makeSettings());
    expect(ensurePassphraseMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.kosync?.password).toBeUndefined();
    expect(patch.readwise?.accessToken).toBeUndefined();
    expect(patch.hardcover?.accessToken).toBeUndefined();
  });

  test('does NOT trigger the gate when only plaintext settings change', async () => {
    isUnlocked = false;
    await publishSettingsIfChanged(
      makeSettings({
        globalReadSettings: {
          ...baseHighlight,
          userHighlightColors: [{ name: 'mint', color: '#a8e6cf' }],
        } as unknown as SystemSettings['globalReadSettings'],
      }),
    );
    expect(ensurePassphraseMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  test('user cancels the gate prompt → encrypted hash NOT stored, next save retries', async () => {
    isUnlocked = false;
    ensurePassphraseMock.mockImplementationOnce(async () => {
      throw new Error('user cancelled');
    });
    await publishSettingsIfChanged(
      makeSettings({
        kosync: {
          serverUrl: '',
          username: '',
          userkey: '',
          password: 'hunter2',
        } as SystemSettings['kosync'],
      }),
    );
    // Publish still fires — plaintext fields go through (none new this
    // call) plus the encrypted field whose ciphertext the middleware
    // will drop on the wire.
    expect(publishMock).toHaveBeenCalledTimes(1);
    publishMock.mockReset();

    // Session still locked, same settings. Hash wasn't stored because
    // we never unlocked, so the diff catches kosync.password again.
    await publishSettingsIfChanged(
      makeSettings({
        kosync: {
          serverUrl: '',
          username: '',
          userkey: '',
          password: 'hunter2',
        } as SystemSettings['kosync'],
      }),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  test('encrypted-field publish while unlocked records the value (no retry next save)', async () => {
    isUnlocked = true;
    await publishSettingsIfChanged(
      makeSettings({
        kosync: {
          serverUrl: '',
          username: '',
          userkey: '',
          password: 'hunter2',
        } as SystemSettings['kosync'],
      }),
    );
    publishMock.mockReset();
    await publishSettingsIfChanged(
      makeSettings({
        kosync: {
          serverUrl: '',
          username: '',
          userkey: '',
          password: 'hunter2',
        } as SystemSettings['kosync'],
      }),
    );
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe('applyRemoteSettings', () => {
  test('merges patch into useSettingsStore and persists', () => {
    const env = makeEnvConfig();
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        globalReadSettings: { userHighlightColors: userColors },
      } as unknown as Partial<SystemSettings>,
    });
    const merged = useSettingsStore.getState().settings;
    expect(merged.globalReadSettings.userHighlightColors).toEqual(userColors);
    // Existing globalReadSettings fields preserved by the deep merge.
    expect(merged.globalReadSettings.customHighlightColors).toEqual(
      baseHighlight.customHighlightColors,
    );
    expect(useSettingsStore.getState().saveSettings).toHaveBeenCalledTimes(1);
  });

  test('applying remote does NOT echo the remote field back on the next publish', async () => {
    await publishSettingsIfChanged(useSettingsStore.getState().settings);
    publishMock.mockReset();

    const env = makeEnvConfig();
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        globalReadSettings: { userHighlightColors: userColors },
      } as unknown as Partial<SystemSettings>,
    });
    publishMock.mockReset();

    await publishSettingsIfChanged(useSettingsStore.getState().settings);
    expect(publishMock).not.toHaveBeenCalled();
  });

  test('empty patch is a no-op', () => {
    const env = makeEnvConfig();
    const before = useSettingsStore.getState().settings;
    applyRemoteSettings(env, { name: 'singleton', patch: {} });
    expect(useSettingsStore.getState().settings).toBe(before);
    expect(useSettingsStore.getState().saveSettings).not.toHaveBeenCalled();
  });
});
