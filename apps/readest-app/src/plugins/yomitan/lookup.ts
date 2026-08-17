import {
  dictionaryContentNodeSchema,
  MAX_DICTIONARY_DOCUMENT_NODES,
  parseDictionaryLookupResult,
  type DictionaryContentNode,
  type DictionaryLookupEntry,
  type PluginPayload,
} from '@/services/plugins/contract';
import type { DatabaseRow } from '@/types/database';
import { normalizeYomitanGlossary } from './content';
import { deinflectJapanese, type DeinflectionCandidate } from './deinflect';
import { splitYomitanTags, yomitanTermBankSchema } from './schemas';
import type { YomitanHost } from './importer';

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

const bytesField = (row: DatabaseRow, key: string): Uint8Array<ArrayBuffer> => {
  const value = row[key];
  let view: Uint8Array;
  if (value instanceof Uint8Array) view = value;
  else if (ArrayBuffer.isView(value)) {
    view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) view = new Uint8Array(value);
  else if (
    Array.isArray(value) &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    view = Uint8Array.from(value);
  } else throw new Error(`Invalid Yomitan index field: ${key}`);
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(view);
  return bytes;
};

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

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

const loadBankedDefinitions = async (
  host: YomitanHost,
  databaseHandle: string,
  terms: IndexedTerm[],
): Promise<Map<number, ReturnType<typeof normalizeYomitanGlossary>>> => {
  const bankOrders = [
    ...new Set(
      terms
        .filter(({ row }) => row['glossary_json'] === null)
        .map(({ row }) => numberField(row, 'bank_order')),
    ),
  ];
  if (bankOrders.length === 0) return new Map();
  const rows = (
    await host.select(
      databaseHandle,
      `SELECT bank_order, data FROM term_banks WHERE bank_order IN (${placeholders(bankOrders.length)})`,
      bankOrders,
      bankOrders.length,
    )
  ).rows;
  const banks = new Map<number, ReturnType<typeof yomitanTermBankSchema.parse>>();
  for (const row of rows) {
    const bytes = bytesField(row, 'data');
    const stream = new Response(bytes.buffer).body!.pipeThrough(new DecompressionStream('gzip'));
    banks.set(
      numberField(row, 'bank_order'),
      yomitanTermBankSchema.parse(JSON.parse(await new Response(stream).text())),
    );
  }
  const definitions = new Map<number, ReturnType<typeof normalizeYomitanGlossary>>();
  for (const { row } of terms) {
    if (row['glossary_json'] !== null) continue;
    const id = numberField(row, 'id');
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
    definitions.set(id, normalizeYomitanGlossary(term[5], term[0]));
  }
  return definitions;
};

const loadTags = async (
  host: YomitanHost,
  databaseHandle: string,
  terms: IndexedTerm[],
): Promise<Map<string, TagInfo>> => {
  const names = new Set<string>();
  for (const { row } of terms) {
    splitYomitanTags(stringField(row, 'definition_tags')).forEach((tag) => names.add(tag));
    splitYomitanTags(stringField(row, 'term_tags')).forEach((tag) => names.add(tag));
  }
  if (names.size === 0) return new Map();
  const values = [...names];
  const result = await host.select(
    databaseHandle,
    `SELECT name, category, notes, score FROM tags WHERE name IN (${placeholders(values.length)}) ORDER BY name ASC LIMIT 256`,
    values,
    256,
  );
  return new Map(
    result.rows.map((row) => {
      const name = stringField(row, 'name');
      const category = stringField(row, 'category');
      const notes = stringField(row, 'notes');
      const score = numberField(row, 'score');
      return [
        name,
        {
          name,
          ...(category ? { category } : {}),
          ...(notes ? { notes } : {}),
          ...(Number.isFinite(score) ? { score } : {}),
        },
      ];
    }),
  );
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
  return (
    await host.select(
      databaseHandle,
      `SELECT expression, mode, reading, payload_json FROM term_meta WHERE expression IN (${placeholders(expressions.length)}) ORDER BY id ASC LIMIT 1000`,
      expressions,
      1_000,
    )
  ).rows;
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
    if (stringField(row, 'expression') !== expression) continue;
    const rowReading = stringField(row, 'reading');
    if (rowReading && rowReading !== reading) continue;
    const mode = stringField(row, 'mode');
    const payload: unknown = JSON.parse(stringField(row, 'payload_json'));
    if (mode === 'freq') {
      if (typeof payload === 'number' || typeof payload === 'string') {
        frequencies.push({ value: payload });
      } else if (isRecord(payload) && typeof payload['value'] === 'number') {
        frequencies.push({
          value: payload['value'],
          ...(typeof payload['displayValue'] === 'string'
            ? { displayValue: payload['displayValue'] }
            : {}),
        });
      }
    } else if (mode === 'pitch' && Array.isArray(payload)) {
      for (const value of payload) {
        if (!isRecord(value)) continue;
        const position = value['position'];
        if (
          (typeof position !== 'number' || !Number.isInteger(position) || position < 0) &&
          (typeof position !== 'string' || !/^[HL]+$/u.test(position))
        ) {
          continue;
        }
        pitches.push({
          position,
          ...(typeof value['nasal'] === 'number' || Array.isArray(value['nasal'])
            ? { nasal: value['nasal'] as number | number[] }
            : {}),
          ...(typeof value['devoice'] === 'number' || Array.isArray(value['devoice'])
            ? { devoice: value['devoice'] as number | number[] }
            : {}),
          ...(Array.isArray(value['tags']) && value['tags'].every((tag) => typeof tag === 'string')
            ? { tags: value['tags'] as string[] }
            : {}),
        });
      }
    } else if (mode === 'ipa' && Array.isArray(payload)) {
      for (const value of payload) {
        if (!isRecord(value) || typeof value['ipa'] !== 'string') continue;
        ipa.push({
          value: value['ipa'],
          ...(Array.isArray(value['tags']) && value['tags'].every((tag) => typeof tag === 'string')
            ? { tags: value['tags'] as string[] }
            : {}),
        });
      }
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
    `SELECT id, expression, reading, definition_tags, rules, score, glossary_json, sequence, term_tags, bank_order, entry_index FROM terms WHERE expression IN (${placeholders(terms.length)}) OR reading IN (${placeholders(terms.length)}) ORDER BY score DESC, bank_order ASC LIMIT 256`,
    [...terms, ...terms],
    256,
  );
  const indexed: IndexedTerm[] = [];
  for (const row of result.rows) {
    const match = candidateFor(row, candidates);
    if (match) indexed.push({ row, ...match });
  }
  indexed.sort(
    (left, right) =>
      left.rank - right.rank ||
      numberField(right.row, 'score') - numberField(left.row, 'score') ||
      numberField(left.row, 'bank_order') - numberField(right.row, 'bank_order'),
  );
  const limited = indexed.slice(0, 128);
  const [tags, metadata, bankedDefinitions] = await Promise.all([
    loadTags(host, request.databaseHandle, limited),
    loadMetadata(host, request.databaseHandle, limited),
    loadBankedDefinitions(host, request.databaseHandle, limited),
  ]);

  const entries: DictionaryLookupEntry[] = [];
  let documentNodes = 0;
  for (const { row, candidate } of limited) {
    const expression = stringField(row, 'expression');
    const reading = stringField(row, 'reading');
    const glossary = row['glossary_json'];
    const definitions = dictionaryContentNodeSchema
      .array()
      .parse(
        typeof glossary === 'string'
          ? JSON.parse(glossary)
          : bankedDefinitions.get(numberField(row, 'id')),
      );
    const tagNames = [
      ...splitYomitanTags(stringField(row, 'definition_tags')),
      ...splitYomitanTags(stringField(row, 'term_tags')),
    ];
    const uniqueTags = [...new Set(tagNames)]
      .slice(0, 128)
      .map((name) => tags.get(name) ?? { name });
    const entry: DictionaryLookupEntry = {
      expression,
      reading,
      rules: splitYomitanTags(stringField(row, 'rules')),
      score: numberField(row, 'score'),
      ...(candidate.reasons.length === 0 ? {} : { deinflection: candidate.reasons }),
      ...(uniqueTags.length === 0 ? {} : { tags: uniqueTags }),
      ...metadataFor(metadata, expression, reading),
      definitions,
    };
    const entryNodes = countDocumentNodes(definitions);
    if (documentNodes + entryNodes > MAX_DICTIONARY_DOCUMENT_NODES) continue;
    documentNodes += entryNodes;
    entries.push(entry);
  }
  return parseDictionaryLookupResult({ entries });
};
