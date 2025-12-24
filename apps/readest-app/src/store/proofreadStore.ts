import { create } from 'zustand';
import { ProofreadRule, ProofreadScope, ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { uniqueId } from '@/utils/misc';

export interface CreateProofreadRuleOptions {
  scope: ProofreadScope;
  pattern: string;
  replacement: string;
  cfi?: string;
  sectionHref?: string;
  isRegex?: boolean;
  enabled?: boolean;
  caseSensitive?: boolean;
  order?: number;
  wholeWord?: boolean;
}

interface ProofreadStoreState {
  getBookRules: (bookKey: string) => ProofreadRule[];
  getGlobalRules: () => ProofreadRule[];
  getMergedRules: (bookKey: string) => ProofreadRule[];

  addRule: (
    envConfig: EnvConfigType,
    bookKey: string,
    options: CreateProofreadRuleOptions,
  ) => Promise<ProofreadRule>;
  updateRule: (
    envConfig: EnvConfigType,
    bookKey: string,
    ruleId: string,
    updates: Partial<Omit<ProofreadRule, 'id'>>,
  ) => Promise<void>;
  removeRule: (
    envConfig: EnvConfigType,
    bookKey: string,
    ruleId: string,
    scope: ProofreadScope,
  ) => Promise<void>;
  toggleRule: (envConfig: EnvConfigType, bookKey: string, ruleId: string) => Promise<void>;
}

function createProofreadRule(opts: CreateProofreadRuleOptions): ProofreadRule {
  return {
    id: uniqueId(),
    scope: opts.scope,
    pattern: opts.pattern,
    replacement: opts.replacement,
    cfi: opts.cfi,
    sectionHref: opts.sectionHref,
    isRegex: opts.isRegex ?? false,
    enabled: opts.enabled ?? true,
    caseSensitive: opts.caseSensitive ?? true,
    order: opts.order ?? 1000,
    wholeWord: opts.wholeWord ?? true,
  };
}

function mergeRules(
  globalRules: ProofreadRule[] | undefined,
  bookRules: ProofreadRule[] | undefined,
): ProofreadRule[] {
  const map = new Map<string, ProofreadRule>();

  (globalRules ?? []).forEach((r) => map.set(r.id, r));
  (bookRules ?? []).forEach((r) => map.set(r.id, r));

  return [...map.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const useProofreadStore = create<ProofreadStoreState>(() => ({
  getBookRules: (bookKey: string) => {
    const { getViewSettings } = useReaderStore.getState();
    const viewSettings = getViewSettings(bookKey);
    return viewSettings?.proofreadRules || [];
  },

  getGlobalRules: () => {
    const { settings } = useSettingsStore.getState();
    return settings.globalViewSettings.proofreadRules || [];
  },

  getMergedRules: (bookKey: string) => {
    const { settings } = useSettingsStore.getState();
    const { getViewSettings } = useReaderStore.getState();
    const viewSettings = getViewSettings(bookKey);

    return mergeRules(settings.globalViewSettings.proofreadRules, viewSettings?.proofreadRules);
  },

  addRule: async (envConfig, bookKey, options) => {
    const rule = createProofreadRule(options);

    if (options.scope === 'library') {
      await addGlobalRule(envConfig, rule);
    } else {
      await addBookRule(envConfig, bookKey, rule, options.scope);
    }

    return rule;
  },

  updateRule: async (envConfig, bookKey, ruleId, updates) => {
    if (updates.scope === 'library') {
      await updateGlobalRule(envConfig, ruleId, updates);
    } else {
      await updateBookRule(envConfig, bookKey, ruleId, updates);
    }
  },

  removeRule: async (envConfig, bookKey, ruleId, scope) => {
    if (scope === 'library') {
      await removeGlobalRule(envConfig, ruleId);
    } else {
      await removeBookRule(envConfig, bookKey, ruleId);
    }
  },

  toggleRule: async (envConfig, bookKey, ruleId) => {
    const { getMergedRules } = useProofreadStore.getState();
    const mergedRules = getMergedRules(bookKey);
    const rule = mergedRules.find((r) => r.id === ruleId);

    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    const { updateRule } = useProofreadStore.getState();
    await updateRule(envConfig, bookKey, ruleId, { enabled: !rule.enabled });
  },
}));

async function addBookRule(
  envConfig: EnvConfigType,
  bookKey: string,
  rule: ProofreadRule,
  scope: ProofreadScope,
): Promise<void> {
  const { getViewSettings } = useReaderStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) return;

  const existingRules = viewSettings.proofreadRules || [];

  if (scope === 'selection') {
    // Always add new single-instance rules (each has unique ID)
    existingRules.push(rule);
  } else {
    // Check for duplicates in book scope
    const existing = existingRules.find(
      (r) => r.pattern === rule.pattern && r.isRegex === rule.isRegex && r.scope !== 'selection',
    );

    if (existing) {
      Object.assign(existing, {
        replacement: rule.replacement,
        enabled: rule.enabled,
        order: rule.order,
      });
    } else {
      existingRules.push(rule);
    }
  }

  await updateBookViewSettings(envConfig, bookKey, existingRules);
}

async function updateBookRule(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
  updates: Partial<Omit<ProofreadRule, 'id'>>,
): Promise<void> {
  const { getViewSettings } = useReaderStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) {
    throw new Error(`No viewSettings found for book: ${bookKey}`);
  }

  const existingRules = viewSettings.proofreadRules || [];
  const updatedRules = existingRules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r));

  await updateBookViewSettings(envConfig, bookKey, updatedRules);
}

async function removeBookRule(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
): Promise<void> {
  const { getViewSettings } = useReaderStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) {
    throw new Error(`No viewSettings found for book: ${bookKey}`);
  }

  const existingRules = viewSettings.proofreadRules || [];
  const filteredRules = existingRules.filter((r) => r.id !== ruleId);

  await updateBookViewSettings(envConfig, bookKey, filteredRules);
}

async function updateBookViewSettings(
  envConfig: EnvConfigType,
  bookKey: string,
  rules: ProofreadRule[],
): Promise<void> {
  const { getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const { settings } = useSettingsStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) {
    throw new Error(`No viewSettings found for book: ${bookKey}`);
  }

  const updatedViewSettings: ViewSettings = {
    ...viewSettings,
    proofreadRules: rules,
  };

  setViewSettings(bookKey, updatedViewSettings);

  const config = getConfig(bookKey);
  if (config) {
    await saveConfig(
      envConfig,
      bookKey,
      { ...config, viewSettings: updatedViewSettings, updatedAt: Date.now() },
      settings,
    );
  }
}

async function addGlobalRule(envConfig: EnvConfigType, rule: ProofreadRule): Promise<void> {
  const { settings } = useSettingsStore.getState();
  if (!settings || !settings.globalViewSettings) return;

  const globalRules = settings.globalViewSettings.proofreadRules || [];

  const existing = globalRules.find(
    (r) => r.pattern === rule.pattern && r.isRegex === rule.isRegex,
  );

  if (existing) {
    Object.assign(existing, {
      replacement: rule.replacement,
      enabled: rule.enabled,
      order: rule.order,
    });
    await updateGlobalSettings(envConfig, globalRules);
  } else {
    await updateGlobalSettings(envConfig, [...globalRules, rule]);
  }
}

async function updateGlobalRule(
  envConfig: EnvConfigType,
  ruleId: string,
  updates: Partial<Omit<ProofreadRule, 'id'>>,
): Promise<void> {
  const { settings } = useSettingsStore.getState();
  const globalRules = settings.globalViewSettings.proofreadRules || [];

  const updatedRules = globalRules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r));

  await updateGlobalSettings(envConfig, updatedRules);
}

async function removeGlobalRule(envConfig: EnvConfigType, ruleId: string): Promise<void> {
  const { settings } = useSettingsStore.getState();
  const globalRules = settings.globalViewSettings.proofreadRules || [];

  const filteredRules = globalRules.filter((r) => r.id !== ruleId);
  await updateGlobalSettings(envConfig, filteredRules);
}

async function updateGlobalSettings(
  envConfig: EnvConfigType,
  rules: ProofreadRule[],
): Promise<void> {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();

  const updatedSettings: SystemSettings = {
    ...settings,
    globalViewSettings: {
      ...settings.globalViewSettings,
      proofreadRules: rules,
    },
  };

  setSettings(updatedSettings);
  await saveSettings(envConfig, updatedSettings);
}

export function validateReplacementRulePattern(
  pattern: string,
  isRegex: boolean,
): { valid: boolean; error?: string } {
  if (!pattern?.trim()) {
    return { valid: false, error: 'Pattern cannot be empty' };
  }

  if (isRegex) {
    try {
      new RegExp(pattern);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid regex pattern',
      };
    }
  }

  return { valid: true };
}
