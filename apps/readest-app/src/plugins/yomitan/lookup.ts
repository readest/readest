import {
  dictionaryContentNodeSchema,
  dictionaryFrequencySchema,
  dictionaryIpaSchema,
  dictionaryPitchSchema,
  dictionaryTagSchema,
  MAX_DICTIONARY_DOCUMENT_NODES,
  MAX_PLUGIN_RESOURCE_BYTES,
  parseDictionaryLookupResult,
  type DictionaryContentNode,
  type DictionaryLookupEntry,
  type PluginPayload,
  type PluginSqlValue,
} from '@/services/plugins/contract';
import type { DatabaseRow } from '@/types/database';
import { normalizeYomitanGlossary } from './content';
import { deinflectJapanese, type DeinflectionCandidate } from './deinflect';
import { splitYomitanTags, yomitanTermBankSchema } from './schemas';
import type { YomitanHost } from './importer';

const MAX_YOMITAN_TAG_LOOKUP_NAMES = 256;
const MAX_YOMITAN_TERM_BANK_JSON_BYTES = 64 * 1_024 * 1_024;
const MAX_YOMITAN_EXPRESSION_BYTES = 512 * 4;
const MAX_YOMITAN_TAG_NAME_BYTES = 256 * 4;
const MAX_YOMITAN_TAG_TEXT_BYTES = 4_000 * 4;
const MAX_DEFERRED_TEXT_ROWS_PER_BATCH = 256;

class YomitanLookupLimitError extends Error {}

const stringField = (row: DatabaseRow, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Invalid Yomitan index field: ${key}`);
  return value;
};

const numberField = (row: DatabaseRow, key: string): number => {
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Invalid Yomitan index field: ${key}`);
  return value;
};

const bytesField = (row: DatabaseRow, key: string, maxBytes: number): Uint8Array<ArrayBuffer> => {
  const value = row[key];
  let view: Uint8Array;
  if (value instanceof Uint8Array) view = value;
  else if (ArrayBuffer.isView(value)) {
    view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) view = new Uint8Array(value);
  else if (
    Array.isArray(value) &&
    value.length <= maxBytes &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    view = Uint8Array.from(value);
  } else throw new Error(`Invalid Yomitan index field: ${key}`);
  if (view.byteLength > maxBytes) {
    throw new YomitanLookupLimitError(`Yomitan ${key} exceeds size limit`);
  }
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(view);
  return bytes;
};

const readTextWithLimit = async (
  stream: ReadableStream<Uint8Array>,
  budget: { bytesRead: number; maxBytes: number },
  signal: AbortSignal,
): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new DOMException('Yomitan operation aborted', 'AbortError');
      }
      const { value, done } = await reader.read();
      if (done) break;
      budget.bytesRead += value.byteLength;
      if (budget.bytesRead > budget.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new YomitanLookupLimitError(
          'Portable Yomitan term banks exceed aggregate decompressed size limit',
        );
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
};

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

type SqlRowId = Extract<PluginSqlValue, number | bigint>;

const sqlRowId = (row: DatabaseRow): SqlRowId => {
  const value = row['portable_rowid'];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new Error('Invalid portable Yomitan row id');
};

const sqlRowIdKey = (value: SqlRowId): string => `${typeof value}:${String(value)}`;

const loadDeferredTextColumn = async (
  host: YomitanHost,
  databaseHandle: string,
  rows: DatabaseRow[],
  options: {
    table: 'term_meta' | 'terms';
    column: 'glossary_json' | 'payload_json';
    sizeKey: 'glossary_size' | 'payload_size';
  },
): Promise<void> => {
  const pending: { row: DatabaseRow; rowId: SqlRowId; size: number }[] = [];
  for (const row of rows) {
    if (Object.hasOwn(row, options.column)) continue;
    try {
      const rowId = sqlRowId(row);
      const size = numberField(row, options.sizeKey);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PLUGIN_RESOURCE_BYTES) continue;
      pending.push({ row, rowId, size });
    } catch {
      // Invalid or oversized cells are isolated from valid sibling rows.
    }
  }

  const loadBatch = async (batch: typeof pending): Promise<void> => {
    if (batch.length === 0) return;
    const targets = new Map(batch.map((item) => [sqlRowIdKey(item.rowId), item]));
    const result = await host.select(
      databaseHandle,
      `SELECT _rowid_ AS portable_rowid, ${options.column} FROM ${options.table} WHERE _rowid_ IN (${placeholders(batch.length)}) AND typeof(${options.column}) = 'text' AND length(CAST(${options.column} AS BLOB)) <= ?`,
      [...batch.map(({ rowId }) => rowId), MAX_PLUGIN_RESOURCE_BYTES],
      batch.length,
    );
    for (const resultRow of result.rows) {
      try {
        const target = targets.get(sqlRowIdKey(sqlRowId(resultRow)));
        const value = stringField(resultRow, options.column);
        if (!target || new TextEncoder().encode(value).byteLength !== target.size) continue;
        target.row[options.column] = value;
      } catch {
        // Portable databases are untrusted; skip malformed deferred cells.
      }
    }
  };

  let batch: typeof pending = [];
  let batchBytes = 0;
  for (const item of pending) {
    if (
      batch.length >= MAX_DEFERRED_TEXT_ROWS_PER_BATCH ||
      (batch.length > 0 && batchBytes + item.size > MAX_PLUGIN_RESOURCE_BYTES)
    ) {
      await loadBatch(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(item);
    batchBytes += item.size;
  }
  await loadBatch(batch);
};

const candidateFor = (
  row: DatabaseRow,
  candidates: DeinflectionCandidate[],
): { candidate: DeinflectionCandidate; rank: number } | undefined => {
  const expression = stringField(row, 'expression');
  const reading = stringField(row, 'reading');
  const termRules = new Set(splitYomitanTags(stringField(row, 'rules')));
  for (let rank = 0; rank < candidates.length; rank += 1) {
    const candidate = candidates[rank]!;
    if (candidate.term !== expression && candidate.term !== reading) continue;
    if (candidate.rules.length > 0 && !candidate.rules.some((rule) => termRules.has(rule)))
      continue;
    return { candidate, rank };
  }
  return undefined;
};

interface IndexedTerm {
  row: DatabaseRow;
  candidate: DeinflectionCandidate;
  rank: number;
}

interface TagInfo {
  name: string;
  category?: string;
  notes?: string;
  score?: number;
}

interface LoadedTags {
  values: Map<string, TagInfo>;
  invalidNames: Set<string>;
}

const loadBankedDefinitions = async (
  host: YomitanHost,
  databaseHandle: string,
  terms: IndexedTerm[],
): Promise<Map<DatabaseRow, ReturnType<typeof normalizeYomitanGlossary>>> => {
  const bankOrders = [
    ...new Set(
      terms
        .filter(({ row }) => row['glossary_json'] === null)
        .map(({ row }) => numberField(row, 'bank_order')),
    ),
  ];
  if (bankOrders.length === 0) return new Map();
  const sizeRows = (
    await host.select(
      databaseHandle,
      `SELECT bank_order, MAX(length(data)) AS data_size FROM term_banks WHERE bank_order IN (${placeholders(bankOrders.length)}) GROUP BY bank_order HAVING COUNT(*) = 1`,
      bankOrders,
      bankOrders.length,
    )
  ).rows;
  const sizes = new Map<number, number>();
  for (const row of sizeRows) {
    try {
      const order = numberField(row, 'bank_order');
      const size = numberField(row, 'data_size');
      if (Number.isSafeInteger(order) && Number.isSafeInteger(size) && size >= 0) {
        sizes.set(order, size);
      }
    } catch {
      // Portable databases are untrusted; skip malformed bank metadata rows.
    }
  }
  const decompressionBudget = {
    bytesRead: 0,
    maxBytes: MAX_YOMITAN_TERM_BANK_JSON_BYTES,
  };
  const banks = new Map<number, ReturnType<typeof yomitanTermBankSchema.parse>>();
  for (const order of bankOrders) {
    const size = sizes.get(order);
    if (size === undefined) continue;
    if (size > MAX_PLUGIN_RESOURCE_BYTES) {
      throw new YomitanLookupLimitError(`Portable Yomitan term bank exceeds size limit: ${order}`);
    }
    try {
      const dataRows = (
        await host.select(
          databaseHandle,
          'SELECT data FROM term_banks WHERE bank_order = ?',
          [order],
          1,
        )
      ).rows;
      const bytes = bytesField(dataRows[0] ?? {}, 'data', MAX_PLUGIN_RESOURCE_BYTES);
      if (bytes.byteLength !== size) continue;
      const stream = new Response(bytes.buffer).body!.pipeThrough(new DecompressionStream('gzip'));
      banks.set(
        order,
        yomitanTermBankSchema.parse(
          JSON.parse(await readTextWithLimit(stream, decompressionBudget, host.signal)),
        ),
      );
    } catch (error) {
      if (
        host.signal.aborted ||
        error instanceof YomitanLookupLimitError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }
      // A malformed bank invalidates only the entries that reference it.
    }
  }
  const definitions = new Map<DatabaseRow, ReturnType<typeof normalizeYomitanGlossary>>();
  for (const { row } of terms) {
    if (row['glossary_json'] !== null) continue;
    try {
      const bank = banks.get(numberField(row, 'bank_order'));
      const entryIndex = numberField(row, 'entry_index');
      const term = bank?.[entryIndex];
      if (!term) throw new Error('Portable Yomitan term bank entry is missing');
      if (
        term[0] !== stringField(row, 'expression') ||
        (term[1] || term[0]) !== stringField(row, 'reading')
      ) {
        throw new Error('Portable Yomitan term bank entry does not match its index');
      }
      const normalized = normalizeYomitanGlossary(term[5], term[0]);
      const parsed = dictionaryContentNodeSchema.array().safeParse(normalized);
      if (parsed.success) definitions.set(row, parsed.data);
    } catch {
      // Portable databases are untrusted; skip malformed entries without breaking other matches.
    }
  }
  return definitions;
};

const loadTags = async (
  host: YomitanHost,
  databaseHandle: string,
  terms: IndexedTerm[],
): Promise<LoadedTags> => {
  const names = new Set<string>();
  for (const { row } of terms) {
    splitYomitanTags(stringField(row, 'definition_tags')).forEach((tag) => names.add(tag));
    splitYomitanTags(stringField(row, 'term_tags')).forEach((tag) => names.add(tag));
  }
  if (names.size === 0) return { values: new Map(), invalidNames: new Set() };
  const values = [...names].slice(0, MAX_YOMITAN_TAG_LOOKUP_NAMES);
  const result = await host.select(
    databaseHandle,
    `SELECT name, CASE WHEN typeof(category) = 'text' AND length(CAST(category AS BLOB)) <= ${MAX_YOMITAN_TAG_NAME_BYTES} THEN category END AS category, CASE WHEN typeof(notes) = 'text' AND length(CAST(notes AS BLOB)) <= ${MAX_YOMITAN_TAG_TEXT_BYTES} THEN notes END AS notes, CASE WHEN typeof(score) IN ('integer', 'real') THEN score END AS score, CASE WHEN typeof(category) = 'text' AND length(CAST(category AS BLOB)) <= ${MAX_YOMITAN_TAG_NAME_BYTES} AND typeof(notes) = 'text' AND length(CAST(notes AS BLOB)) <= ${MAX_YOMITAN_TAG_TEXT_BYTES} AND typeof(score) IN ('integer', 'real') THEN 1 ELSE 0 END AS portable_valid FROM tags WHERE name IN (${placeholders(values.length)}) AND typeof(name) = 'text' AND length(CAST(name AS BLOB)) <= ${MAX_YOMITAN_TAG_NAME_BYTES} ORDER BY name ASC LIMIT 256`,
    values,
    256,
  );
  const tags = new Map<string, TagInfo>();
  const invalidNames = new Set<string>();
  for (const row of result.rows) {
    const rawName = row['name'];
    try {
      const name = stringField(row, 'name');
      if (Object.hasOwn(row, 'portable_valid') && numberField(row, 'portable_valid') !== 1) {
        throw new Error('Invalid portable Yomitan tag row');
      }
      const category = stringField(row, 'category');
      const notes = stringField(row, 'notes');
      const score = numberField(row, 'score');
      const parsed = dictionaryTagSchema.safeParse({
        name,
        ...(category ? { category } : {}),
        ...(notes ? { notes } : {}),
        ...(Number.isFinite(score) ? { score } : {}),
      });
      if (parsed.success) {
        tags.set(name, parsed.data);
        invalidNames.delete(name);
      } else if (!tags.has(name)) {
        invalidNames.add(name);
      }
    } catch {
      if (typeof rawName === 'string' && !tags.has(rawName)) invalidNames.add(rawName);
      // Portable databases are untrusted; skip malformed tag rows.
    }
  }
  return { values: tags, invalidNames };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const loadMetadata = async (
  host: YomitanHost,
  databaseHandle: string,
  terms: IndexedTerm[],
): Promise<DatabaseRow[]> => {
  const expressions = [...new Set(terms.map(({ row }) => stringField(row, 'expression')))];
  if (expressions.length === 0) return [];
  const rows = (
    await host.select(
      databaseHandle,
      `SELECT _rowid_ AS portable_rowid, expression, mode, reading, length(CAST(payload_json AS BLOB)) AS payload_size FROM term_meta WHERE expression IN (${placeholders(expressions.length)}) AND typeof(id) IN ('integer', 'real') AND typeof(expression) = 'text' AND length(CAST(expression AS BLOB)) <= ${MAX_YOMITAN_EXPRESSION_BYTES} AND mode IN ('freq', 'pitch', 'ipa') AND typeof(reading) = 'text' AND length(CAST(reading AS BLOB)) <= ${MAX_YOMITAN_EXPRESSION_BYTES} AND typeof(payload_json) = 'text' ORDER BY id ASC LIMIT 1000`,
      expressions,
      1_000,
    )
  ).rows;
  await loadDeferredTextColumn(host, databaseHandle, rows, {
    table: 'term_meta',
    column: 'payload_json',
    sizeKey: 'payload_size',
  });
  return rows;
};

const metadataFor = (
  metadata: DatabaseRow[],
  expression: string,
  reading: string,
): Pick<DictionaryLookupEntry, 'frequencies' | 'pitches' | 'ipa'> => {
  const frequencies: NonNullable<DictionaryLookupEntry['frequencies']> = [];
  const pitches: NonNullable<DictionaryLookupEntry['pitches']> = [];
  const ipa: NonNullable<DictionaryLookupEntry['ipa']> = [];
  for (const row of metadata) {
    try {
      if (stringField(row, 'expression') !== expression) continue;
      const rowReading = stringField(row, 'reading');
      if (rowReading && rowReading !== reading) continue;
      const mode = stringField(row, 'mode');
      const payload: unknown = JSON.parse(stringField(row, 'payload_json'));
      if (mode === 'freq') {
        if (typeof payload === 'number' || typeof payload === 'string') {
          const parsed = dictionaryFrequencySchema.safeParse({ value: payload });
          if (parsed.success) frequencies.push(parsed.data);
        } else if (isRecord(payload)) {
          const parsed = dictionaryFrequencySchema.safeParse({
            value: payload['value'],
            ...('displayValue' in payload ? { displayValue: payload['displayValue'] } : {}),
          });
          if (parsed.success) frequencies.push(parsed.data);
        }
      } else if (mode === 'pitch' && Array.isArray(payload)) {
        for (const value of payload) {
          if (!isRecord(value)) continue;
          const parsed = dictionaryPitchSchema.safeParse({
            position: value['position'],
            ...('nasal' in value ? { nasal: value['nasal'] } : {}),
            ...('devoice' in value ? { devoice: value['devoice'] } : {}),
            ...('tags' in value ? { tags: value['tags'] } : {}),
          });
          if (parsed.success) pitches.push(parsed.data);
        }
      } else if (mode === 'ipa' && Array.isArray(payload)) {
        for (const value of payload) {
          if (!isRecord(value)) continue;
          const parsed = dictionaryIpaSchema.safeParse({
            value: value['ipa'],
            ...('tags' in value ? { tags: value['tags'] } : {}),
          });
          if (parsed.success) ipa.push(parsed.data);
        }
      }
    } catch {
      // Portable databases are untrusted; skip malformed metadata rows.
    }
  }
  return {
    ...(frequencies.length === 0 ? {} : { frequencies: frequencies.slice(0, 128) }),
    ...(pitches.length === 0 ? {} : { pitches: pitches.slice(0, 128) }),
    ...(ipa.length === 0 ? {} : { ipa: ipa.slice(0, 128) }),
  };
};

const countDocumentNodes = (definitions: DictionaryContentNode[]): number => {
  let count = 0;
  const visit = (node: DictionaryContentNode): void => {
    count += 1;
    if (node.type === 'element') node.children.forEach(visit);
  };
  definitions.forEach(visit);
  return count;
};

export const lookupYomitan = async (host: YomitanHost, request: PluginPayload<'lookup'>) => {
  const candidates = deinflectJapanese(request.query);
  const terms = candidates.map((candidate) => candidate.term);
  const result = await host.select(
    request.databaseHandle,
    `SELECT _rowid_ AS portable_rowid, id, expression, reading, definition_tags, rules, score, glossary_json IS NULL AS glossary_is_banked, length(CAST(glossary_json AS BLOB)) AS glossary_size, term_tags, bank_order, entry_index FROM terms WHERE (expression IN (${placeholders(terms.length)}) OR reading IN (${placeholders(terms.length)})) AND typeof(id) IN ('integer', 'real') AND typeof(expression) = 'text' AND length(CAST(expression AS BLOB)) <= ${MAX_YOMITAN_EXPRESSION_BYTES} AND typeof(reading) = 'text' AND length(CAST(reading AS BLOB)) <= ${MAX_YOMITAN_EXPRESSION_BYTES} AND typeof(definition_tags) = 'text' AND length(CAST(definition_tags AS BLOB)) <= ${MAX_YOMITAN_TAG_TEXT_BYTES} AND typeof(rules) = 'text' AND length(CAST(rules AS BLOB)) <= ${MAX_YOMITAN_TAG_TEXT_BYTES} AND typeof(score) IN ('integer', 'real') AND (glossary_json IS NULL OR typeof(glossary_json) = 'text') AND typeof(term_tags) = 'text' AND length(CAST(term_tags AS BLOB)) <= ${MAX_YOMITAN_TAG_TEXT_BYTES} AND typeof(bank_order) IN ('integer', 'real') AND (entry_index IS NULL OR typeof(entry_index) IN ('integer', 'real')) ORDER BY score DESC, bank_order ASC LIMIT 128`,
    [...terms, ...terms],
    128,
  );
  const indexed: IndexedTerm[] = [];
  for (const row of result.rows) {
    try {
      const match = candidateFor(row, candidates);
      if (!match) continue;
      stringField(row, 'definition_tags');
      stringField(row, 'term_tags');
      numberField(row, 'id');
      numberField(row, 'score');
      numberField(row, 'bank_order');
      numberField(row, 'entry_index');
      indexed.push({ row, ...match });
    } catch {
      // Portable databases are untrusted; skip malformed rows without breaking other matches.
    }
  }
  indexed.sort(
    (left, right) =>
      left.rank - right.rank ||
      numberField(right.row, 'score') - numberField(left.row, 'score') ||
      numberField(left.row, 'bank_order') - numberField(right.row, 'bank_order'),
  );
  const limited = indexed.slice(0, 128);
  for (const { row } of limited) {
    if (Object.hasOwn(row, 'glossary_json')) continue;
    try {
      if (numberField(row, 'glossary_is_banked') === 1) row['glossary_json'] = null;
    } catch {
      // Invalid rows remain without a glossary and are skipped below.
    }
  }
  await loadDeferredTextColumn(
    host,
    request.databaseHandle,
    limited.map(({ row }) => row),
    { table: 'terms', column: 'glossary_json', sizeKey: 'glossary_size' },
  );
  const [loadedTags, metadata, bankedDefinitions] = await Promise.all([
    loadTags(host, request.databaseHandle, limited),
    loadMetadata(host, request.databaseHandle, limited),
    loadBankedDefinitions(host, request.databaseHandle, limited),
  ]);

  const entries: DictionaryLookupEntry[] = [];
  let documentNodes = 0;
  for (const { row, candidate } of limited) {
    try {
      const expression = stringField(row, 'expression');
      const reading = stringField(row, 'reading');
      const glossary = row['glossary_json'];
      const definitions =
        typeof glossary === 'string' ? JSON.parse(glossary) : bankedDefinitions.get(row);
      const tagNames = [
        ...splitYomitanTags(stringField(row, 'definition_tags')),
        ...splitYomitanTags(stringField(row, 'term_tags')),
      ];
      const uniqueTags = [...new Set(tagNames)]
        .filter((name) => !loadedTags.invalidNames.has(name))
        .slice(0, 128)
        .map((name) => loadedTags.values.get(name) ?? { name });
      const [entry] = parseDictionaryLookupResult({
        entries: [
          {
            expression,
            reading,
            rules: splitYomitanTags(stringField(row, 'rules')),
            score: numberField(row, 'score'),
            ...(candidate.reasons.length === 0 ? {} : { deinflection: candidate.reasons }),
            ...(uniqueTags.length === 0 ? {} : { tags: uniqueTags }),
            ...metadataFor(metadata, expression, reading),
            definitions,
          },
        ],
      }).entries;
      if (!entry) continue;
      const entryNodes = countDocumentNodes(entry.definitions);
      if (documentNodes + entryNodes > MAX_DICTIONARY_DOCUMENT_NODES) continue;
      documentNodes += entryNodes;
      entries.push(entry);
    } catch {
      // Portable databases are untrusted; skip malformed rows without breaking other matches.
    }
  }
  return parseDictionaryLookupResult({ entries });
};
