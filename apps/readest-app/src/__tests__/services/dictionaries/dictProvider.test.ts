import { describe, it, expect, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';

import { createDictProvider } from '@/services/dictionaries/providers/dictProvider';
import { decodeDictBase64, parseDictIndex } from '@/services/dictionaries/dictReader';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir } from '@/types/system';

import {
  INDEX_FIXTURE_NAME,
  DICT_FIXTURE_NAME,
  readIndexFile,
  readDictFile,
} from './_dictFixtures';
import { makeReadCounter, withReadCounting } from './_countingFs';

// ---------------------------------------------------------------------------
// Base64 alphabet decoder unit tests.
// ---------------------------------------------------------------------------

describe('decodeDictBase64', () => {
  it('decodes single-character tokens', () => {
    expect(decodeDictBase64('A')).toBe(0);
    expect(decodeDictBase64('B')).toBe(1);
    expect(decodeDictBase64('Z')).toBe(25);
    expect(decodeDictBase64('a')).toBe(26);
    expect(decodeDictBase64('z')).toBe(51);
    expect(decodeDictBase64('0')).toBe(52);
    expect(decodeDictBase64('9')).toBe(61);
    expect(decodeDictBase64('+')).toBe(62);
    expect(decodeDictBase64('/')).toBe(63);
  });

  it('decodes multi-character big-endian tokens', () => {
    // 'BA' = 1·64 + 0 = 64
    expect(decodeDictBase64('BA')).toBe(64);
    // 'Bn0B' = 1·64³ + 39·64² + 52·64 + 1 = 262144+159744+3328+1 = 425217
    expect(decodeDictBase64('Bn0B')).toBe(425217);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeDictBase64('A!B')).toThrow(/Invalid DICT base64/);
  });
});

// ---------------------------------------------------------------------------
// Synthetic-bundle tests — minimal DICT bundle exercising parser edge cases.
// ---------------------------------------------------------------------------

const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeDictBase64(n: number): string {
  if (n === 0) return 'A';
  let s = '';
  while (n > 0) {
    s = A64[n & 63] + s;
    n = Math.floor(n / 64);
  }
  return s;
}

interface SynEntry {
  word: string;
  text: string;
}

function buildBundle(
  entries: SynEntry[],
  meta: { short?: string; info?: string; url?: string } = {},
) {
  // Concatenate bodies and remember offsets.
  const enc = new TextEncoder();
  const bodyParts: Uint8Array[] = [];
  const lines: string[] = [];
  let pos = 0;

  const push = (word: string, text: string) => {
    const data = enc.encode(text);
    lines.push(`${word}\t${encodeDictBase64(pos)}\t${encodeDictBase64(data.length)}`);
    bodyParts.push(data);
    pos += data.length;
  };

  if (meta.short) push('00databaseshort', meta.short);
  if (meta.info) push('00databaseinfo', meta.info);
  if (meta.url) push('00databaseurl', meta.url);
  push('00databaseutf8', '');
  for (const e of entries) push(e.word, e.text);

  // Concatenate body and gzip it as a (non-DictZip) gzip stream — the
  // reader's whole-file gunzip fallback handles that.
  const body = new Uint8Array(bodyParts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of bodyParts) {
    body.set(p, off);
    off += p.length;
  }
  const dictDz = new Uint8Array(gzipSync(Buffer.from(body)));

  // .index: deliberately keep the original input order (FreeDict files in
  // the wild are mostly sorted by `dictsort`, but the parser must still
  // re-sort defensively before binary search).
  const indexBytes = enc.encode(lines.join('\n') + '\n');

  return { index: indexBytes, dictDz };
}

describe('parseDictIndex', () => {
  it('handles CRLF and trailing whitespace', () => {
    const text = ['hello\tA\tB', '00databaseshort\tA\tA', 'world\tB\tA', ''].join('\r\n');
    const parsed = parseDictIndex(text);
    expect(parsed.words).toEqual(['hello', 'world']);
    expect(parsed.meta['00databaseshort']).toEqual({ offset: 0, size: 0 });
  });

  it('sorts entries case-insensitively', () => {
    const text = ['Banana\tA\tA', 'apple\tB\tA', 'Cherry\tC\tA'].join('\n');
    const parsed = parseDictIndex(text);
    expect(parsed.words).toEqual(['apple', 'Banana', 'Cherry']);
  });
});

describe('dictProvider — synthetic bundle', () => {
  let bundleFiles: { index: Uint8Array; dictDz: Uint8Array };

  beforeEach(() => {
    bundleFiles = buildBundle(
      [
        { word: 'apple', text: 'a fruit' },
        { word: 'banana', text: 'another fruit' },
        { word: 'cherry', text: 'a small red fruit' },
      ],
      { short: 'Test Dict', info: 'A tiny test dictionary.' },
    );
  });

  const buildDict = (): ImportedDictionary => ({
    id: 'dict:test',
    kind: 'dict',
    name: 'Test Dict',
    bundleDir: 'test-bundle',
    files: { index: 'test.index', dict: 'test.dict.dz' },
    addedAt: 1,
  });

  const makeFs = (files = bundleFiles) => ({
    openFile: async (path: string, _base: BaseDir) => {
      const base = path.split('/').pop()!;
      let bytes: Uint8Array;
      if (base === 'test.index') bytes = files.index;
      else if (base === 'test.dict.dz') bytes = files.dictDz;
      else throw new Error(`Unknown fixture file: ${base}`);
      const buf = new Uint8Array(bytes.length);
      buf.set(bytes);
      return new File([buf], base);
    },
  });

  it('initializes lazily and looks up a headword', async () => {
    const provider = createDictProvider({ dict: buildDict(), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('banana', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('banana');
      expect(outcome.sourceLabel).toBe('Test Dict');
    }
    expect(container.querySelector('h1')?.textContent).toBe('banana');
    expect(container.querySelector('pre')?.textContent).toBe('another fruit');
  });

  it('case-insensitive lookup', async () => {
    const provider = createDictProvider({ dict: buildDict(), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('APPLE', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.headword).toBe('apple');
  });

  it('returns empty when the headword does not exist', async () => {
    const provider = createDictProvider({ dict: buildDict(), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('zzzz', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('reports `error` on init failure', async () => {
    const failingFs = {
      openFile: async () => {
        throw new Error('disk gone');
      },
    };
    const provider = createDictProvider({ dict: buildDict(), fs: failingFs });
    const container = document.createElement('div');
    const outcome = await provider.lookup('apple', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('error');
      expect(outcome.message).toContain('disk gone');
    }
  });

  it('shares the parsed instance across lookups', async () => {
    const fs = makeFs();
    let openCount = 0;
    const wrappedFs = {
      openFile: async (path: string, base: BaseDir) => {
        openCount += 1;
        return fs.openFile(path, base);
      },
    };
    const provider = createDictProvider({ dict: buildDict(), fs: wrappedFs });
    const container = document.createElement('div');
    await provider.lookup('apple', { signal: new AbortController().signal, container });
    const opensAfterFirst = openCount;
    container.replaceChildren();
    await provider.lookup('banana', { signal: new AbortController().signal, container });
    expect(openCount).toBe(opensAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Real-fixture tests — the FreeDict English-Dutch bundle.
// ---------------------------------------------------------------------------

describe('dictProvider — real freedict-eng-nld fixture', () => {
  const realDict: ImportedDictionary = {
    id: 'dict:freedict-eng-nld',
    kind: 'dict',
    name: 'FreeDict eng-nld',
    bundleDir: 'freedict-eng-nld-bundle',
    files: { index: INDEX_FIXTURE_NAME, dict: DICT_FIXTURE_NAME },
    addedAt: 1,
  };

  const makeRealFs = () => ({
    openFile: async (p: string, _base: BaseDir) => {
      const base = p.split('/').pop()!;
      if (base === INDEX_FIXTURE_NAME) return readIndexFile();
      if (base === DICT_FIXTURE_NAME) return readDictFile();
      throw new Error(`Unknown fixture file: ${base}`);
    },
  });

  it('looks up a real headword and renders a definition', async () => {
    const provider = createDictProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('hello', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('hello');
      // 00databaseshort exists in this fixture and is used as the source label.
      expect(outcome.sourceLabel).toBeTruthy();
    }
    expect(container.querySelector('h1')?.textContent).toBe('hello');
    const def = container.querySelector('pre')?.textContent ?? '';
    expect(def.length).toBeGreaterThan(0);
  });

  it('finds several common headwords', async () => {
    const provider = createDictProvider({ dict: realDict, fs: makeRealFs() });
    for (const word of ['hello', 'world', 'reveal']) {
      const container = document.createElement('div');
      const outcome = await provider.lookup(word, {
        signal: new AbortController().signal,
        container,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.headword).toBe(word);
      expect(container.querySelector('pre')?.textContent?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('returns empty for non-existent words', async () => {
    const provider = createDictProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('zzznonsenseword', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('caches the reader instance — second lookup opens no extra files', async () => {
    const realFs = makeRealFs();
    let opens = 0;
    const wrappedFs = {
      openFile: async (p: string, base: BaseDir) => {
        opens += 1;
        return realFs.openFile(p, base);
      },
    };
    const provider = createDictProvider({ dict: realDict, fs: wrappedFs });
    const c1 = document.createElement('div');
    await provider.lookup('hello', { signal: new AbortController().signal, container: c1 });
    const opensAfterInit = opens;
    expect(opensAfterInit).toBe(2); // .index, .dict.dz
    const c2 = document.createElement('div');
    await provider.lookup('world', { signal: new AbortController().signal, container: c2 });
    expect(opens).toBe(opensAfterInit);
  });

  // -------------------------------------------------------------------------
  // Per-lookup .dict.dz reads should be small (lazy chunk decompression).
  // -------------------------------------------------------------------------
  it('per-lookup .dict.dz reads are bounded by the chunk size', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeRealFs(), counter);
    const provider = createDictProvider({ dict: realDict, fs });

    // Prime init.
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    let dictLast = counter.perFile.get(DICT_FIXTURE_NAME) ?? 0;
    for (const word of ['world', 'reveal', 'vital']) {
      await provider.lookup(word, {
        signal: new AbortController().signal,
        container: document.createElement('div'),
      });
      const dictNow = counter.perFile.get(DICT_FIXTURE_NAME) ?? 0;
      const delta = dictNow - dictLast;
      // The freedict bundle's dictzip chunks are ~8 KB compressed; bound
      // generously at 64 KB to absorb format variance.
      expect(delta).toBeLessThanOrEqual(64 * 1024);
      dictLast = dictNow;
    }
  });
});
