import { beforeEach, describe, expect, test, vi } from 'vitest';

import { FileEntry, FileSyncProvider } from '@/services/sync/file/provider';
import {
  pullTTSPacks,
  pushTTSPacks,
  TTSPackDestination,
  TTSPackSource,
} from '@/services/sync/file/ttsPackSync';
import type { TTSPackSidecar } from '@/services/tts/providers/sqliteCacheStore';

const HASH = 'bookhash1';
const TTS_DIR = '/Readest/books/bookhash1/tts';

const sidecarOf = (name: string): TTSPackSidecar => ({
  version: 1,
  section: 3,
  keysFingerprint: name.replace(/\.mp3$/, ''),
  totalSize: 4,
  entries: [{ key: `k-${name}`, offset: 0, length: 4, boundaries: [] }],
});

// In-memory provider: path -> bytes/text, with an operation log so tests can
// assert ordering (mp3 must land before its sidecar).
class FakeProvider implements FileSyncProvider {
  rootPath = '/';
  files = new Map<string, ArrayBuffer | string>();
  ops: string[] = [];
  listError: Error | null = null;

  async readText(path: string): Promise<string | null> {
    const value = this.files.get(path);
    return typeof value === 'string' ? value : null;
  }
  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const value = this.files.get(path);
    return value instanceof ArrayBuffer ? value : null;
  }
  async head() {
    return null;
  }
  async list(path: string): Promise<FileEntry[]> {
    if (this.listError) throw this.listError;
    const prefix = `${path}/`;
    const out: FileEntry[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        out.push({ name: key.slice(prefix.length), path: key, isDirectory: false });
      }
    }
    if (!out.length) throw new Error('404: no such directory');
    return out;
  }
  async writeText(path: string, body: string): Promise<void> {
    this.ops.push(`writeText:${path}`);
    this.files.set(path, body);
  }
  async writeBinary(path: string, body: ArrayBuffer): Promise<void> {
    this.ops.push(`writeBinary:${path}`);
    this.files.set(path, body);
  }
  async ensureDir(paths: string[]): Promise<void> {
    this.ops.push(`ensureDir:${paths.join(',')}`);
  }
  async deleteDir(): Promise<void> {}
}

const makeSource = (packs: Record<string, ArrayBuffer | null>): TTSPackSource => ({
  listPacks: vi.fn().mockResolvedValue(Object.keys(packs).map((name) => ({ name, size: 4 }))),
  readPackBytes: vi.fn().mockImplementation(async (name: string) => packs[name] ?? null),
  buildPackSidecar: vi
    .fn()
    .mockImplementation(async (name: string) => (packs[name] ? sidecarOf(name) : null)),
});

const makeDest = (
  existing: string[] = [],
): TTSPackDestination & {
  imported: TTSPackSidecar[];
} => {
  const imported: TTSPackSidecar[] = [];
  return {
    imported,
    hasPack: vi.fn().mockImplementation(async (name: string) => existing.includes(name)),
    importPack: vi.fn().mockImplementation(async (_data: ArrayBuffer, s: TTSPackSidecar) => {
      imported.push(s);
      return true;
    }),
  };
};

describe('pushTTSPacks', () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = new FakeProvider();
  });

  test('uploads missing packs, mp3 before sidecar', async () => {
    const source = makeSource({ 'a.mp3': new ArrayBuffer(4) });
    const pushed = await pushTTSPacks(provider, HASH, source);
    expect(pushed).toBe(1);
    expect(provider.files.has(`${TTS_DIR}/a.mp3`)).toBe(true);
    expect(provider.files.has(`${TTS_DIR}/a.json`)).toBe(true);
    const mp3Index = provider.ops.findIndex((op) => op.endsWith('a.mp3'));
    const jsonIndex = provider.ops.findIndex((op) => op.endsWith('a.json'));
    expect(mp3Index).toBeGreaterThanOrEqual(0);
    expect(mp3Index).toBeLessThan(jsonIndex);
  });

  test('skips packs the remote already has', async () => {
    provider.files.set(`${TTS_DIR}/a.mp3`, new ArrayBuffer(4));
    provider.files.set(`${TTS_DIR}/a.json`, JSON.stringify(sidecarOf('a.mp3')));
    const source = makeSource({ 'a.mp3': new ArrayBuffer(4) });
    const pushed = await pushTTSPacks(provider, HASH, source);
    expect(pushed).toBe(0);
    expect(provider.ops.filter((op) => op.startsWith('write'))).toHaveLength(0);
  });

  test('heals a remote pack whose sidecar is missing', async () => {
    provider.files.set(`${TTS_DIR}/a.mp3`, new ArrayBuffer(4));
    const source = makeSource({ 'a.mp3': new ArrayBuffer(4) });
    const pushed = await pushTTSPacks(provider, HASH, source);
    expect(pushed).toBe(1);
    expect(provider.files.has(`${TTS_DIR}/a.json`)).toBe(true);
    // The mp3 itself was not re-uploaded.
    expect(provider.ops.some((op) => op === `writeBinary:${TTS_DIR}/a.mp3`)).toBe(false);
  });

  test('a pack whose bytes cannot be read locally is skipped, not fatal', async () => {
    const source = makeSource({ 'a.mp3': null, 'b.mp3': new ArrayBuffer(4) });
    const pushed = await pushTTSPacks(provider, HASH, source);
    expect(pushed).toBe(1);
    expect(provider.files.has(`${TTS_DIR}/b.mp3`)).toBe(true);
    expect(provider.files.has(`${TTS_DIR}/a.mp3`)).toBe(false);
  });

  test('nothing local means no remote traffic at all', async () => {
    const source = makeSource({});
    expect(await pushTTSPacks(provider, HASH, source)).toBe(0);
    expect(provider.ops).toHaveLength(0);
  });
});

describe('pullTTSPacks', () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = new FakeProvider();
  });

  const remotePack = (name: string) => {
    provider.files.set(`${TTS_DIR}/${name}`, new ArrayBuffer(4));
    provider.files.set(
      `${TTS_DIR}/${name.replace(/\.mp3$/, '.json')}`,
      JSON.stringify(sidecarOf(name)),
    );
  };

  test('imports packs the device does not have', async () => {
    remotePack('a.mp3');
    remotePack('b.mp3');
    const dest = makeDest(['a.mp3']);
    const imported = await pullTTSPacks(provider, HASH, dest);
    expect(imported).toBe(1);
    expect(dest.imported.map((s) => s.keysFingerprint)).toEqual(['b']);
  });

  test('ignores a sidecar without its pack (incomplete upload)', async () => {
    provider.files.set(`${TTS_DIR}/a.json`, JSON.stringify(sidecarOf('a.mp3')));
    const dest = makeDest();
    expect(await pullTTSPacks(provider, HASH, dest)).toBe(0);
    expect(dest.importPack).not.toHaveBeenCalled();
  });

  test('ignores malformed sidecars', async () => {
    provider.files.set(`${TTS_DIR}/a.mp3`, new ArrayBuffer(4));
    provider.files.set(`${TTS_DIR}/a.json`, '{not json');
    const dest = makeDest();
    expect(await pullTTSPacks(provider, HASH, dest)).toBe(0);
  });

  test('a missing remote directory is silence, not an error', async () => {
    const dest = makeDest();
    await expect(pullTTSPacks(provider, HASH, dest)).resolves.toBe(0);
  });

  test('a listing failure is swallowed', async () => {
    provider.listError = new Error('503');
    const dest = makeDest();
    await expect(pullTTSPacks(provider, HASH, dest)).resolves.toBe(0);
  });
});
