import { describe, it, expect, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';

import { createStarDictProvider } from '@/services/dictionaries/providers/starDictProvider';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir } from '@/types/system';

// ---------------------------------------------------------------------------
// Minimal StarDict fixture builder for edge-case tests.
//
// Produces `.ifo`, `.idx`, plain-gzipped `.dict.dz`, and (optionally) `.syn`
// files. The provider's reader (`StarDictReader`) gunzips the whole `.dict`
// once at init and slices by offset, which works on real-world `.dict.dz`
// files regardless of whether they were produced with proper DictZip
// random-access boundaries — so the fixture builder doesn't need to bother
// with FEXTRA / RA. Single-type `sametypesequence=m` (plain text) matches
// v1's StarDict scope.
// ---------------------------------------------------------------------------

interface Entry {
  word: string;
  text: string;
}

function concatU8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

/** Build a `.dict` blob (uncompressed concatenation) and the per-entry index. */
function buildDictAndIndex(entries: Entry[]) {
  const enc = new TextEncoder();
  const dictParts: Uint8Array[] = [];
  const indexEntries: { word: string; offset: number; size: number }[] = [];
  let pos = 0;
  for (const e of entries) {
    const data = enc.encode(e.text);
    indexEntries.push({ word: e.word, offset: pos, size: data.length });
    dictParts.push(data);
    pos += data.length;
  }
  return { dict: concatU8(dictParts), indexEntries };
}

/** Build a `.idx` blob (word\0 offset_be size_be ...). */
function buildIdx(indexEntries: { word: string; offset: number; size: number }[]) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  // .idx must be sorted by word for the binary search in dict.js.
  const sorted = [...indexEntries].sort((a, b) =>
    a.word.toLowerCase() < b.word.toLowerCase()
      ? -1
      : a.word.toLowerCase() > b.word.toLowerCase()
        ? 1
        : 0,
  );
  for (const e of sorted) {
    parts.push(enc.encode(e.word));
    const tail = new Uint8Array(1 + 8); // null terminator + offset + size
    writeUint32BE(tail, 1, e.offset);
    writeUint32BE(tail, 5, e.size);
    parts.push(tail);
  }
  return concatU8(parts);
}

/** Build a `.syn` blob (synonym\0 idx_be ...) where idx_be points into `.idx`. */
function buildSyn(synonyms: { word: string; idxIndex: number }[]) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const sorted = [...synonyms].sort((a, b) =>
    a.word.toLowerCase() < b.word.toLowerCase()
      ? -1
      : a.word.toLowerCase() > b.word.toLowerCase()
        ? 1
        : 0,
  );
  for (const s of sorted) {
    parts.push(enc.encode(s.word));
    const tail = new Uint8Array(1 + 4);
    writeUint32BE(tail, 1, s.idxIndex);
    parts.push(tail);
  }
  return concatU8(parts);
}

/** Build a `.dict.dz` blob — just gzip the raw `.dict` bytes. */
function buildDictDz(dict: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(dict)));
}

/** Build a full StarDict bundle for the given entries. */
function buildBundle(entries: Entry[], synonyms: { word: string; idxIndex: number }[] = []) {
  const ifo = new TextEncoder().encode(
    [
      "StarDict's dict ifo file",
      'version=2.4.2',
      'bookname=Test Dictionary',
      `wordcount=${entries.length}`,
      `synwordcount=${synonyms.length}`,
      'sametypesequence=m',
      '',
    ].join('\n'),
  );
  const { dict, indexEntries } = buildDictAndIndex(entries);
  const idx = buildIdx(indexEntries);
  const dictDz = buildDictDz(dict);
  const syn = synonyms.length ? buildSyn(synonyms) : undefined;
  return { ifo, idx, dictDz, syn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('starDictProvider', () => {
  let bundleFiles: { ifo: Uint8Array; idx: Uint8Array; dictDz: Uint8Array; syn?: Uint8Array };

  beforeEach(() => {
    bundleFiles = buildBundle(
      [
        { word: 'apple', text: 'a fruit' },
        { word: 'banana', text: 'another fruit' },
        { word: 'cherry', text: 'a small red fruit' },
      ],
      // synonym 'pomme' → idx entry 0 ('apple')
      [{ word: 'pomme', idxIndex: 0 }],
    );
  });

  const buildDict = (files = bundleFiles): ImportedDictionary => ({
    id: 'stardict:test',
    kind: 'stardict',
    name: 'Test Dictionary',
    bundleDir: 'test-bundle',
    files: {
      ifo: 'test.ifo',
      idx: 'test.idx',
      dict: 'test.dict.dz',
      syn: files.syn ? 'test.syn' : undefined,
    },
    addedAt: 1,
  });

  const makeFs = (files = bundleFiles) => ({
    openFile: async (path: string, _base: BaseDir) => {
      const base = path.split('/').pop()!;
      let bytes: Uint8Array;
      if (base === 'test.ifo') bytes = files.ifo;
      else if (base === 'test.idx') bytes = files.idx;
      else if (base === 'test.dict.dz') bytes = files.dictDz;
      else if (base === 'test.syn' && files.syn) bytes = files.syn;
      else throw new Error(`Unknown fixture file: ${base}`);
      // Copy into a fresh ArrayBuffer to satisfy BlobPart's Uint8Array<ArrayBuffer> constraint.
      const buf = new Uint8Array(bytes.length);
      buf.set(bytes);
      return new File([buf], base);
    },
  });

  it('initializes lazily and looks up a headword', async () => {
    const provider = createStarDictProvider({ dict: buildDict(), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('apple', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.headword).toBe('apple');
    expect(container.querySelector('h1')?.textContent).toBe('apple');
    expect(container.querySelector('pre')?.textContent).toBe('a fruit');
  });

  it('returns empty when the headword does not exist', async () => {
    const provider = createStarDictProvider({ dict: buildDict(), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('zzzz', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('falls back to synonym lookup when direct match fails', async () => {
    const provider = createStarDictProvider({ dict: buildDict(), fs: makeFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('pomme', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('apple');
    expect(container.querySelector('pre')?.textContent).toBe('a fruit');
  });

  it('shares the parsed instance across consecutive lookups', async () => {
    const fs = makeFs();
    let openCount = 0;
    const wrappedFs = {
      openFile: async (path: string, base: BaseDir) => {
        openCount += 1;
        return fs.openFile(path, base);
      },
    };
    const provider = createStarDictProvider({ dict: buildDict(), fs: wrappedFs });
    const container = document.createElement('div');
    await provider.lookup('apple', { signal: new AbortController().signal, container });
    const opensAfterFirst = openCount;
    container.replaceChildren();
    await provider.lookup('banana', { signal: new AbortController().signal, container });
    expect(openCount).toBe(opensAfterFirst);
  });

  it('reports `error` on init failure', async () => {
    const failingFs = {
      openFile: async () => {
        throw new Error('disk gone');
      },
    };
    const provider = createStarDictProvider({ dict: buildDict(), fs: failingFs });
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
});

// ---------------------------------------------------------------------------
// Real-fixture tests — exercise the production code path against a real
// StarDict bundle (CMU American English spelling, 105,626 entries,
// `sametypesequence=m`, DictZip-compressed). The synthetic-fixture tests
// above cover edge cases the real data doesn't have (.syn fallback, init
// failure); these tests verify the happy path against real bytes.
// ---------------------------------------------------------------------------

import {
  IFO_FIXTURE_NAME,
  IDX_FIXTURE_NAME,
  DICT_FIXTURE_NAME,
  readIfoFile,
  readIdxFile,
  readDictFile,
} from './_stardictFixtures';
import { makeReadCounter, withReadCounting } from './_countingFs';

describe('starDictProvider — real cmudict fixture', () => {
  const realDict: ImportedDictionary = {
    id: 'stardict:cmudict',
    kind: 'stardict',
    name: 'CMU American English spelling',
    bundleDir: 'cmudict-bundle',
    files: {
      ifo: IFO_FIXTURE_NAME,
      idx: IDX_FIXTURE_NAME,
      dict: DICT_FIXTURE_NAME,
    },
    addedAt: 1,
  };

  const makeRealFs = () => ({
    openFile: async (p: string, _base: BaseDir) => {
      const base = p.split('/').pop()!;
      if (base === IFO_FIXTURE_NAME) return readIfoFile();
      if (base === IDX_FIXTURE_NAME) return readIdxFile();
      if (base === DICT_FIXTURE_NAME) return readDictFile();
      throw new Error(`Unknown fixture file: ${base}`);
    },
  });

  it('looks up a real headword and renders the definition', async () => {
    const provider = createStarDictProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('hello', {
      signal: new AbortController().signal,
      container,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('hello');
      expect(outcome.sourceLabel).toBe('CMU American English spelling');
    }
    expect(container.querySelector('h1')?.textContent).toBe('hello');
    const def = container.querySelector('pre')?.textContent ?? '';
    expect(def.length).toBeGreaterThan(0);
  });

  it('returns the same definition shape for several common headwords', async () => {
    const provider = createStarDictProvider({ dict: realDict, fs: makeRealFs() });
    for (const word of ['cat', 'computer', 'world']) {
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

  it('returns empty when the headword is not in the dictionary', async () => {
    const provider = createStarDictProvider({ dict: realDict, fs: makeRealFs() });
    const container = document.createElement('div');
    const outcome = await provider.lookup('zzznonsenseword', {
      signal: new AbortController().signal,
      container,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('caches the StarDict instance — second lookup opens no extra files', async () => {
    const realFs = makeRealFs();
    let opens = 0;
    const wrappedFs = {
      openFile: async (p: string, base: BaseDir) => {
        opens += 1;
        return realFs.openFile(p, base);
      },
    };
    const provider = createStarDictProvider({ dict: realDict, fs: wrappedFs });
    const c1 = document.createElement('div');
    await provider.lookup('hello', { signal: new AbortController().signal, container: c1 });
    const opensAfterInit = opens;
    expect(opensAfterInit).toBe(3); // .ifo, .idx, .dict.dz
    const c2 = document.createElement('div');
    await provider.lookup('world', { signal: new AbortController().signal, container: c2 });
    expect(opens).toBe(opensAfterInit);
  });

  // -------------------------------------------------------------------------
  // Perf regression — bytes read.
  //
  // Lazy reader contract:
  //
  //   Init reads:
  //     - .ifo       → in full, parsed
  //     - .idx       → in full (scan path) OR not at all (sidecar path);
  //                    bytes are discarded after the offsets array is built
  //     - .dict.dz   → only the gzip+FEXTRA header (~hundreds of bytes) plus
  //                    chunk 0 (~16 KB compressed for cmudict) for the
  //                    streaming-inflate viability probe. NOT the whole file.
  //
  //   Per-lookup reads:
  //     - .idx       → ~log2(N) small Blob slices (~16 B each); LRU-cached.
  //     - .dict.dz   → typically 0 or 1 chunk (one chunk holds many entries);
  //                    LRU-cached. The first lookup whose offset falls in
  //                    chunk 0 reads nothing extra (already loaded by the
  //                    init probe). Other chunks read their compressed size
  //                    (cmudict: ~16 KB, eng-nld: ~8 KB).
  //
  // These tests guard:
  //   1. Init does NOT read the full .dict.dz — only header + one chunk.
  //   2. Per-lookup reads from .idx are tiny (≪ file size).
  //   3. Per-lookup .dict.dz reads are bounded by the chunk size budget.
  //   4. Repeat identical lookups → 0 bytes.
  // -------------------------------------------------------------------------
  it('init reads .ifo and .idx in full, and only a small slice of .dict.dz', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeRealFs(), counter);
    const provider = createStarDictProvider({ dict: realDict, fs });
    // Trigger init via a lookup. Using 'aa' lands in the very first .idx
    // probe range, minimizing post-init .idx reads.
    await provider.lookup('aa', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    const realIfo = await readIfoFile();
    const realIdx = await readIdxFile();
    const realDictFile = await readDictFile();
    expect(counter.perFile.get(IFO_FIXTURE_NAME)).toBe(realIfo.size);
    // .idx reads ≥ file size (the init scan needed to build offsets when
    // no sidecar is present) + small overhead for first-lookup probes.
    const idxRead = counter.perFile.get(IDX_FIXTURE_NAME) ?? 0;
    expect(idxRead).toBeGreaterThanOrEqual(realIdx.size);
    expect(idxRead).toBeLessThanOrEqual(realIdx.size + 1024);
    // .dict.dz is read lazily — header probe + one chunk + maybe one more
    // for the lookup. Bound at half the file size; real ratio on cmudict
    // is ~22%.
    const dictRead = counter.perFile.get(DICT_FIXTURE_NAME) ?? 0;
    expect(dictRead).toBeGreaterThan(0);
    expect(dictRead).toBeLessThan(realDictFile.size * 0.5);
  });

  it('per-lookup reads from .idx are bounded (lazy random-access)', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeRealFs(), counter);
    const provider = createStarDictProvider({ dict: realDict, fs });

    // Prime init with one lookup.
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    // Each subsequent lookup should read at most ~log2(105K) × ~16 B ≈
    // 300 B from .idx. Bound at 4 KB.
    const idxBefore = counter.perFile.get(IDX_FIXTURE_NAME) ?? 0;
    let idxLast = idxBefore;
    for (const word of ['cat', 'world', 'computer']) {
      await provider.lookup(word, {
        signal: new AbortController().signal,
        container: document.createElement('div'),
      });
      const idxNow = counter.perFile.get(IDX_FIXTURE_NAME) ?? 0;
      const idxDelta = idxNow - idxLast;
      expect(idxDelta).toBeLessThan(4 * 1024);
      idxLast = idxNow;
    }
  });

  it('per-lookup .dict.dz reads are bounded by the chunk size (lazy decompression)', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeRealFs(), counter);
    const provider = createStarDictProvider({ dict: realDict, fs });

    // Prime init.
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    // Each lookup reads at most one chunk of .dict.dz (typically far less
    // when the chunk is already in the LRU). cmudict's chunks compress to
    // ~16 KB each; bound at 64 KB to absorb format variance.
    let dictLast = counter.perFile.get(DICT_FIXTURE_NAME) ?? 0;
    for (const word of ['cat', 'world', 'computer']) {
      await provider.lookup(word, {
        signal: new AbortController().signal,
        container: document.createElement('div'),
      });
      const dictNow = counter.perFile.get(DICT_FIXTURE_NAME) ?? 0;
      const delta = dictNow - dictLast;
      expect(delta).toBeLessThanOrEqual(64 * 1024);
      dictLast = dictNow;
    }
  });

  it('repeat lookups of the same word warm the LRU → 0 bytes after first', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeRealFs(), counter);
    const provider = createStarDictProvider({ dict: realDict, fs });

    // Cold lookup (also primes init).
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    // Same word again: every .idx probe + .dict.dz chunk hits cache.
    const before = counter.total;
    await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });
    expect(counter.total - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Offset sidecar tests.
//
// At import time, `dictionaryService.importStarDictBundle` writes a
// `.idx.offsets` (and optionally `.syn.offsets`) sidecar so subsequent
// provider inits can skip the full `.idx` scan. These tests verify the
// reader honors the sidecar — and falls back gracefully when it's missing.
// ---------------------------------------------------------------------------

import { scanEntryOffsets, serializeOffsetsSidecar } from '@/services/dictionaries/stardictReader';

describe('starDictProvider — offset sidecar', () => {
  const buildSidecarFile = async (idxFile: File, name: string): Promise<File> => {
    const bytes = new Uint8Array(await idxFile.arrayBuffer());
    const offsets = scanEntryOffsets(bytes, /* payloadBytes */ 8);
    const sidecar = serializeOffsetsSidecar(offsets);
    return new File([new Uint8Array(sidecar)], name);
  };

  const SIDECAR_NAME = 'cmudict.idx.offsets';
  const sidecarDict: ImportedDictionary = {
    id: 'stardict:cmudict-with-sidecar',
    kind: 'stardict',
    name: 'CMU American English spelling',
    bundleDir: 'cmudict-bundle',
    files: {
      ifo: IFO_FIXTURE_NAME,
      idx: IDX_FIXTURE_NAME,
      dict: DICT_FIXTURE_NAME,
      idxOffsets: SIDECAR_NAME,
    },
    addedAt: 1,
  };

  const makeFsWithSidecar = () => ({
    openFile: async (p: string, _base: BaseDir) => {
      const base = p.split('/').pop()!;
      if (base === IFO_FIXTURE_NAME) return readIfoFile();
      if (base === IDX_FIXTURE_NAME) return readIdxFile();
      if (base === DICT_FIXTURE_NAME) return readDictFile();
      if (base === SIDECAR_NAME) {
        return buildSidecarFile(await readIdxFile(), SIDECAR_NAME);
      }
      throw new Error(`Unknown fixture file: ${base}`);
    },
  });

  it('with a sidecar, init does NOT read the full .idx file', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFsWithSidecar(), counter);
    const provider = createStarDictProvider({ dict: sidecarDict, fs });
    await provider.lookup('aa', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    const realIdx = await readIdxFile();
    const idxRead = counter.perFile.get(IDX_FIXTURE_NAME) ?? 0;
    // With sidecar, the reader only reads `.idx` for the lookup probes
    // — well below the full 1.7 MB scan.
    expect(idxRead).toBeLessThan(realIdx.size * 0.05);
    expect(idxRead).toBeLessThan(4 * 1024);

    // Sanity: lookup still works correctly.
    const c = document.createElement('div');
    const outcome = await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: c,
    });
    expect(outcome.ok).toBe(true);
  });

  it('with a sidecar, init bytes saved match the .idx file size minus sidecar size', async () => {
    const counter = makeReadCounter();
    const fs = withReadCounting(makeFsWithSidecar(), counter);
    const provider = createStarDictProvider({ dict: sidecarDict, fs });
    await provider.lookup('aa', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    const realIdx = await readIdxFile();
    const sidecarFile = await buildSidecarFile(realIdx, SIDECAR_NAME);
    const idxRead = counter.perFile.get(IDX_FIXTURE_NAME) ?? 0;
    const sidecarRead = counter.perFile.get(SIDECAR_NAME) ?? 0;

    // Sidecar consumed in full.
    expect(sidecarRead).toBe(sidecarFile.size);
    // For cmudict: sidecar is ~422 KB vs `.idx` 1.7 MB → ~75% reduction
    // in init reads against `.idx`. Bound generously.
    expect(idxRead + sidecarRead).toBeLessThan(realIdx.size);
  });

  it('falls back to scanning .idx when sidecar bytes are corrupted', async () => {
    const corruptedDict: ImportedDictionary = {
      ...sidecarDict,
      id: 'stardict:cmudict-corrupted-sidecar',
    };
    const fs = {
      openFile: async (p: string, _base: BaseDir) => {
        const base = p.split('/').pop()!;
        if (base === IFO_FIXTURE_NAME) return readIfoFile();
        if (base === IDX_FIXTURE_NAME) return readIdxFile();
        if (base === DICT_FIXTURE_NAME) return readDictFile();
        if (base === SIDECAR_NAME) {
          // Garbage bytes — wrong magic.
          return new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0])], SIDECAR_NAME);
        }
        throw new Error(`Unknown fixture file: ${base}`);
      },
    };
    const provider = createStarDictProvider({ dict: corruptedDict, fs });
    const c = document.createElement('div');
    const outcome = await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: c,
    });
    expect(outcome.ok).toBe(true);
  });

  it('falls back to scanning .idx when sidecar is missing on disk', async () => {
    // Simulates a pre-sidecar imported entry where metadata says no sidecar.
    const noSidecarDict: ImportedDictionary = {
      ...sidecarDict,
      id: 'stardict:cmudict-no-sidecar',
      files: { ...sidecarDict.files, idxOffsets: undefined },
    };
    const fs = {
      openFile: async (p: string, _base: BaseDir) => {
        const base = p.split('/').pop()!;
        if (base === IFO_FIXTURE_NAME) return readIfoFile();
        if (base === IDX_FIXTURE_NAME) return readIdxFile();
        if (base === DICT_FIXTURE_NAME) return readDictFile();
        throw new Error(`Unknown fixture file: ${base}`);
      },
    };
    const provider = createStarDictProvider({ dict: noSidecarDict, fs });
    const c = document.createElement('div');
    const outcome = await provider.lookup('hello', {
      signal: new AbortController().signal,
      container: c,
    });
    expect(outcome.ok).toBe(true);
  });
});
