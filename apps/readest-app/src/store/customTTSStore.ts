import { create } from 'zustand';
import type { EnvConfigType } from '@/services/environment';
import type { CustomTTSService } from '@/types/customTTS';
import { useSettingsStore } from './settingsStore';
import { getReplicaPersistEnv } from '@/services/sync/replicaPersist';
import { publishReplicaDelete, publishReplicaUpsert } from '@/services/sync/replicaPublish';
import { CUSTOM_TTS_KIND } from '@/services/sync/adapters/customTTS';

type ServiceInput = Omit<CustomTTSService, 'id' | 'addedAt' | 'updatedAt'>;

const replace = (list: CustomTTSService[], service: CustomTTSService) =>
  list.some((s) => s.id === service.id)
    ? list.map((s) => (s.id === service.id ? service : s))
    : [...list, service];

const markDeleted = (list: CustomTTSService[], id: string) =>
  list.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s));

const persist = () => {
  const env = getReplicaPersistEnv();
  if (env) void useCustomTTSStore.getState().saveCustomTTSServices(env);
};

interface CustomTTSState {
  services: CustomTTSService[];
  loaded: boolean;

  addService(input: ServiceInput): CustomTTSService;
  updateService(id: string, patch: Partial<ServiceInput>): void;
  removeService(id: string): void;

  /** Replica pull: apply without republishing. */
  applyRemoteService(service: CustomTTSService): void;
  softDeleteService(id: string): void;

  loadCustomTTSServices(envConfig: EnvConfigType): Promise<void>;
  saveCustomTTSServices(envConfig: EnvConfigType): Promise<void>;
}

export const useCustomTTSStore = create<CustomTTSState>((set, get) => ({
  services: [],
  loaded: false,

  addService: (input) => {
    const now = Date.now();
    const service: CustomTTSService = {
      ...input,
      id: crypto.randomUUID(),
      addedAt: now,
      updatedAt: now,
      reincarnation: Math.random().toString(36).slice(2),
    };
    set((state) => ({ services: [...state.services, service] }));
    void publishReplicaUpsert(CUSTOM_TTS_KIND, service, service.id, service.reincarnation);
    return service;
  },

  updateService: (id, patch) => {
    const old = get().services.find((s) => s.id === id && !s.deletedAt);
    if (!old) return;
    const service = { ...old, ...patch, updatedAt: Date.now() };
    set((state) => ({ services: replace(state.services, service) }));
    void publishReplicaUpsert(CUSTOM_TTS_KIND, service, id, service.reincarnation);
  },

  removeService: (id) => {
    set((state) => ({ services: markDeleted(state.services, id) }));
    void publishReplicaDelete(CUSTOM_TTS_KIND, id);
  },

  applyRemoteService: (remote) => {
    const old = get().services.find((s) => s.id === remote.id);
    // A row pushed while the publisher's CryptoSession was locked carries no
    // apiKey; keep the local one instead of wiping it.
    const service: CustomTTSService = {
      ...remote,
      apiKey: remote.apiKey ?? old?.apiKey,
      lastSeenCipher: remote.lastSeenCipher ?? old?.lastSeenCipher,
      deletedAt: undefined,
    };
    set((state) => ({ services: replace(state.services, service) }));
    persist();
  },

  softDeleteService: (id) => {
    if (!get().services.some((s) => s.id === id && !s.deletedAt)) return;
    set((state) => ({ services: markDeleted(state.services, id) }));
    persist();
  },

  loadCustomTTSServices: async () => {
    const { settings } = useSettingsStore.getState();
    set({ services: settings?.customTTSServices ?? [], loaded: true });
  },

  saveCustomTTSServices: async (envConfig) => {
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    // Tombstones stay in memory for the pull orchestrator but are not persisted.
    settings.customTTSServices = get().services.filter((s) => !s.deletedAt);
    setSettings(settings);
    await saveSettings(envConfig, settings);
  },
}));

/** Hydrates the store from settings once; later changes flow through the store. */
export const ensureCustomTTSServicesLoaded = (envConfig: EnvConfigType): void => {
  if (!useCustomTTSStore.getState().loaded) {
    void useCustomTTSStore.getState().loadCustomTTSServices(envConfig);
  }
};

/** Pull-side lookup that also checks persisted settings before the store hydrates. */
export const findCustomTTSService = (id: string): CustomTTSService | undefined =>
  useCustomTTSStore.getState().services.find((s) => s.id === id) ??
  useSettingsStore.getState().settings?.customTTSServices?.find((s) => s.id === id);

/** Services whose voices Read Aloud offers. */
export const getEnabledCustomTTSServices = (): CustomTTSService[] => {
  const { loaded, services } = useCustomTTSStore.getState();
  const list = loaded ? services : (useSettingsStore.getState().settings?.customTTSServices ?? []);
  return list.filter((s) => !s.deletedAt && !s.disabled);
};
