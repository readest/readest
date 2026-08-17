import { afterEach, describe, expect, test, vi } from 'vitest';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DictionaryPluginControlStore } from '@/services/dictionaries/plugins/controlStore';
import { importPluginDictionaries } from '@/services/dictionaries/plugins/import';
import { createPluginDictionaryProvider } from '@/services/dictionaries/plugins/provider';
import { materializePluginDictionary } from '@/services/dictionaries/plugins/materialize';
import { yomitanPluginManifest } from '@/plugins/yomitan/manifest';
import { yomitanOperationHandlers } from '@/plugins/yomitan/handlers';
import {
  startPluginWorkerServer,
  type PluginWorkerGlobalLike,
} from '@/services/plugins/workerServer';
import type { PluginWorkerLike } from '@/services/plugins/runtime';
import type { BundledPluginDefinition } from '@/services/plugins/catalog';
import type { BaseDir } from '@/types/system';
import { computePluginDictionaryContentId } from '@/services/dictionaries/plugins/integrity';
import { YOMITAN_PORTABLE_APPLICATION_ID } from '@/plugins/yomitan/importer';

class LoopbackWorker implements PluginWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  private terminated = false;
  private readonly workerScope: PluginWorkerGlobalLike;

  constructor() {
    this.workerScope = {
      onmessage: null,
      postMessage: (message) => {
        queueMicrotask(() => {
          if (!this.terminated) this.onmessage?.(new MessageEvent('message', { data: message }));
        });
      },
    };
    startPluginWorkerServer(this.workerScope, yomitanOperationHandlers);
  }

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      if (!this.terminated) {
        this.workerScope.onmessage?.(new MessageEvent('message', { data: message }));
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const createDictionary = async (): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Reader Japanese', revision: '1', format: 3 })),
  );
  await writer.add(
    'tag_bank_1.json',
    new TextReader(JSON.stringify([['v5', 'partOfSpeech', 1, 'Godan verb', 5]])),
  );
  await writer.add(
    'term_bank_1.json',
    new TextReader(
      JSON.stringify([
        [
          '読む',
          'よむ',
          'v5',
          'v5',
          100,
          [
            {
              type: 'structured-content',
              content: ['to read', { tag: 'img', path: 'read.png', alt: 'stroke order' }],
            },
          ],
          1,
          'v5',
        ],
      ]),
    ),
  );
  await writer.add(
    'read.png',
    new Uint8ArrayReader(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  return new File([await writer.close()], 'reader-japanese.zip', { type: 'application/zip' });
};

const createInvalidDictionary = async (): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Broken Japanese', revision: '1', format: 3 })),
  );
  await writer.add('term_bank_1.json', new TextReader(JSON.stringify([['invalid']])));
  return new File([await writer.close()], 'broken-japanese.zip', { type: 'application/zip' });
};

const createPortableDictionary = async (path: string): Promise<File> => {
  const database = await NodeDatabaseService.open(path);
  await database.execute(`PRAGMA application_id = ${YOMITAN_PORTABLE_APPLICATION_ID}`);
  await database.execute('PRAGMA user_version = 1');
  await database.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  await database.execute(
    'CREATE TABLE terms (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
  );
  await database.execute(
    'CREATE TABLE tags (name TEXT PRIMARY KEY, category TEXT NOT NULL, sort_order REAL NOT NULL, notes TEXT NOT NULL, score REAL NOT NULL)',
  );
  await database.execute(
    'CREATE TABLE term_meta (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, mode TEXT NOT NULL, reading TEXT NOT NULL, payload_json TEXT NOT NULL)',
  );
  await database.execute(
    'CREATE TABLE resources (key TEXT PRIMARY KEY, archive_path TEXT NOT NULL, media_kind TEXT NOT NULL, data BLOB)',
  );
  await database.execute(
    'CREATE TABLE term_banks (bank_order INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  );
  await database.execute(
    "INSERT INTO meta VALUES ('index_version', '2'), ('title', 'Portable Jitendex')",
  );
  await database.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    1,
    '読む',
    'よむ',
    'v5',
    'v5',
    100,
    null,
    1,
    'v5',
    1,
    0,
  ]);
  await database.execute("INSERT INTO tags VALUES ('v5', 'partOfSpeech', 1, 'Godan verb', 5)");
  const bank = [['読む', 'よむ', 'v5', 'v5', 100, ['portable definition'], 1, 'v5']];
  const compressed = new Uint8Array(
    await new Response(
      new Response(JSON.stringify(bank)).body!.pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
  await database.execute('INSERT INTO term_banks VALUES (?, ?)', [1, compressed]);
  await database.close();
  return new File([await readFile(path)], basename(path), { type: 'application/vnd.sqlite3' });
};

describe('bundled dictionary plugin integration', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  test('routes legacy-only files without opening the plugin control database', async () => {
    const openDatabase = vi.fn().mockRejectedValue(new Error('plugin control unavailable'));
    const host = { openDatabase } as unknown as Parameters<typeof importPluginDictionaries>[0];
    const source = { file: new File(['legacy'], 'legacy.bgl') };

    await expect(importPluginDictionaries(host, [source])).resolves.toEqual({
      imported: [],
      replacements: [],
      unclaimed: [source],
      failures: [],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  test('invalidates a missing healthy derived index without retrying the stale pointer', async () => {
    const source = new File(['x'], 'dictionary.zip');
    const dict = {
      id: 'dict-1',
      contentId: 'dict-1',
      kind: 'plugin' as const,
      name: 'Dictionary',
      bundleDir: 'bundle',
      files: { pluginSource: source.name },
      plugin: {
        recordVersion: 1 as const,
        pluginId: 'readest.yomitan',
        formatId: 'yomitan',
        sourceFormatVersion: 3,
        indexVersion: 2,
        source: { filename: source.name, byteSize: source.size, sha256: 'a'.repeat(64) },
      },
      addedAt: 1,
    };
    let active = true;
    const discardFailedGeneration = vi.fn(async () => {
      active = false;
    });
    const controlStore = {
      getActiveGeneration: vi.fn(async () =>
        active
          ? {
              dictionaryId: dict.id,
              pluginId: 'readest.yomitan',
              buildId: 'build-1',
              databasePath: 'missing.sqlite3',
              indexVersion: 2,
              state: 'healthy',
              createdAt: 1,
            }
          : undefined,
      ),
      discardFailedGeneration,
    } as unknown as DictionaryPluginControlStore;
    const openDatabase = vi.fn().mockRejectedValue(new Error('derived database missing'));
    const host = {
      openFile: vi.fn().mockResolvedValue(source),
      openDatabase,
      deleteDatabase: vi.fn(async () => undefined),
    };
    const plugin: BundledPluginDefinition = {
      manifest: yomitanPluginManifest,
      createWorker: () => new LoopbackWorker(),
    };
    const provider = createPluginDictionaryProvider({ dict, host, plugin, controlStore });

    await expect(provider.init!()).rejects.toThrow('derived database missing');
    await expect(provider.init!()).rejects.toThrow(/not materialized/i);
    expect(discardFailedGeneration).toHaveBeenCalledWith(dict.id, 'build-1', 'healthy');
    expect(openDatabase).toHaveBeenCalledOnce();
    provider.dispose?.();
  });

  test('does not invalidate a healthy derived index on a transient busy error', async () => {
    const source = new File(['x'], 'dictionary.zip');
    const dict = {
      id: 'dict-1',
      contentId: 'dict-1',
      kind: 'plugin' as const,
      name: 'Dictionary',
      bundleDir: 'bundle',
      files: { pluginSource: source.name },
      plugin: {
        recordVersion: 1 as const,
        pluginId: 'readest.yomitan',
        formatId: 'yomitan',
        sourceFormatVersion: 3,
        indexVersion: 2,
        source: { filename: source.name, byteSize: source.size, sha256: 'a'.repeat(64) },
      },
      addedAt: 1,
    };
    const discardFailedGeneration = vi.fn(async () => undefined);
    const controlStore = {
      getActiveGeneration: vi.fn(async () => ({
        dictionaryId: dict.id,
        pluginId: 'readest.yomitan',
        buildId: 'build-1',
        databasePath: 'busy.sqlite3',
        indexVersion: 2,
        state: 'healthy',
        createdAt: 1,
      })),
      discardFailedGeneration,
    } as unknown as DictionaryPluginControlStore;
    const host = {
      openFile: vi.fn().mockResolvedValue(source),
      openDatabase: vi.fn().mockRejectedValue(new Error('database is busy')),
      deleteDatabase: vi.fn(async () => undefined),
    };
    const plugin: BundledPluginDefinition = {
      manifest: yomitanPluginManifest,
      createWorker: () => new LoopbackWorker(),
    };
    const provider = createPluginDictionaryProvider({ dict, host, plugin, controlStore });

    await expect(provider.init!()).rejects.toThrow('database is busy');
    expect(discardFailedGeneration).not.toHaveBeenCalled();
    provider.dispose?.();
  });

  test('imports through Worker RPC and renders through the active read-only generation', async () => {
    root = await mkdtemp(join(tmpdir(), 'readest-yomitan-'));
    const resolve = (path: string, base: BaseDir): string =>
      base === 'None' ? path : join(root!, path);
    const host = {
      openFile: async (path: string, base: BaseDir): Promise<File> => {
        const fullPath = resolve(path, base);
        return new File([await readFile(fullPath)], basename(fullPath));
      },
      createDir: async (path: string, base: BaseDir): Promise<void> => {
        await mkdir(resolve(path, base), { recursive: true });
      },
      writeFile: async (
        path: string,
        base: BaseDir,
        content: string | ArrayBuffer | File,
      ): Promise<void> => {
        const fullPath = resolve(path, base);
        await mkdir(dirname(fullPath), { recursive: true });
        if (typeof content === 'string') await writeFile(fullPath, content);
        else if (content instanceof File) {
          await writeFile(fullPath, new Uint8Array(await content.arrayBuffer()));
        } else await writeFile(fullPath, new Uint8Array(content));
      },
      installDatabase: async (path: string, base: BaseDir, source: File): Promise<void> => {
        await writeFile(resolve(path, base), new Uint8Array(await source.arrayBuffer()));
      },
      deleteDir: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { recursive: true, force: true });
      },
      openDatabase: async (_schema: string, path: string, base: BaseDir) =>
        NodeDatabaseService.open(resolve(path, base)),
      deleteDatabase: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { force: true });
        await rm(`${resolve(path, base)}-wal`, { force: true });
      },
    };
    const controlDb = await NodeDatabaseService.open(join(root, 'control.sqlite3'));
    const controlStore = new DictionaryPluginControlStore(controlDb, {
      createId: () => 'owner-1',
      deleteDatabase: (path) => host.deleteDatabase(path, 'Dictionaries'),
    });
    await controlStore.initialize();
    const plugin: BundledPluginDefinition = {
      manifest: yomitanPluginManifest,
      createWorker: () => new LoopbackWorker(),
    };

    const imported = await importPluginDictionaries(
      host,
      [{ file: await createDictionary() }],
      [],
      {
        resolvePlugin: () => plugin,
        controlStore,
        createBuildId: () => 'build-1',
        isWorkerSupported: () => true,
      },
    );
    expect(imported.unclaimed).toEqual([]);
    expect(imported.imported).toHaveLength(1);
    const dict = imported.imported[0]!;
    expect(dict).toMatchObject({
      kind: 'plugin',
      name: 'Reader Japanese',
      files: { pluginSource: 'reader-japanese.zip' },
      plugin: {
        recordVersion: 1,
        pluginId: 'readest.yomitan',
        formatId: 'yomitan',
        sourceFormatVersion: 3,
        indexVersion: 2,
      },
    });
    expect(dict.plugin?.source.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(await controlStore.getActiveGeneration(dict.id)).toMatchObject({
      buildId: 'build-1',
      state: 'healthy',
    });

    const provider = createPluginDictionaryProvider({ dict, host, plugin, controlStore });
    const container = document.createElement('div');
    await expect(
      provider.lookup('読みました', {
        signal: new AbortController().signal,
        container,
      }),
    ).resolves.toMatchObject({ ok: true, headword: '読む' });
    expect(container.textContent).toContain('to read');
    expect(container.querySelector('img')?.src).toMatch(/^data:image\/png;base64,/u);
    provider.dispose?.();
    await controlDb.close();
  });

  test('returns earlier successful imports when a later plugin source fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'readest-yomitan-partial-'));
    const resolve = (path: string, base: BaseDir): string =>
      base === 'None' ? path : join(root!, path);
    const host = {
      openFile: async (path: string, base: BaseDir): Promise<File> => {
        const fullPath = resolve(path, base);
        return new File([await readFile(fullPath)], basename(fullPath));
      },
      createDir: async (path: string, base: BaseDir): Promise<void> => {
        await mkdir(resolve(path, base), { recursive: true });
      },
      writeFile: async (
        path: string,
        base: BaseDir,
        content: string | ArrayBuffer | File,
      ): Promise<void> => {
        const fullPath = resolve(path, base);
        await mkdir(dirname(fullPath), { recursive: true });
        if (typeof content === 'string') await writeFile(fullPath, content);
        else if (content instanceof File) {
          await writeFile(fullPath, new Uint8Array(await content.arrayBuffer()));
        } else await writeFile(fullPath, new Uint8Array(content));
      },
      installDatabase: async (path: string, base: BaseDir, source: File): Promise<void> => {
        await writeFile(resolve(path, base), new Uint8Array(await source.arrayBuffer()));
      },
      deleteDir: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { recursive: true, force: true });
      },
      openDatabase: async (_schema: string, path: string, base: BaseDir) =>
        NodeDatabaseService.open(resolve(path, base)),
      deleteDatabase: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { force: true });
        await rm(`${resolve(path, base)}-wal`, { force: true });
      },
    };
    const controlDb = await NodeDatabaseService.open(join(root, 'control.sqlite3'));
    const controlStore = new DictionaryPluginControlStore(controlDb, {
      createId: () => 'owner-1',
      deleteDatabase: (path) => host.deleteDatabase(path, 'Dictionaries'),
    });
    await controlStore.initialize();
    const plugin: BundledPluginDefinition = {
      manifest: yomitanPluginManifest,
      createWorker: () => new LoopbackWorker(),
    };
    let build = 0;

    const result = await importPluginDictionaries(
      host,
      [{ file: await createDictionary() }, { file: await createInvalidDictionary() }],
      [],
      {
        resolvePlugin: () => plugin,
        controlStore,
        createBuildId: () => `build-${++build}`,
        isWorkerSupported: () => true,
      },
    );

    expect(result.imported).toHaveLength(1);
    expect(result).toMatchObject({
      failures: [
        { name: 'broken-japanese.zip', message: expect.stringMatching(/invalid|too small/i) },
      ],
    });
    await controlDb.close();
  });

  test('verifies a synced source before rebuilding its device-local index', async () => {
    root = await mkdtemp(join(tmpdir(), 'readest-yomitan-sync-'));
    const resolve = (path: string, base: BaseDir): string =>
      base === 'None' ? path : join(root!, path);
    const host = {
      openFile: async (path: string, base: BaseDir): Promise<File> => {
        const fullPath = resolve(path, base);
        return new File([await readFile(fullPath)], basename(fullPath));
      },
      openDatabase: async (_schema: string, path: string, base: BaseDir) =>
        NodeDatabaseService.open(resolve(path, base)),
      installDatabase: async (path: string, base: BaseDir, source: File): Promise<void> => {
        await writeFile(resolve(path, base), new Uint8Array(await source.arrayBuffer()));
      },
      deleteDatabase: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { force: true });
        await rm(`${resolve(path, base)}-wal`, { force: true });
      },
    };
    const source = await createDictionary();
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const { sha256File } = await import('@/services/dictionaries/plugins/integrity');
    const sha256 = await sha256File(source);
    const bundleDir = 'remote-bundle';
    await mkdir(join(root, bundleDir), { recursive: true });
    await writeFile(join(root, bundleDir, source.name), sourceBytes);
    const dictionaryId = computePluginDictionaryContentId('readest.yomitan', 'yomitan', [
      { name: source.name, byteSize: source.size, sha256 },
    ]);
    const dict = {
      id: dictionaryId,
      contentId: dictionaryId,
      kind: 'plugin' as const,
      name: 'Reader Japanese',
      bundleDir,
      files: { pluginSource: source.name },
      plugin: {
        recordVersion: 1 as const,
        pluginId: 'readest.yomitan',
        formatId: 'yomitan',
        sourceFormatVersion: 3,
        indexVersion: 2,
        source: { filename: source.name, byteSize: source.size, sha256 },
      },
      addedAt: Date.now(),
      unavailable: true,
    };
    const controlDb = await NodeDatabaseService.open(join(root, 'remote-control.sqlite3'));
    const controlStore = new DictionaryPluginControlStore(controlDb, {
      createId: () => 'remote-owner',
      deleteDatabase: (path) => host.deleteDatabase(path, 'Dictionaries'),
    });
    await controlStore.initialize();
    const plugin: BundledPluginDefinition = {
      manifest: yomitanPluginManifest,
      createWorker: () => new LoopbackWorker(),
    };

    await expect(
      materializePluginDictionary(host, dict, {
        plugin,
        controlStore,
        createBuildId: () => 'remote-build',
        isWorkerSupported: () => true,
      }),
    ).resolves.toMatchObject({ state: 'healthy', buildId: 'remote-build' });

    await writeFile(join(root, bundleDir, source.name), new Uint8Array([1, 2, 3]));
    await expect(
      materializePluginDictionary(host, dict, {
        plugin,
        controlStore,
        createBuildId: () => 'corrupt-build',
        isWorkerSupported: () => true,
        force: true,
      }),
    ).rejects.toThrow(/integrity|size|sha-256/i);
    expect(await controlStore.getGeneration(dict.id, 'corrupt-build')).toBeUndefined();
    await controlDb.close();
  });

  test('installs a portable index without rebuilding its Yomitan banks', async () => {
    root = await mkdtemp(join(tmpdir(), 'readest-yomitan-portable-'));
    const resolve = (path: string, base: BaseDir): string =>
      base === 'None' ? path : join(root!, path);
    let installedDatabases = 0;
    const host = {
      openFile: async (path: string, base: BaseDir): Promise<File> => {
        const fullPath = resolve(path, base);
        return new File([await readFile(fullPath)], basename(fullPath));
      },
      createDir: async (path: string, base: BaseDir): Promise<void> => {
        await mkdir(resolve(path, base), { recursive: true });
      },
      writeFile: async (
        path: string,
        base: BaseDir,
        content: string | ArrayBuffer | File,
      ): Promise<void> => {
        const fullPath = resolve(path, base);
        await mkdir(dirname(fullPath), { recursive: true });
        if (typeof content === 'string') await writeFile(fullPath, content);
        else if (content instanceof File) {
          await writeFile(fullPath, new Uint8Array(await content.arrayBuffer()));
        } else await writeFile(fullPath, new Uint8Array(content));
      },
      installDatabase: async (path: string, base: BaseDir, source: File): Promise<void> => {
        installedDatabases += 1;
        const fullPath = resolve(path, base);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, new Uint8Array(await source.arrayBuffer()));
      },
      deleteDir: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { recursive: true, force: true });
      },
      openDatabase: async (_schema: string, path: string, base: BaseDir) =>
        NodeDatabaseService.open(resolve(path, base)),
      deleteDatabase: async (path: string, base: BaseDir): Promise<void> => {
        await rm(resolve(path, base), { force: true });
        await rm(`${resolve(path, base)}-wal`, { force: true });
      },
    };
    const controlDb = await NodeDatabaseService.open(join(root, 'portable-control.sqlite3'));
    const controlStore = new DictionaryPluginControlStore(controlDb, {
      createId: () => 'portable-owner',
      deleteDatabase: (path) => host.deleteDatabase(path, 'Dictionaries'),
    });
    await controlStore.initialize();
    const plugin: BundledPluginDefinition = {
      manifest: yomitanPluginManifest,
      createWorker: () => new LoopbackWorker(),
    };
    const source = await createPortableDictionary(join(root, 'portable-jitendex.rdict'));

    const imported = await importPluginDictionaries(host, [{ file: source }], [], {
      resolvePlugin: () => plugin,
      controlStore,
      createBuildId: () => 'portable-build',
      isWorkerSupported: () => true,
    });

    expect(installedDatabases).toBe(1);
    expect(imported.imported[0]).toMatchObject({
      name: 'Portable Jitendex',
      plugin: { formatId: 'yomitan-indexed', indexVersion: 2 },
    });
    const dict = imported.imported[0]!;
    const provider = createPluginDictionaryProvider({ dict, host, plugin, controlStore });
    const container = document.createElement('div');
    await expect(
      provider.lookup('読みました', { signal: new AbortController().signal, container }),
    ).resolves.toMatchObject({ ok: true, headword: '読む' });
    expect(container.textContent).toContain('portable definition');
    provider.dispose?.();
    await controlDb.close();
  });
});
