import { afterEach, expect, test } from 'vitest';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { WebDatabaseService } from '@/services/database/webDatabaseService';
import { WebAppService } from '@/services/webAppService';
import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import { getBundledPlugin } from '@/services/plugins/catalog';
import { createPluginHostCallHandler } from '@/services/plugins/hostCalls';
import { createPluginRuntime } from '@/services/plugins/runtime';
import { importPluginDictionaries } from '@/services/dictionaries/plugins/import';
import {
  buildYomitanIndex,
  YOMITAN_PORTABLE_APPLICATION_ID,
  type YomitanHost,
} from '@/plugins/yomitan/importer';

const createDictionary = async (termCount = 1): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Browser Japanese', revision: '1', format: 3 })),
  );
  await writer.add(
    'term_bank_1.json',
    new TextReader(
      JSON.stringify(
        Array.from({ length: termCount }, (_, index) => [
          index === 0 ? '読む' : `語${index}`,
          index === 0 ? 'よむ' : `ご${index}`,
          'v5',
          'v5',
          100,
          [
            {
              type: 'structured-content',
              content: ['to read', { tag: 'img', path: 'read.png', alt: 'stroke order' }],
            },
          ],
          index + 1,
          'v5',
        ]),
      ),
    ),
  );
  await writer.add(
    'read.png',
    new Uint8ArrayReader(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  return new File([await writer.close()], 'browser-japanese.zip', {
    type: 'application/zip',
  });
};

const createPortableDictionary = async (): Promise<File> => {
  const source = await createDictionary();
  const databaseName = `readest-yomitan-portable-source-${crypto.randomUUID()}.sqlite3`;
  const database = await WebDatabaseService.open(databaseName);
  const host: YomitanHost = {
    signal: new AbortController().signal,
    stat: async () => ({ name: source.name, size: source.size, type: source.type }),
    readRange: async (_handle, offset, length) => ({
      bytes: new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()),
    }),
    execute: async (_handle, sql, params = []) => database.execute(sql, params),
    select: async (_handle, sql, params = []) => ({ rows: await database.select(sql, params) }),
    transaction: async (_handle, statements) => {
      await database.execute('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await database.execute(statement.sql, statement.params ?? []));
        }
        await database.execute('COMMIT');
        return { results };
      } catch (error) {
        await database.execute('ROLLBACK');
        throw error;
      }
    },
    progress: () => undefined,
  };
  await buildYomitanIndex(
    host,
    {
      dictionaryId: 'portable-source',
      sourceHandle: 'source',
      databaseHandle: 'database',
      sourceFormatVersion: 3,
    },
    { storage: 'banked' },
  );
  await database.execute(`PRAGMA application_id = ${YOMITAN_PORTABLE_APPLICATION_ID}`);
  await database.execute('PRAGMA user_version = 1');
  await database.close();
  const root = await navigator.storage.getDirectory();
  const file = await (await root.getFileHandle(databaseName)).getFile();
  const header = new Uint8Array(await file.slice(0, 100).arrayBuffer());
  expect(new TextDecoder().decode(header.subarray(0, 16))).toBe('SQLite format 3\0');
  expect(new DataView(header.buffer).getUint32(68, false)).toBe(YOMITAN_PORTABLE_APPLICATION_ID);
  const portable = new File([await file.arrayBuffer()], 'browser-japanese.rdict', {
    type: 'application/vnd.sqlite3',
  });
  await root.removeEntry(databaseName).catch(() => undefined);
  await root.removeEntry(`${databaseName}-wal`).catch(() => undefined);
  return portable;
};

let closeRuntime: (() => void) | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

afterEach(async () => {
  closeRuntime?.();
  await closeDatabase?.();
  closeRuntime = undefined;
  closeDatabase = undefined;
});

test('builds and queries a Yomitan dictionary through a real Worker and browser SQLite', async () => {
  const pluginId = 'readest.yomitan';
  const dictionaryId = 'browser-dictionary';
  const source = await createDictionary(1_000);
  const sourceBroker = new SourceBroker();
  const sqlBroker = new SqlBroker();
  const sourceHandle = sourceBroker.register({ pluginId }, source);
  const databaseName = `readest-yomitan-${crypto.randomUUID()}.sqlite3`;
  let database = await WebDatabaseService.open(databaseName);
  closeDatabase = async () => {
    await database.close();
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(databaseName).catch(() => undefined);
    await root.removeEntry(`${databaseName}-wal`).catch(() => undefined);
  };
  const databaseHandle = await sqlBroker.register({ pluginId, dictionaryId }, database, 'staging');
  const runtime = createPluginRuntime({
    createWorker: () =>
      new Worker(new URL('../../../../plugins/yomitan/worker.ts', import.meta.url), {
        type: 'module',
      }),
    handleHostCall: createPluginHostCallHandler(pluginId, sourceBroker, sqlBroker),
  });
  closeRuntime = runtime.close;

  await expect(
    runtime.call('probe', {
      sources: [{ handle: sourceHandle, name: source.name, size: source.size }],
    }),
  ).resolves.toMatchObject({
    matches: [{ formatId: 'yomitan', confidence: 1 }],
  });
  const inspected = await runtime.call('inspect', { sourceHandle });
  expect(inspected).toMatchObject({ title: 'Browser Japanese', sourceFormatVersion: 3 });

  sourceBroker.rebind(sourceHandle, { pluginId, dictionaryId });
  await expect(
    runtime.call('buildIndex', {
      dictionaryId,
      sourceHandle,
      databaseHandle,
      sourceFormatVersion: inspected.sourceFormatVersion,
    }),
  ).resolves.toMatchObject({ indexVersion: 2, entries: 1_000, resources: 1 });
  await expect(
    runtime.call('verifyIndex', { dictionaryId, databaseHandle }),
  ).resolves.toMatchObject({ indexVersion: 2, entries: 1_000 });

  sqlBroker.revoke(databaseHandle);
  await database.close();
  database = await WebDatabaseService.open(databaseName);
  const activeDatabaseHandle = await sqlBroker.register(
    { pluginId, dictionaryId },
    database,
    'active',
  );
  const lookup = await runtime.call('lookup', {
    dictionaryId,
    databaseHandle: activeDatabaseHandle,
    query: '読みました',
    language: 'ja',
  });
  expect(lookup.entries[0]).toMatchObject({ expression: '読む', reading: 'よむ' });
  expect(JSON.stringify(lookup.entries[0]?.definitions)).toContain('read.png');

  await expect(
    runtime.call('readResource', {
      dictionaryId,
      sourceHandle,
      databaseHandle: activeDatabaseHandle,
      resourceRef: 'read.png',
    }),
  ).resolves.toMatchObject({
    mimeType: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  });
});

test('imports a Yomitan dictionary through the browser app service', async () => {
  const appService = new WebAppService();
  const source = await createDictionary();
  const bundledPlugin = getBundledPlugin('readest.yomitan');
  if (!bundledPlugin) throw new Error('Bundled Yomitan plugin is missing');
  const result = await importPluginDictionaries(appService, [{ file: source }], [], {
    resolvePlugin: () => ({
      ...bundledPlugin,
      createWorker: () =>
        new Worker(new URL('../../../../plugins/yomitan/worker.ts', import.meta.url), {
          type: 'module',
        }),
    }),
  });
  const dictionary = result.imported[0];

  try {
    expect(result.unclaimed).toEqual([]);
    expect(result.replacements).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(dictionary).toMatchObject({
      name: 'Browser Japanese',
      kind: 'plugin',
      plugin: { pluginId: 'readest.yomitan', formatId: 'yomitan' },
    });
  } finally {
    if (dictionary) await appService.deleteDictionary(dictionary);
  }
});

test('installs and queries a portable Yomitan database through browser OPFS', async () => {
  const appService = new WebAppService();
  const source = await createPortableDictionary();
  expect(source.size).toBeGreaterThan(100);
  const bundledPlugin = getBundledPlugin('readest.yomitan');
  if (!bundledPlugin) throw new Error('Bundled Yomitan plugin is missing');
  const probeSourceBroker = new SourceBroker();
  const probeSqlBroker = new SqlBroker();
  const probeSourceHandle = probeSourceBroker.register(
    { pluginId: bundledPlugin.manifest.id },
    source,
  );
  const probeRuntime = createPluginRuntime({
    createWorker: () =>
      new Worker(new URL('../../../../plugins/yomitan/worker.ts', import.meta.url), {
        type: 'module',
      }),
    handleHostCall: createPluginHostCallHandler(
      bundledPlugin.manifest.id,
      probeSourceBroker,
      probeSqlBroker,
    ),
  });
  await expect(
    probeRuntime.call('probe', {
      sources: [{ handle: probeSourceHandle, name: source.name, size: source.size }],
    }),
  ).resolves.toMatchObject({ matches: [{ formatId: 'yomitan-indexed', confidence: 1 }] });
  probeRuntime.close();
  const result = await importPluginDictionaries(appService, [{ file: source }], [], {
    resolvePlugin: () => ({
      ...bundledPlugin,
      createWorker: () =>
        new Worker(new URL('../../../../plugins/yomitan/worker.ts', import.meta.url), {
          type: 'module',
        }),
    }),
  });
  const dictionary = result.imported[0];

  try {
    expect(result.unclaimed).toEqual([]);
    expect(result.replacements).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(dictionary).toMatchObject({
      name: 'Browser Japanese',
      kind: 'plugin',
      plugin: { formatId: 'yomitan-indexed', indexVersion: 2 },
    });
  } finally {
    if (dictionary) await appService.deleteDictionary(dictionary);
  }
});
