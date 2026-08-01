import { describe, it, expect } from 'vitest';

import { createBglProvider } from '@/services/dictionaries/providers/bglProvider';
import { BglReader } from '@/services/dictionaries/bglReader';
import { groupBundlesByStem, importDictionaries } from '@/services/dictionaries/dictionaryService';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir, FileSystem } from '@/types/system';
import { vi } from 'vitest';

import { BGL_FIXTURE_NAME, readBglFile } from './_bglFixtures';

// ---------------------------------------------------------------------------
// Real-fixture tests — "History and Geography" English→French Babylon BGL.
// ---------------------------------------------------------------------------

describe('bglReader — real hist-geog-en-fr.bgl fixture', () => {
  it('parses the header and exposes metadata', async () => {
    const file = await readBglFile();
    const reader = new BglReader();
    await reader.load({ bgl: file });
    expect(reader.metadata.title).toBe('History and Geography');
    expect(reader.metadata.author).toBe('Olivier TABARY');
    expect(reader.metadata.sourceLang).toBe('English');
    expect(reader.metadata.targetLang).toBe('French');
    expect(reader.entryCount).toBe(624);
  });

  it('finds a known headword with its alternates', async () => {
    const file = await readBglFile();
    const reader = new BglReader();
    await reader.load({ bgl: file });
    const entries = reader.findEntries('Agriculture');
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0]!;
    expect(entry.headword).toBe('Agriculture');
    expect(entry.alternates).toContain('Farming');
    expect(entry.definition).toContain('Agriculture');
  });

  it('finds headwords case-insensitively', async () => {
    const file = await readBglFile();
    const reader = new BglReader();
    await reader.load({ bgl: file });
    const entries = reader.findEntries('agriculture');
    expect(entries[0]?.headword).toBe('Agriculture');
  });

  it('resolves alternate keys to their entry', async () => {
    const file = await readBglFile();
    const reader = new BglReader();
    await reader.load({ bgl: file });
    const entries = reader.findEntries('Big Emerging Market');
    expect(entries[0]?.headword).toBe('B.E.M.');
  });

  it('decodes cp1252 accented definitions', async () => {
    const file = await readBglFile();
    const reader = new BglReader();
    await reader.load({ bgl: file });
    const entries = reader.findEntries('Airport');
    expect(entries[0]?.definition).toContain('Aéroport');
  });

  it('returns no entries for non-existent words', async () => {
    const file = await readBglFile();
    const reader = new BglReader();
    await reader.load({ bgl: file });
    expect(reader.findEntries('zzznonsenseword')).toEqual([]);
  });
});

describe('bglReader — error handling', () => {
  it('rejects a wrong-magic file', async () => {
    const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0])], 'bad.bgl');
    const reader = new BglReader();
    await expect(reader.load({ bgl: file })).rejects.toThrow(/not a babylon/i);
  });
});

// ---------------------------------------------------------------------------
// Provider-level tests — full popup flow.
// ---------------------------------------------------------------------------

describe('bglProvider — real hist-geog-en-fr.bgl fixture', () => {
  const realDict: ImportedDictionary = {
    id: 'bgl:hist-geog',
    kind: 'bgl',
    name: 'History and Geography',
    bundleDir: 'hist-geog-bgl-bundle',
    files: { bgl: BGL_FIXTURE_NAME },
    addedAt: 1,
  };

  const makeRealFs = () => ({
    openFile: async (p: string, _base: BaseDir) => {
      const base = p.split('/').pop()!;
      if (base === BGL_FIXTURE_NAME) return readBglFile();
      throw new Error(`Unknown fixture file: ${base}`);
    },
  });

  it('looks up a real headword and renders the definition', async () => {
    const provider = createBglProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('Airport', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('Airport');
      expect(outcome.sourceLabel).toBe('History and Geography');
    }
    expect(container.querySelector('h1')?.textContent).toBe('Airport');
    expect(container.textContent).toContain('Aéroport');
  });

  it('returns empty for missing headwords', async () => {
    const provider = createBglProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('zzznotaword', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('caches the reader — second lookup opens no extra files', async () => {
    const realFs = makeRealFs();
    let opens = 0;
    const wrappedFs = {
      openFile: async (p: string, base: BaseDir) => {
        opens += 1;
        return realFs.openFile(p, base);
      },
    };
    const provider = createBglProvider({ dict: realDict, fs: wrappedFs });
    await provider.lookup('Airport', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(opens).toBe(1);
    await provider.lookup('Border', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(opens).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Importer integration — grouping and metadata extraction.
// ---------------------------------------------------------------------------

describe('importDictionaries — Babylon BGL', () => {
  function createMockFs(): FileSystem {
    return {
      resolvePath: vi
        .fn()
        .mockReturnValue({ baseDir: 0, basePrefix: async () => '', fp: 'x', base: 'Dictionaries' }),
      getURL: vi.fn().mockReturnValue('url'),
      getBlobURL: vi.fn().mockResolvedValue('blob:url'),
      getImageURL: vi.fn().mockResolvedValue('image:url'),
      openFile: vi.fn().mockResolvedValue(new File([], 'unused')),
      copyFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      removeFile: vi.fn().mockResolvedValue(undefined),
      readDir: vi.fn().mockResolvedValue([]),
      createDir: vi.fn().mockResolvedValue(undefined),
      removeDir: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      stats: vi.fn().mockResolvedValue({
        isFile: true,
        isDirectory: false,
        size: 0,
        mtime: null,
        atime: null,
        birthtime: null,
      }),
      getPrefix: vi.fn().mockResolvedValue('Readest/Dictionaries'),
    };
  }

  it('groups a lone .bgl file into a bgl bundle', () => {
    const { bundles, orphans } = groupBundlesByStem([{ path: `/books/${BGL_FIXTURE_NAME}` }]);
    expect(orphans).toEqual([]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.kind).toBe('bgl');
  });

  it('imports the fixture and derives the name from the glossary title', async () => {
    const fs = createMockFs();
    const file = await readBglFile();
    const result = await importDictionaries(fs, [{ file }]);
    expect(result.orphanFiles).toEqual([]);
    expect(result.imported).toHaveLength(1);
    const entry = result.imported[0]!;
    expect(entry.kind).toBe('bgl');
    expect(entry.name).toBe('History and Geography');
    expect(entry.files.bgl).toBe(BGL_FIXTURE_NAME);
    expect(entry.unsupported).toBeUndefined();
  });

  it('flags a corrupt .bgl as unsupported instead of failing the import', async () => {
    const fs = createMockFs();
    const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0])], 'broken.bgl');
    const result = await importDictionaries(fs, [{ file }]);
    expect(result.imported).toHaveLength(1);
    const entry = result.imported[0]!;
    expect(entry.kind).toBe('bgl');
    expect(entry.unsupported).toBe(true);
    expect(entry.unsupportedReason).toMatch(/not a babylon/i);
  });
});
