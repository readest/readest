import { describe, it, expect } from 'vitest';

const getModule = async () => {
  return await import('../../helpers/shortcuts');
};

const getDefaults = async () => {
  const mod = await getModule();
  return mod.loadShortcuts();
};

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

describe('No identical keybinding lists across actions (#3675)', () => {
  // Pre-existing pairs where two actions intentionally share the exact
  // same key list — both handlers guard on runtime context.
  // TODO: consider giving these distinct bindings to avoid the same
  // class of bug as #3675.
  const KNOWN_PAIRS: ReadonlySet<string> = new Set([
    'onSearchSelection,onShowSearchBar', // ctrl+f / cmd+f
    'onCloseWindow,onWikipediaSelection', // ctrl+w / cmd+w
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
    ]);
  });

  it('excludes entries with empty section', async () => {
    const mod = await getModule();
    const result = mod.getShortcutsForDisplay(true);
    const allDescriptions = result.flatMap((s) => s.items.map((i) => i.description));
    // onEscape and onSaveNote have empty section, should be excluded
    const shortcuts = mod.loadShortcuts();
    const hiddenEntries = Object.values(shortcuts).filter((e) => e.section === '');
    for (const hidden of hiddenEntries) {
      expect(allDescriptions).not.toContain(hidden.description);
    }
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
