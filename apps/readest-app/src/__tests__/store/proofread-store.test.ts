import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { ViewSettings, ProofreadRule } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

// ---------------------------------------------------------------------------
// vi.hoisted — values available inside vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockViewSettingsMap,
  mockSaveConfig,
  mockSaveSettings,
  mockGlobalViewSettingsHolder,
  uidHolder,
} = vi.hoisted(() => ({
  mockViewSettingsMap: {} as Record<string, ViewSettings | null>,
  mockSaveConfig: vi.fn().mockResolvedValue(undefined),
  mockSaveSettings: vi.fn().mockResolvedValue(undefined),
  mockGlobalViewSettingsHolder: { current: {} as ViewSettings },
  uidHolder: { counter: 0 },
}));

// ---------------------------------------------------------------------------
// Mock peer stores
// ---------------------------------------------------------------------------

vi.mock('@/store/readerStore', async () => {
  const { create } = await import('zustand');
  return {
    useReaderStore: create(() => ({
      viewStates: {},
      getViewSettings: (bookKey: string) => mockViewSettingsMap[bookKey] ?? null,
      setViewSettings: vi.fn(
        (bookKey: string, vs: ViewSettings) => (mockViewSettingsMap[bookKey] = vs),
      ),
    })),
  };
});

vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');

  const store = create(() => ({
    settings: {} as SystemSettings,
    setSettings: vi.fn(),
    saveSettings: mockSaveSettings,
  }));

  // Dynamic getter so tests can mutate mockGlobalViewSettingsHolder between calls
  const origGetState = store.getState.bind(store);
  store.getState = () => {
    const s = origGetState();
    return {
      ...s,
      settings: {
        ...s.settings,
        globalViewSettings: mockGlobalViewSettingsHolder.current,
      },
    };
  };

  return { useSettingsStore: store };
});

vi.mock('@/store/bookDataStore', async () => {
  const { create } = await import('zustand');
  return {
    useBookDataStore: create(() => ({
      getConfig: vi.fn(() => ({ viewSettings: {} })),
      saveConfig: mockSaveConfig,
    })),
  };
});

// Mock uniqueId to produce predictable IDs
vi.mock('@/utils/misc', () => ({
  uniqueId: () => `uid-${++uidHolder.counter}`,
}));

// Transitive imports needed by readerStore's module
vi.mock('@/utils/toc', () => ({ updateToc: vi.fn() }));
vi.mock('@/utils/book', () => ({
  formatTitle: vi.fn((t: string) => t),
  getMetadataHash: vi.fn(() => 'hash'),
  getPrimaryLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/utils/path', () => ({ getBaseFilename: vi.fn((n: string) => n) }));
vi.mock('@/services/constants', () => ({ SUPPORTED_LANGNAMES: {} }));
vi.mock('@/libs/document', () => ({ DocumentLoader: vi.fn() }));
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return {
    useLibraryStore: create(() => ({
      library: [],
      setLibrary: vi.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { useProofreadStore, validateReplacementRulePattern } from '@/store/proofreadStore';

const envConfig = {
  getAppService: vi.fn(),
} as unknown as import('@/services/environment').EnvConfigType;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<ProofreadRule> = {}): ProofreadRule {
  return {
    id: 'r1',
    scope: 'book',
    pattern: 'foo',
    replacement: 'bar',
    isRegex: false,
    enabled: true,
    caseSensitive: true,
    order: 1000,
    wholeWord: true,
    onlyForTTS: false,
    ...overrides,
  };
}

function emptyViewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return { proofreadRules: [], ...overrides } as ViewSettings;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proofreadStore', () => {
  beforeEach(() => {
    uidHolder.counter = 0;
    Object.keys(mockViewSettingsMap).forEach((k) => delete mockViewSettingsMap[k]);
    mockGlobalViewSettingsHolder.current = emptyViewSettings();
    mockSaveConfig.mockClear();
    mockSaveSettings.mockClear();
  });

  // -----------------------------------------------------------------------
  // validateReplacementRulePattern
  // -----------------------------------------------------------------------
  describe('validateReplacementRulePattern', () => {
    test('empty pattern is invalid', () => {
      const result = validateReplacementRulePattern('', false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Pattern cannot be empty');
    });

    test('whitespace-only pattern is invalid', () => {
      const result = validateReplacementRulePattern('   ', false);
      expect(result.valid).toBe(false);
    });

    test('valid plain text pattern', () => {
      const result = validateReplacementRulePattern('hello', false);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('valid regex pattern', () => {
      const result = validateReplacementRulePattern('^foo\\d+$', true);
      expect(result.valid).toBe(true);
    });

    test('invalid regex returns error message', () => {
      const result = validateReplacementRulePattern('[invalid(', true);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.error!.length).toBeGreaterThan(0);
    });

    test('special regex characters in plain text mode are valid', () => {
      const result = validateReplacementRulePattern('[foo(bar', false);
      expect(result.valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // addRule – book scope
  // -----------------------------------------------------------------------
  describe('addRule (book scope)', () => {
    test('creates rule with correct defaults', async () => {
      mockViewSettingsMap['book1'] = emptyViewSettings();

      const rule = await useProofreadStore.getState().addRule(envConfig, 'book1', {
        scope: 'book',
        pattern: 'teh',
        replacement: 'the',
      });

      expect(rule.id).toBe('uid-1');
      expect(rule.scope).toBe('book');
      expect(rule.pattern).toBe('teh');
      expect(rule.replacement).toBe('the');
      expect(rule.isRegex).toBe(false);
      expect(rule.enabled).toBe(true);
      expect(rule.caseSensitive).toBe(true);
      expect(rule.order).toBe(1000);
      expect(rule.wholeWord).toBe(true);
      expect(rule.onlyForTTS).toBe(false);
    });

    test('handles all optional fields', async () => {
      mockViewSettingsMap['book1'] = emptyViewSettings();

      const rule = await useProofreadStore.getState().addRule(envConfig, 'book1', {
        scope: 'book',
        pattern: 'foo',
        replacement: 'bar',
        cfi: 'epubcfi(/6/4)',
        sectionHref: 'ch1.xhtml',
        isRegex: true,
        enabled: false,
        caseSensitive: false,
        order: 5,
        wholeWord: false,
        onlyForTTS: true,
      });

      expect(rule.cfi).toBe('epubcfi(/6/4)');
      expect(rule.sectionHref).toBe('ch1.xhtml');
      expect(rule.isRegex).toBe(true);
      expect(rule.enabled).toBe(false);
      expect(rule.caseSensitive).toBe(false);
      expect(rule.order).toBe(5);
      expect(rule.wholeWord).toBe(false);
      expect(rule.onlyForTTS).toBe(true);
    });

    test('persists via saveConfig', async () => {
      mockViewSettingsMap['book1'] = emptyViewSettings();

      await useProofreadStore.getState().addRule(envConfig, 'book1', {
        scope: 'book',
        pattern: 'x',
        replacement: 'y',
      });

      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // addRule – library (global) scope
  // -----------------------------------------------------------------------
  describe('addRule (library / global scope)', () => {
    test('creates global rule and saves settings', async () => {
      const rule = await useProofreadStore.getState().addRule(envConfig, 'book1', {
        scope: 'library',
        pattern: 'teh',
        replacement: 'the',
      });

      expect(rule.scope).toBe('library');
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // addRule – selection scope
  // -----------------------------------------------------------------------
  describe('addRule (selection scope)', () => {
    test('always adds new rule even with duplicate pattern', async () => {
      const existingRule = makeRule({ id: 'existing', scope: 'selection', pattern: 'dup' });
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: [existingRule] });

      await useProofreadStore.getState().addRule(envConfig, 'book1', {
        scope: 'selection',
        pattern: 'dup',
        replacement: 'new',
      });

      // Both rules should exist
      const rules = mockViewSettingsMap['book1']!.proofreadRules!;
      expect(rules.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // updateRule – book scope
  // -----------------------------------------------------------------------
  describe('updateRule (book scope)', () => {
    test('updates specific fields and preserves others', async () => {
      const rule = makeRule({ id: 'r1' });
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: [rule] });

      await useProofreadStore.getState().updateRule(envConfig, 'book1', 'r1', {
        replacement: 'baz',
        enabled: false,
      });

      const updated = mockViewSettingsMap['book1']!.proofreadRules!.find((r) => r.id === 'r1');
      expect(updated).toBeDefined();
      expect(updated!.replacement).toBe('baz');
      expect(updated!.enabled).toBe(false);
      // Preserved fields
      expect(updated!.pattern).toBe('foo');
      expect(updated!.isRegex).toBe(false);
      expect(updated!.order).toBe(1000);
    });
  });

  // -----------------------------------------------------------------------
  // updateRule – global scope
  // -----------------------------------------------------------------------
  describe('updateRule (library / global scope)', () => {
    test('updates global rule and saves settings', async () => {
      const globalRule = makeRule({ id: 'g1', scope: 'library' });
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: [globalRule],
      });

      await useProofreadStore.getState().updateRule(envConfig, 'book1', 'g1', {
        scope: 'library',
        replacement: 'updated',
      });

      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // removeRule – book scope
  // -----------------------------------------------------------------------
  describe('removeRule (book scope)', () => {
    test('removes rule by id', async () => {
      const rule = makeRule({ id: 'r1' });
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: [rule] });

      await useProofreadStore.getState().removeRule(envConfig, 'book1', 'r1', 'book');

      const rules = mockViewSettingsMap['book1']!.proofreadRules!;
      expect(rules.length).toBe(0);
    });

    test('does not remove unmatched rule', async () => {
      const rule = makeRule({ id: 'r1' });
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: [rule] });

      await useProofreadStore.getState().removeRule(envConfig, 'book1', 'no-match', 'book');

      const rules = mockViewSettingsMap['book1']!.proofreadRules!;
      expect(rules.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // removeRule – global scope
  // -----------------------------------------------------------------------
  describe('removeRule (library / global scope)', () => {
    test('removes global rule by id', async () => {
      const globalRule = makeRule({ id: 'g1', scope: 'library' });
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: [globalRule],
      });

      await useProofreadStore.getState().removeRule(envConfig, 'book1', 'g1', 'library');

      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // getGlobalRules / getBookRules
  // -----------------------------------------------------------------------
  describe('getGlobalRules', () => {
    test('returns correct rules from settings store', () => {
      const rules = [makeRule({ id: 'g1', scope: 'library' })];
      mockGlobalViewSettingsHolder.current = emptyViewSettings({ proofreadRules: rules });

      const result = useProofreadStore.getState().getGlobalRules();
      expect(result).toEqual(rules);
    });

    test('returns empty array when no rules', () => {
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: undefined,
      });

      const result = useProofreadStore.getState().getGlobalRules();
      expect(result).toEqual([]);
    });
  });

  describe('getBookRules', () => {
    test('returns correct rules from reader store', () => {
      const rules = [makeRule({ id: 'b1' })];
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: rules });

      const result = useProofreadStore.getState().getBookRules('book1');
      expect(result).toEqual(rules);
    });

    test('returns empty array when no view settings', () => {
      const result = useProofreadStore.getState().getBookRules('nonexistent');
      expect(result).toEqual([]);
    });

    test('returns empty array when proofreadRules is undefined', () => {
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: undefined });
      const result = useProofreadStore.getState().getBookRules('book1');
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getMergedRules
  // -----------------------------------------------------------------------
  describe('getMergedRules', () => {
    test('combines global and book rules', () => {
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: [makeRule({ id: 'g1', pattern: 'global', order: 10 })],
      });
      mockViewSettingsMap['book1'] = emptyViewSettings({
        proofreadRules: [makeRule({ id: 'b1', pattern: 'book', order: 20 })],
      });

      const merged = useProofreadStore.getState().getMergedRules('book1');
      expect(merged.length).toBe(2);
      expect(merged[0]!.id).toBe('g1');
      expect(merged[1]!.id).toBe('b1');
    });

    test('book rules with same id override global', () => {
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: [
          makeRule({ id: 'shared', pattern: 'global-pattern', replacement: 'global-repl' }),
        ],
      });
      mockViewSettingsMap['book1'] = emptyViewSettings({
        proofreadRules: [
          makeRule({ id: 'shared', pattern: 'book-pattern', replacement: 'book-repl' }),
        ],
      });

      const merged = useProofreadStore.getState().getMergedRules('book1');
      expect(merged.length).toBe(1);
      expect(merged[0]!.pattern).toBe('book-pattern');
      expect(merged[0]!.replacement).toBe('book-repl');
    });

    test('sorts by order', () => {
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: [makeRule({ id: 'g1', order: 500 })],
      });
      mockViewSettingsMap['book1'] = emptyViewSettings({
        proofreadRules: [makeRule({ id: 'b2', order: 100 }), makeRule({ id: 'b3', order: 900 })],
      });

      const merged = useProofreadStore.getState().getMergedRules('book1');
      expect(merged.map((r) => r.id)).toEqual(['b2', 'g1', 'b3']);
    });

    test('handles undefined rules gracefully', () => {
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: undefined,
      });
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: undefined });

      const merged = useProofreadStore.getState().getMergedRules('book1');
      expect(merged).toEqual([]);
    });

    test('handles missing book viewSettings gracefully', () => {
      mockGlobalViewSettingsHolder.current = emptyViewSettings({
        proofreadRules: [makeRule({ id: 'g1' })],
      });

      const merged = useProofreadStore.getState().getMergedRules('nonexistent');
      expect(merged.length).toBe(1);
      expect(merged[0]!.id).toBe('g1');
    });
  });

  // -----------------------------------------------------------------------
  // toggleRule
  // -----------------------------------------------------------------------
  describe('toggleRule', () => {
    test('toggles enabled state of a book rule', async () => {
      const rule = makeRule({ id: 'r1', enabled: true });
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: [rule] });

      await useProofreadStore.getState().toggleRule(envConfig, 'book1', 'r1');

      const updated = mockViewSettingsMap['book1']!.proofreadRules!.find((r) => r.id === 'r1');
      expect(updated!.enabled).toBe(false);
    });

    test('throws when rule not found', async () => {
      mockViewSettingsMap['book1'] = emptyViewSettings({ proofreadRules: [] });
      mockGlobalViewSettingsHolder.current = emptyViewSettings({ proofreadRules: [] });

      await expect(
        useProofreadStore.getState().toggleRule(envConfig, 'book1', 'no-exist'),
      ).rejects.toThrow('Rule not found: no-exist');
    });
  });
});
