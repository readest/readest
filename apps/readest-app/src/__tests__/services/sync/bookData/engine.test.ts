import { describe, expect, test, vi } from 'vitest';

import { pullBookData, pushBookData, type BookDataKind } from '@/services/sync/bookData/engine';
import { createFileSyncDestination } from '@/services/sync/bookData/fileSyncDestination';
import { createTTSBookDataKind } from '@/services/sync/bookData/ttsKind';
import type { BookDataDestination } from '@/services/sync/bookData/types';
import type {
  SqliteTTSCacheStore,
  TTSPackSidecar,
} from '@/services/tts/providers/sqliteCacheStore';
import { FakeFileSyncProvider } from './fakeFileSyncProvider';

const HASH = 'bookhash1';
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const dec = (b: ArrayBuffer | null) => (b ? new TextDecoder().decode(b) : null);

// A two-file kind like TTS packs: unit 'a.mp3' is ['a.mp3', 'a.json'], the
// '.json' marking it complete.
const makeKind = (local: Record<string, string | null>, have: string[] = []) => {
  const imported: string[] = [];
  const kind: BookDataKind = {
    id: 'tts',
    listLocal: async () => Object.keys(local),
    filesOf: (unit) => [unit, unit.replace(/\.mp3$/, '.json')],
    contentTypeOf: (file) => (file.endsWith('.json') ? 'application/json' : 'audio/mpeg'),
    readLocal: async (unit, file) => {
      const body = local[unit];
      if (body == null) return null;
      return enc(file.endsWith('.json') ? `{"of":"${unit}"}` : body);
    },
    unitOf: (file) => (file.endsWith('.json') ? file.replace(/\.json$/, '.mp3') : null),
    hasLocal: async (unit) => have.includes(unit),
    importUnit: vi.fn(async (unit, read) => {
      if (!(await read(unit))) return false;
      imported.push(unit);
      return true;
    }),
  };
  return { kind, imported };
};

// In-memory destination with a write log.
const makeDest = (id: string, remote: string[] = []) => {
  const files = new Map<string, ArrayBuffer>(remote.map((n) => [n, enc(`remote ${n}`)]));
  const writes: string[] = [];
  const dest: BookDataDestination & {
    files: typeof files;
    writes: string[];
    failWrites: boolean;
    failList: boolean;
    declines: boolean;
  } = {
    id,
    files,
    writes,
    failWrites: false,
    failList: false,
    declines: false,
    async list() {
      if (dest.failList) throw new Error('503');
      if (dest.declines) return null;
      return new Set(files.keys());
    },
    async read(_h, _k, name) {
      return files.get(name) ?? null;
    },
    async write(_h, _k, name, body) {
      if (dest.failWrites) throw new Error('Insufficient storage quota');
      writes.push(name);
      files.set(name, body);
    },
  };
  return dest;
};

describe('pushBookData', () => {
  test('uploads a missing unit, main file before the one that completes it', async () => {
    const { kind } = makeKind({ 'a.mp3': 'mp3' });
    const dest = makeDest('webdav');
    expect(await pushBookData(kind, HASH, [dest])).toBe(1);
    expect(dest.writes).toEqual(['a.mp3', 'a.json']);
  });

  test('pushes to every destination', async () => {
    const { kind } = makeKind({ 'a.mp3': 'mp3' });
    const a = makeDest('webdav');
    const b = makeDest('readest');
    expect(await pushBookData(kind, HASH, [a, b])).toBe(2);
    expect(a.writes).toEqual(['a.mp3', 'a.json']);
    expect(b.writes).toEqual(['a.mp3', 'a.json']);
  });

  test('skips a unit already complete remotely', async () => {
    const { kind } = makeKind({ 'a.mp3': 'mp3' });
    const dest = makeDest('webdav', ['a.mp3', 'a.json']);
    expect(await pushBookData(kind, HASH, [dest])).toBe(0);
    expect(dest.writes).toEqual([]);
  });

  test('re-uploads the main file when its companion is missing', async () => {
    // Readest Cloud lists a file once its row exists, before its bytes land,
    // so a listed main file without its companion may be a ghost.
    const { kind } = makeKind({ 'a.mp3': 'mp3' });
    const dest = makeDest('readest', ['a.mp3']);
    expect(await pushBookData(kind, HASH, [dest])).toBe(1);
    expect(dest.writes).toEqual(['a.mp3', 'a.json']);
  });

  test('a unit that cannot be read locally is skipped, not fatal', async () => {
    const { kind } = makeKind({ 'a.mp3': null, 'b.mp3': 'mp3' });
    const dest = makeDest('webdav');
    expect(await pushBookData(kind, HASH, [dest])).toBe(1);
    expect(dest.writes).toEqual(['b.mp3', 'b.json']);
  });

  test("stops a destination's round at its first failed write", async () => {
    const { kind } = makeKind({ 'a.mp3': 'mp3', 'b.mp3': 'mp3' });
    const a = makeDest('readest');
    a.failWrites = true;
    const write = vi.spyOn(a, 'write');
    const b = makeDest('webdav');
    expect(await pushBookData(kind, HASH, [a, b])).toBe(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(b.writes).toEqual(['a.mp3', 'a.json', 'b.mp3', 'b.json']);
  });

  test('a failing destination does not block the next', async () => {
    const { kind } = makeKind({ 'a.mp3': 'mp3' });
    const a = makeDest('webdav');
    a.failList = true;
    const b = makeDest('gdrive');
    expect(await pushBookData(kind, HASH, [a, b])).toBe(1);
    expect(a.writes).toEqual([]);
    expect(b.writes).toEqual(['a.mp3', 'a.json']);
  });

  test('a destination that declines the book gets nothing', async () => {
    const { kind } = makeKind({ 'a.mp3': 'mp3' });
    const a = makeDest('readest');
    a.declines = true;
    const b = makeDest('webdav');
    expect(await pushBookData(kind, HASH, [a, b])).toBe(1);
    expect(a.writes).toEqual([]);
    expect(b.writes).toEqual(['a.mp3', 'a.json']);
  });

  test('nothing local means no remote traffic at all', async () => {
    const { kind } = makeKind({});
    const dest = makeDest('webdav');
    const list = vi.spyOn(dest, 'list');
    expect(await pushBookData(kind, HASH, [dest])).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('a sync session', () => {
  test('pushes against the listing it already has, adding what it uploads', async () => {
    // A chapter download finishes one section at a time, each starting a push
    // round: listing every destination each round doubled the requests.
    const dest = makeDest('webdav', ['old.mp3', 'old.json']);
    const list = vi.spyOn(dest, 'list');
    const listings = new Map<string, Set<string> | null>();
    await pullBookData(makeKind({}).kind, HASH, [dest], listings);
    expect(list).toHaveBeenCalledTimes(1);

    expect(await pushBookData(makeKind({ 'a.mp3': 'a' }).kind, HASH, [dest], listings)).toBe(1);
    expect(
      await pushBookData(makeKind({ 'a.mp3': 'a', 'b.mp3': 'b' }).kind, HASH, [dest], listings),
    ).toBe(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(dest.writes).toEqual(['a.mp3', 'a.json', 'b.mp3', 'b.json']);
  });

  test('a destination that declined the book stays declined for the session', async () => {
    const dest = makeDest('readest');
    dest.declines = true;
    const list = vi.spyOn(dest, 'list');
    const listings = new Map<string, Set<string> | null>();
    await pushBookData(makeKind({ 'a.mp3': 'a' }).kind, HASH, [dest], listings);
    await pushBookData(makeKind({ 'a.mp3': 'a' }).kind, HASH, [dest], listings);
    expect(list).toHaveBeenCalledTimes(1);
    expect(dest.writes).toEqual([]);
  });
});

describe('pullBookData', () => {
  test('imports units the device does not have', async () => {
    const { kind, imported } = makeKind({}, ['a.mp3']);
    const dest = makeDest('webdav', ['a.mp3', 'a.json', 'b.mp3', 'b.json']);
    expect(await pullBookData(kind, HASH, [dest])).toBe(1);
    expect(imported).toEqual(['b.mp3']);
  });

  test('imports a complete unit once across destinations', async () => {
    const { kind } = makeKind({});
    const a = makeDest('webdav', ['a.mp3', 'a.json']);
    const b = makeDest('readest', ['a.mp3', 'a.json']);
    expect(await pullBookData(kind, HASH, [a, b])).toBe(1);
    expect(kind.importUnit).toHaveBeenCalledTimes(1);
  });

  test('takes a unit from the destination that holds all of it', async () => {
    const { kind } = makeKind({});
    const a = makeDest('readest', ['a.json']);
    const b = makeDest('webdav', ['a.mp3', 'a.json']);
    expect(await pullBookData(kind, HASH, [a, b])).toBe(1);
    const read = vi.mocked(kind.importUnit).mock.calls[0]![1];
    expect(dec(await read('a.mp3'))).toBe('remote a.mp3');
  });

  test('skips a unit missing its main file', async () => {
    const { kind } = makeKind({});
    const dest = makeDest('webdav', ['a.json']);
    expect(await pullBookData(kind, HASH, [dest])).toBe(0);
    expect(kind.importUnit).not.toHaveBeenCalled();
  });

  test('a listing failure is swallowed', async () => {
    const { kind } = makeKind({});
    const dest = makeDest('webdav');
    dest.failList = true;
    await expect(pullBookData(kind, HASH, [dest])).resolves.toBe(0);
  });

  test('a failing import is swallowed and the next unit still lands', async () => {
    const { kind, imported } = makeKind({});
    vi.mocked(kind.importUnit).mockRejectedValueOnce(new Error('disk full'));
    const dest = makeDest('webdav', ['a.mp3', 'a.json', 'b.mp3', 'b.json']);
    expect(await pullBookData(kind, HASH, [dest])).toBe(1);
    expect(imported).toEqual(['b.mp3']);
  });
});

describe('TTS book-data kind', () => {
  const sidecarOf = (name: string): TTSPackSidecar => ({
    version: 1,
    section: 3,
    keysFingerprint: name.replace(/\.mp3$/, ''),
    totalSize: 4,
    entries: [{ key: `k-${name}`, offset: 0, length: 4, boundaries: [] }],
  });
  const makeStore = (packs: string[], have: string[] = []) => {
    const store = {
      listPacks: vi.fn(async () => packs.map((name) => ({ name, size: 4 }))),
      readPackBytes: vi.fn(async (name: string) => (packs.includes(name) ? enc('mp3') : null)),
      buildPackSidecar: vi.fn(async (name: string) =>
        packs.includes(name) ? sidecarOf(name) : null,
      ),
      hasPack: vi.fn(async (name: string) => have.includes(name)),
      importPack: vi.fn(async () => true),
    };
    return store;
  };
  const asStore = (s: ReturnType<typeof makeStore>) => s as unknown as SqliteTTSCacheStore;

  test('describes packs as an mp3 completed by its json sidecar', async () => {
    const store = makeStore(['3-f.mp3']);
    const kind = createTTSBookDataKind(asStore(store));
    expect(kind.id).toBe('tts');
    expect(await kind.listLocal()).toEqual(['3-f.mp3']);
    expect(kind.filesOf('3-f.mp3')).toEqual(['3-f.mp3', '3-f.json']);
    expect(kind.unitOf('3-f.json')).toBe('3-f.mp3');
    expect(kind.unitOf('3-f.mp3')).toBeNull();
    expect(kind.contentTypeOf('3-f.mp3')).toBe('audio/mpeg');
    expect(kind.contentTypeOf('3-f.json')).toBe('application/json');
    expect(dec(await kind.readLocal('3-f.mp3', '3-f.mp3'))).toBe('mp3');
    expect(JSON.parse(dec(await kind.readLocal('3-f.mp3', '3-f.json'))!)).toEqual(
      sidecarOf('3-f.mp3'),
    );
  });

  test('imports a pack from its remote files', async () => {
    const store = makeStore([]);
    const kind = createTTSBookDataKind(asStore(store));
    const remote: Record<string, ArrayBuffer> = {
      '3-f.mp3': enc('mp3'),
      '3-f.json': enc(JSON.stringify(sidecarOf('3-f.mp3'))),
    };
    expect(await kind.importUnit('3-f.mp3', async (f) => remote[f] ?? null)).toBe(true);
    expect(store.importPack).toHaveBeenCalledWith(remote['3-f.mp3'], sidecarOf('3-f.mp3'));
  });

  test('refuses a malformed sidecar', async () => {
    const store = makeStore([]);
    const kind = createTTSBookDataKind(asStore(store));
    const read = async (f: string) => (f.endsWith('.json') ? enc('{not json') : enc('mp3'));
    expect(await kind.importUnit('3-f.mp3', read)).toBe(false);
    expect(store.importPack).not.toHaveBeenCalled();
  });

  test('round-trips through a file-sync backend at books/<hash>/tts/', async () => {
    const provider = new FakeFileSyncProvider();
    const from = makeStore(['3-f.mp3']);
    await pushBookData(createTTSBookDataKind(asStore(from)), HASH, [
      createFileSyncDestination('webdav', provider),
    ]);
    expect([...provider.files.keys()]).toEqual([
      '/Readest/books/bookhash1/tts/3-f.mp3',
      '/Readest/books/bookhash1/tts/3-f.json',
    ]);
    const to = makeStore([]);
    expect(
      await pullBookData(createTTSBookDataKind(asStore(to)), HASH, [
        createFileSyncDestination('webdav', provider),
      ]),
    ).toBe(1);
    const [bytes, sidecar] = vi.mocked(to.importPack).mock.calls[0]! as unknown as [
      ArrayBuffer,
      TTSPackSidecar,
    ];
    expect(dec(bytes)).toBe('mp3');
    expect(sidecar).toEqual(sidecarOf('3-f.mp3'));
  });
});
