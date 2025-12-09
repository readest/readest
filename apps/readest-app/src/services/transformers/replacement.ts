// copilot generated
import type { Transformer } from './types';
import { ReplacementRule, ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { uniqueId } from '@/utils/misc';

/**
 * Replacement transformer that applies user-defined text replacement rules.
 * Supports both simple string replacements and regex patterns.
 * Rules are applied in order (by order field), with per-book rules taking precedence over global rules.
 */
export const replacementTransformer: Transformer = {
  name: 'replacement',

  transform: async (ctx) => {
    // Get merged rules (global + book rules)
    const globalRules = useSettingsStore.getState().settings?.globalViewSettings?.replacementRules;
    const bookRules = ctx.viewSettings.replacementRules;
    const replacementRules = mergeReplacementRules(globalRules, bookRules);
        
    
    // Log when transformer is called
    console.log('[REPLACEMENT] Transformer called!', {
      bookKey: ctx.bookKey,
      hasGlobalRules: !!globalRules,
      globalRuleCount: globalRules?.length || 0,
      hasBookRules: !!bookRules,
      bookRuleCount: bookRules?.length || 0,
      hasMergedRules: !!replacementRules,
      mergedRuleCount: replacementRules.length
    });
    
    // If no rules defined, return content unchanged
    if (!replacementRules || replacementRules.length === 0) {
      console.log('[REPLACEMENT] No rules defined, returning unchanged');
      return ctx.content;
    }

    // Filter enabled rules and sort by order
    const enabledRules = replacementRules
      .filter((rule) => rule.enabled)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (enabledRules.length === 0) {
      console.log('[REPLACEMENT] No enabled rules, returning unchanged');
      return ctx.content;
    }

    console.log('[REPLACEMENT] Applying', enabledRules.length, 'rules:', enabledRules.map(r => r.pattern));

    // Use direct string replacement to preserve XHTML structure
    let result = ctx.content;

    for (const rule of enabledRules) {
      try {
        // For single-instance rules, check section match
        if (rule.singleInstance && rule.sectionHref) {
          // Extract just the file path without fragment
          const ruleSectionBase = rule.sectionHref.split('#')[0] || rule.sectionHref;
          const ctxSectionBase = ctx.sectionHref?.split('#')[0] || ctx.sectionHref;
          
          const sectionMatch = ctxSectionBase && (
            ctxSectionBase === ruleSectionBase ||
            ctxSectionBase.includes(ruleSectionBase) ||
            ruleSectionBase.includes(ctxSectionBase) ||
            ctxSectionBase.endsWith(ruleSectionBase) ||
            ruleSectionBase.endsWith(ctxSectionBase)
          );
          
          if (!sectionMatch) {
            continue; // Skip - wrong section
          }
        }

        let pattern: string;
        if (rule.isRegex) {
          pattern = rule.pattern;
        } else {
          // Escape special regex characters for simple string matching
          pattern = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // For single-instance with occurrence tracking, replace only the Nth occurrence
        if (rule.singleInstance && typeof rule.occurrenceIndex === 'number') {
          const targetIndex = rule.occurrenceIndex;
          let currentIndex = 0;
          
          const regex = new RegExp(pattern, 'g');
          result = result.replace(regex, (match) => {
            if (currentIndex === targetIndex) {
              currentIndex++;
              return rule.replacement;
            }
            currentIndex++;
            return match;
          });
        } else {
          // For non-single-instance rules, use global replacement
          const flags = rule.singleInstance ? '' : 'g';
          
          try {
            const regex = new RegExp(pattern, flags);
            result = result.replace(regex, rule.replacement);
          } catch (regexError) {
            console.warn(`Invalid regex pattern in replacement rule "${rule.id}": ${rule.pattern}`, regexError);
            continue;
          }
        }
      } catch (error) {
        console.warn(`Error applying replacement rule "${rule.id}":`, error);
        continue;
      }
    }

    console.log('[REPLACEMENT] Transformation complete');

    return result;
  },
};

// ============================================================================
// Replacement Rules Management Functions
// ============================================================================

/**
 * Scope for applying replacement rules
 */
export type ReplacementRuleScope = 'single' | 'book' | 'global';

/**
 * Options for creating a replacement rule
 */
export interface CreateReplacementRuleOptions {
  pattern: string;
  replacement: string;
  isRegex?: boolean;
  enabled?: boolean;
  order?: number;
  singleInstance?: boolean; // If true, only replace the specific occurrence
  sectionHref?: string; // Section where the single-instance replacement applies
  occurrenceIndex?: number; // Which occurrence in the section (0-based)
}

/**
 * Creates a new replacement rule with default values
 */
export function createReplacementRule(options: CreateReplacementRuleOptions): ReplacementRule {
  const rule: ReplacementRule = {
    id: uniqueId(),
    pattern: options.pattern,
    replacement: options.replacement,
    isRegex: options.isRegex ?? false,
    enabled: options.enabled ?? true,
    order: options.order ?? 1000, // Default to high order (applied last)
    singleInstance: options.singleInstance ?? false,
  };
  
  // Add single-instance specific fields if provided
  if (options.sectionHref) {
    rule.sectionHref = options.sectionHref;
  }
  if (typeof options.occurrenceIndex === 'number') {
    rule.occurrenceIndex = options.occurrenceIndex;
  }
  
  return rule;
}

/**
 * Merges global and book-specific replacement rules.
 * Book rules take precedence over global rules.
 * Rules are sorted by order (lower numbers first).
 */
export function mergeReplacementRules(
  globalRules: ReplacementRule[] | undefined,
  bookRules: ReplacementRule[] | undefined,
): ReplacementRule[] {
  const global = globalRules || [];
  const book = bookRules || [];

  // Combine rules, with book rules taking precedence (by ID matching)
  const ruleMap = new Map<string, ReplacementRule>();

  // Add global rules first
  for (const rule of global) {
    ruleMap.set(rule.id, rule);
  }

  // Override with book rules (same ID means book rule wins)
  for (const rule of book) {
    ruleMap.set(rule.id, rule);
  }

  // Convert to array and sort by order
  const merged = Array.from(ruleMap.values());
  return merged.sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Gets all active replacement rules for a book (merged global + book rules)
 */
export function getMergedReplacementRules(bookKey: string): ReplacementRule[] {
  const { settings } = useSettingsStore.getState();
  const { getViewSettings } = useReaderStore.getState();
  const viewSettings = getViewSettings(bookKey);

  const globalRules = settings.globalViewSettings.replacementRules;
  const bookRules = viewSettings?.replacementRules;

  return mergeReplacementRules(globalRules, bookRules);
}

/**
 * Adds a replacement rule at the specified scope
 */
export async function addReplacementRule(
  envConfig: EnvConfigType,
  bookKey: string,
  options: CreateReplacementRuleOptions,
  scope: ReplacementRuleScope,
): Promise<ReplacementRule> {
  const rule = createReplacementRule(options);

  switch (scope) {
    case 'single':
      // Single-instance replacement: persisted in book config for refresh persistence
      await addReplacementRuleToBook(envConfig, bookKey, rule, true);
      break;
    case 'book':
      // Apply to entire book (persisted in book config)
      await addReplacementRuleToBook(envConfig, bookKey, rule, true);
      break;
    case 'global':
      // Apply globally to all books
      await addReplacementRuleToGlobal(envConfig, rule);
      break;
  }

  return rule;
}

/**
 * Adds a rule to a specific book's viewSettings
 */
async function addReplacementRuleToBook(
  envConfig: EnvConfigType,
  bookKey: string,
  rule: ReplacementRule,
  persist: boolean,
): Promise<void> {
  const { getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const { settings } = useSettingsStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) {
    throw new Error(`No viewSettings found for book: ${bookKey}`);
  }

  // Get existing book rules
  const existingRules = viewSettings.replacementRules || [];
  
  if (rule.singleInstance) {
    // Single-instance rules: ALWAYS create new rule (each has unique ID)
    // Don't try to merge - after DOM modifications, occurrence indices shift
    // and we can't reliably detect duplicates
    existingRules.push(rule);
  } else {
    // Non-single-instance: check if same pattern exists to avoid duplicates
    const existingRule = existingRules.find(
      (r) => r.pattern === rule.pattern && r.isRegex === rule.isRegex && !r.singleInstance,
    );

    if (existingRule) {
      // Update existing rule
      existingRule.replacement = rule.replacement;
      existingRule.enabled = rule.enabled;
      existingRule.order = rule.order;
    } else {
      // Add new rule
      existingRules.push(rule);
    }
  }

  // Update viewSettings
  const updatedViewSettings: ViewSettings = {
    ...viewSettings,
    replacementRules: existingRules,
  };

  setViewSettings(bookKey, updatedViewSettings);

  // Persist if requested
  if (persist) {
    const config = getConfig(bookKey);
    if (config) {
      const updatedConfig = {
        ...config,
        viewSettings: updatedViewSettings,
        updatedAt: Date.now(),
      };
      await saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  }
}

/**
 * Adds a rule to global viewSettings
 */
async function addReplacementRuleToGlobal(
  envConfig: EnvConfigType,
  rule: ReplacementRule,
): Promise<void> {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();

  const globalRules = settings.globalViewSettings.replacementRules || [];

  // Check if rule with same pattern already exists
  const existingRule = globalRules.find(
    (r) => r.pattern === rule.pattern && r.isRegex === rule.isRegex,
  );

  if (existingRule) {
    // Update existing rule
    existingRule.replacement = rule.replacement;
    existingRule.enabled = rule.enabled;
    existingRule.order = rule.order;
  } else {
    // Add new rule
    globalRules.push(rule);
  }

  // Update global settings
  const updatedSettings: SystemSettings = {
    ...settings,
    globalViewSettings: {
      ...settings.globalViewSettings,
      replacementRules: globalRules,
    },
  };

  setSettings(updatedSettings);
  await saveSettings(envConfig, updatedSettings);
}

/**
 * Removes a replacement rule by ID
 */
export async function removeReplacementRule(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
  scope: ReplacementRuleScope,
): Promise<void> {
  switch (scope) {
    case 'single':
    case 'book':
      await removeReplacementRuleFromBook(envConfig, bookKey, ruleId, scope === 'book');
      break;
    case 'global':
      await removeReplacementRuleFromGlobal(envConfig, ruleId);
      break;
  }
}

/**
 * Removes a rule from a book's viewSettings
 */
async function removeReplacementRuleFromBook(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
  persist: boolean,
): Promise<void> {
  const { getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const { settings } = useSettingsStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) {
    throw new Error(`No viewSettings found for book: ${bookKey}`);
  }

  const existingRules = viewSettings.replacementRules || [];
  const filteredRules = existingRules.filter((r) => r.id !== ruleId);

  const updatedViewSettings: ViewSettings = {
    ...viewSettings,
    replacementRules: filteredRules,
  };

  setViewSettings(bookKey, updatedViewSettings);

  if (persist) {
    const config = getConfig(bookKey);
    if (config) {
      const updatedConfig = {
        ...config,
        viewSettings: updatedViewSettings,
        updatedAt: Date.now(),
      };
      await saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  }
}

/**
 * Removes a rule from global viewSettings
 */
async function removeReplacementRuleFromGlobal(
  envConfig: EnvConfigType,
  ruleId: string,
): Promise<void> {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();

  const globalRules = settings.globalViewSettings.replacementRules || [];
  const filteredRules = globalRules.filter((r) => r.id !== ruleId);

  const updatedSettings: SystemSettings = {
    ...settings,
    globalViewSettings: {
      ...settings.globalViewSettings,
      replacementRules: filteredRules,
    },
  };

  setSettings(updatedSettings);
  await saveSettings(envConfig, updatedSettings);
}

/**
 * Updates an existing replacement rule
 */
export async function updateReplacementRule(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
  updates: Partial<Omit<ReplacementRule, 'id'>>,
  scope: ReplacementRuleScope,
): Promise<void> {
  switch (scope) {
    case 'single':
    case 'book':
      await updateReplacementRuleInBook(envConfig, bookKey, ruleId, updates, scope === 'book');
      break;
    case 'global':
      await updateReplacementRuleInGlobal(envConfig, ruleId, updates);
      break;
  }
}

/**
 * Updates a rule in a book's viewSettings
 */
async function updateReplacementRuleInBook(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
  updates: Partial<Omit<ReplacementRule, 'id'>>,
  persist: boolean,
): Promise<void> {
  const { getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const { settings } = useSettingsStore.getState();

  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) {
    throw new Error(`No viewSettings found for book: ${bookKey}`);
  }

  const existingRules = viewSettings.replacementRules || [];
  const updatedRules = existingRules.map((r) =>
    r.id === ruleId ? { ...r, ...updates } : r,
  );

  const updatedViewSettings: ViewSettings = {
    ...viewSettings,
    replacementRules: updatedRules,
  };

  setViewSettings(bookKey, updatedViewSettings);

  if (persist) {
    const config = getConfig(bookKey);
    if (config) {
      const updatedConfig = {
        ...config,
        viewSettings: updatedViewSettings,
        updatedAt: Date.now(),
      };
      await saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  }
}

/**
 * Updates a rule in global viewSettings
 */
async function updateReplacementRuleInGlobal(
  envConfig: EnvConfigType,
  ruleId: string,
  updates: Partial<Omit<ReplacementRule, 'id'>>,
): Promise<void> {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();

  const globalRules = settings.globalViewSettings.replacementRules || [];
  const updatedRules = globalRules.map((r) =>
    r.id === ruleId ? { ...r, ...updates } : r,
  );

  const updatedSettings: SystemSettings = {
    ...settings,
    globalViewSettings: {
      ...settings.globalViewSettings,
      replacementRules: updatedRules,
    },
  };

  setSettings(updatedSettings);
  await saveSettings(envConfig, updatedSettings);
}

/**
 * Toggles a rule's enabled state
 */
export async function toggleReplacementRule(
  envConfig: EnvConfigType,
  bookKey: string,
  ruleId: string,
  scope: ReplacementRuleScope,
): Promise<void> {
  const mergedRules = getMergedReplacementRules(bookKey);
  const rule = mergedRules.find((r) => r.id === ruleId);

  if (!rule) {
    throw new Error(`Rule not found: ${ruleId}`);
  }

  await updateReplacementRule(envConfig, bookKey, ruleId, { enabled: !rule.enabled }, scope);
}

/**
 * Validates a replacement rule pattern
 */
export function validateReplacementRulePattern(
  pattern: string,
  isRegex: boolean,
): { valid: boolean; error?: string } {
  if (!pattern || pattern.trim().length === 0) {
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