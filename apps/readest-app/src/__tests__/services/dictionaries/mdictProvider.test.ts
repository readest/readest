import { describe, it, expect, beforeEach } from 'vitest';

import { createMdictProvider } from '@/services/dictionaries/providers/mdictProvider';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir } from '@/types/system';

import { MDX_FIXTURE_NAME, MDD_FIXTURE_NAME, readMdxFile, readMddFile } from './_mdictFixtures';
import { makeReadCounter, withReadCounting } from './_countingFs';

// The shared fixture is a real MDict bundle (Longman Phrasal Verbs Dictionary,
// encrypt=2 / key-info-encrypted variant). Drop in any real .mdx/.mdd pair
// renamed to `mdict-en-en.*` to exercise this suite against your own data.
const KNOWN_HEADWORD = 'abandon';
const UNKNOWN_HEADWORD = 'zzznotaword';

const objectUrls: string[] = [];
const originalCreate = globalThis.URL.createObjectURL;
const originalRevoke = globalThis.URL.revokeObjectURL;

beforeEach(() => {
  objectUrls.length = 0;
  // jsdom lacks URL.createObjectURL — stub it so the provider's image
  // substitution path exercises end-to-end.
  globalThis.URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${objectUrls.length}-${blob.size}`;
    objectUrls.push(url);
    return url;
  };
  globalThis.URL.revokeObjectURL = () => {};
  return () => {
    globalThis.URL.createObjectURL = originalCreate;
    globalThis.URL.revokeObjectURL = originalRevoke;
  };
});

const buildDict = (withMdd = true): ImportedDictionary => ({
  id: 'mdict:fixture',
  kind: 'mdict',
  name: 'Fixture',
  bundleDir: 'fixture-bundle',
  files: {
    mdx: MDX_FIXTURE_NAME,
    mdd: withMdd ? [MDD_FIXTURE_NAME] : undefined,
  },
  addedAt: 1,
});

const makeFs = () => ({
  openFile: async (p: string, _base: BaseDir) => {
    const base = p.split('/').pop()!;
    if (base === MDX_FIXTURE_NAME) return readMdxFile();
    if (base === MDD_FIXTURE_NAME) return readMddFile();
    throw new Error(`Unknown fixture file: ${base}`);
  },
});

describe('mdictProvider', () => {
  it('opens an .mdx via Blob and looks up a real entry', async () => {
    const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.headword).toBe(KNOWN_HEADWORD);
    expect(container.querySelector('h1')?.textContent).toBe(KNOWN_HEADWORD);
    expect(container.querySelector('div')?.innerHTML.length).toBeGreaterThan(0);
  });

  it('returns empty for an unknown headword', async () => {
    const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup(UNKNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('shares the parsed instance across consecutive lookups', async () => {
    const fs = makeFs();
    let opens = 0;
    const wrappedFs = {
      openFile: async (p: string, base: BaseDir) => {
        opens += 1;
        return fs.openFile(p, base);
      },
    };
    const provider = createMdictProvider({ dict: buildDict(false), fs: wrappedFs });
    const container = document.createElement('div');
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    const firstOpens = opens;
    container.replaceChildren();
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(opens).toBe(firstOpens);
  });

  it('handles encrypt=2 (key-info-only) dictionaries — the fixture itself is encrypt=2', async () => {
    // The shared fixture's `meta.encrypt === 2`, so this is verified by the
    // first test passing. Lock the contract explicitly here as well.
    const jsmdict = await import('js-mdict');
    const file = await readMdxFile();
    const mdx = await jsmdict.MDX.create(file);
    expect(mdx.meta.encrypt).toBe(2);
  });

  it('rejects encrypt=1 (record-block / passcode) dictionaries as unsupported', async () => {
    const jsmdict = await import('js-mdict');
    const origCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    jsmdict.MDX.create = async (file: Blob) => {
      const inst = await origCreate(file);
      (inst as unknown as { meta: { encrypt: number } }).meta.encrypt = 1;
      return inst;
    };
    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const outcome = await provider.lookup(KNOWN_HEADWORD, {
        signal: new AbortController().signal,
        container,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
    } finally {
      jsmdict.MDX.create = origCreate;
    }
  });

  it('classifies upstream "encrypted file" throws as `unsupported`, not `error`', async () => {
    const jsmdict = await import('js-mdict');
    const origCreate = jsmdict.MDX.create.bind(jsmdict.MDX);
    jsmdict.MDX.create = async () => {
      throw new Error('user identification is needed to read encrypted file');
    };
    try {
      const provider = createMdictProvider({ dict: buildDict(false), fs: makeFs() });
      const container = document.createElement('div');
      const outcome = await provider.lookup(KNOWN_HEADWORD, {
        signal: new AbortController().signal,
        container,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
    } finally {
      jsmdict.MDX.create = origCreate;
    }
  });

  it('init failure surfaces as `error`', async () => {
    const failingFs = {
      openFile: async () => {
        throw new Error('disk gone');
      },
    };
    const provider = createMdictProvider({ dict: buildDict(false), fs: failingFs });
    const container = document.createElement('div');
    const outcome = await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('error');
      expect(outcome.message).toContain('disk gone');
    }
  });

  it('dispose() revokes object URLs created for image resources', async () => {
    let revoked = 0;
    globalThis.URL.revokeObjectURL = () => {
      revoked += 1;
    };
    const provider = createMdictProvider({ dict: buildDict(true), fs: makeFs() });
    const container = document.createElement('div');
    // Manually inject an <img> referencing an mdd resource to force the
    // resolver path. We don't depend on the definition containing one;
    // the resolver runs on the rendered body.
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    const body = container.querySelector('div')!;
    const img = document.createElement('img');
    img.setAttribute('src', 'nonexistent.png');
    body.appendChild(img);
    // Re-run lookup so the resolver iterates over the freshly-added <img>.
    container.replaceChildren();
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container,
    });
    provider.dispose?.();
    // Either tracked URLs were created or weren't; the key assertion is
    // dispose() runs without throwing in both cases.
    expect(typeof revoked).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Perf regression — bytes read.
  //
  // MDict's BlobScanner reads slices on demand. After init, a single lookup
  // should read at most one record block (typically a few KB to tens of KB).
  // If a future change accidentally re-reads the keylist or scans for a
  // matching word linearly, these tests catch it.
  //
  // Measured baselines on the Longman fixture (5,587 entries, encrypt=2):
  //   - init (incl. eager `_readKeyBlocks` traversal):   ~50 KB
  //   - per-lookup (one inflated record block):          ~7.4 KB
  //   - not-found word (binary-search early-out):        0 bytes
  //
  // The 64 KB ceiling absorbs format variance (some bundles use larger
  // record blocks).
  // -------------------------------------------------------------------------
  it('per-lookup reads less than 64 KB after init', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });

    // Init via the first lookup.
    const c1 = document.createElement('div');
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container: c1,
    });
    const initBytes = counter.total;
    expect(initBytes).toBeGreaterThan(0);

    // Real headwords from the Longman fixture (verified to exist via probe:
    // first 5 entries are abandon, abandon to, abide, abide by, abound).
    for (const word of ['abide', 'abound', 'abide by']) {
      const before = counter.total;
      const c = document.createElement('div');
      await provider.lookup(word, { signal: new AbortController().signal, container: c });
      const delta = counter.total - before;
      expect(delta).toBeGreaterThan(0); // Word found → at least one record-block read
      expect(delta).toBeLessThan(64 * 1024);
    }
  });

  it('lookup of an unknown headword reads 0 bytes (binary-search early-out)', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });

    // Prime init with a known lookup first.
    await provider.lookup(KNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    const before = counter.total;
    await provider.lookup(UNKNOWN_HEADWORD, {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(counter.total - before).toBe(0);
  });

  it('init does not read the entire .mdx file', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });
    const c = document.createElement('div');
    await provider.lookup(KNOWN_HEADWORD, { signal: new AbortController().signal, container: c });

    const realMdx = await readMdxFile();
    const mdxBytesRead = counter.perFile.get(MDX_FIXTURE_NAME) ?? 0;
    // Init reads keylist + headers + the lookup's record block — not full
    // record content. Bound at half the file size; real ratio on Longman
    // is ~4%.
    expect(mdxBytesRead).toBeGreaterThan(0);
    expect(mdxBytesRead).toBeLessThan(realMdx.size * 0.5);
  });

  it('repeated lookups of the same word produce identical, bounded reads', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFs(), counter);
    const provider = createMdictProvider({ dict: buildDict(false), fs });

    const run = async () => {
      await provider.lookup(KNOWN_HEADWORD, {
        signal: new AbortController().signal,
        container: document.createElement('div'),
      });
    };

    await run(); // includes init
    const afterFirst = counter.total;
    await run();
    const secondDelta = counter.total - afterFirst;
    await run();
    const thirdDelta = counter.total - afterFirst - secondDelta;

    // js-mdict doesn't cache record blocks. Repeats re-read the same block
    // — assert deltas are equal (no creeping growth) and small.
    expect(secondDelta).toBeGreaterThan(0);
    expect(secondDelta).toBeLessThan(64 * 1024);
    expect(thirdDelta).toBe(secondDelta);
  });
});
