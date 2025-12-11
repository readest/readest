// used copilot for assistance
import type { Transformer } from './types';
import { ReplacementRule, ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { uniqueId } from '@/utils/misc';


// Whole-word enforcement for ALL rules (literal OR regex)
// Case-sensitive, with Unicode-aware boundaries for non-ASCII patterns
interface NormalizedPattern {
  source: string;
  flags: string;
}

// Check if a character is a Unicode word character (letter, number, or underscore)
function isUnicodeWordChar(char: string): boolean {
  if (!char) return false;
  return /[\p{L}\p{N}_]/u.test(char);
}

function normalizePattern(pattern: string, isRegex: boolean, caseSensitive = true): NormalizedPattern {
  const hasUnicode = /[^\x00-\x7F]/.test(pattern);

  let flags = '';
  if (hasUnicode) flags += 'u';
  flags += 'g';
  if (!caseSensitive) flags += 'i';

  if (isRegex) {
    // Do NOT escape regex patterns; just add boundaries if missing
    if (pattern.includes('\\b')) {
      return { source: pattern, flags };
    }
    // For regex patterns, use \b for ASCII (works well)
    // For Unicode, we'll rely on manual boundary checking in the matching functions
    const source = hasUnicode
      ? pattern // Don't add boundaries for Unicode regex - will check manually
      : `\\b${pattern}\\b`;
    return { source, flags };
  }

  // Escape literals
  const escaped = pattern.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  
  // Check if pattern has punctuation at start or end
  const startsWithPunctuation = /^[^\w\s]/.test(pattern);
  const endsWithPunctuation = /[^\w\s]$/.test(pattern);
  const hasBoundaryPunctuation = startsWithPunctuation || endsWithPunctuation;
  
  // For ASCII patterns with boundary punctuation, add boundaries only around the word part
  // For patterns without boundary punctuation, add boundaries around the whole pattern
  // For Unicode patterns, we'll check boundaries manually
  let source: string;
  if (hasUnicode) {
    // Don't add boundaries for Unicode - will check manually
    source = escaped;
  } else if (hasBoundaryPunctuation) {
    // For patterns like "scholar;" or "'tis", find the word part and add boundaries only around it
    const wordMatch = pattern.match(/[\w]+/);
    if (!wordMatch || !wordMatch[0]) {
      // No word characters found, just use escaped pattern without boundaries
      source = escaped;
    } else {
      const wordPart = wordMatch[0];
      const wordStart = pattern.indexOf(wordPart);
      const wordEnd = wordStart + wordPart.length;
      
      // Escape the word part separately
      const wordEscaped = wordPart.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
      
      // Build the pattern: [before punctuation][word boundary][word][word boundary][after punctuation]
      const beforeWord = escaped.substring(0, wordStart);
      const afterWord = escaped.substring(wordEnd);
      source = `${beforeWord}\\b${wordEscaped}\\b${afterWord}`;
    }
  } else {
    // No boundary punctuation - add boundaries around the whole pattern
    source = `\\b${escaped}\\b`;
  }
  
  return { source, flags };
}

// HTML attribute / tag safety
// Prevent replacement inside <tag attr="..."> and inside the tag name
function isInsideHTMLTag(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? '';
  const after = text[end] ?? '';
  if (before === '<') return true;
  if (after === '>') return true;
  return false;
}

// Checks if a position is inside <script>...</script> or <style>...</style>
function isInsideScriptOrStyle(text: string, index: number): boolean {
  const lower = text.toLowerCase();
  const lastScriptOpen = lower.lastIndexOf('<script', index);
  const lastScriptClose = lower.lastIndexOf('</script', index);
  if (lastScriptOpen !== -1 && lastScriptOpen > lastScriptClose) return true;

  const lastStyleOpen = lower.lastIndexOf('<style', index);
  const lastStyleClose = lower.lastIndexOf('</style', index);
  if (lastStyleOpen !== -1 && lastStyleOpen > lastStyleClose) return true;

  return false;
}


// Replacement region tracking: prevents re-matching replacement output
interface Region { start: number; end: number; }

function isInReplacedRegion(start: number, end: number, regions: Region[]): boolean {
  return regions.some(r => start < r.end && end > r.start);
}

function shiftRegionsAfterReplacement(
  regions: Region[],
  replaceStart: number,
  replaceEnd: number,
  replacementLength: number
) {
  const diff = replacementLength - (replaceEnd - replaceStart);

  for (const r of regions) {
    if (r.start >= replaceEnd) {
      r.start += diff;
      r.end += diff;
    }
  }
}


// Multi-replacement (all occurrences except inside HTML tags/attributes)
function applyMultiReplacement(
  text: string,
  rule: ReplacementRule & { normalizedPattern: NormalizedPattern },
  replacedRegions: Region[]
): string {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.normalizedPattern.source, rule.normalizedPattern.flags || 'g');
  } catch (_e) {
    // Invalid regex; skip this rule
    return text;
  }

  const matches: { index: number; length: number }[] = [];

  let m;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    // For literal (non-regex) rules, ensure the matched string exactly equals the pattern.
    // If caseSensitive is false, compare in lowercase. If true or unspecified, compare literally.
    if (!rule.isRegex) {
      const match = m[0];
      const pattern = rule.pattern;

      const isCaseSensitive = rule.caseSensitive !== false;

      const isMatch = isCaseSensitive
        ? match === pattern
        : match.toLowerCase() === pattern.toLowerCase();

      if (!isMatch) continue;
    }


    if (isInsideHTMLTag(text, start, end)) continue;
    if (isInsideScriptOrStyle(text, start)) continue;
    if (isInReplacedRegion(start, end, replacedRegions)) continue;

    // Manual whole-word boundary check for Unicode patterns
    const hasUnicode = /[^\x00-\x7F]/.test(rule.pattern);
    if (hasUnicode) {
      const charBefore = text[start - 1] ?? '';
      const charAfter = text[end] ?? '';
      if (isUnicodeWordChar(charBefore) || isUnicodeWordChar(charAfter)) {
        continue; // Not a whole word
      }
    }

    matches.push({ index: start, length: m[0].length });
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (!match) continue;
    const { index, length } = match;
    const end = index + length;

    shiftRegionsAfterReplacement(replacedRegions, index, end, rule.replacement.length);

    text = text.slice(0, index) + rule.replacement + text.slice(end);

    replacedRegions.push({ start: index, end: index + rule.replacement.length });
  }

  return text;
}


// Single-instance replacement (Nth occurrence only)
function applySingleInstance(
  text: string,
  pattern: NormalizedPattern,
  replacement: string,
  occurrenceIndex: number | undefined,
  replacedRegions: Region[],
  isRegex: boolean,
  rawPattern: string
): string {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern.source, pattern.flags || 'g');
  } catch (_e) {
    return text;
  }

  const matches: { start: number; end: number }[] = [];

  let m;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    
    // Case sensitive by default for single-instance replacements
    if (!isRegex && m[0] !== rawPattern) continue;
    if (isInsideHTMLTag(text, start, end)) continue;
    if (isInsideScriptOrStyle(text, start)) continue;
    if (isInReplacedRegion(start, end, replacedRegions)) continue;

    // Manual whole-word boundary check for Unicode patterns
    const hasUnicode = /[^\x00-\x7F]/.test(rawPattern);
    if (hasUnicode) {
      const charBefore = text[start - 1] ?? '';
      const charAfter = text[end] ?? '';
      if (isUnicodeWordChar(charBefore) || isUnicodeWordChar(charAfter)) {
        continue; // Not a whole word
      }
    }

    matches.push({ start, end });
  }

  const targetIndex = occurrenceIndex ?? 0;
  const target = matches[targetIndex];
  if (!target) return text;

  shiftRegionsAfterReplacement(replacedRegions, target.start, target.end, replacement.length);

  text = text.slice(0, target.start) + replacement + text.slice(target.end);

  replacedRegions.push({ start: target.start, end: target.start + replacement.length });

  return text;
}


// Transformer
export const replacementTransformer: Transformer = {
  name: 'replacement',

  transform: async (ctx) => {
    const globalRaw = useSettingsStore.getState().settings?.globalViewSettings?.replacementRules;
    const bookRaw = ctx.viewSettings.replacementRules;

    const merged = mergeReplacementRules(globalRaw, bookRaw);
    if (!merged || merged.length === 0) return ctx.content;

    const processed = merged
      .filter(r => r.enabled && r.pattern.trim().length > 0)
      .map(r => ({
        ...r,
        normalizedPattern: normalizePattern(r.pattern, r.isRegex, r.caseSensitive !== false)
      }));

    if (processed.length === 0) return ctx.content;

    const singleRules = processed.filter(r => r.singleInstance);
    const bookRules = processed.filter(r => !r.singleInstance && !r.global);
    const globalRules = processed.filter(r => !r.singleInstance && r.global);

    const ordered = [
      ...singleRules,
      ...bookRules,
      ...globalRules,
    ];

    let text = ctx.content;
    const replacedRegions: Region[] = [];

    for (const rule of ordered) {
      if (rule.singleInstance && rule.sectionHref) {
        const ruleBase = rule.sectionHref.split('#')[0];
        const ctxBase = ctx.sectionHref?.split('#')[0];
        if (ctxBase !== ruleBase) continue;
      }

      if (rule.singleInstance) {
        text = applySingleInstance(
          text,
          rule.normalizedPattern,
          rule.replacement,
          rule.occurrenceIndex,
          replacedRegions,
          rule.isRegex,
          rule.pattern
        );
      } else {
        text = applyMultiReplacement(
          text,
          rule,
          replacedRegions
        );
      }
    }

    return text;
  }
};


// Rule management 
export type ReplacementRuleScope = 'single' | 'book' | 'global';

export interface CreateReplacementRuleOptions {
  pattern: string;
  replacement: string;
  isRegex?: boolean;
  enabled?: boolean;
  caseSensitive?: boolean;
  order?: number;
  singleInstance?: boolean;
  sectionHref?: string;
  occurrenceIndex?: number;
  wholeWord?: boolean;
  global?: boolean;
}

export function createReplacementRule(opts: CreateReplacementRuleOptions): ReplacementRule {
  return {
    id: uniqueId(),
    pattern: opts.pattern,
    replacement: opts.replacement,
    isRegex: opts.isRegex ?? false,
    enabled: opts.enabled ?? true,
    caseSensitive: opts.caseSensitive ?? true,
    order: opts.order ?? 1000,
    singleInstance: opts.singleInstance ?? false,
    wholeWord: opts.wholeWord ?? true,
    sectionHref: opts.sectionHref,
    occurrenceIndex: opts.occurrenceIndex,
    global: opts.global ?? false,
  };
}

export function mergeReplacementRules(
  globalRules: ReplacementRule[] | undefined,
  bookRules: ReplacementRule[] | undefined
): ReplacementRule[] {
  const map = new Map<string, ReplacementRule>();

  for (const g of globalRules ?? []) map.set(g.id, g);
  for (const b of bookRules ?? []) map.set(b.id, b);

  return [...map.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
      // Single-instance rules are persisted in book config
      await removeReplacementRuleFromBook(envConfig, bookKey, ruleId, true);
      break;
    case 'book':
      // Book-wide rules are persisted in book config
      await removeReplacementRuleFromBook(envConfig, bookKey, ruleId, true);
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
      // Single-instance rules are persisted in book config
      await updateReplacementRuleInBook(envConfig, bookKey, ruleId, updates, true);
      break;
    case 'book':
      // Book-wide rules are persisted in book config
      await updateReplacementRuleInBook(envConfig, bookKey, ruleId, updates, true);
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