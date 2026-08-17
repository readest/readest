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
  YOMITAN_PORTABLE_APPLICATION_ID,
  type YomitanHost,
} from '@/plugins/yomitan/importer';
import { lookupYomitan } from '@/plugins/yomitan/lookup';

const createDictionary = async (): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  const bulkTerms = Array.from({ length: 110 }, (_, index) => [
    `語${index}`,
    `ご${index}`,
    '',
    '',
    0,
    [`word ${index}`],
    index + 3,
    '',
  ]);
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
                { tag: 'img', path: 'images/read.avif', alt: 'word class' },
                { tag: 'img', path: 'images/unsupported.bmp', alt: 'optional artwork' },
              ],
            },
          ],
          1,
          'v5',
        ],
        ['青い', 'あおい', 'adj-i', 'adj-i', 50, ['blue'], 2, 'adj-i'],
        ...bulkTerms,
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
  await writer.add(
    'images/read.avif',
    new Uint8ArrayReader(
      new Uint8Array([
        0, 0, 0, 28, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0, 97, 118, 105, 102, 109, 105,
        102, 49, 109, 105, 97, 102,
      ]),
    ),
  );
  await writer.add('images/unsupported.bmp', new Uint8ArrayReader(new Uint8Array([66, 77, 0, 0])));
  return new File([await writer.close()], 'reader-japanese.zip', { type: 'application/zip' });
};

const createJitendexSizedDictionary = async (): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Jitendex', revision: '2026.08.11.0', format: 3 })),
  );
  const paddingNames = Array.from({ length: 9 }, (_, index) => `padding_${index}.bin`);
  for (const name of paddingNames) {
    await writer.add(name, new Uint8ArrayReader(new Uint8Array([0])));
  }

  const archive = new Uint8Array(await (await writer.close()).arrayBuffer());
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const names = new Set(paddingNames);
  const decoder = new TextDecoder();
  const declaredEntrySize = Math.ceil(542_580_806 / paddingNames.length);
  let patchedEntries = 0;
  for (let offset = 0; offset <= archive.byteLength - 46; ) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const filename = decoder.decode(archive.subarray(offset + 46, offset + 46 + filenameLength));
    if (names.has(filename)) {
      view.setUint32(offset + 24, declaredEntrySize, true);
      patchedEntries += 1;
    }
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  if (patchedEntries !== paddingNames.length) throw new Error('Failed to patch ZIP entry metadata');

  return new File([archive], 'jitendex.zip', { type: 'application/zip' });
};

const createPortableHeader = (): File => {
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  const view = new DataView(bytes.buffer);
  view.setUint32(60, 1, false);
  view.setUint32(68, YOMITAN_PORTABLE_APPLICATION_ID, false);
  return new File([bytes], 'Jitendex.rdict', { type: 'application/vnd.sqlite3' });
};

const createDictionaryWithTerms = async (terms: unknown[]): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Lookup limits', revision: '1', format: 3 })),
  );
  await writer.add('term_bank_1.json', new TextReader(JSON.stringify(terms)));
  return new File([await writer.close()], 'lookup-limits.zip', { type: 'application/zip' });
};

interface ExecutedStatement {
  sql: string;
  params: unknown[];
}

const createHost = (
  source: File,
  db: DatabaseService,
  executedStatements: ExecutedStatement[] = [],
  executedTransactions: ExecutedStatement[][] = [],
): YomitanHost => ({
  signal: new AbortController().signal,
  stat: async () => ({ name: source.name, size: source.size, type: source.type }),
  readRange: async (_handle, offset, length) => ({
    bytes: new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()),
  }),
  execute: async (_handle, sql, params = []) => {
    executedStatements.push({ sql, params });
    return db.execute(sql, params);
  },
  select: async (_handle, sql, params = [], maxRows = 1_000) => {
    const rows = await db.select(sql, params);
    if (rows.length > maxRows) throw new Error('row limit');
    return { rows };
  },
  transaction: async (_handle, statements) => {
    const results = [];
    const executedTransaction: ExecutedStatement[] = [];
    executedTransactions.push(executedTransaction);
    await db.execute('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) {
        const params = statement.params ?? [];
        const executed = { sql: statement.sql, params };
        executedStatements.push(executed);
        executedTransaction.push(executed);
        results.push(await db.execute(statement.sql, params));
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
    const executedStatements: ExecutedStatement[] = [];
    const executedTransactions: ExecutedStatement[][] = [];
    const host = createHost(source, db, executedStatements, executedTransactions);

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
    ).resolves.toEqual({ indexVersion: 2, entries: 112, resources: 3 });
    expect(
      executedStatements.findIndex(({ sql }) =>
        sql.startsWith('CREATE INDEX terms_expression_idx'),
      ),
    ).toBeGreaterThan(
      executedStatements.findIndex(({ sql }) => sql.startsWith('INSERT OR REPLACE INTO terms')),
    );
    const termInserts = executedStatements.filter(({ sql }) =>
      sql.startsWith('INSERT OR REPLACE INTO terms'),
    );
    expect(termInserts).toHaveLength(1);
    expect(termInserts[0]!.params).toHaveLength(112 * 10);
    expect(termInserts[0]!.sql).not.toContain('json_each');
    const insertTransactions = executedTransactions.filter((statements) =>
      statements.some(({ sql }) => sql.startsWith('INSERT OR REPLACE INTO')),
    );
    expect(insertTransactions).toHaveLength(1);
    expect(insertTransactions[0]).toHaveLength(5);
    await expect(verifyYomitanIndex(host, 'db-1')).resolves.toEqual({
      indexVersion: 2,
      entries: 112,
      title: 'Reader Japanese',
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
    await expect(
      readYomitanResource(host, {
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        resourceRef: 'images/read.avif',
      }),
    ).resolves.toMatchObject({ mimeType: 'image/avif' });
    await expect(
      readYomitanResource(host, {
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        resourceRef: 'images/unsupported.bmp',
      }),
    ).resolves.toEqual({ mimeType: 'image/bmp', bytes: new Uint8Array([66, 77, 0, 0]) });
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

  test('probes a valid dictionary with Jitendex-sized uncompressed metadata', async () => {
    const source = await createJitendexSizedDictionary();
    db = await NodeDatabaseService.open(':memory:');

    await expect(probeYomitanSource(createHost(source, db), 'source-1')).resolves.toEqual({
      matches: [{ sourceHandle: 'source-1', formatId: 'yomitan', confidence: 1 }],
    });
  });

  test('probes and inspects a portable pre-indexed dictionary from its SQLite header', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);

    await expect(probeYomitanSource(host, 'source-1')).resolves.toEqual({
      matches: [{ sourceHandle: 'source-1', formatId: 'yomitan-indexed', confidence: 1 }],
    });
    await expect(inspectYomitanSource(host, 'source-1')).resolves.toEqual({
      formatId: 'yomitan-indexed',
      sourceFormatVersion: 1,
      title: 'Jitendex',
    });
  });

  test('bounds high-cardinality exact matches before the SQL broker row cap', async () => {
    const source = await createDictionaryWithTerms(
      Array.from({ length: 257 }, (_, index) => [
        '同じ',
        'おなじ',
        '',
        '',
        257 - index,
        [`definition ${index}`],
        index + 1,
        '',
      ]),
    );
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await buildYomitanIndex(host, {
      dictionaryId: 'dict-1',
      sourceHandle: 'source-1',
      databaseHandle: 'db-1',
      sourceFormatVersion: 3,
    });

    const result = await lookupYomitan(host, {
      dictionaryId: 'dict-1',
      databaseHandle: 'db-1',
      query: '同じ',
      language: 'ja',
    });

    expect(result.entries).toHaveLength(128);
  });

  test('truncates ranked entries before the aggregate document budget is exceeded', async () => {
    const definitions = Array.from({ length: 600 }, (_, index) => `definition ${index}`);
    const source = await createDictionaryWithTerms([
      ['同じ', 'おなじ', '', '', 2, definitions, 1, ''],
      ['同じ', 'おなじ', '', '', 1, definitions, 2, ''],
    ]);
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await buildYomitanIndex(host, {
      dictionaryId: 'dict-1',
      sourceHandle: 'source-1',
      databaseHandle: 'db-1',
      sourceFormatVersion: 3,
    });

    const result = await lookupYomitan(host, {
      dictionaryId: 'dict-1',
      databaseHandle: 'db-1',
      query: '同じ',
      language: 'ja',
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.definitions).toHaveLength(600);
  });

  test('builds a compact portable index with compressed banks and embedded resources', async () => {
    const source = await createDictionary();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);

    await expect(
      buildYomitanIndex(
        host,
        {
          dictionaryId: 'dict-1',
          sourceHandle: 'source-1',
          databaseHandle: 'db-1',
          sourceFormatVersion: 3,
        },
        { storage: 'banked' },
      ),
    ).resolves.toEqual({ indexVersion: 2, entries: 112, resources: 3 });
    await expect(db.select('SELECT COUNT(*) AS count FROM term_banks')).resolves.toEqual([
      { count: 1 },
    ]);
    const term = (
      await db.select('SELECT glossary_json, entry_index FROM terms ORDER BY id LIMIT 1')
    )[0]!;
    expect(term['glossary_json']).toBeNull();
    expect(term['entry_index']).toBe(0);
    const resource = (
      await db.select("SELECT data FROM resources WHERE key = 'images/read.png'")
    )[0]!['data'];
    expect(ArrayBuffer.isView(resource)).toBe(true);
  });

  test('looks up portable banks and resources serialized as native JSON byte arrays', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await db.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    await db.execute(
      'CREATE TABLE terms (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
    );
    await db.execute(
      'CREATE TABLE tags (name TEXT PRIMARY KEY, category TEXT NOT NULL, sort_order REAL NOT NULL, notes TEXT NOT NULL, score REAL NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE term_meta (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, mode TEXT NOT NULL, reading TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE resources (key TEXT PRIMARY KEY, archive_path TEXT NOT NULL, media_kind TEXT NOT NULL, data BLOB)',
    );
    await db.execute(
      'CREATE TABLE term_banks (bank_order INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    await db.execute("INSERT INTO meta VALUES ('index_version', '2'), ('title', 'Jitendex')");
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
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
    await db.execute("INSERT INTO tags VALUES ('v5', 'partOfSpeech', 1, 'Godan verb', 5)");
    const bank = [
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
    ];
    const compressed = new Uint8Array(
      await new Response(
        new Response(JSON.stringify(bank)).body!.pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
    await db.execute('INSERT INTO term_banks VALUES (?, ?)', [1, compressed]);
    const png = new Uint8Array([137, 80, 78, 71]);
    await db.execute('INSERT INTO resources VALUES (?, ?, ?, ?)', [
      'read.png',
      'read.png',
      'image/png',
      png,
    ]);

    const nativeHost: YomitanHost = {
      ...host,
      select: async (...args) => {
        const result = await host.select(...args);
        return {
          rows: result.rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value instanceof ArrayBuffer
                  ? Array.from(new Uint8Array(value))
                  : ArrayBuffer.isView(value)
                    ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
                    : value,
              ]),
            ),
          ),
        };
      },
    };

    const result = await lookupYomitan(nativeHost, {
      dictionaryId: 'dict-1',
      databaseHandle: 'db-1',
      query: '読みました',
      language: 'ja',
    });
    expect(result.entries[0]).toMatchObject({
      expression: '読む',
      reading: 'よむ',
      deinflection: ['polite past'],
      definitions: expect.arrayContaining([
        { type: 'text', value: 'to read' },
        { type: 'image', resourceRef: 'read.png', alt: 'stroke order' },
      ]),
    });
    await expect(
      readYomitanResource(nativeHost, {
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        resourceRef: 'read.png',
      }),
    ).resolves.toEqual({ mimeType: 'image/png', bytes: png });
  });
});
