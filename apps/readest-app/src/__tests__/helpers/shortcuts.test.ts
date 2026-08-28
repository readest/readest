import { beforeEach, describe, it, expect, vi } from 'vitest';

const getModule = async () => {
  return await import('../../helpers/shortcuts');
};

const getDefaults = async () => {
  const mod = await getModule();
  return mod.loadShortcuts();
};

beforeEach(() => {
  localStorage.clear();
});

describe('Shortcut entry structure', () => {
  it('each shortcut entry has keys, description, and section', async () => {
    const shortcuts = await getDefaults();
    for (const [name, entry] of Object.entries(shortcuts)) {
      expect(entry, `${name} should have keys array`).toHaveProperty('keys');
      expect(Array.isArray(entry.keys), `${name}.keys should be an array`).toBe(true);
      expect(entry, `${name} should have description`).toHaveProperty('description');
      expect(typeof entry.description, `${name}.description should be a string`).toBe('string');
      expect(entry, `${name} should have section`).toHaveProperty('section');
    }
  });
});

describe('TTS play/pause shortcut', () => {
  it('should have onTTSPlayPause shortcut with space', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSPlayPause.keys).toEqual([' ']);
  });

  it('should also have space in onGoRight as fallback', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onGoRight.keys).toContain(' ');
  });
});

describe('TTS navigation shortcuts', () => {
  it('should have onTTSGoNextSentence shortcut with ctrl+] and cmd+]', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoNextSentence.keys).toEqual(['ctrl+]', 'cmd+]']);
  });

  it('should have onTTSGoPreviousSentence shortcut with ctrl+[ and cmd+[', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoPreviousSentence.keys).toEqual(['ctrl+[', 'cmd+[']);
  });

  it('should have onTTSGoNextParagraph shortcut with ctrl+shift+} and cmd+shift+}', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoNextParagraph.keys).toEqual(['ctrl+shift+}', 'cmd+shift+}']);
  });

  it('should have onTTSGoPreviousParagraph shortcut with ctrl+shift+{ and cmd+shift+{', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoPreviousParagraph.keys).toEqual(['ctrl+shift+{', 'cmd+shift+{']);
  });
});

describe('Book start/end shortcuts (#5660)', () => {
  it('binds Home to the start of the book and End to the end of the book', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onGoBookStart.keys).toEqual(['Home']);
    expect(shortcuts.onGoBookEnd.keys).toEqual(['End']);
  });

  it('lists both under Navigation so they show up in the shortcuts help', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onGoBookStart.section).toBe('Navigation');
    expect(shortcuts.onGoBookEnd.section).toBe('Navigation');
  });
});

describe('Proofread selection shortcut (#4717)', () => {
  it('binds alt+p alongside ctrl+p/cmd+p so it avoids the print conflict', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onProofreadSelection.keys).toContain('alt+p');
    expect(shortcuts.onProofreadSelection.keys).toEqual(['ctrl+p', 'cmd+p', 'alt+p']);
  });
});

describe('No identical keybinding lists across actions (#3675)', () => {
  // Pre-existing pairs where two actions intentionally share the exact
  // same key list — both handlers guard on runtime context.
  // TODO: consider giving these distinct bindings to avoid the same
  // class of bug as #3675.
  const KNOWN_PAIRS: ReadonlySet<string> = new Set([
    'onSearchSelection,onShowSearchBar', // ctrl+f / cmd+f
  ]);

  it('should not have two actions with exactly the same key list', async () => {
    const shortcuts = await getDefaults();
    const keyListToActions = new Map<string, string[]>();
    for (const [name, entry] of Object.entries(shortcuts)) {
      const id = [...entry.keys].sort().join(',').toLowerCase();
      const actions = keyListToActions.get(id) ?? [];
      actions.push(name);
      keyListToActions.set(id, actions);
    }
    const duplicates: string[] = [];
    for (const [keys, actions] of keyListToActions) {
      if (actions.length > 1) {
        const pairId = [...actions].sort().join(',');
        if (!KNOWN_PAIRS.has(pairId)) {
          duplicates.push(`[${keys}] is shared by: ${actions.join(', ')}`);
        }
      }
    }
    expect(
      duplicates,
      `Actions with identical keybinding lists:\n${duplicates.join('\n')}`,
    ).toEqual([]);
  });
});

describe('getShortcutsForDisplay', () => {
  it('returns sections in the correct order', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(true);
    const sectionNames = result.map((s) => s.section);
    expect(sectionNames).toEqual([
      'General',
      'Navigation',
      'Text to Speech',
      'Selection',
      'Zoom',
      'Window',
      'Notes',
    ]);
  });

  it('assigns every action to a visible section', async () => {
    const mod = await getModule();
    const shortcuts = mod.loadShortcuts();
    const hiddenEntries = Object.values(shortcuts).filter((e) => e.section === '');
    expect(hiddenEntries).toEqual([]);
  });

  it('each item has a description and non-empty keys', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(false);
    for (const section of result) {
      for (const item of section.items) {
        expect(item.description.length).toBeGreaterThan(0);
        expect(item.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('on Mac, returns cmd-prefixed keys for onShowSearchBar', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(true);
    const general = result.find((s) => s.section === 'General');
    const searchItem = general?.items.find((i) =>
      i.keys.some((k) => k.includes('cmd') || k.includes('f')),
    );
    expect(searchItem).toBeDefined();
    expect(searchItem!.keys.some((k) => k.includes('cmd'))).toBe(true);
    expect(searchItem!.keys.some((k) => k.includes('ctrl'))).toBe(false);
  });

  it('on non-Mac, returns ctrl-prefixed keys for onShowSearchBar', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(false);
    const general = result.find((s) => s.section === 'General');
    const searchItem = general?.items.find((i) =>
      i.keys.some((k) => k.includes('ctrl') || k.includes('f')),
    );
    expect(searchItem).toBeDefined();
    expect(searchItem!.keys.some((k) => k.includes('ctrl'))).toBe(true);
    expect(searchItem!.keys.some((k) => k.includes('cmd'))).toBe(false);
  });
});

describe('shortcut customization', () => {
  it('loads, reassigns, resets, persists, and notifies safely', async () => {
    localStorage.setItem('customShortcuts', '{not-json');
    const mod = await getModule();
    const initial = mod.loadShortcuts();
    expect(initial.onToggleSideBar.keys).toEqual(['s']);

    const listener = vi.fn();
    window.addEventListener('shortcutUpdate', listener);

    const updated = mod.setShortcutBinding(initial, 'onToggleNotebook', 's');
    mod.saveShortcuts(updated);

    expect(initial.onToggleSideBar.keys).toEqual(['s']);
    expect(updated.onToggleSideBar.keys).toEqual([]);
    expect(updated.onToggleNotebook.keys).toEqual(['s']);
    expect(JSON.parse(localStorage.getItem('customShortcuts')!)).toEqual({
      onToggleSideBar: [],
      onToggleNotebook: ['s'],
    });
    expect(listener).toHaveBeenCalledOnce();

    const reset = mod.resetShortcutBinding(updated, 'onToggleSideBar');
    expect(reset.onToggleSideBar.keys).toEqual(['s']);
    expect(reset.onToggleNotebook.keys).toEqual([]);

    window.removeEventListener('shortcutUpdate', listener);
  });
});

describe('Default bindings that always fire', () => {
  // useBookShortcuts registers one action map, and useShortcuts stops at the
  // first action whose handler does not return `false`. Actions listed here
  // never decline, so a binding claimed by an earlier one can never reach a
  // later one — the Shortcuts settings page would advertise a dead key.
  // Order mirrors the useShortcuts({...}) call in useBookShortcuts.ts.
  const ALWAYS_FIRING_IN_ORDER = [
    'onSwitchSideBar',
    'onToggleSideBar',
    'onToggleNotebook',
    'onToggleScrollMode',
    'onToggleBookmark',
    'onStartRSVP',
    'onToggleAutoScroll',
    'onOpenFontLayoutSettings',
    'onShowSearchBar',
    'onToggleTTS',
    'onTTSGoNextSentence',
    'onTTSGoPreviousSentence',
    'onTTSGoNextParagraph',
    'onTTSGoPreviousParagraph',
    'onTTSHighlightSentence',
    'onReloadPage',
    'onGoLeft',
    'onGoRight',
    'onGoPrev',
    'onGoNext',
    'onGoHalfPageDown',
    'onGoHalfPageUp',
    'onGoPrevSection',
    'onGoNextSection',
    'onGoLeftSection',
    'onGoRightSection',
    'onGoBookStart',
    'onGoBookEnd',
    'onGoBack',
    'onGoForward',
    'onZoomIn',
    'onZoomOut',
    'onResetZoom',
  ] as const;

  it('no action shadows a later one', async () => {
    const { normalizeShortcut } = await import('../../utils/shortcutKeys');
    const shortcuts = await getDefaults();
    const claimedBy = new Map<string, string>();
    const shadowed: string[] = [];
    for (const action of ALWAYS_FIRING_IN_ORDER) {
      for (const key of shortcuts[action].keys) {
        const normalized = normalizeShortcut(key);
        const owner = claimedBy.get(normalized);
        // Within one action, `alt+X`/`opt+X` are deliberate platform aliases
        // that normalize to the same binding — only cross-action collisions
        // shadow anything.
        if (owner && owner !== action) {
          shadowed.push(`${action} '${key}' is already claimed by ${owner}`);
        } else if (!owner) {
          claimedBy.set(normalized, action);
        }
      }
    }
    expect(shadowed).toEqual([]);
  });
});

describe('macOS command bindings', () => {
  it('offers a cmd variant wherever a ctrl-only binding would be shown on Mac', async () => {
    const { filterPlatformKeys } = await import('../../utils/shortcutKeys');
    const shortcuts = await getDefaults();
    const ctrlOnlyOnMac: string[] = [];
    for (const [action, entry] of Object.entries(shortcuts)) {
      const macKeys = filterPlatformKeys(entry.keys, true);
      if (macKeys.length && macKeys.every((key) => /(^|\+)ctrl\+/.test(key.toLowerCase()))) {
        ctrlOnlyOnMac.push(action);
      }
    }
    expect(ctrlOnlyOnMac).toEqual([]);
  });
});
