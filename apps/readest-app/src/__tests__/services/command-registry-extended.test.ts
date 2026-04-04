import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock react-icons before importing the module under test
vi.mock('react-icons/ri', () => ({
  RiFontSize: () => null,
  RiDashboardLine: () => null,
  RiTranslate: () => null,
}));
vi.mock('react-icons/vsc', () => ({
  VscSymbolColor: () => null,
}));
vi.mock('react-icons/lia', () => ({
  LiaHandPointerSolid: () => null,
}));
vi.mock('react-icons/io5', () => ({
  IoAccessibilityOutline: () => null,
}));
vi.mock('react-icons/pi', () => ({
  PiRobot: () => null,
  PiSpeakerHigh: () => null,
  PiSun: () => null,
  PiMoon: () => null,
}));
vi.mock('react-icons/tb', () => ({
  TbSunMoon: () => null,
}));
vi.mock('react-icons/md', () => ({
  MdRefresh: () => null,
}));
vi.mock('react-icons', () => ({
  IconType: undefined,
}));

vi.mock('@/utils/misc', () => ({
  stubTranslation: (key: string) => key,
}));

import {
  buildCommandRegistry,
  searchCommands,
  groupResultsByCategory,
  getCategoryLabel,
  getRecentCommands,
  trackCommandUsage,
  CommandItem,
  CommandRegistryOptions,
  CommandCategory,
} from '@/services/commandRegistry';

function createMockOptions(
  overrides: Partial<CommandRegistryOptions> = {},
): CommandRegistryOptions {
  return {
    _: (key: string) => key,
    openSettingsPanel: vi.fn(),
    toggleTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleAlwaysOnTop: vi.fn(),
    toggleScreenWakeLock: vi.fn(),
    toggleAutoUpload: vi.fn(),
    reloadPage: vi.fn(),
    toggleOpenLastBooks: vi.fn(),
    showAbout: vi.fn(),
    toggleTelemetry: vi.fn(),
    isDesktop: false,
    ...overrides,
  };
}

describe('buildCommandRegistry', () => {
  it('should return an array of command items', () => {
    const items = buildCommandRegistry(createMockOptions());
    expect(items.length).toBeGreaterThan(0);
  });

  it('should include settings items from all panels', () => {
    const items = buildCommandRegistry(createMockOptions());
    const settingsItems = items.filter((i) => i.category === 'settings');
    expect(settingsItems.length).toBeGreaterThan(0);

    // Check that multiple panels are represented
    const panels = new Set(settingsItems.map((i) => i.panel));
    expect(panels.has('Font')).toBe(true);
    expect(panels.has('Layout')).toBe(true);
    expect(panels.has('Color')).toBe(true);
    expect(panels.has('Control')).toBe(true);
    expect(panels.has('Language')).toBe(true);
    expect(panels.has('Custom')).toBe(true);
  });

  it('should include action items', () => {
    const items = buildCommandRegistry(createMockOptions());
    const actionItems = items.filter((i) => i.category === 'actions');
    expect(actionItems.length).toBeGreaterThan(0);

    const actionIds = actionItems.map((i) => i.id);
    expect(actionIds).toContain('action.toggleTheme');
    expect(actionIds).toContain('action.fullscreen');
    expect(actionIds).toContain('action.reload');
    expect(actionIds).toContain('action.about');
    expect(actionIds).toContain('action.telemetry');
  });

  it('should use the provided translation function for localized labels', () => {
    const translate = (key: string) => `translated:${key}`;
    const items = buildCommandRegistry(createMockOptions({ _: translate }));
    const fontItem = items.find((i) => i.id === 'settings.font.defaultFontSize');
    expect(fontItem).toBeDefined();
    expect(fontItem!.localizedLabel).toBe('translated:Default Font Size');
  });

  it('should set panelLabel using translation function', () => {
    const translate = (key: string) => `t:${key}`;
    const items = buildCommandRegistry(createMockOptions({ _: translate }));

    const fontItem = items.find((i) => i.id === 'settings.font.defaultFontSize');
    expect(fontItem!.panelLabel).toBe('t:Font');

    // Control panel items use panelLabel 'Behavior'
    const controlItem = items.find((i) => i.id === 'settings.control.scrolledMode');
    expect(controlItem!.panelLabel).toBe('t:Behavior');
  });

  it('should call openSettingsPanel when settings item action is invoked', () => {
    const openSettingsPanel = vi.fn();
    const items = buildCommandRegistry(createMockOptions({ openSettingsPanel }));
    const fontItem = items.find((i) => i.id === 'settings.font.defaultFontSize')!;
    fontItem.action();
    expect(openSettingsPanel).toHaveBeenCalledWith('Font', 'settings.font.defaultFontSize');
  });

  it('should call correct action handler for action items', () => {
    const toggleTheme = vi.fn();
    const reloadPage = vi.fn();
    const items = buildCommandRegistry(createMockOptions({ toggleTheme, reloadPage }));

    items.find((i) => i.id === 'action.toggleTheme')!.action();
    expect(toggleTheme).toHaveBeenCalled();

    items.find((i) => i.id === 'action.reload')!.action();
    expect(reloadPage).toHaveBeenCalled();
  });

  it('should set isAvailable for desktop-only actions', () => {
    const items = buildCommandRegistry(createMockOptions({ isDesktop: false }));

    const fullscreen = items.find((i) => i.id === 'action.fullscreen')!;
    expect(fullscreen.isAvailable).toBeDefined();
    expect(fullscreen.isAvailable!()).toBe(false);

    const alwaysOnTop = items.find((i) => i.id === 'action.alwaysOnTop')!;
    expect(alwaysOnTop.isAvailable!()).toBe(false);

    const openLastBooks = items.find((i) => i.id === 'action.openLastBooks')!;
    expect(openLastBooks.isAvailable!()).toBe(false);
  });

  it('should report desktop-only actions as available on desktop', () => {
    const items = buildCommandRegistry(createMockOptions({ isDesktop: true }));

    const fullscreen = items.find((i) => i.id === 'action.fullscreen')!;
    expect(fullscreen.isAvailable!()).toBe(true);
  });

  it('should not set isAvailable for non-desktop-only actions', () => {
    const items = buildCommandRegistry(createMockOptions());
    const themeItem = items.find((i) => i.id === 'action.toggleTheme')!;
    expect(themeItem.isAvailable).toBeUndefined();
  });

  it('should have unique ids for all items', () => {
    const items = buildCommandRegistry(createMockOptions());
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should include AI panel items in non-production', () => {
    const items = buildCommandRegistry(createMockOptions());
    const aiItems = items.filter((i) => i.panel === 'AI');
    // In test environment (not production), AI items should be included
    expect(aiItems.length).toBeGreaterThan(0);
  });

  it('should give each settings item keywords and section', () => {
    const items = buildCommandRegistry(createMockOptions());
    const settingsItems = items.filter((i) => i.category === 'settings');
    for (const item of settingsItems) {
      expect(item.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('searchCommands', () => {
  let items: CommandItem[];

  beforeEach(() => {
    items = buildCommandRegistry(createMockOptions());
  });

  it('should return empty array for empty query', () => {
    expect(searchCommands('', items)).toEqual([]);
  });

  it('should return empty array for whitespace-only query', () => {
    expect(searchCommands('   ', items)).toEqual([]);
  });

  it('should find items matching the query', () => {
    const results = searchCommands('font', items);
    expect(results.length).toBeGreaterThan(0);
    // At least some results should be font-related
    const hasFontResult = results.some(
      (r) => r.item.id.includes('font') || r.item.labelKey.toLowerCase().includes('font'),
    );
    expect(hasFontResult).toBe(true);
  });

  it('should filter out unavailable items', () => {
    const itemsNonDesktop = buildCommandRegistry(createMockOptions({ isDesktop: false }));
    const results = searchCommands('fullscreen', itemsNonDesktop);
    // Fullscreen is desktop-only; should not appear when isDesktop is false
    const hasFullscreen = results.some((r) => r.item.id === 'action.fullscreen');
    expect(hasFullscreen).toBe(false);
  });

  it('should include available items', () => {
    const desktopItems = buildCommandRegistry(createMockOptions({ isDesktop: true }));
    const results = searchCommands('fullscreen', desktopItems);
    const hasFullscreen = results.some((r) => r.item.id === 'action.fullscreen');
    expect(hasFullscreen).toBe(true);
  });

  it('should return results with score and positions', () => {
    const results = searchCommands('reload', items);
    expect(results.length).toBeGreaterThan(0);
    const first = results[0]!;
    expect(typeof first.score).toBe('number');
    expect(first.positions).toBeDefined();
    expect(first.highlightIndices).toBeDefined();
  });

  it('should search across keywords', () => {
    const results = searchCommands('hyphen', items);
    expect(results.length).toBeGreaterThan(0);
    const hasHyphenation = results.some((r) => r.item.id === 'settings.layout.hyphenation');
    expect(hasHyphenation).toBe(true);
  });

  it('should search across panel label', () => {
    const results = searchCommands('Behavior', items);
    // Control panel items have panelLabel 'Behavior'
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('groupResultsByCategory', () => {
  let items: CommandItem[];

  beforeEach(() => {
    items = buildCommandRegistry(createMockOptions({ isDesktop: true }));
  });

  it('should group results by category', () => {
    const results = searchCommands('theme', items);
    const grouped = groupResultsByCategory(results);

    expect(grouped).toHaveProperty('settings');
    expect(grouped).toHaveProperty('actions');
    expect(grouped).toHaveProperty('navigation');

    // 'theme' should match both settings (Theme Mode under Color) and action (toggle theme)
    expect(grouped.settings.length).toBeGreaterThan(0);
    expect(grouped.actions.length).toBeGreaterThan(0);
  });

  it('should return empty arrays when no results', () => {
    const grouped = groupResultsByCategory([]);
    expect(grouped.settings).toEqual([]);
    expect(grouped.actions).toEqual([]);
    expect(grouped.navigation).toEqual([]);
  });

  it('should place all results into their correct category', () => {
    const results = searchCommands('font', items);
    const grouped = groupResultsByCategory(results);

    let totalGrouped = 0;
    totalGrouped += grouped.settings.length;
    totalGrouped += grouped.actions.length;
    totalGrouped += grouped.navigation.length;
    expect(totalGrouped).toBe(results.length);
  });
});

describe('getCategoryLabel', () => {
  const translate = (key: string) => `t:${key}`;

  it('should return translated label for settings', () => {
    expect(getCategoryLabel(translate, 'settings')).toBe('t:Settings');
  });

  it('should return translated label for actions', () => {
    expect(getCategoryLabel(translate, 'actions')).toBe('t:Actions');
  });

  it('should return translated label for navigation', () => {
    expect(getCategoryLabel(translate, 'navigation')).toBe('t:Navigation');
  });

  it('should return the category string for unknown category', () => {
    // Force an unknown category via type assertion
    const unknown = 'unknown' as CommandCategory;
    expect(getCategoryLabel(translate, unknown)).toBe('unknown');
  });
});

describe('getRecentCommands', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    // Set up a fresh localStorage mock
    const store: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const key of Object.keys(store)) {
          delete store[key];
        }
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((_index: number) => null),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  it('should return empty array when no recent commands stored', () => {
    const items = buildCommandRegistry(createMockOptions());
    expect(getRecentCommands(items)).toEqual([]);
  });

  it('should return matching recent commands', () => {
    const items = buildCommandRegistry(createMockOptions());
    localStorage.setItem('recentCommands', JSON.stringify(['action.reload', 'action.about']));

    const recent = getRecentCommands(items);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.id).toBe('action.reload');
    expect(recent[1]!.id).toBe('action.about');
  });

  it('should skip ids that do not exist in items', () => {
    const items = buildCommandRegistry(createMockOptions());
    localStorage.setItem('recentCommands', JSON.stringify(['nonexistent.item', 'action.reload']));

    const recent = getRecentCommands(items);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.id).toBe('action.reload');
  });

  it('should respect the limit parameter', () => {
    const items = buildCommandRegistry(createMockOptions());
    localStorage.setItem(
      'recentCommands',
      JSON.stringify(['action.reload', 'action.about', 'action.toggleTheme']),
    );

    const recent = getRecentCommands(items, 2);
    expect(recent).toHaveLength(2);
  });

  it('should use default limit of 5', () => {
    const items = buildCommandRegistry(createMockOptions());
    const ids = items.slice(0, 8).map((i) => i.id);
    localStorage.setItem('recentCommands', JSON.stringify(ids));

    const recent = getRecentCommands(items);
    expect(recent).toHaveLength(5);
  });

  it('should return empty array on invalid JSON', () => {
    const items = buildCommandRegistry(createMockOptions());
    localStorage.setItem('recentCommands', 'not-json');

    const recent = getRecentCommands(items);
    expect(recent).toEqual([]);
  });
});

describe('trackCommandUsage', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const key of Object.keys(store)) {
          delete store[key];
        }
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((_index: number) => null),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  it('should store a new command id', () => {
    trackCommandUsage('action.reload');
    const stored = JSON.parse(localStorage.getItem('recentCommands') ?? '[]') as string[];
    expect(stored).toContain('action.reload');
  });

  it('should move existing command to front', () => {
    localStorage.setItem('recentCommands', JSON.stringify(['action.about', 'action.reload']));

    trackCommandUsage('action.reload');
    const stored = JSON.parse(localStorage.getItem('recentCommands') ?? '[]') as string[];
    expect(stored[0]).toBe('action.reload');
    expect(stored[1]).toBe('action.about');
    // No duplicates
    expect(stored.filter((id) => id === 'action.reload')).toHaveLength(1);
  });

  it('should limit stored commands to 10', () => {
    const existingIds = Array.from({ length: 10 }, (_, i) => `cmd-${i}`);
    localStorage.setItem('recentCommands', JSON.stringify(existingIds));

    trackCommandUsage('new-cmd');
    const stored = JSON.parse(localStorage.getItem('recentCommands') ?? '[]') as string[];
    expect(stored).toHaveLength(10);
    expect(stored[0]).toBe('new-cmd');
    // Last item from the original list should have been dropped
    expect(stored).not.toContain('cmd-9');
  });

  it('should handle empty localStorage gracefully', () => {
    trackCommandUsage('action.reload');
    const stored = JSON.parse(localStorage.getItem('recentCommands') ?? '[]') as string[];
    expect(stored).toEqual(['action.reload']);
  });
});
