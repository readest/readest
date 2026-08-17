import { afterEach, describe, expect, test, vi } from 'vitest';
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
import {
  MAX_PLUGIN_RESOURCE_BYTES,
  MAX_PLUGIN_SQL_REQUEST_BYTES,
  pluginSqlValueBytes,
} from '@/services/plugins/contract';
import { SqlBroker } from '@/services/plugins/brokers';

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

const createDictionaryWithTerms = async (
  terms: unknown[],
  resources: Record<string, Uint8Array> = {},
): Promise<File> => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add(
    'index.json',
    new TextReader(JSON.stringify({ title: 'Lookup limits', revision: '1', format: 3 })),
  );
  await writer.add('term_bank_1.json', new TextReader(JSON.stringify(terms)));
  for (const [path, bytes] of Object.entries(resources)) {
    await writer.add(path, new Uint8ArrayReader(bytes));
  }
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
    vi.unstubAllGlobals();
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

  test.each([
    ['duplicate numeric orders', ['term_bank_1.json', 'term_bank_01.json'], /duplicate/i],
    ['an unsafe numeric order', ['term_bank_9007199254740992.json'], /invalid/i],
  ])('rejects term banks with %s', async (_case, filenames, expectedError) => {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add(
      'index.json',
      new TextReader(JSON.stringify({ title: 'Invalid banks', revision: '1', format: 3 })),
    );
    for (const [index, filename] of filenames.entries()) {
      await writer.add(
        filename,
        new TextReader(
          JSON.stringify([[`word-${index}`, '', '', '', 1, [`definition-${index}`], index, '']]),
        ),
      );
    }
    const source = new File([await writer.close()], 'invalid-banks.zip', {
      type: 'application/zip',
    });
    db = await NodeDatabaseService.open(':memory:');

    await expect(
      buildYomitanIndex(
        createHost(source, db),
        {
          dictionaryId: 'dict-1',
          sourceHandle: 'source-1',
          databaseHandle: 'db-1',
          sourceFormatVersion: 3,
        },
        { storage: 'banked' },
      ),
    ).rejects.toThrow(expectedError);
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

  test('rejects portable indexes missing required lookup tables', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await db.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    await db.execute(
      'CREATE TABLE terms (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
    );
    await db.execute("INSERT INTO meta VALUES ('index_version', '2'), ('title', 'Incomplete')");
    await db.execute("INSERT INTO terms VALUES (1, '読む', 'よむ', '', '', 1, '[]', 1, '', 1, 0)");

    await expect(verifyYomitanIndex(host, 'db-1')).rejects.toThrow(/schema/i);
  });

  test.each([
    'meta',
    'terms',
  ] as const)('rejects a portable %s view before querying dictionary data', async (table) => {
    const source = await createDictionaryWithTerms([
      ['word', 'word', '', '', 1, ['definition'], 1, ''],
    ]);
    db = await NodeDatabaseService.open(':memory:');
    const baseHost = createHost(source, db);
    await buildYomitanIndex(baseHost, {
      dictionaryId: 'dict-1',
      sourceHandle: 'source-1',
      databaseHandle: 'db-1',
      sourceFormatVersion: 3,
    });
    await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_source`);
    await db.execute(`CREATE VIEW ${table} AS SELECT * FROM ${table}_source`);

    const queries: string[] = [];
    const host: YomitanHost = {
      ...baseHost,
      select: async (handle, sql, params, maxRows) => {
        queries.push(sql);
        return baseHost.select(handle, sql, params, maxRows);
      },
    };

    await expect(verifyYomitanIndex(host, 'db-1')).rejects.toThrow(/schema/i);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('main.sqlite_schema');
  });

  test('rejects portable tables that shadow SQLite row identity', async () => {
    const source = await createDictionaryWithTerms([
      ['word', 'word', '', '', 1, ['definition'], 1, ''],
    ]);
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await buildYomitanIndex(host, {
      dictionaryId: 'dict-1',
      sourceHandle: 'source-1',
      databaseHandle: 'db-1',
      sourceFormatVersion: 3,
    });
    await db.execute('ALTER TABLE terms RENAME TO original_terms');
    await db.execute(
      'CREATE TABLE terms (rowid INTEGER, id INTEGER, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
    );
    await db.execute(
      'INSERT INTO terms SELECT 1, id, expression, reading, definition_tags, rules, score, glossary_json, sequence, term_tags, bank_order, entry_index FROM original_terms',
    );

    await expect(verifyYomitanIndex(host, 'db-1')).rejects.toThrow(/schema/i);
  });

  test.each([
    [
      'too many grammatical rules',
      Array.from({ length: 65 }, (_, index) => `rule-${index}`).join(' '),
      ['definition'],
    ],
    [
      'an image wider than the host contract',
      '',
      [{ type: 'image', path: 'wide.png', width: 8_193 }],
    ],
  ])('rejects a term with %s during indexing', async (_case, rules, glossary) => {
    const source = await createDictionaryWithTerms(
      [['読む', 'よむ', '', rules, 1, glossary, 1, '']],
      { 'wide.png': new Uint8Array([137, 80, 78, 71]) },
    );
    db = await NodeDatabaseService.open(':memory:');

    await expect(
      buildYomitanIndex(createHost(source, db), {
        dictionaryId: 'dict-1',
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        sourceFormatVersion: 3,
      }),
    ).rejects.toThrow();
  });

  test('caps tag lookups before constructing broker SQL', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const rows = Array.from({ length: 128 }, (_, rowIndex) => ({
      id: rowIndex + 1,
      expression: 'word',
      reading: 'word',
      definition_tags: Array.from(
        { length: 100 },
        (_, tagIndex) => `tag-${rowIndex}-${tagIndex}`,
      ).join(' '),
      rules: '',
      score: 128 - rowIndex,
      glossary_json: JSON.stringify([{ type: 'text', value: `definition ${rowIndex}` }]),
      sequence: rowIndex + 1,
      term_tags: '',
      bank_order: 1,
      entry_index: rowIndex,
    }));
    let tagParamCount = 0;
    const baseHost = createHost(source, db);
    const host: YomitanHost = {
      ...baseHost,
      select: async (_handle, sql, params = []) => {
        if (sql.includes('FROM terms WHERE')) return { rows };
        if (sql.includes('FROM tags WHERE')) {
          tagParamCount = params.length;
          return { rows: [] };
        }
        if (sql.includes('FROM term_meta WHERE')) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: 'word',
        language: 'en',
      }),
    ).resolves.toMatchObject({ entries: { length: 128 } });
    expect(tagParamCount).toBe(256);
  });

  test('rejects oversized portable blobs before loading them', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    const oversized = new Uint8Array(MAX_PLUGIN_RESOURCE_BYTES + 1);
    await db.execute(
      'CREATE TABLE resources (key TEXT PRIMARY KEY, archive_path TEXT NOT NULL, media_kind TEXT NOT NULL, data BLOB)',
    );
    await db.execute('INSERT INTO resources VALUES (?, ?, ?, ?)', [
      'large.png',
      'large.png',
      'image/png',
      oversized,
    ]);

    await expect(
      readYomitanResource(host, {
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        resourceRef: 'large.png',
      }),
    ).rejects.toThrow(/size limit/i);

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
      'CREATE TABLE term_banks (bank_order INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    await db.execute("INSERT INTO terms VALUES (1, 'word', 'word', '', '', 1, NULL, 1, '', 1, 0)");
    await db.execute('INSERT INTO term_banks VALUES (?, ?)', [1, oversized]);

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: 'word',
        language: 'en',
      }),
    ).rejects.toThrow(/size limit/i);

    await db.execute('UPDATE term_banks SET data = ? WHERE bank_order = 1', [new Uint8Array([0])]);
    const expandedChunk = new Uint8Array([0]);
    Object.defineProperty(expandedChunk, 'byteLength', {
      value: 64 * 1_024 * 1_024 + 1,
    });
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readonly readable = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(expandedChunk);
            controller.close();
          },
        });
        readonly writable = new WritableStream<Uint8Array>();
      },
    );

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: 'word',
        language: 'en',
      }),
    ).rejects.toThrow(/decompressed size limit/i);
  });

  test('skips contract-invalid portable rows without failing the lookup', async () => {
    const source = await createDictionary();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await buildYomitanIndex(
      host,
      {
        dictionaryId: 'dict-1',
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        sourceFormatVersion: 3,
      },
      { storage: 'banked' },
    );

    await db.execute("UPDATE terms SET rules = ? WHERE expression = '読む'", [
      Array.from({ length: 65 }, (_, index) => `rule-${index}`).join(' '),
    ]);
    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: '読む',
        language: 'ja',
      }),
    ).resolves.toEqual({ entries: [] });

    await db.execute("UPDATE terms SET rules = '', glossary_json = ? WHERE expression = '読む'", [
      JSON.stringify([{ type: 'image', resourceRef: 'wide.png', width: 8_193 }]),
    ]);
    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: '読む',
        language: 'ja',
      }),
    ).resolves.toEqual({ entries: [] });
  });

  test.each([
    ['malformed fields', { rules: null }],
    [
      'over-depth definitions',
      {
        glossary_json: JSON.stringify([
          Array.from({ length: 17 }).reduce<unknown>(
            (child) => ({ type: 'element', tag: 'div', children: [child] }),
            { type: 'text', value: 'too deep' },
          ),
        ]),
      },
    ],
  ])('isolates portable rows with %s from valid siblings', async (_case, invalidFields) => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const rows = [
      {
        id: 1,
        expression: 'word',
        reading: 'word',
        definition_tags: '',
        rules: '',
        score: 2,
        glossary_json: JSON.stringify([{ type: 'text', value: 'invalid' }]),
        sequence: 1,
        term_tags: '',
        bank_order: 1,
        entry_index: 0,
        ...invalidFields,
      },
      {
        id: 2,
        expression: 'word',
        reading: 'word',
        definition_tags: '',
        rules: '',
        score: 1,
        glossary_json: JSON.stringify([{ type: 'text', value: 'valid' }]),
        sequence: 2,
        term_tags: '',
        bank_order: 1,
        entry_index: 1,
      },
    ];
    const baseHost = createHost(source, db);
    const host: YomitanHost = {
      ...baseHost,
      select: async (_handle, sql) => {
        if (sql.includes('FROM terms WHERE')) return { rows };
        if (sql.includes('FROM term_meta WHERE')) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: 'word',
        language: 'en',
      }),
    ).resolves.toMatchObject({
      entries: [{ expression: 'word', definitions: [{ type: 'text', value: 'valid' }] }],
    });
  });

  test('isolates malformed portable tags and metadata from valid matches', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const term = {
      id: 1,
      expression: 'word',
      reading: 'word',
      definition_tags: 'bad good oversized',
      rules: '',
      score: 1,
      glossary_json: JSON.stringify([{ type: 'text', value: 'valid' }]),
      sequence: 1,
      term_tags: '',
      bank_order: 1,
      entry_index: 0,
    };
    const baseHost = createHost(source, db);
    const host: YomitanHost = {
      ...baseHost,
      select: async (_handle, sql) => {
        if (sql.includes('FROM terms WHERE')) return { rows: [term] };
        if (sql.includes('FROM tags WHERE')) {
          return {
            rows: [
              { name: 'bad', category: null, notes: '', score: 0 },
              { name: 'good', category: 'partOfSpeech', notes: 'Valid tag', score: 1 },
              {
                name: 'oversized',
                category: 'partOfSpeech',
                notes: 'x'.repeat(4_001),
                score: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM term_meta WHERE')) {
          return {
            rows: [
              { expression: 'word', reading: 'word', mode: 'freq', payload_json: '{' },
              { expression: 'word', reading: 'word', mode: 'freq', payload_json: '42' },
              {
                expression: 'word',
                reading: 'word',
                mode: 'pitch',
                payload_json: JSON.stringify([
                  { position: 1, nasal: ['invalid'] },
                  { position: 2, nasal: [0] },
                ]),
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const result = await lookupYomitan(host, {
      dictionaryId: 'dict-1',
      databaseHandle: 'db-1',
      query: 'word',
      language: 'en',
    });
    expect(result).toMatchObject({
      entries: [
        {
          expression: 'word',
          definitions: [{ type: 'text', value: 'valid' }],
          tags: expect.arrayContaining([
            expect.objectContaining({ name: 'good', category: 'partOfSpeech' }),
          ]),
          frequencies: [{ value: 42 }],
          pitches: [{ position: 2, nasal: [0] }],
        },
      ],
    });
    expect((result.entries[0]?.tags ?? []).map(({ name }) => name)).not.toContain('oversized');
  });

  test('isolates oversized portable text cells before broker transport', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
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
      'CREATE TABLE term_banks (bank_order INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    const oversized = 'x'.repeat(MAX_PLUGIN_RESOURCE_BYTES + 1);
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      1,
      'word',
      'word',
      'good oversized',
      '',
      2,
      oversized,
      1,
      '',
      1,
      0,
    ]);
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      2,
      'word',
      'word',
      'good oversized',
      '',
      1,
      JSON.stringify([{ type: 'text', value: 'good' }]),
      2,
      '',
      1,
      1,
    ]);
    await db.execute('INSERT INTO tags VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)', [
      'good',
      'partOfSpeech',
      1,
      'valid tag',
      1,
      'oversized',
      'partOfSpeech',
      2,
      oversized,
      1,
    ]);
    await db.execute('INSERT INTO term_meta VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)', [
      1,
      'word',
      'freq',
      'word',
      '42',
      2,
      'word',
      'freq',
      'word',
      oversized,
    ]);

    const scope = { pluginId: 'readest.yomitan', dictionaryId: 'dict-1' };
    const broker = new SqlBroker({ createHandle: () => 'broker-db' });
    const databaseHandle = await broker.register(scope, db, 'active');
    const baseHost = createHost(source, db);
    const host: YomitanHost = {
      ...baseHost,
      select: (_handle, sql, params = [], maxRows = 1_000) =>
        broker.select(scope, { handle: databaseHandle, sql, params, maxRows }),
    };

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle,
        query: 'word',
        language: 'en',
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          expression: 'word',
          definitions: [{ type: 'text', value: 'good' }],
          tags: [expect.objectContaining({ name: 'good' })],
          frequencies: [{ value: 42 }],
        },
      ],
    });
  });

  test('isolates duplicate portable term-bank rows from inline matches', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await db.execute(
      'CREATE TABLE terms (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
    );
    await db.execute(
      'CREATE TABLE tags (name TEXT PRIMARY KEY, category TEXT NOT NULL, sort_order REAL NOT NULL, notes TEXT NOT NULL, score REAL NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE term_meta (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, mode TEXT NOT NULL, reading TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await db.execute('CREATE TABLE term_banks (bank_order INTEGER, data BLOB NOT NULL)');
    await db.execute('INSERT INTO term_banks VALUES (?, ?), (?, ?)', [
      999,
      new Uint8Array([1]),
      999,
      new Uint8Array([2]),
    ]);
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      1,
      'word',
      'word',
      '',
      '',
      2,
      null,
      1,
      '',
      999,
      0,
    ]);
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      2,
      'word',
      'word',
      '',
      '',
      1,
      JSON.stringify([{ type: 'text', value: 'valid' }]),
      2,
      '',
      1,
      0,
    ]);

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: 'word',
        language: 'en',
      }),
    ).resolves.toMatchObject({
      entries: [{ expression: 'word', definitions: [{ type: 'text', value: 'valid' }] }],
    });
  });

  test('keeps banked definitions isolated when portable term ids are duplicated', async () => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await db.execute(
      'CREATE TABLE terms (id INTEGER, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
    );
    await db.execute(
      'CREATE TABLE tags (name TEXT PRIMARY KEY, category TEXT NOT NULL, sort_order REAL NOT NULL, notes TEXT NOT NULL, score REAL NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE term_meta (id INTEGER PRIMARY KEY, expression TEXT NOT NULL, mode TEXT NOT NULL, reading TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await db.execute(
      'CREATE TABLE term_banks (bank_order INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    const banks = await Promise.all(
      [
        [['word', 'word', '', '', 2, ['definition-A'], 1, '']],
        [['other', 'word', '', '', 1, ['definition-B'], 2, '']],
      ].map(
        async (bank) =>
          new Uint8Array(
            await new Response(
              new Response(JSON.stringify(bank)).body!.pipeThrough(new CompressionStream('gzip')),
            ).arrayBuffer(),
          ),
      ),
    );
    await db.execute('INSERT INTO term_banks VALUES (?, ?), (?, ?)', [1, banks[0], 2, banks[1]]);
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      1,
      'word',
      'word',
      '',
      '',
      2,
      null,
      1,
      '',
      1,
      0,
    ]);
    await db.execute('INSERT INTO terms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      1,
      'other',
      'word',
      '',
      '',
      1,
      null,
      2,
      '',
      2,
      0,
    ]);

    const result = await lookupYomitan(host, {
      dictionaryId: 'dict-1',
      databaseHandle: 'db-1',
      query: 'word',
      language: 'en',
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        expression: 'word',
        definitions: [{ type: 'text', value: 'definition-A' }],
      }),
      expect.objectContaining({
        expression: 'other',
        definitions: [{ type: 'text', value: 'definition-B' }],
      }),
    ]);
  });

  test.each([
    ['missing', [], []],
    ['corrupt', [{ bank_order: 999, data_size: 1 }], [{ data: new Uint8Array([0]) }]],
  ])('isolates %s portable term banks from inline matches', async (_case, sizeRows, dataRows) => {
    const source = createPortableHeader();
    db = await NodeDatabaseService.open(':memory:');
    const rows = [
      {
        id: 1,
        expression: 'word',
        reading: 'word',
        definition_tags: '',
        rules: '',
        score: 2,
        glossary_json: null,
        sequence: 1,
        term_tags: '',
        bank_order: 999,
        entry_index: 0,
      },
      {
        id: 2,
        expression: 'word',
        reading: 'word',
        definition_tags: '',
        rules: '',
        score: 1,
        glossary_json: JSON.stringify([{ type: 'text', value: 'valid' }]),
        sequence: 2,
        term_tags: '',
        bank_order: 1,
        entry_index: 1,
      },
    ];
    const baseHost = createHost(source, db);
    const host: YomitanHost = {
      ...baseHost,
      select: async (_handle, sql) => {
        if (sql.includes('FROM terms WHERE')) return { rows };
        if (sql.includes('AS data_size')) return { rows: sizeRows };
        if (sql.includes('SELECT data FROM term_banks')) return { rows: dataRows };
        if (sql.includes('FROM term_meta WHERE')) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: 'word',
        language: 'en',
      }),
    ).resolves.toMatchObject({
      entries: [{ expression: 'word', definitions: [{ type: 'text', value: 'valid' }] }],
    });
  });

  test('caps aggregate portable term-bank decompression per lookup', async () => {
    const source = await createDictionary();
    db = await NodeDatabaseService.open(':memory:');
    const host = createHost(source, db);
    await buildYomitanIndex(
      host,
      {
        dictionaryId: 'dict-1',
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        sourceFormatVersion: 3,
      },
      { storage: 'banked' },
    );
    const compressed = (await db.select('SELECT data FROM term_banks WHERE bank_order = 1'))[0]![
      'data'
    ];
    await db.execute('INSERT INTO term_banks VALUES (?, ?)', [2, compressed]);
    await db.execute(
      "INSERT INTO terms (expression, reading, definition_tags, rules, score, glossary_json, sequence, term_tags, bank_order, entry_index) VALUES ('読む', 'よむ', 'v5', 'v5', 99, NULL, 2, 'v5', 2, 0)",
    );

    const expandedBankJson = JSON.stringify([
      ['読む', 'よむ', 'v5', 'v5', 100, ['to read'], 1, 'v5'],
    ]);
    const NativeTextDecoder = TextDecoder;
    vi.stubGlobal(
      'TextDecoder',
      class {
        decode(value?: Uint8Array): string {
          if (!value) return '';
          return new NativeTextDecoder().decode(
            new Uint8Array(
              value.buffer,
              value.byteOffset,
              value.buffer.byteLength - value.byteOffset,
            ),
          );
        }
      },
    );
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readonly readable = new ReadableStream<Uint8Array>({
          start(controller) {
            const expandedBank = new TextEncoder().encode(expandedBankJson);
            Object.defineProperty(expandedBank, 'byteLength', { value: 40 * 1_024 * 1_024 });
            controller.enqueue(expandedBank);
            controller.close();
          },
        });
        readonly writable = new WritableStream<Uint8Array>();
      },
    );

    await expect(
      lookupYomitan(host, {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: '読みました',
        language: 'ja',
      }),
    ).rejects.toThrow(/aggregate decompressed size limit/i);
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

  test('batches portable resource inserts within the SQL transaction byte budget', async () => {
    const resources = {
      'one.png': new Uint8Array(MAX_PLUGIN_RESOURCE_BYTES),
      'two.png': new Uint8Array(MAX_PLUGIN_RESOURCE_BYTES),
    };
    const source = await createDictionaryWithTerms(
      [
        [
          'word',
          'word',
          '',
          '',
          1,
          [
            {
              type: 'structured-content',
              content: [
                { tag: 'img', path: 'one.png' },
                { tag: 'img', path: 'two.png' },
              ],
            },
          ],
          1,
          '',
        ],
      ],
      resources,
    );
    db = await NodeDatabaseService.open(':memory:');
    const transactions: ExecutedStatement[][] = [];
    const host = createHost(source, db, [], transactions);

    await buildYomitanIndex(
      host,
      {
        dictionaryId: 'dict-1',
        sourceHandle: 'source-1',
        databaseHandle: 'db-1',
        sourceFormatVersion: 3,
      },
      { storage: 'banked' },
    );

    for (const transaction of transactions) {
      const parameterBytes = transaction
        .flatMap(({ params }) => params)
        .reduce<number>((total, value) => total + pluginSqlValueBytes(value), 0);
      expect(parameterBytes).toBeLessThanOrEqual(MAX_PLUGIN_SQL_REQUEST_BYTES);
    }
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
