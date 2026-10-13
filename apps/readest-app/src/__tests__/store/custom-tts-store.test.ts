import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publishReplicaUpsert, publishReplicaDelete } = vi.hoisted(() => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));
vi.mock('@/services/sync/replicaPublish', () => ({ publishReplicaUpsert, publishReplicaDelete }));

import { getEnabledCustomTTSServices, useCustomTTSStore } from '@/store/customTTSStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { CustomTTSService } from '@/types/customTTS';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const input = { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'tts-1' };

const remote = (overrides: Partial<CustomTTSService> = {}): CustomTTSService => ({
  id: 's-1',
  ...input,
  name: 'Remote name',
  addedAt: 1,
  updatedAt: 2,
  ...overrides,
});

describe('customTTSStore', () => {
  let saveSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    saveSettings = vi.fn();
    useCustomTTSStore.setState({ services: [], loaded: false });
    useSettingsStore.setState({
      settings: {} as SystemSettings,
      setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
      saveSettings,
    } as unknown as ReturnType<typeof useSettingsStore.getState>);
  });

  it('adds, updates and removes services, publishing each change', () => {
    const store = useCustomTTSStore.getState();
    const added = store.addService(input);
    expect(publishReplicaUpsert).toHaveBeenCalledWith(
      'custom_tts',
      added,
      added.id,
      added.reincarnation,
    );
    store.updateService(added.id, { model: 'gpt-4o-mini-tts' });
    expect(useCustomTTSStore.getState().services[0]!.model).toBe('gpt-4o-mini-tts');
    store.removeService(added.id);
    expect(publishReplicaDelete).toHaveBeenCalledWith('custom_tts', added.id);
    expect(useCustomTTSStore.getState().services[0]!.deletedAt).toBeDefined();
  });

  it('persists live services only', async () => {
    const store = useCustomTTSStore.getState();
    const kept = store.addService(input);
    store.removeService(store.addService({ ...input, name: 'Gone' }).id);
    await store.saveCustomTTSServices({} as EnvConfigType);
    expect(useSettingsStore.getState().settings.customTTSServices).toEqual([kept]);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('keeps the local apiKey when a remote row arrives without one', () => {
    useCustomTTSStore.setState({ services: [remote({ name: 'Local', apiKey: 'sk-local' })] });
    useCustomTTSStore.getState().applyRemoteService(remote());
    const [service] = useCustomTTSStore.getState().services;
    expect(service!.name).toBe('Remote name');
    expect(service!.apiKey).toBe('sk-local');
  });

  it('drops the local apiKey when another device cleared it', () => {
    useCustomTTSStore.setState({ services: [remote({ apiKey: 'sk-local' })] });
    useCustomTTSStore.getState().applyRemoteService(remote({ apiKey: '' }));
    expect(useCustomTTSStore.getState().services[0]!.apiKey).toBe('');
  });

  it('lists enabled services, reading settings before the store hydrates', () => {
    useSettingsStore.getState().settings.customTTSServices = [
      remote({ id: 'a' }),
      remote({ id: 'b', disabled: true }),
    ];
    expect(getEnabledCustomTTSServices().map((s) => s.id)).toEqual(['a']);
    useCustomTTSStore.setState({
      loaded: true,
      services: [remote({ id: 'c' }), remote({ id: 'd', deletedAt: 5 })],
    });
    expect(getEnabledCustomTTSServices().map((s) => s.id)).toEqual(['c']);
  });
});
