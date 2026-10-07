import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findCustomTranslator, useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { CustomTranslator } from '@/types/translation';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

const remote = (overrides: Partial<CustomTranslator> = {}): CustomTranslator => ({
  id: 't-1',
  type: 'openai-compatible',
  name: 'Remote name',
  baseUrl: 'https://api.example.com/v1',
  addedAt: 1,
  updatedAt: 2,
  ...overrides,
});

describe('customTranslatorStore replica apply', () => {
  beforeEach(() => {
    useCustomTranslatorStore.setState({ translators: [], prompts: [], loaded: false });
    useSettingsStore.setState({
      settings: {} as SystemSettings,
      setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
      saveSettings: vi.fn(),
    } as unknown as ReturnType<typeof useSettingsStore.getState>);
  });

  it('applyRemoteTranslator keeps the local apiKey when the remote row has none', () => {
    useCustomTranslatorStore.setState({
      translators: [remote({ name: 'Local name', apiKey: 'sk-local' })],
    });
    useCustomTranslatorStore.getState().applyRemoteTranslator(remote());
    const [t] = useCustomTranslatorStore.getState().translators;
    expect(t!.name).toBe('Remote name');
    expect(t!.apiKey).toBe('sk-local');
  });

  it('applyRemoteTranslator accepts a decrypted remote apiKey', () => {
    useCustomTranslatorStore.setState({ translators: [remote({ apiKey: 'sk-old' })] });
    useCustomTranslatorStore.getState().applyRemoteTranslator(remote({ apiKey: 'sk-new' }));
    expect(useCustomTranslatorStore.getState().translators[0]!.apiKey).toBe('sk-new');
  });

  it('applyRemoteTranslator adds an unknown translator', () => {
    useCustomTranslatorStore.getState().applyRemoteTranslator(remote());
    expect(findCustomTranslator('t-1')?.name).toBe('Remote name');
  });

  it('softDeleteTranslator tombstones in memory and hides it from available', () => {
    useCustomTranslatorStore.getState().applyRemoteTranslator(remote());
    useCustomTranslatorStore.getState().softDeleteTranslator('t-1');
    const state = useCustomTranslatorStore.getState();
    expect(state.translators[0]!.deletedAt).toBeTruthy();
    expect(state.getAvailableTranslators()).toHaveLength(0);
  });

  it('softDeletePrompt tombstones a prompt', () => {
    useCustomTranslatorStore
      .getState()
      .applyRemotePrompt({ id: 'p-1', name: 'P', systemPrompt: 's', addedAt: 1, updatedAt: 1 });
    useCustomTranslatorStore.getState().softDeletePrompt('p-1');
    expect(useCustomTranslatorStore.getState().getAvailablePrompts()).toHaveLength(0);
  });
});
