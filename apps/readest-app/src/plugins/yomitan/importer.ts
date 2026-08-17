import type { DatabaseExecResult, DatabaseRow } from '@/types/database';
import {
  dictionaryLookupEntrySchema,
  MAX_PLUGIN_RESOURCE_BYTES,
  MAX_PLUGIN_SQL_PARAMS,
  MAX_PLUGIN_SQL_REQUEST_BYTES,
  pluginSqlValueBytes,
  type PluginPayload,
  type PluginSqlValue,
} from '@/services/plugins/contract';
import { collectYomitanResourceRefs, normalizeYomitanGlossary } from './content';
import { openYomitanArchive, type YomitanArchiveHost } from './archive';
import {
  parseYomitanIndex,
  splitYomitanTags,
  yomitanTagBankSchema,
  yomitanTermBankSchema,
  yomitanTermMetaBankSchema,
  type YomitanIndex,
  type YomitanTagTuple,
  type YomitanTermMetaTuple,
  type YomitanTermTuple,
} from './schemas';

export const YOMITAN_INDEX_VERSION = 2;
export const YOMITAN_PORTABLE_APPLICATION_ID = 0x52444954;
const YOMITAN_PORTABLE_FORMAT_VERSION = 1;
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');

interface SqlStatement {
  sql: string;
  params?: PluginSqlValue[];
}

export interface YomitanHost extends YomitanArchiveHost {
  execute(handle: string, sql: string, params?: PluginSqlValue[]): Promise<DatabaseExecResult>;
  select(
    handle: string,
    sql: string,
    params?: PluginSqlValue[],
    maxRows?: number,
  ): Promise<{ rows: DatabaseRow[] }>;
  transaction(
    handle: string,
    statements: SqlStatement[],
  ): Promise<{ results: DatabaseExecResult[] }>;
  progress(stage: string, completed: number, total?: number): void;
}

const TERM_BANK_PATTERN = /^term_bank_(\d+)\.json$/u;
const TAG_BANK_PATTERN = /^tag_bank_(\d+)\.json$/u;
const TERM_META_BANK_PATTERN = /^term_meta_bank_(\d+)\.json$/u;

const bankOrder = (filename: string): number => {
  const match = filename.match(/_(\d+)\.json$/u);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const checkedTermBankOrder = (filename: string): number => {
  const order = bankOrder(filename);
  if (!Number.isSafeInteger(order) || order < 1) {
    throw new Error(`Invalid Yomitan term bank order: ${filename}`);
  }
  return order;
};

const byBankOrder = (left: { filename: string }, right: { filename: string }): number =>
  bankOrder(left.filename) - bankOrder(right.filename) ||
  left.filename.localeCompare(right.filename);

const mediaKindFor = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  const extension = lower.match(/\.([a-z0-9][a-z0-9+.-]*)$/u)?.[1];
  return extension ? `image/${extension}` : 'application/octet-stream';
};

const ownedBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
};

const schemaStatements = (): SqlStatement[] => [
  { sql: 'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)', params: [] },
  {
    sql: 'CREATE TABLE terms (id INTEGER PRIMARY KEY AUTOINCREMENT, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json BLOB, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL, entry_index INTEGER)',
    params: [],
  },
  {
    sql: 'CREATE TABLE tags (name TEXT PRIMARY KEY, category TEXT NOT NULL, sort_order REAL NOT NULL, notes TEXT NOT NULL, score REAL NOT NULL)',
    params: [],
  },
  {
    sql: 'CREATE TABLE term_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, expression TEXT NOT NULL, mode TEXT NOT NULL, reading TEXT NOT NULL, payload_json TEXT NOT NULL)',
    params: [],
  },
  {
    sql: 'CREATE TABLE resources (key TEXT PRIMARY KEY, archive_path TEXT NOT NULL, media_kind TEXT NOT NULL, data BLOB)',
    params: [],
  },
  {
    sql: 'CREATE TABLE term_banks (bank_order INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    params: [],
  },
];

const insertStatement = (
  table: string,
  columns: string[],
  rows: PluginSqlValue[][],
): SqlStatement => ({
  sql: `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${rows
    .map(() => `(${columns.map(() => '?').join(', ')})`)
    .join(', ')}`,
  params: rows.flat(),
});

const statementParameterBytes = (statement: SqlStatement): number =>
  (statement.params ?? []).reduce<number>((total, value) => total + pluginSqlValueBytes(value), 0);

const flushInsertStatements = async (
  host: YomitanHost,
  databaseHandle: string,
  statements: SqlStatement[],
): Promise<void> => {
  if (statements.length === 0) return;
  await host.transaction(databaseHandle, statements.splice(0));
};

const queueInsertStatement = async (
  host: YomitanHost,
  databaseHandle: string,
  statements: SqlStatement[],
  statement: SqlStatement,
): Promise<void> => {
  const statementBytes = statementParameterBytes(statement);
  if (statementBytes > MAX_PLUGIN_SQL_REQUEST_BYTES) {
    throw new Error('Yomitan SQL statement exceeds parameter byte limit');
  }
  const queuedBytes = statements.reduce<number>(
    (total, queued) => total + statementParameterBytes(queued),
    0,
  );
  if (statements.length === 16 || queuedBytes + statementBytes > MAX_PLUGIN_SQL_REQUEST_BYTES) {
    await flushInsertStatements(host, databaseHandle, statements);
  }
  statements.push(statement);
  if (statements.length === 16) {
    await flushInsertStatements(host, databaseHandle, statements);
  }
};

const insertRows = async (
  host: YomitanHost,
  databaseHandle: string,
  statements: SqlStatement[],
  table: string,
  columns: string[],
  rows: PluginSqlValue[][],
): Promise<void> => {
  const rowsPerStatement = Math.max(1, Math.floor(MAX_PLUGIN_SQL_PARAMS / columns.length));
  let batch: PluginSqlValue[][] = [];
  let batchBytes = 0;
  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    await queueInsertStatement(
      host,
      databaseHandle,
      statements,
      insertStatement(table, columns, batch),
    );
    batch = [];
    batchBytes = 0;
  };
  for (const row of rows) {
    const rowBytes = row.reduce<number>((total, value) => total + pluginSqlValueBytes(value), 0);
    if (
      batch.length > 0 &&
      (batch.length === rowsPerStatement || batchBytes + rowBytes > MAX_PLUGIN_SQL_REQUEST_BYTES)
    ) {
      await flushBatch();
    }
    batch.push(row);
    batchBytes += rowBytes;
  }
  await flushBatch();
};

const readIndex = async (host: YomitanHost, sourceHandle: string): Promise<YomitanIndex> => {
  const archive = await openYomitanArchive(host, sourceHandle);
  try {
    if (!archive.has('index.json')) throw new Error('Yomitan index.json is missing');
    return parseYomitanIndex(await archive.readJson('index.json', 2 * 1_024 * 1_024));
  } finally {
    await archive.close();
  }
};

const readPortableVersion = async (
  host: YomitanHost,
  sourceHandle: string,
): Promise<number | undefined> => {
  const stat = await host.stat(sourceHandle);
  if (stat.size < 100) return undefined;
  const { bytes } = await host.readRange(sourceHandle, 0, 100);
  if (bytes.byteLength < 100) return undefined;
  if (SQLITE_HEADER.some((byte, index) => bytes[index] !== byte)) return undefined;
  const uint32 = (offset: number): number =>
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0;
  if (uint32(68) !== YOMITAN_PORTABLE_APPLICATION_ID) return undefined;
  const version = uint32(60);
  return version === YOMITAN_PORTABLE_FORMAT_VERSION ? version : undefined;
};

export const probeYomitanSource = async (host: YomitanHost, sourceHandle: string) => {
  try {
    if ((await readPortableVersion(host, sourceHandle)) !== undefined) {
      return {
        matches: [{ sourceHandle, formatId: 'yomitan-indexed' as const, confidence: 1 }],
      };
    }
    await readIndex(host, sourceHandle);
    return {
      matches: [{ sourceHandle, formatId: 'yomitan' as const, confidence: 1 }],
    };
  } catch {
    return { matches: [] };
  }
};

export const inspectYomitanSource = async (host: YomitanHost, sourceHandle: string) => {
  const portableVersion = await readPortableVersion(host, sourceHandle);
  if (portableVersion !== undefined) {
    const { name } = await host.stat(sourceHandle);
    return {
      formatId: 'yomitan-indexed' as const,
      sourceFormatVersion: portableVersion,
      title: name.replace(/\.rdict$/iu, '') || name,
    };
  }
  const index = await readIndex(host, sourceHandle);
  return {
    formatId: 'yomitan' as const,
    sourceFormatVersion: index.sourceFormatVersion,
    title: index.title,
    ...(index.revision === undefined ? {} : { revision: index.revision }),
    ...(index.sequenced === undefined ? {} : { sequenced: index.sequenced }),
  };
};

const termRows = (
  terms: YomitanTermTuple[],
  order: number,
  storage: 'expanded' | 'banked',
): { rows: PluginSqlValue[][]; resourceRefs: string[] } => {
  const rows: PluginSqlValue[][] = [];
  const resourceRefs = new Set<string>();
  for (let entryIndex = 0; entryIndex < terms.length; entryIndex += 1) {
    const term = terms[entryIndex]!;
    const [expression, reading, definitionTags, rules, score, glossary, sequence, termTags] = term;
    const normalizedReading = reading || expression;
    const normalizedRules = splitYomitanTags(rules);
    const normalizedTags = [
      ...new Set([...splitYomitanTags(definitionTags), ...splitYomitanTags(termTags)]),
    ].slice(0, 128);
    const definitions = normalizeYomitanGlossary(glossary, expression);
    dictionaryLookupEntrySchema.parse({
      expression,
      reading: normalizedReading,
      rules: normalizedRules,
      score,
      tags: normalizedTags.map((name) => ({ name })),
      definitions,
    });
    collectYomitanResourceRefs(definitions).forEach((ref) => resourceRefs.add(ref));
    rows.push([
      expression,
      normalizedReading,
      splitYomitanTags(definitionTags).join(' '),
      normalizedRules.join(' '),
      score,
      storage === 'expanded' ? JSON.stringify(definitions) : null,
      sequence,
      splitYomitanTags(termTags).join(' '),
      order,
      storage === 'banked' ? entryIndex : null,
    ]);
  }
  return { rows, resourceRefs: [...resourceRefs] };
};

const gzipJson = async (value: unknown): Promise<Uint8Array<ArrayBuffer>> => {
  const input = new Response(JSON.stringify(value)).body;
  if (!input) throw new Error('Failed to encode portable Yomitan term bank');
  const stream = input.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const tagRows = (tags: YomitanTagTuple[]): PluginSqlValue[][] =>
  tags.map(([name, category, order, notes, score]) => [name, category, order, notes, score]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const metaRow = (meta: YomitanTermMetaTuple): PluginSqlValue[] => {
  const [expression, mode, payload] = meta;
  if (mode === 'freq') {
    if (isRecord(payload) && 'reading' in payload && 'frequency' in payload) {
      return [expression, mode, String(payload['reading']), JSON.stringify(payload['frequency'])];
    }
    return [expression, mode, '', JSON.stringify(payload)];
  }
  if (mode === 'pitch') {
    return [expression, mode, payload.reading, JSON.stringify(payload.pitches)];
  }
  return [expression, mode, payload.reading, JSON.stringify(payload.transcriptions)];
};

const legacyTagRows = (index: YomitanIndex): PluginSqlValue[][] => {
  if (!index.tagMeta) return [];
  const rows: PluginSqlValue[][] = [];
  for (const [name, raw] of Object.entries(index.tagMeta)) {
    if (!isRecord(raw)) continue;
    rows.push([
      name,
      typeof raw['category'] === 'string' ? raw['category'] : '',
      typeof raw['order'] === 'number' ? raw['order'] : 0,
      typeof raw['notes'] === 'string' ? raw['notes'] : '',
      typeof raw['score'] === 'number' ? raw['score'] : 0,
    ]);
  }
  return rows;
};

export const buildYomitanIndex = async (
  host: YomitanHost,
  request: PluginPayload<'buildIndex'>,
  options: { storage?: 'expanded' | 'banked' } = {},
) => {
  const storage = options.storage ?? 'expanded';
  const archive = await openYomitanArchive(host, request.sourceHandle);
  try {
    const index = parseYomitanIndex(await archive.readJson('index.json', 2 * 1_024 * 1_024));
    if (index.sourceFormatVersion !== request.sourceFormatVersion) {
      throw new Error('Yomitan source format changed after inspection');
    }

    await host.transaction(request.databaseHandle, schemaStatements());
    const insertStatements: SqlStatement[] = [];
    await insertRows(
      host,
      request.databaseHandle,
      insertStatements,
      'meta',
      ['key', 'value'],
      [
        ['index_version', String(YOMITAN_INDEX_VERSION)],
        ['source_format_version', String(index.sourceFormatVersion)],
        ['title', index.title],
        ['revision', index.revision ?? ''],
        ['storage_format', storage === 'banked' ? 'banked-gzip-v1' : 'expanded-v1'],
      ],
    );

    const termBanks = archive
      .list(TERM_BANK_PATTERN)
      .map((bank) => ({ ...bank, order: checkedTermBankOrder(bank.filename) }))
      .sort(
        (left, right) => left.order - right.order || left.filename.localeCompare(right.filename),
      );
    const tagBanks = archive.list(TAG_BANK_PATTERN).sort(byBankOrder);
    const metaBanks = archive.list(TERM_META_BANK_PATTERN).sort(byBankOrder);
    if (termBanks.length === 0) throw new Error('Yomitan dictionary has no term banks');
    for (let index = 1; index < termBanks.length; index += 1) {
      if (termBanks[index - 1]!.order === termBanks[index]!.order) {
        throw new Error(`Duplicate Yomitan term bank order: ${termBanks[index]!.order}`);
      }
    }

    const allBanks = [...tagBanks, ...termBanks, ...metaBanks];
    let completed = 0;
    let entries = 0;
    const referencedResources = new Set<string>();

    const legacyTags = legacyTagRows(index);
    if (legacyTags.length > 0) {
      await insertRows(
        host,
        request.databaseHandle,
        insertStatements,
        'tags',
        ['name', 'category', 'sort_order', 'notes', 'score'],
        legacyTags,
      );
    }

    for (const bank of tagBanks) {
      if (host.signal.aborted) throw new DOMException('Yomitan import aborted', 'AbortError');
      const tags = yomitanTagBankSchema.parse(await archive.readJson(bank.filename));
      await insertRows(
        host,
        request.databaseHandle,
        insertStatements,
        'tags',
        ['name', 'category', 'sort_order', 'notes', 'score'],
        tagRows(tags),
      );
      host.progress('indexing', ++completed, allBanks.length);
    }

    for (const bank of termBanks) {
      if (host.signal.aborted) throw new DOMException('Yomitan import aborted', 'AbortError');
      const terms = yomitanTermBankSchema.parse(await archive.readJson(bank.filename));
      const order = bank.order;
      const normalized = termRows(terms, order, storage);
      normalized.resourceRefs.forEach((ref) => referencedResources.add(ref));
      await insertRows(
        host,
        request.databaseHandle,
        insertStatements,
        'terms',
        [
          'expression',
          'reading',
          'definition_tags',
          'rules',
          'score',
          'glossary_json',
          'sequence',
          'term_tags',
          'bank_order',
          'entry_index',
        ],
        normalized.rows,
      );
      if (storage === 'banked') {
        const compressed = await gzipJson(terms);
        if (compressed.byteLength > MAX_PLUGIN_RESOURCE_BYTES) {
          throw new Error(`Portable Yomitan term bank exceeds size limit: ${bank.filename}`);
        }
        await insertRows(
          host,
          request.databaseHandle,
          insertStatements,
          'term_banks',
          ['bank_order', 'data'],
          [[order, compressed]],
        );
      }
      entries += terms.length;
      host.progress('indexing', ++completed, allBanks.length);
    }

    for (const bank of metaBanks) {
      if (host.signal.aborted) throw new DOMException('Yomitan import aborted', 'AbortError');
      const metadata = yomitanTermMetaBankSchema.parse(await archive.readJson(bank.filename));
      await insertRows(
        host,
        request.databaseHandle,
        insertStatements,
        'term_meta',
        ['expression', 'mode', 'reading', 'payload_json'],
        metadata.map(metaRow),
      );
      host.progress('indexing', ++completed, allBanks.length);
    }

    const resourceRows: PluginSqlValue[][] = [];
    for (const ref of referencedResources) {
      const entry = archive.entries.find((candidate) => candidate.filename === ref);
      const mimeType = mediaKindFor(ref);
      if (!entry) throw new Error(`Referenced Yomitan resource is missing: ${ref}`);
      if (entry.uncompressedSize > MAX_PLUGIN_RESOURCE_BYTES) {
        throw new Error(`Yomitan resource exceeds size limit: ${ref}`);
      }
      resourceRows.push([
        ref,
        ref,
        mimeType,
        storage === 'banked' ? await archive.readBytes(ref) : null,
      ]);
    }
    if (resourceRows.length > 0) {
      await insertRows(
        host,
        request.databaseHandle,
        insertStatements,
        'resources',
        ['key', 'archive_path', 'media_kind', 'data'],
        resourceRows,
      );
    }
    if (insertStatements.length > 0) {
      await host.transaction(request.databaseHandle, insertStatements);
    }

    await host.transaction(request.databaseHandle, [
      {
        sql: 'CREATE INDEX terms_expression_idx ON terms(expression, score DESC)',
        params: [],
      },
      { sql: 'CREATE INDEX terms_reading_idx ON terms(reading, score DESC)', params: [] },
      {
        sql: 'CREATE INDEX term_meta_expression_idx ON term_meta(expression, reading, mode)',
        params: [],
      },
    ]);

    return { indexVersion: YOMITAN_INDEX_VERSION, entries, resources: resourceRows.length };
  } finally {
    await archive.close();
  }
};

const firstValue = (rows: DatabaseRow[], key: string): unknown => rows[0]?.[key];

const PORTABLE_INDEX_TABLES = [
  'meta',
  'terms',
  'tags',
  'term_meta',
  'resources',
  'term_banks',
] as const;

export const verifyYomitanIndex = async (host: YomitanHost, databaseHandle: string) => {
  try {
    const schemaRows = await host.select(
      databaseHandle,
      `SELECT name, type, sql FROM main.sqlite_schema WHERE name IN (${PORTABLE_INDEX_TABLES.map(() => '?').join(', ')})`,
      [...PORTABLE_INDEX_TABLES],
      PORTABLE_INDEX_TABLES.length,
    );
    const schemaByName = new Map(
      schemaRows.rows.map((row) => [row['name'], { type: row['type'], sql: row['sql'] }]),
    );
    if (
      PORTABLE_INDEX_TABLES.some((name) => {
        const schema = schemaByName.get(name);
        return (
          schema?.type !== 'table' ||
          typeof schema.sql !== 'string' ||
          !/^\s*CREATE\s+TABLE\b/iu.test(schema.sql)
        );
      })
    ) {
      throw new Error('Required portable index table is missing or unsafe');
    }
    for (const table of ['terms', 'term_meta']) {
      const shadowedRowIds = await host.select(
        databaseHandle,
        `SELECT name FROM pragma_table_info('${table}') WHERE lower(name) IN ('rowid', '_rowid_', 'oid') LIMIT 1`,
        [],
        1,
      );
      if (shadowedRowIds.rows.length > 0) {
        throw new Error('Portable index table shadows SQLite row identity');
      }
    }
    for (const sql of [
      'SELECT key, value FROM main.meta LIMIT 0',
      'SELECT _rowid_, id, expression, reading, definition_tags, rules, score, glossary_json, sequence, term_tags, bank_order, entry_index FROM main.terms LIMIT 0',
      'SELECT name, category, sort_order, notes, score FROM main.tags LIMIT 0',
      'SELECT _rowid_, id, expression, mode, reading, payload_json FROM main.term_meta LIMIT 0',
      'SELECT key, archive_path, media_kind, data FROM main.resources LIMIT 0',
      'SELECT bank_order, data FROM main.term_banks LIMIT 0',
    ]) {
      await host.select(databaseHandle, sql, [], 1);
    }
  } catch {
    throw new Error('Invalid portable Yomitan index schema');
  }
  const versionRows = await host.select(
    databaseHandle,
    "SELECT value FROM main.meta WHERE key = 'index_version'",
    [],
    1,
  );
  const version = Number(firstValue(versionRows.rows, 'value'));
  if (version !== YOMITAN_INDEX_VERSION) {
    throw new Error(`Yomitan index version mismatch: ${String(version)}`);
  }
  const countRows = await host.select(
    databaseHandle,
    'SELECT COUNT(*) AS count FROM main.terms',
    [],
    1,
  );
  const entries = Number(firstValue(countRows.rows, 'count'));
  if (!Number.isSafeInteger(entries) || entries < 1) throw new Error('Yomitan index is empty');
  const titleRows = await host.select(
    databaseHandle,
    "SELECT value FROM main.meta WHERE key = 'title'",
    [],
    1,
  );
  const title = firstValue(titleRows.rows, 'value');
  return { indexVersion: version, entries, ...(typeof title === 'string' ? { title } : {}) };
};

export const readYomitanResource = async (
  host: YomitanHost,
  request: Pick<PluginPayload<'readResource'>, 'sourceHandle' | 'databaseHandle' | 'resourceRef'>,
) => {
  const result = await host.select(
    request.databaseHandle,
    'SELECT archive_path, media_kind, length(data) AS data_size FROM resources WHERE key = ?',
    [request.resourceRef],
    1,
  );
  const row = result.rows[0];
  const path = row?.['archive_path'];
  const mimeType = row?.['media_kind'];
  if (typeof path !== 'string' || typeof mimeType !== 'string') {
    throw new Error(`Yomitan resource not found: ${request.resourceRef}`);
  }
  const expectedMime = mediaKindFor(path);
  if (expectedMime !== mimeType) throw new Error('Invalid Yomitan resource metadata');
  const dataSize = row?.['data_size'];
  if (dataSize !== null && dataSize !== undefined) {
    const size = Number(dataSize);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PLUGIN_RESOURCE_BYTES) {
      throw new Error(`Yomitan resource exceeds size limit: ${request.resourceRef}`);
    }
    const dataResult = await host.select(
      request.databaseHandle,
      'SELECT data FROM resources WHERE key = ?',
      [request.resourceRef],
      1,
    );
    const data = dataResult.rows[0]?.['data'];
    let view: Uint8Array;
    if (data instanceof Uint8Array) view = data;
    else if (ArrayBuffer.isView(data)) {
      view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (data instanceof ArrayBuffer) view = new Uint8Array(data);
    else if (
      Array.isArray(data) &&
      data.length <= MAX_PLUGIN_RESOURCE_BYTES &&
      data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      view = Uint8Array.from(data);
    } else throw new Error(`Invalid Yomitan resource data: ${request.resourceRef}`);
    if (view.byteLength !== size || view.byteLength > MAX_PLUGIN_RESOURCE_BYTES) {
      throw new Error(`Yomitan resource exceeds size limit: ${request.resourceRef}`);
    }
    return { mimeType: expectedMime, bytes: ownedBytes(view) };
  }
  const archive = await openYomitanArchive(host, request.sourceHandle);
  try {
    return { mimeType: expectedMime, bytes: ownedBytes(await archive.readBytes(path)) };
  } finally {
    await archive.close();
  }
};
