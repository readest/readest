import {
  dictionaryContentNodeSchema,
  parseDictionaryLookupResult,
  type DictionaryLookupEntry,
  type PluginPayload,
} from '@/services/plugins/contract';
import type { DatabaseRow } from '@/types/database';
import { deinflectJapanese, type DeinflectionCandidate } from './deinflect';
import { splitYomitanTags } from './schemas';
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
    `SELECT name, category, notes, score FROM tags WHERE name IN (${placeholders(values.length)})`,
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
      `SELECT expression, mode, reading, payload_json FROM term_meta WHERE expression IN (${placeholders(expressions.length)})`,
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
    ...(frequencies.length === 0 ? {} : { frequencies }),
    ...(pitches.length === 0 ? {} : { pitches }),
    ...(ipa.length === 0 ? {} : { ipa }),
  };
};

export const lookupYomitan = async (host: YomitanHost, request: PluginPayload<'lookup'>) => {
  const candidates = deinflectJapanese(request.query);
  const terms = candidates.map((candidate) => candidate.term);
  const result = await host.select(
    request.databaseHandle,
    `SELECT id, expression, reading, definition_tags, rules, score, glossary_json, sequence, term_tags, bank_order FROM terms WHERE expression IN (${placeholders(terms.length)}) OR reading IN (${placeholders(terms.length)}) ORDER BY score DESC, bank_order ASC`,
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
  const [tags, metadata] = await Promise.all([
    loadTags(host, request.databaseHandle, limited),
    loadMetadata(host, request.databaseHandle, limited),
  ]);

  const entries: DictionaryLookupEntry[] = limited.map(({ row, candidate }) => {
    const expression = stringField(row, 'expression');
    const reading = stringField(row, 'reading');
    const definitions = dictionaryContentNodeSchema
      .array()
      .parse(JSON.parse(stringField(row, 'glossary_json')));
    const tagNames = [
      ...splitYomitanTags(stringField(row, 'definition_tags')),
      ...splitYomitanTags(stringField(row, 'term_tags')),
    ];
    const uniqueTags = [...new Set(tagNames)].map((name) => tags.get(name) ?? { name });
    return {
      expression,
      reading,
      rules: splitYomitanTags(stringField(row, 'rules')),
      score: numberField(row, 'score'),
      ...(candidate.reasons.length === 0 ? {} : { deinflection: candidate.reasons }),
      ...(uniqueTags.length === 0 ? {} : { tags: uniqueTags }),
      ...metadataFor(metadata, expression, reading),
      definitions,
    };
  });
  return parseDictionaryLookupResult({ entries });
};
