import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FileSyncError } from '@/services/sync/file/provider';
import { runSemanticContract } from '../../file/providerSemanticContract';

/**
 * In-memory fake of the slice of @tauri-apps/plugin-fs the provider uses,
 * plus a fake native bridge. `forbidden` simulates a Tauri fs-scope denial
 * (the plugin rejects with a "forbidden path" error), which the provider
 * maps to AUTH_FAILED — the closest thing iCloud has to an auth failure.
 */
const state = vi.hoisted(() => ({
  files: new Map<string, string | Uint8Array>(),
  dirs: new Set<string>(),
  forbidden: false,
  ensureDownloadedCalls: [] as string[],
}));

const deny = (path: string) => {
  if (state.forbidden) throw new Error(`forbidden path: ${path}`);
};
const missing = (path: string) => new Error(`No such file or directory (os error 2): ${path}`);

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => {
    deny(path);
    return state.files.has(path) || state.dirs.has(path);
  },
  readTextFile: async (path: string) => {
    deny(path);
    const body = state.files.get(path);
    if (body === undefined) throw missing(path);
    return typeof body === 'string' ? body : new TextDecoder().decode(body);
  },
  readFile: async (path: string) => {
    deny(path);
    const body = state.files.get(path);
    if (body === undefined) throw missing(path);
    return typeof body === 'string' ? new TextEncoder().encode(body) : body;
  },
  writeTextFile: async (path: string, body: string) => {
    deny(path);
    state.files.set(path, body);
  },
  writeFile: async (path: string, body: Uint8Array) => {
    deny(path);
    state.files.set(path, body);
  },
  mkdir: async (path: string) => {
    deny(path);
    state.dirs.add(path);
  },
  readDir: async (path: string) => {
    deny(path);
    if (!state.dirs.has(path)) throw missing(path);
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const p of [...state.files.keys(), ...state.dirs]) {
      if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]!);
    }
    return [...names].map((name) => ({
      name,
      isDirectory: state.dirs.has(`${prefix}${name}`),
      isFile: !state.dirs.has(`${prefix}${name}`),
      isSymlink: false,
    }));
  },
  remove: async (path: string, opts?: { recursive?: boolean }) => {
    deny(path);
    if (!state.files.has(path) && !state.dirs.has(path)) throw missing(path);
    state.files.delete(path);
    state.dirs.delete(path);
    if (opts?.recursive) {
      for (const p of [...state.files.keys()]) if (p.startsWith(`${path}/`)) state.files.delete(p);
      for (const p of [...state.dirs]) if (p.startsWith(`${path}/`)) state.dirs.delete(p);
    }
  },
  rename: async (from: string, to: string) => {
    deny(from);
    const body = state.files.get(from);
    if (body === undefined) throw missing(from);
    state.files.delete(from);
    state.files.set(to, body);
  },
  copyFile: async (from: string, to: string) => {
    deny(from);
    const body = state.files.get(from);
    if (body === undefined) throw missing(from);
    state.files.set(to, body);
  },
  stat: async (path: string) => {
    deny(path);
    if (state.dirs.has(path)) return { isDirectory: true, isFile: false, size: 0, mtime: null };
    const body = state.files.get(path);
    if (body === undefined) throw missing(path);
    return {
      isDirectory: false,
      isFile: true,
      size: typeof body === 'string' ? body.length : body.byteLength,
      mtime: new Date('2026-08-06T00:00:00Z'),
    };
  },
}));

vi.mock('@/utils/bridge', () => ({
  getICloudContainerStatus: async () => ({ available: true, documentsPath: '/icloud/Documents' }),
  icloudEnsureDownloaded: async ({ path }: { path: string }) => {
    if (state.forbidden) throw new Error(`forbidden path: ${path}`);
    state.ensureDownloadedCalls.push(path);
    if (state.files.has(path)) return { status: 'ready' };
    // Simulate the daemon materialising a placeholder-backed file.
    const i = path.lastIndexOf('/');
    const placeholder = `${path.slice(0, i + 1)}.${path.slice(i + 1)}.icloud`;
    if (state.files.has(placeholder)) {
      state.files.set(path, 'downloaded');
      state.files.delete(placeholder);
      return { status: 'ready' };
    }
    return { status: 'notFound' };
  },
}));

import { createICloudProvider } from '@/services/sync/providers/icloud/ICloudProvider';

const DOCS = '/icloud/Documents';
const abs = (p: string) => `${DOCS}${p}`;

beforeEach(() => {
  state.files.clear();
  state.dirs.clear();
  state.forbidden = false;
  state.ensureDownloadedCalls = [];
  for (const dir of [DOCS, abs('/Readest'), abs('/Readest/books')]) state.dirs.add(dir);
});

runSemanticContract('iCloud', () => ({
  makeProvider: () => createICloudProvider(DOCS),
  stageAbsent: () => {},
  stageAuthFailure: () => {
    state.forbidden = true;
  },
}));

describe('ICloudProvider specifics', () => {
  const provider = () => createICloudProvider(DOCS);

  test('readText materialises a placeholder before reading', async () => {
    state.files.set(abs('/Readest/.library.json.icloud'), 'placeholder');
    expect(await provider().readText('/Readest/library.json')).toBe('downloaded');
    expect(state.ensureDownloadedCalls).toContain(abs('/Readest/library.json'));
  });

  test('writeText is atomic: writes a temp file then renames, leaving no strays', async () => {
    await provider().writeText('/Readest/library.json', '{"v":1}');
    expect(state.files.get(abs('/Readest/library.json'))).toBe('{"v":1}');
    expect([...state.files.keys()].filter((k) => k.includes('.readest-tmp-'))).toEqual([]);
  });

  test('list coalesces .icloud placeholders and hides dot files', async () => {
    state.files.set(abs('/Readest/books/aaa.epub'), 'x');
    state.files.set(abs('/Readest/books/.bbb.epub.icloud'), 'p');
    state.files.set(abs('/Readest/books/.DS_Store'), 'junk');
    state.files.set(abs('/Readest/books/.readest-tmp-zz'), 'tmp');
    const entries = await provider().list('/Readest/books');
    expect(entries.map((e) => e.name).sort()).toEqual(['aaa.epub', 'bbb.epub']);
    const placeholder = entries.find((e) => e.name === 'bbb.epub')!;
    expect(placeholder.path).toBe('/Readest/books/bbb.epub');
    expect(placeholder.size).toBeUndefined();
  });

  test('head reports a placeholder-only file as existing without downloading it', async () => {
    state.files.set(abs('/Readest/books/.big.epub.icloud'), 'p');
    expect(await provider().head('/Readest/books/big.epub')).toEqual({});
    expect(state.ensureDownloadedCalls).toEqual([]);
  });

  test('ensureDir is idempotent and deleteDir removes recursively', async () => {
    await provider().ensureDir(['/Readest', '/Readest/books', '/Readest/books/h1']);
    await provider().ensureDir(['/Readest/books/h1']);
    state.files.set(abs('/Readest/books/h1/config.json'), '{}');
    await provider().deleteDir('/Readest/books/h1');
    expect(state.files.has(abs('/Readest/books/h1/config.json'))).toBe(false);
  });

  test('uploadStream copies via a temp file; downloadStream materialises first', async () => {
    state.files.set('/appdata/books/h1/book.epub', 'bytes');
    expect(
      await provider().uploadStream!('/Readest/books/h1/book.epub', '/appdata/books/h1/book.epub'),
    ).toBe(true);
    expect(state.files.get(abs('/Readest/books/h1/book.epub'))).toBe('bytes');

    state.files.delete(abs('/Readest/books/h1/book.epub'));
    state.files.set(abs('/Readest/books/h1/.book.epub.icloud'), 'p');
    expect(
      await provider().downloadStream!('/Readest/books/h1/book.epub', '/appdata/out.epub'),
    ).toBe(true);
    expect(state.files.get('/appdata/out.epub')).toBe('downloaded');
  });

  test('a forbidden-path failure surfaces as AUTH_FAILED', async () => {
    state.forbidden = true;
    const err = await provider()
      .writeText('/Readest/library.json', '{}')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileSyncError);
    expect((err as FileSyncError).code).toBe('AUTH_FAILED');
  });
});
