import { afterEach, expect, test } from 'vitest';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { WebDatabaseService } from '@/services/database/webDatabaseService';
import { WebAppService } from '@/services/webAppService';
import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import { getBundledPlugin } from '@/services/plugins/catalog';
import { createPluginHostCallHandler } from '@/services/plugins/hostCalls';
import { createPluginRuntime } from '@/services/plugins/runtime';
import { importPluginDictionaries } from '@/services/dictionaries/plugins/import';

const createDictionary = async (): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Browser Japanese', revision: '1', format: 3 })),
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
  return new File([await writer.close()], 'browser-japanese.zip', {
    type: 'application/zip',
  });
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
  const source = await createDictionary();
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
  ).resolves.toMatchObject({ indexVersion: 1, entries: 1, resources: 1 });
  await expect(
    runtime.call('verifyIndex', { dictionaryId, databaseHandle }),
  ).resolves.toMatchObject({ indexVersion: 1, entries: 1 });

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
    expect(dictionary).toMatchObject({
      name: 'Browser Japanese',
      kind: 'plugin',
      plugin: { pluginId: 'readest.yomitan', formatId: 'yomitan' },
    });
  } finally {
    if (dictionary) await appService.deleteDictionary(dictionary);
  }
});
