import { describe, it, expect } from 'vitest';

import { createSlobProvider } from '@/services/dictionaries/providers/slobProvider';
import { SlobReader, cleanTag } from '@/services/dictionaries/slobReader';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir } from '@/types/system';

import { SLOB_FIXTURE_NAME, readSlobFile } from './_slobFixtures';
import { makeReadCounter, withReadCounting } from './_countingFs';

// ---------------------------------------------------------------------------
// Real-fixture tests — the FreeDict English-Dutch slob (zlib-compressed).
// ---------------------------------------------------------------------------

describe('slobReader — real eng-nld.slob fixture', () => {
  it('parses the header and exposes metadata', async () => {
    const file = await readSlobFile();
    const reader = new SlobReader();
    await reader.load({ slob: file });
    expect(reader.header.encoding).toBe('utf-8');
    expect(reader.header.compression).toBe('zlib');
    // FreeDict bundles ship 7,717 refs (3 resource refs + 7,714 headwords).
    expect(reader.refCount).toBe(7717);
    expect(reader.header.contentTypes).toContain('text/html;charset=utf-8');
    expect(reader.header.contentTypes).toContain('text/css');
    expect(cleanTag(reader.header.tags['label'] ?? '')).toBe('English-Dutch FreeDict Dictionary');
  });

  it('finds a known headword case-insensitively', async () => {
    const file = await readSlobFile();
    const reader = new SlobReader();
    await reader.load({ slob: file });
    const ref = await reader.findRef('hello');
    expect(ref).toBeDefined();
    if (ref) {
      expect(ref.key).toBe('hello');
      expect(ref.binIndex).toBeGreaterThanOrEqual(0);
    }
    const refUpper = await reader.findRef('HELLO');
    expect(refUpper?.key).toBe('hello');
  });

  it('decompresses a bin and reads the html blob', async () => {
    const file = await readSlobFile();
    const reader = new SlobReader();
    await reader.load({ slob: file });
    const ref = await reader.findRef('hello');
    expect(ref).toBeDefined();
    if (!ref) return;
    const blob = await reader.readBlob(ref);
    expect(blob.contentType.startsWith('text/html')).toBe(true);
    const html = new TextDecoder('utf-8').decode(blob.data);
    expect(html.length).toBeGreaterThan(0);
    // FreeDict slob entries are wrapped in HTML; just sanity-check there's tags.
    expect(html).toMatch(/<\/?\w+/);
  });

  it('returns undefined for non-existent words', async () => {
    const file = await readSlobFile();
    const reader = new SlobReader();
    await reader.load({ slob: file });
    expect(await reader.findRef('zzznonsenseword')).toBeUndefined();
  });
});

describe('slobReader — error handling', () => {
  it('rejects a wrong-magic file', async () => {
    const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0])], 'bad.slob');
    const reader = new SlobReader();
    await expect(reader.load({ slob: file })).rejects.toThrow(/bad magic/);
  });
});

// ---------------------------------------------------------------------------
// Provider-level tests — full popup flow.
// ---------------------------------------------------------------------------

describe('slobProvider — real eng-nld.slob fixture', () => {
  const realDict: ImportedDictionary = {
    id: 'slob:eng-nld',
    kind: 'slob',
    name: 'English-Dutch FreeDict Dictionary',
    bundleDir: 'eng-nld-slob-bundle',
    files: { slob: SLOB_FIXTURE_NAME },
    addedAt: 1,
  };

  const makeRealFs = () => ({
    openFile: async (p: string, _base: BaseDir) => {
      const base = p.split('/').pop()!;
      if (base === SLOB_FIXTURE_NAME) return readSlobFile();
      throw new Error(`Unknown fixture file: ${base}`);
    },
  });

  it('looks up a real headword and renders HTML', async () => {
    const provider = createSlobProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('hello', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('hello');
      expect(outcome.sourceLabel).toBe('English-Dutch FreeDict Dictionary');
    }
    expect(container.querySelector('h1')?.textContent).toBe('hello');
    // Body div must contain at least one element (the HTML body of the entry).
    const body = container.querySelector('div');
    expect(body).toBeTruthy();
    expect((body?.innerHTML ?? '').length).toBeGreaterThan(0);
  });

  it('returns empty for missing headwords', async () => {
    const provider = createSlobProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('zzznotaword', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('hides bundled resource keys (~/...)', async () => {
    const provider = createSlobProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('~/css/default.css', {
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
    const provider = createSlobProvider({ dict: realDict, fs: wrappedFs });
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    const opensAfterInit = opens;
    expect(opensAfterInit).toBe(1);
    await provider.lookup('world', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(opens).toBe(opensAfterInit);
  });

  it('per-lookup reads are bounded (lazy bin decompression)', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeRealFs(), counter);
    const provider = createSlobProvider({ dict: realDict, fs });

    // Prime init + one lookup.
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    const sizes: number[] = [];
    let last = counter.perFile.get(SLOB_FIXTURE_NAME) ?? 0;
    for (const word of ['world', 'cat', 'apple', 'about']) {
      await provider.lookup(word, {
        signal: new AbortController().signal,
        container: document.createElement('div'),
      });
      const now = counter.perFile.get(SLOB_FIXTURE_NAME) ?? 0;
      sizes.push(now - last);
      last = now;
    }
    // Each subsequent lookup should be tiny — log2(7717)≈13 ref probes,
    // each ≤4 KB, plus at most one new bin decompression. Bound at 256 KB.
    for (const delta of sizes) expect(delta).toBeLessThanOrEqual(256 * 1024);
  });
});
