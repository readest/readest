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

function normalizePattern(
  pattern: string,
  isRegex: boolean,
  caseSensitive = true,
): NormalizedPattern {
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

// Apply multi-replacement to text nodes
function applyRuleToTextNodesMulti(
  textNodes: Text[],
  rule: ReplacementRule & { normalizedPattern: NormalizedPattern },
): void {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.normalizedPattern.source, rule.normalizedPattern.flags || 'g');
  } catch (_e) {
    return; // Invalid regex
  }

  for (const textNode of textNodes) {
    if (!textNode.textContent) continue;

    let text = textNode.textContent;
    const matches: { index: number; length: number }[] = [];

    let m;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;

      // For literal (non-regex) rules, ensure exact match
      if (!rule.isRegex) {
        const match = m[0];
        const pattern = rule.pattern;
        const isCaseSensitive = rule.caseSensitive !== false;
        const isMatch = isCaseSensitive
          ? match === pattern
          : match.toLowerCase() === pattern.toLowerCase();
        if (!isMatch) continue;
      }

      // Manual whole-word boundary check for Unicode patterns
      const hasUnicode = /[^\x00-\x7F]/.test(rule.pattern);
      if (hasUnicode) {
        const charBefore = text[start - 1] ?? '';
        const charAfter = text[start + m[0].length] ?? '';
        if (isUnicodeWordChar(charBefore) || isUnicodeWordChar(charAfter)) {
          continue;
        }
      }

      matches.push({ index: start, length: m[0].length });
    }

    // Apply replacements in reverse order to maintain indices
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      if (!match) continue;
      const { index, length } = match;
      const end = index + length;

      text = text.slice(0, index) + rule.replacement + text.slice(end);
    }

    // Update the text node with replaced content
    if (matches.length > 0) {
      textNode.textContent = text;
    }
  }
}

// Apply single-instance replacement to text nodes
function applyRuleToTextNodesSingle(
  textNodes: Text[],
  rule: ReplacementRule & { normalizedPattern: NormalizedPattern },
): void {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.normalizedPattern.source, rule.normalizedPattern.flags || 'g');
  } catch (_e) {
    return;
  }

  // Collect all matches across all text nodes
  const allMatches: { nodeIndex: number; matchIndex: number; length: number }[] = [];

  for (let nodeIdx = 0; nodeIdx < textNodes.length; nodeIdx++) {
    const textNode = textNodes[nodeIdx];
    if (!textNode || !textNode.textContent) continue;

    const text = textNode.textContent;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;

      // Case sensitive check for single-instance
      if (!rule.isRegex && m[0] !== rule.pattern) continue;

      // Unicode whole-word check
      const hasUnicode = /[^\x00-\x7F]/.test(rule.pattern);
      if (hasUnicode) {
        const charBefore = text[start - 1] ?? '';
        const charAfter = text[start + m[0].length] ?? '';
        if (isUnicodeWordChar(charBefore) || isUnicodeWordChar(charAfter)) {
          continue;
        }
      }

      allMatches.push({ nodeIndex: nodeIdx, matchIndex: start, length: m[0].length });
    }
  }

  // Apply replacement to the target occurrence
  const targetIndex = rule.occurrenceIndex ?? 0;
  const target = allMatches[targetIndex];
  if (!target) return;

  const textNode = textNodes[target.nodeIndex];
  if (!textNode || !textNode.textContent) return;

  const text = textNode.textContent;
  const newText =
    text.slice(0, target.matchIndex) +
    rule.replacement +
    text.slice(target.matchIndex + target.length);
  textNode.textContent = newText;
}

// DOM-Based Transformer function
export const replacementTransformer: Transformer = {
  name: 'replacement',

  transform: async (ctx) => {
    const globalRaw = useSettingsStore.getState().settings?.globalViewSettings?.replacementRules;
    const bookRaw = ctx.viewSettings.replacementRules;

    const merged = mergeReplacementRules(globalRaw, bookRaw);
    if (!merged || merged.length === 0) return ctx.content;

    const processed = merged
      .filter((r) => r.enabled && r.pattern.trim().length > 0)
      .map((r) => ({
        ...r,
        normalizedPattern: normalizePattern(r.pattern, r.isRegex, r.caseSensitive !== false),
      }));

    if (processed.length === 0) return ctx.content;

    // Parse HTML into DOM
    const parser = new DOMParser();
    const doc = parser.parseFromString(ctx.content, 'text/html');

    // Get all text nodes using TreeWalker
    const walker = document.createTreeWalker(
      doc.body || doc.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          // Skip script and style tags
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
          // Only accept nodes with actual text content
          return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      },
    );

    // Collect all text nodes
    const textNodes: Text[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode as Text);
    }

    // Separate rules by type
    const singleRules = processed.filter((r) => r.singleInstance);
    const bookRules = processed.filter((r) => !r.singleInstance && !r.global);
    const globalRules = processed.filter((r) => !r.singleInstance && r.global);

    const ordered = [...singleRules, ...bookRules, ...globalRules];

    // Apply replacements to text nodes
    for (const rule of ordered) {
      // Check section match for single-instance rules
      if (rule.singleInstance && rule.sectionHref) {
        const ruleBase = rule.sectionHref.split('#')[0];
        const ctxBase = ctx.sectionHref?.split('#')[0];
        if (ctxBase !== ruleBase) continue;
      }

      if (rule.singleInstance) {
        applyRuleToTextNodesSingle(textNodes, rule);
      } else {
        applyRuleToTextNodesMulti(textNodes, rule);
      }
    }

    // Serialize back to HTML
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  },
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
  bookRules: ReplacementRule[] | undefined,
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
  const updatedRules = existingRules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r));

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
  const updatedRules = globalRules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r));

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
