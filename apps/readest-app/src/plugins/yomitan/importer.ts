import type { DatabaseExecResult, DatabaseRow } from '@/types/database';
import {
  MAX_PLUGIN_RESOURCE_BYTES,
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

export const YOMITAN_INDEX_VERSION = 1;

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

const byBankOrder = (left: { filename: string }, right: { filename: string }): number =>
  bankOrder(left.filename) - bankOrder(right.filename) ||
  left.filename.localeCompare(right.filename);

const mediaKindFor = (
  path: string,
): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml' | undefined => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return undefined;
};

const schemaStatements = (): SqlStatement[] => [
  { sql: 'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)', params: [] },
  {
    sql: 'CREATE TABLE terms (id INTEGER PRIMARY KEY AUTOINCREMENT, expression TEXT NOT NULL, reading TEXT NOT NULL, definition_tags TEXT NOT NULL, rules TEXT NOT NULL, score REAL NOT NULL, glossary_json TEXT NOT NULL, sequence INTEGER NOT NULL, term_tags TEXT NOT NULL, bank_order INTEGER NOT NULL)',
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
    sql: 'CREATE TABLE resources (key TEXT PRIMARY KEY, archive_path TEXT NOT NULL, media_kind TEXT NOT NULL)',
    params: [],
  },
  {
    sql: 'CREATE INDEX terms_expression_idx ON terms(expression, score DESC)',
    params: [],
  },
  { sql: 'CREATE INDEX terms_reading_idx ON terms(reading, score DESC)', params: [] },
  {
    sql: 'CREATE INDEX term_meta_expression_idx ON term_meta(expression, reading, mode)',
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

const insertRows = async (
  host: YomitanHost,
  databaseHandle: string,
  table: string,
  columns: string[],
  rows: PluginSqlValue[][],
): Promise<void> => {
  const rowsPerStatement = Math.max(1, Math.floor(900 / columns.length));
  const statements: SqlStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += rowsPerStatement) {
    statements.push(insertStatement(table, columns, rows.slice(offset, offset + rowsPerStatement)));
    if (statements.length === 16) {
      await host.transaction(databaseHandle, statements.splice(0));
    }
  }
  if (statements.length > 0) await host.transaction(databaseHandle, statements);
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

export const probeYomitanSource = async (host: YomitanHost, sourceHandle: string) => {
  try {
    await readIndex(host, sourceHandle);
    return {
      matches: [{ sourceHandle, formatId: 'yomitan' as const, confidence: 1 }],
    };
  } catch {
    return { matches: [] };
  }
};

export const inspectYomitanSource = async (host: YomitanHost, sourceHandle: string) => {
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
): { rows: PluginSqlValue[][]; resourceRefs: string[] } => {
  const rows: PluginSqlValue[][] = [];
  const resourceRefs = new Set<string>();
  for (const term of terms) {
    const [expression, reading, definitionTags, rules, score, glossary, sequence, termTags] = term;
    const definitions = normalizeYomitanGlossary(glossary);
    collectYomitanResourceRefs(definitions).forEach((ref) => resourceRefs.add(ref));
    rows.push([
      expression,
      reading || expression,
      splitYomitanTags(definitionTags).join(' '),
      splitYomitanTags(rules).join(' '),
      score,
      JSON.stringify(definitions),
      sequence,
      splitYomitanTags(termTags).join(' '),
      order,
    ]);
  }
  return { rows, resourceRefs: [...resourceRefs] };
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
) => {
  const archive = await openYomitanArchive(host, request.sourceHandle);
  try {
    const index = parseYomitanIndex(await archive.readJson('index.json', 2 * 1_024 * 1_024));
    if (index.sourceFormatVersion !== request.sourceFormatVersion) {
      throw new Error('Yomitan source format changed after inspection');
    }

    await host.transaction(request.databaseHandle, schemaStatements());
    await insertRows(
      host,
      request.databaseHandle,
      'meta',
      ['key', 'value'],
      [
        ['index_version', String(YOMITAN_INDEX_VERSION)],
        ['source_format_version', String(index.sourceFormatVersion)],
        ['title', index.title],
        ['revision', index.revision ?? ''],
      ],
    );

    const termBanks = archive.list(TERM_BANK_PATTERN).sort(byBankOrder);
    const tagBanks = archive.list(TAG_BANK_PATTERN).sort(byBankOrder);
    const metaBanks = archive.list(TERM_META_BANK_PATTERN).sort(byBankOrder);
    if (termBanks.length === 0) throw new Error('Yomitan dictionary has no term banks');

    const allBanks = [...tagBanks, ...termBanks, ...metaBanks];
    let completed = 0;
    let entries = 0;
    const referencedResources = new Set<string>();

    const legacyTags = legacyTagRows(index);
    if (legacyTags.length > 0) {
      await insertRows(
        host,
        request.databaseHandle,
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
        'tags',
        ['name', 'category', 'sort_order', 'notes', 'score'],
        tagRows(tags),
      );
      host.progress('indexing', ++completed, allBanks.length);
    }

    for (const bank of termBanks) {
      if (host.signal.aborted) throw new DOMException('Yomitan import aborted', 'AbortError');
      const terms = yomitanTermBankSchema.parse(await archive.readJson(bank.filename));
      const normalized = termRows(terms, bankOrder(bank.filename));
      normalized.resourceRefs.forEach((ref) => referencedResources.add(ref));
      await insertRows(
        host,
        request.databaseHandle,
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
        ],
        normalized.rows,
      );
      entries += terms.length;
      host.progress('indexing', ++completed, allBanks.length);
    }

    for (const bank of metaBanks) {
      if (host.signal.aborted) throw new DOMException('Yomitan import aborted', 'AbortError');
      const metadata = yomitanTermMetaBankSchema.parse(await archive.readJson(bank.filename));
      await insertRows(
        host,
        request.databaseHandle,
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
      if (!mimeType) throw new Error(`Unsupported Yomitan resource type: ${ref}`);
      if (entry.uncompressedSize > MAX_PLUGIN_RESOURCE_BYTES) {
        throw new Error(`Yomitan resource exceeds size limit: ${ref}`);
      }
      resourceRows.push([ref, ref, mimeType]);
    }
    if (resourceRows.length > 0) {
      await insertRows(
        host,
        request.databaseHandle,
        'resources',
        ['key', 'archive_path', 'media_kind'],
        resourceRows,
      );
    }

    return { indexVersion: YOMITAN_INDEX_VERSION, entries, resources: resourceRows.length };
  } finally {
    await archive.close();
  }
};

const firstValue = (rows: DatabaseRow[], key: string): unknown => rows[0]?.[key];

export const verifyYomitanIndex = async (host: YomitanHost, databaseHandle: string) => {
  const versionRows = await host.select(
    databaseHandle,
    "SELECT value FROM meta WHERE key = 'index_version'",
    [],
    1,
  );
  const version = Number(firstValue(versionRows.rows, 'value'));
  if (version !== YOMITAN_INDEX_VERSION) {
    throw new Error(`Yomitan index version mismatch: ${String(version)}`);
  }
  const countRows = await host.select(databaseHandle, 'SELECT COUNT(*) AS count FROM terms', [], 1);
  const entries = Number(firstValue(countRows.rows, 'count'));
  if (!Number.isSafeInteger(entries) || entries < 1) throw new Error('Yomitan index is empty');
  return { indexVersion: version, entries };
};

export const readYomitanResource = async (
  host: YomitanHost,
  request: Pick<PluginPayload<'readResource'>, 'sourceHandle' | 'databaseHandle' | 'resourceRef'>,
) => {
  const result = await host.select(
    request.databaseHandle,
    'SELECT archive_path, media_kind FROM resources WHERE key = ?',
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
  if (!expectedMime || expectedMime !== mimeType)
    throw new Error('Invalid Yomitan resource metadata');
  const archive = await openYomitanArchive(host, request.sourceHandle);
  try {
    return { mimeType: expectedMime, bytes: await archive.readBytes(path) };
  } finally {
    await archive.close();
  }
};
