import { afterEach, describe, expect, test } from 'vitest';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import type { DatabaseService } from '@/types/database';
import {
  buildYomitanIndex,
  inspectYomitanSource,
  probeYomitanSource,
  readYomitanResource,
  verifyYomitanIndex,
  type YomitanHost,
} from '@/plugins/yomitan/importer';
import { lookupYomitan } from '@/plugins/yomitan/lookup';

const createDictionary = async (): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Reader Japanese', revision: '2026.08', format: 3 })),
  );
  await writer.add(
    'tag_bank_1.json',
    new TextReader(
      JSON.stringify([
        ['v5', 'partOfSpeech', 1, 'Godan verb', 5],
        ['adj-i', 'partOfSpeech', 2, 'i-adjective', 5],
      ]),
    ),
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
              content: [
                { tag: 'ruby', content: ['読', { tag: 'rt', content: 'よ' }] },
                'む: to read',
                { tag: 'img', path: 'images/read.png', alt: 'stroke order' },
              ],
            },
          ],
          1,
          'v5',
        ],
        ['青い', 'あおい', 'adj-i', 'adj-i', 50, ['blue'], 2, 'adj-i'],
      ]),
    ),
  );
  await writer.add(
    'term_meta_bank_1.json',
    new TextReader(
      JSON.stringify([
        ['読む', 'freq', { reading: 'よむ', frequency: { value: 42, displayValue: '42' } }],
        ['読む', 'pitch', { reading: 'よむ', pitches: [{ position: 1 }] }],
        ['読む', 'ipa', { reading: 'よむ', transcriptions: [{ ipa: '[jo̞mɯ̟ᵝ]' }] }],
      ]),
    ),
  );
  await writer.add('images/read.png', new Uint8ArrayReader(new Uint8Array([137, 80, 78, 71])));
  return new File([await writer.close()], 'reader-japanese.zip', { type: 'application/zip' });
};

const createHost = (source: File, db: DatabaseService): YomitanHost => ({
  signal: new AbortController().signal,
  stat: async () => ({ name: source.name, size: source.size, type: source.type }),
  readRange: async (_handle, offset, length) => ({
    bytes: new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()),
  }),
  execute: async (_handle, sql, params = []) => db.execute(sql, params),
  select: async (_handle, sql, params = [], maxRows = 1_000) => {
    const rows = await db.select(sql, params);
    if (rows.length > maxRows) throw new Error('row limit');
    return { rows };
  },
  transaction: async (_handle, statements) => {
    const results = [];
    await db.execute('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) {
        results.push(await db.execute(statement.sql, statement.params ?? []));
      }
      await db.execute('COMMIT');
      return { results };
    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }
  },
  progress: () => undefined,
});

describe('Yomitan importer and lookup', () => {
  let db: DatabaseService | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  test('probes, inspects, indexes, verifies, looks up, and reads media', async () => {
    const source = await createDictionary();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);

    await expect(probeYomitanSource(host, 'source-1')).resolves.toEqual({
      matches: [{ sourceHandle: 'source-1', formatId: 'yomitan', confidence: 1 }],
    });
    await expect(inspectYomitanSource(host, 'source-1')).resolves.toMatchObject({
      formatId: 'yomitan',
      sourceFormatVersion: 3,
      title: 'Reader Japanese',
      revision: '2026.08',
    });
    await expect(
      buildYomitanIndex(host, {
        dictionaryId: 'dict-1',
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        sourceFormatVersion: 3,
      }),
    ).resolves.toEqual({ indexVersion: 1, entries: 2, resources: 1 });
    await expect(verifyYomitanIndex(host, 'db-1')).resolves.toEqual({
      indexVersion: 1,
      entries: 2,
    });

    const result = await lookupYomitan(host, {
      dictionaryId: 'dict-1',
      databaseHandle: 'db-1',
      query: '読みました',
      language: 'ja',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      expression: '読む',
      reading: 'よむ',
      deinflection: ['polite past'],
      frequencies: [{ value: 42, displayValue: '42' }],
      pitches: [{ position: 1 }],
      ipa: [{ value: '[jo̞mɯ̟ᵝ]' }],
    });
    expect(result.entries[0]!.definitions).toContainEqual({
      type: 'image',
      resourceRef: 'images/read.png',
      alt: 'stroke order',
    });

    await expect(
      readYomitanResource(host, {
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        resourceRef: 'images/read.png',
      }),
    ).resolves.toEqual({ mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) });
  });

  test('does not claim an arbitrary ZIP', async () => {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('notes.txt', new TextReader('not a dictionary'));
    const source = new File([await writer.close()], 'notes.zip');
    db = await NodeDatabaseService.open(':memory:');

    await expect(probeYomitanSource(createHost(source, db), 'source-1')).resolves.toEqual({
      matches: [],
    });
  });
});
