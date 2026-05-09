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
  initSettingsSync,
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

/**
 * Opt the current test into credential sync. Most tests in this file
 * exercise the encryption path (gate prompts, hash storage, etc.) which
 * is gated by the 'credentials' meta-toggle — and that toggle defaults
 * OFF. Call this before driving an encrypted-credential scenario.
 */
const enableCredentialsSync = (): void => {
  const current = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: { ...current, syncCategories: { credentials: true } } as never,
  } as never);
};

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

  test('does NOT publish dictionarySettings.providerOrder by default (auto-mutation gate)', async () => {
    // providerOrder must only ship cross-device on explicit user
    // actions (drag-drop reorder, dict import, dict delete, web-search
    // add). Auto-mutations from applyRemoteDictionary, softDeleteByContentId,
    // loadCustomDictionaries reconciliation, and ordinary saveSettings
    // calls must NOT republish it — otherwise a fresh device's local
    // append-on-pull or orphan-rescue order would clobber the
    // authoritative cross-device order under per-field LWW.
    await publishSettingsIfChanged(
      makeSettings({
        dictionarySettings: {
          providerOrder: ['imp-new', 'builtin:wiktionary'],
          providerEnabled: { 'imp-new': true, 'builtin:wiktionary': true },
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    // providerOrder excluded — gate closed, no explicit opt-in.
    expect(patch.dictionarySettings?.providerOrder).toBeUndefined();
    // providerEnabled is NOT gated — auto-publishes per usual diff.
    expect(patch.dictionarySettings?.providerEnabled).toBeDefined();
  });

  test('publishes dictionarySettings.providerOrder when markExplicitProviderOrderPublish was called', async () => {
    const { markExplicitProviderOrderPublish } =
      await import('@/services/sync/replicaSettingsSync');
    markExplicitProviderOrderPublish();
    await publishSettingsIfChanged(
      makeSettings({
        dictionarySettings: {
          providerOrder: ['imp-new', 'builtin:wiktionary'],
          providerEnabled: { 'imp-new': true, 'builtin:wiktionary': true },
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.dictionarySettings?.providerOrder).toEqual(['imp-new', 'builtin:wiktionary']);
  });

  test('explicit-publish opt-in is consumed after one publish (no carryover)', async () => {
    const { markExplicitProviderOrderPublish } =
      await import('@/services/sync/replicaSettingsSync');
    markExplicitProviderOrderPublish();
    const settings1 = makeSettings({
      dictionarySettings: {
        providerOrder: ['a'],
        providerEnabled: { a: true },
        webSearches: [],
      },
    } as Partial<SystemSettings>);
    await publishSettingsIfChanged(settings1);
    expect(publishMock).toHaveBeenCalledTimes(1);
    publishMock.mockReset();

    // Second publish without re-marking — providerOrder change is gated.
    const settings2 = makeSettings({
      dictionarySettings: {
        providerOrder: ['b', 'a'],
        providerEnabled: { a: true, b: true },
        webSearches: [],
      },
    } as Partial<SystemSettings>);
    await publishSettingsIfChanged(settings2);
    // providerEnabled changed — that publishes. providerOrder is gated.
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.dictionarySettings?.providerOrder).toBeUndefined();
    expect(patch.dictionarySettings?.providerEnabled).toEqual({ a: true, b: true });
  });

  test('triggers the passphrase gate when an encrypted field gets meaningful content while locked', async () => {
    enableCredentialsSync();
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

  describe('credentials category gate', () => {
    // The 'credentials' meta-toggle defaults OFF. When OFF, the settings
    // publisher must skip every ENCRYPTED_PATH (kosync.username/userkey/
    // password, readwise.accessToken, hardcover.accessToken) entirely:
    // no patch entry, no proactive passphrase prompt, no stored hash.
    // Non-credential plaintext settings still publish normally.
    const setCredentials = async (enabled: boolean | undefined): Promise<void> => {
      const { useSettingsStore } = await import('@/store/settingsStore');
      const map = enabled === undefined ? {} : { credentials: enabled };
      const current = useSettingsStore.getState().settings;
      useSettingsStore.setState({
        settings: { ...current, syncCategories: map } as never,
      } as never);
    };

    test('does NOT trigger the passphrase gate when credentials sync is OFF and a kosync password is set', async () => {
      await setCredentials(undefined); // default OFF
      isUnlocked = false;
      await publishSettingsIfChanged(
        makeSettings({
          kosync: {
            serverUrl: 'https://kosync.example',
            username: 'alice',
            userkey: 'secret-key',
            password: 'hunter2',
          } as SystemSettings['kosync'],
        }),
      );
      expect(ensurePassphraseMock).not.toHaveBeenCalled();
    });

    test('omits all credential paths from the patch when credentials sync is OFF', async () => {
      await setCredentials(undefined);
      isUnlocked = false;
      await publishSettingsIfChanged(
        makeSettings({
          kosync: {
            serverUrl: 'https://kosync.example',
            username: 'alice',
            userkey: 'secret-key',
            password: 'hunter2',
          } as SystemSettings['kosync'],
          readwise: {
            accessToken: 'rw-token',
            enabled: true,
            lastSyncedAt: 0,
          } as SystemSettings['readwise'],
          hardcover: {
            accessToken: 'hc-token',
            enabled: true,
            lastSyncedAt: 0,
          } as SystemSettings['hardcover'],
        }),
      );
      // Plaintext kosync.serverUrl still publishes — only the credential
      // sub-fields are gated.
      expect(publishMock).toHaveBeenCalledTimes(1);
      const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
      expect(patch.kosync?.serverUrl).toBe('https://kosync.example');
      expect(patch.kosync?.username).toBeUndefined();
      expect(patch.kosync?.userkey).toBeUndefined();
      expect(patch.kosync?.password).toBeUndefined();
      expect(patch.readwise?.accessToken).toBeUndefined();
      expect(patch.hardcover?.accessToken).toBeUndefined();
    });

    test('publishes credential paths normally when credentials sync is ON', async () => {
      await setCredentials(true);
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
      expect(publishMock).toHaveBeenCalledTimes(1);
      const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
      expect(patch.kosync?.password).toBe('hunter2');
    });

    test('skipping all of the only-credential changes is a clean no-op (no empty publish)', async () => {
      await setCredentials(undefined);
      isUnlocked = false;
      // Prime the snapshot so the first publish drains everything.
      await publishSettingsIfChanged(makeSettings());
      publishMock.mockReset();
      ensurePassphraseMock.mockReset();
      // Only encrypted-credential fields change; nothing plaintext does.
      await publishSettingsIfChanged(
        makeSettings({
          readwise: {
            accessToken: 'rw-token',
            enabled: true,
            lastSyncedAt: 0,
          } as SystemSettings['readwise'],
        }),
      );
      // No publish at all — credentials gate dropped the only diff.
      expect(publishMock).not.toHaveBeenCalled();
      expect(ensurePassphraseMock).not.toHaveBeenCalled();
    });
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

  test('initSettingsSync(initialSettings) primes the snapshot so the first setSettings(disk_default) does not push', async () => {
    // Real-world bug: a fresh-install Device B's library boot calls
    // setSettings(disk_default) which fires publishSettingsIfChanged
    // with an empty lastPublishedFields snapshot. Every whitelisted
    // field looks "changed from undefined" and gets pushed to the
    // server with a fresh HLC, overwriting the cross-device
    // authoritative values another device set. Disk-priming via
    // initSettingsSync(initialSettings) seeds the snapshot from the
    // just-loaded disk so the same-value first publish is a no-op.
    const diskSettings = makeSettings({
      dictionarySettings: {
        providerOrder: ['builtin:wiktionary', 'builtin:wikipedia'],
        providerEnabled: { 'builtin:wiktionary': true, 'builtin:wikipedia': true },
        webSearches: [],
      },
      kosync: {
        serverUrl: 'https://sync.koreader.rocks/',
        username: '',
        userkey: '',
        password: '',
      } as SystemSettings['kosync'],
    } as Partial<SystemSettings>);
    initSettingsSync(diskSettings);

    // The same disk_default replayed (typical library page initLibrary
    // flow) — should produce no publish because every whitelisted
    // field already matches the primed snapshot.
    await publishSettingsIfChanged(diskSettings);
    expect(publishMock).not.toHaveBeenCalled();
  });

  test('initSettingsSync priming does not block legitimate user changes against the seeded baseline', async () => {
    const diskSettings = makeSettings({
      kosync: {
        serverUrl: '',
        username: '',
        userkey: '',
        password: '',
      } as SystemSettings['kosync'],
    });
    initSettingsSync(diskSettings);

    // User changes kosync.serverUrl after boot — must publish.
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
    enableCredentialsSync();
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
    enableCredentialsSync();
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

  test('propagates dictionarySettings into useCustomDictionaryStore mirror', async () => {
    const { useCustomDictionaryStore } = await import('@/store/customDictionaryStore');
    useCustomDictionaryStore.setState({
      ...useCustomDictionaryStore.getState(),
      settings: {
        providerOrder: ['local-x'],
        providerEnabled: { 'local-x': true },
        defaultProviderId: 'local-x',
        webSearches: [],
      },
    });
    const env = makeEnvConfig();
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        dictionarySettings: {
          providerOrder: ['remote-y'],
          providerEnabled: { 'remote-y': true },
          webSearches: [{ id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' }],
        },
      } as unknown as Partial<SystemSettings>,
    });
    const dictMirror = useCustomDictionaryStore.getState().settings;
    expect(dictMirror.providerOrder).toEqual(['remote-y']);
    expect(dictMirror.providerEnabled).toEqual({ 'remote-y': true });
    expect(dictMirror.webSearches).toEqual([
      { id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' },
    ]);
    expect(dictMirror.defaultProviderId).toBe('local-x');
  });

  test('deep-merges dictionarySettings without clobbering local fields', () => {
    const env = makeEnvConfig();
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      settings: makeSettings({
        dictionarySettings: {
          providerOrder: ['local-x'],
          providerEnabled: { 'local-x': true },
          defaultProviderId: 'local-x',
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    });
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        dictionarySettings: {
          providerOrder: ['remote-y'],
          providerEnabled: { 'remote-y': true },
          // defaultProviderId omitted — must NOT be cleared by the merge.
          webSearches: [{ id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' }],
        },
      } as unknown as Partial<SystemSettings>,
    });
    const merged = useSettingsStore.getState().settings.dictionarySettings;
    expect(merged.providerOrder).toEqual(['remote-y']);
    expect(merged.providerEnabled).toEqual({ 'remote-y': true });
    expect(merged.webSearches).toEqual([
      { id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' },
    ]);
    // defaultProviderId is per-device — preserved by the deep-merge even
    // when the remote patch omits it.
    expect(merged.defaultProviderId).toBe('local-x');
  });
});
