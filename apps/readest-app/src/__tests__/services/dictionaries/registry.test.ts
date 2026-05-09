import { describe, it, expect, beforeEach } from 'vitest';
import { getEnabledProviders, __resetRegistryForTests } from '@/services/dictionaries/registry';
import { BUILTIN_PROVIDER_IDS, BUILTIN_WEB_SEARCH_IDS } from '@/services/dictionaries/types';
import type {
  DictionarySettings,
  ImportedDictionary,
  WebSearchEntry,
} from '@/services/dictionaries/types';

const baseSettings: DictionarySettings = {
  providerOrder: [BUILTIN_PROVIDER_IDS.wiktionary, BUILTIN_PROVIDER_IDS.wikipedia],
  providerEnabled: {
    [BUILTIN_PROVIDER_IDS.wiktionary]: true,
    [BUILTIN_PROVIDER_IDS.wikipedia]: true,
  },
};

describe('dictionary registry', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('returns builtin providers in order, both enabled', () => {
    const providers = getEnabledProviders({ settings: baseSettings, dictionaries: [] });
    expect(providers.map((p) => p.id)).toEqual([
      BUILTIN_PROVIDER_IDS.wiktionary,
      BUILTIN_PROVIDER_IDS.wikipedia,
    ]);
  });

  it('skips providers explicitly disabled', () => {
    const providers = getEnabledProviders({
      settings: {
        ...baseSettings,
        providerEnabled: {
          ...baseSettings.providerEnabled,
          [BUILTIN_PROVIDER_IDS.wikipedia]: false,
        },
      },
      dictionaries: [],
    });
    expect(providers.map((p) => p.id)).toEqual([BUILTIN_PROVIDER_IDS.wiktionary]);
  });

  it('honors providerOrder regardless of declaration order', () => {
    const providers = getEnabledProviders({
      settings: {
        ...baseSettings,
        providerOrder: [BUILTIN_PROVIDER_IDS.wikipedia, BUILTIN_PROVIDER_IDS.wiktionary],
      },
      dictionaries: [],
    });
    expect(providers.map((p) => p.id)).toEqual([
      BUILTIN_PROVIDER_IDS.wikipedia,
      BUILTIN_PROVIDER_IDS.wiktionary,
    ]);
  });

  it('caches the same provider instance across calls', () => {
    const a = getEnabledProviders({ settings: baseSettings, dictionaries: [] });
    const b = getEnabledProviders({ settings: baseSettings, dictionaries: [] });
    expect(a[0]).toBe(b[0]);
  });

  it('dispatches built-in web-search ids to a web provider', () => {
    const settings: DictionarySettings = {
      providerOrder: [BUILTIN_WEB_SEARCH_IDS.google, BUILTIN_WEB_SEARCH_IDS.urban],
      providerEnabled: {
        [BUILTIN_WEB_SEARCH_IDS.google]: true,
        [BUILTIN_WEB_SEARCH_IDS.urban]: true,
      },
    };
    const providers = getEnabledProviders({ settings, dictionaries: [] });
    expect(providers.map((p) => p.id)).toEqual([
      BUILTIN_WEB_SEARCH_IDS.google,
      BUILTIN_WEB_SEARCH_IDS.urban,
    ]);
    expect(providers.every((p) => p.kind === 'web')).toBe(true);
  });

  it('resolves custom web-search ids from settings.webSearches', () => {
    const customEntry: WebSearchEntry = {
      id: 'web:custom123',
      name: 'My Site',
      urlTemplate: 'https://example.com/?q=%WORD%',
    };
    const settings: DictionarySettings = {
      providerOrder: ['web:custom123'],
      providerEnabled: { 'web:custom123': true },
      webSearches: [customEntry],
    };
    const providers = getEnabledProviders({ settings, dictionaries: [] });
    expect(providers).toHaveLength(1);
    expect(providers[0]!.label).toBe('My Site');
    expect(providers[0]!.kind).toBe('web');
  });

  it('drops custom web-search ids whose entries are missing or soft-deleted', () => {
    const settings: DictionarySettings = {
      providerOrder: ['web:gone', 'web:dead'],
      providerEnabled: { 'web:gone': true, 'web:dead': true },
      webSearches: [
        {
          id: 'web:dead',
          name: 'Dead',
          urlTemplate: 'https://example.com/?q=%WORD%',
          deletedAt: 1,
        },
      ],
    };
    const providers = getEnabledProviders({ settings, dictionaries: [] });
    expect(providers).toEqual([]);
  });

  it('skips imported dictionaries that are unavailable, deleted, or unsupported', () => {
    const fs = { openFile: async () => new File([], '') };
    const dicts: ImportedDictionary[] = [
      {
        id: 'mdict:available',
        kind: 'mdict',
        name: 'Available',
        bundleDir: 'a',
        files: { mdx: 'a.mdx' },
        addedAt: 1,
      },
      {
        id: 'mdict:gone',
        kind: 'mdict',
        name: 'Gone',
        bundleDir: 'g',
        files: { mdx: 'g.mdx' },
        addedAt: 2,
        unavailable: true,
      },
      {
        id: 'stardict:nope',
        kind: 'stardict',
        name: 'Nope',
        bundleDir: 'n',
        files: { ifo: 'n.ifo' },
        addedAt: 3,
        unsupported: true,
      },
    ];
    const settings: DictionarySettings = {
      providerOrder: [
        BUILTIN_PROVIDER_IDS.wiktionary,
        'mdict:available',
        'mdict:gone',
        'stardict:nope',
      ],
      providerEnabled: {
        [BUILTIN_PROVIDER_IDS.wiktionary]: true,
        'mdict:available': true,
        'mdict:gone': true,
        'stardict:nope': true,
      },
    };
    const providers = getEnabledProviders({ settings, dictionaries: dicts, fs });
    expect(providers.map((p) => p.id)).toEqual([
      BUILTIN_PROVIDER_IDS.wiktionary,
      'mdict:available',
    ]);
  });
});
