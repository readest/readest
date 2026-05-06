import { describe, it, expect, beforeEach } from 'vitest';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { BUILTIN_WEB_SEARCH_IDS } from '@/services/dictionaries/types';

const ZERO = (s: string) => s.startsWith('web:builtin:');

describe('customDictionaryStore — web search CRUD', () => {
  beforeEach(() => {
    // Reset state to defaults so tests don't bleed.
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: {
        providerOrder: [
          BUILTIN_WEB_SEARCH_IDS.google,
          BUILTIN_WEB_SEARCH_IDS.urban,
          BUILTIN_WEB_SEARCH_IDS.merriamWebster,
        ],
        providerEnabled: {
          [BUILTIN_WEB_SEARCH_IDS.google]: false,
          [BUILTIN_WEB_SEARCH_IDS.urban]: false,
          [BUILTIN_WEB_SEARCH_IDS.merriamWebster]: false,
        },
        webSearches: [],
      },
    });
  });

  it('seeds the three built-in web ids in default order, all disabled', () => {
    const { settings } = useCustomDictionaryStore.getState();
    const builtinWeb = settings.providerOrder.filter(ZERO);
    expect(builtinWeb).toEqual([
      BUILTIN_WEB_SEARCH_IDS.google,
      BUILTIN_WEB_SEARCH_IDS.urban,
      BUILTIN_WEB_SEARCH_IDS.merriamWebster,
    ]);
    for (const id of builtinWeb) {
      expect(settings.providerEnabled[id]).toBe(false);
    }
  });

  it('addWebSearch appends to order, enables, returns the entry', () => {
    const { addWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('My Site', 'https://example.com/?q=%WORD%');
    expect(entry.id.startsWith('web:')).toBe(true);
    expect(entry.id.startsWith('web:builtin:')).toBe(false);
    expect(entry.name).toBe('My Site');
    expect(entry.urlTemplate).toBe('https://example.com/?q=%WORD%');

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(entry.id)).toBe(true);
    expect(after.providerEnabled[entry.id]).toBe(true);
    expect((after.webSearches ?? []).map((w) => w.id)).toEqual([entry.id]);
  });

  it('addWebSearch trims whitespace from name and URL', () => {
    const { addWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('  Spaced Name  ', '   https://x.com/?q=%WORD%   ');
    expect(entry.name).toBe('Spaced Name');
    expect(entry.urlTemplate).toBe('https://x.com/?q=%WORD%');
  });

  it('updateWebSearch updates name + URL of a custom entry', () => {
    const { addWebSearch, updateWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('Old', 'https://old.com/?q=%WORD%');
    updateWebSearch(entry.id, { name: 'New', urlTemplate: 'https://new.com/?q=%WORD%' });
    const list = useCustomDictionaryStore.getState().settings.webSearches ?? [];
    const updated = list.find((w) => w.id === entry.id);
    expect(updated?.name).toBe('New');
    expect(updated?.urlTemplate).toBe('https://new.com/?q=%WORD%');
  });

  it('updateWebSearch is a no-op for built-in ids', () => {
    const { updateWebSearch, settings } = useCustomDictionaryStore.getState();
    updateWebSearch(BUILTIN_WEB_SEARCH_IDS.google, { name: 'Hijacked' });
    // No `webSearches` entry was added or modified.
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.webSearches).toEqual(settings.webSearches ?? []);
  });

  it('removeWebSearch soft-deletes a custom entry and removes it from order/enabled', () => {
    const { addWebSearch, removeWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('Tmp', 'https://tmp.com/?q=%WORD%');
    expect(removeWebSearch(entry.id)).toBe(true);
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(entry.id)).toBe(false);
    expect(entry.id in after.providerEnabled).toBe(false);
    const found = (after.webSearches ?? []).find((w) => w.id === entry.id);
    expect(found?.deletedAt).toBeGreaterThan(0);
  });

  it('removeWebSearch refuses built-in ids', () => {
    const { removeWebSearch } = useCustomDictionaryStore.getState();
    expect(removeWebSearch(BUILTIN_WEB_SEARCH_IDS.google)).toBe(false);
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(BUILTIN_WEB_SEARCH_IDS.google)).toBe(true);
  });

  it('updateDictionary patches the display name (trimmed) and ignores empty / unchanged input', () => {
    const { addDictionary, updateDictionary } = useCustomDictionaryStore.getState();
    addDictionary({
      id: 'mdict:abc',
      kind: 'mdict',
      name: 'Title (No HTML code allowed)',
      bundleDir: 'abc',
      files: { mdx: 'abc.mdx' },
      addedAt: 1,
    });

    updateDictionary('mdict:abc', { name: '  Webster MW11  ' });
    let dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Same name (no-op).
    updateDictionary('mdict:abc', { name: 'Webster MW11' });
    dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Empty / whitespace patch is rejected — keep existing name.
    updateDictionary('mdict:abc', { name: '   ' });
    dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Unknown id: silent no-op.
    expect(() => updateDictionary('mdict:nope', { name: 'X' })).not.toThrow();
  });
});
