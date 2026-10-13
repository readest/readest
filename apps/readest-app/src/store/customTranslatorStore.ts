import { create } from 'zustand';
import type { EnvConfigType } from '@/services/environment';
import type { CustomTranslator, TranslationPrompt } from '@/types/translation';
import { useSettingsStore } from './settingsStore';
import { getReplicaPersistEnv } from '@/services/sync/replicaPersist';
import { publishReplicaDelete, publishReplicaUpsert } from '@/services/sync/replicaPublish';
import {
  CUSTOM_TRANSLATOR_KIND,
  TRANSLATION_PROMPT_KIND,
} from '@/services/sync/adapters/customTranslator';
import {
  DEFAULT_PROMPT_ID,
  DEFAULT_TRANSLATION_PROMPT,
} from '@/services/translators/custom/prompts';

const newId = () => crypto.randomUUID();
const newReincarnation = () => Math.random().toString(36).slice(2);

interface SyncedEntry {
  id: string;
  deletedAt?: number;
  reincarnation?: string;
}

const replace = <T extends SyncedEntry>(list: T[], entry: T): T[] =>
  list.some((e) => e.id === entry.id)
    ? list.map((e) => (e.id === entry.id ? entry : e))
    : [...list, entry];

const markDeleted = <T extends SyncedEntry>(list: T[], id: string): T[] =>
  list.map((e) => (e.id === id ? { ...e, deletedAt: Date.now() } : e));

const persist = () => {
  const env = getReplicaPersistEnv();
  if (env) void useCustomTranslatorStore.getState().saveCustomTranslators(env);
};

type TranslatorInput = Omit<CustomTranslator, 'id' | 'addedAt' | 'updatedAt'>;
type PromptInput = Pick<TranslationPrompt, 'name' | 'systemPrompt'>;

interface CustomTranslatorState {
  translators: CustomTranslator[];
  prompts: TranslationPrompt[];
  loaded: boolean;

  getAvailableTranslators(): CustomTranslator[];
  getAvailablePrompts(): TranslationPrompt[];

  addTranslator(input: TranslatorInput): CustomTranslator;
  updateTranslator(id: string, patch: Partial<TranslatorInput>): void;
  removeTranslator(id: string): void;
  addPrompt(input: PromptInput): TranslationPrompt;
  updatePrompt(id: string, patch: Partial<PromptInput>): void;
  removePrompt(id: string): void;

  /** Replica pull: apply without republishing. */
  applyRemoteTranslator(translator: CustomTranslator): void;
  applyRemotePrompt(prompt: TranslationPrompt): void;
  softDeleteTranslator(id: string): void;
  softDeletePrompt(id: string): void;

  loadCustomTranslators(envConfig: EnvConfigType): Promise<void>;
  saveCustomTranslators(envConfig: EnvConfigType): Promise<void>;
}

export const useCustomTranslatorStore = create<CustomTranslatorState>((set, get) => ({
  translators: [],
  prompts: [],
  loaded: false,

  getAvailableTranslators: () => get().translators.filter((t) => !t.deletedAt),
  getAvailablePrompts: () => get().prompts.filter((p) => !p.deletedAt),

  addTranslator: (input) => {
    const now = Date.now();
    const translator: CustomTranslator = {
      ...input,
      id: newId(),
      addedAt: now,
      updatedAt: now,
      reincarnation: newReincarnation(),
    };
    set((state) => ({ translators: [...state.translators, translator] }));
    void publishReplicaUpsert(
      CUSTOM_TRANSLATOR_KIND,
      translator,
      translator.id,
      translator.reincarnation,
    );
    return translator;
  },

  updateTranslator: (id, patch) => {
    const old = get().translators.find((t) => t.id === id && !t.deletedAt);
    if (!old) return;
    const translator = { ...old, ...patch, updatedAt: Date.now() };
    set((state) => ({ translators: replace(state.translators, translator) }));
    void publishReplicaUpsert(CUSTOM_TRANSLATOR_KIND, translator, id, translator.reincarnation);
  },

  removeTranslator: (id) => {
    set((state) => ({ translators: markDeleted(state.translators, id) }));
    void publishReplicaDelete(CUSTOM_TRANSLATOR_KIND, id);
  },

  addPrompt: (input) => {
    const now = Date.now();
    const prompt: TranslationPrompt = {
      ...input,
      id: newId(),
      addedAt: now,
      updatedAt: now,
      reincarnation: newReincarnation(),
    };
    set((state) => ({ prompts: [...state.prompts, prompt] }));
    void publishReplicaUpsert(TRANSLATION_PROMPT_KIND, prompt, prompt.id, prompt.reincarnation);
    return prompt;
  },

  updatePrompt: (id, patch) => {
    const old = get().prompts.find((p) => p.id === id && !p.deletedAt);
    if (!old) return;
    const prompt = { ...old, ...patch, updatedAt: Date.now() };
    set((state) => ({ prompts: replace(state.prompts, prompt) }));
    void publishReplicaUpsert(TRANSLATION_PROMPT_KIND, prompt, id, prompt.reincarnation);
  },

  removePrompt: (id) => {
    set((state) => ({ prompts: markDeleted(state.prompts, id) }));
    void publishReplicaDelete(TRANSLATION_PROMPT_KIND, id);
  },

  applyRemoteTranslator: (remote) => {
    const old = get().translators.find((t) => t.id === remote.id);
    // A row pushed while the publisher's CryptoSession was locked carries no
    // apiKey; keep the local one instead of wiping it.
    const translator: CustomTranslator = {
      ...remote,
      apiKey: remote.apiKey ?? old?.apiKey,
      lastSeenCipher: remote.lastSeenCipher ?? old?.lastSeenCipher,
      deletedAt: undefined,
    };
    set((state) => ({ translators: replace(state.translators, translator) }));
    persist();
  },

  applyRemotePrompt: (remote) => {
    set((state) => ({ prompts: replace(state.prompts, { ...remote, deletedAt: undefined }) }));
    persist();
  },

  softDeleteTranslator: (id) => {
    if (!get().translators.some((t) => t.id === id && !t.deletedAt)) return;
    set((state) => ({ translators: markDeleted(state.translators, id) }));
    persist();
  },

  softDeletePrompt: (id) => {
    if (!get().prompts.some((p) => p.id === id && !p.deletedAt)) return;
    set((state) => ({ prompts: markDeleted(state.prompts, id) }));
    persist();
  },

  loadCustomTranslators: async () => {
    const { settings } = useSettingsStore.getState();
    set({
      translators: settings?.customTranslators ?? [],
      prompts: settings?.translationPrompts ?? [],
      loaded: true,
    });
  },

  saveCustomTranslators: async (envConfig) => {
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    const { translators, prompts } = get();
    // Tombstones stay in memory for the pull orchestrator but are not persisted.
    settings.customTranslators = translators.filter((t) => !t.deletedAt);
    settings.translationPrompts = prompts.filter((p) => !p.deletedAt);
    setSettings(settings);
    await saveSettings(envConfig, settings);
  },
}));

/** Hydrates the store from settings once; later changes flow through the store. */
export const ensureCustomTranslatorsLoaded = (envConfig: EnvConfigType): void => {
  if (!useCustomTranslatorStore.getState().loaded) {
    void useCustomTranslatorStore.getState().loadCustomTranslators(envConfig);
  }
};

/** System-prompt template for a prompt id, falling back to the built-in default. */
export const getPromptTemplate = (promptId?: string): string => {
  if (!promptId || promptId === DEFAULT_PROMPT_ID) return DEFAULT_TRANSLATION_PROMPT;
  const prompt = useCustomTranslatorStore
    .getState()
    .getAvailablePrompts()
    .find((p) => p.id === promptId);
  return prompt?.systemPrompt ?? DEFAULT_TRANSLATION_PROMPT;
};

/** Pull-side lookup that also checks persisted settings before the store hydrates. */
export const findCustomTranslator = (id: string): CustomTranslator | undefined =>
  useCustomTranslatorStore.getState().translators.find((t) => t.id === id) ??
  useSettingsStore.getState().settings?.customTranslators?.find((t) => t.id === id);

export const findTranslationPrompt = (id: string): TranslationPrompt | undefined =>
  useCustomTranslatorStore.getState().prompts.find((p) => p.id === id) ??
  useSettingsStore.getState().settings?.translationPrompts?.find((p) => p.id === id);

/** Usable OpenAI-compatible translators, e.g. for the AI context dictionary (#5544). */
export const getLLMTranslators = (): CustomTranslator[] => {
  const { loaded, translators } = useCustomTranslatorStore.getState();
  const list = loaded
    ? translators
    : (useSettingsStore.getState().settings?.customTranslators ?? []);
  return list.filter((t) => t.type === 'openai-compatible' && !t.deletedAt && !t.disabled);
};
