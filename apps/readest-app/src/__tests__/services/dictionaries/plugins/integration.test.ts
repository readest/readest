import { afterEach, describe, expect, test } from 'vitest';
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

describe('bundled dictionary plugin integration', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
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
        indexVersion: 1,
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
        indexVersion: 1,
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
});
