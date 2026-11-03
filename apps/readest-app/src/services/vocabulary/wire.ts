import type { VocabularyEntry, VocabularyOccurrence, VocabularyState } from './types';
import { MAX_OCCURRENCES, entryId } from './entry';

export const MAX_PUSH_ROWS = 100;
export const MAX_PULL_ROWS = 1000;
export const MAX_ROW_BYTES = 64 * 1024;

/** A `public.vocabulary` row (migration 032). */
export interface VocabularyRow {
  user_id?: string;
  id: string;
  lang: string;
  word_key: string;
  word: string;
  state: VocabularyState;
  hint: string | null;
  occurrences: VocabularyOccurrence[];
  created_at: number;
  modified_at: number;
  deleted_at: number | null;
  /** Server-stamped on every write; the pull cursor. */
  updated_at?: string;
}

const STATES: readonly VocabularyState[] = ['none', 'learning', 'mastered'];

export const entryToRow = (e: VocabularyEntry): VocabularyRow => ({
  id: e.id,
  lang: e.lang,
  word_key: e.key,
  word: e.word,
  state: e.state,
  hint: e.hint ?? null,
  occurrences: e.occurrences,
  created_at: e.createdAt,
  modified_at: e.modifiedAt,
  deleted_at: e.deletedAt ?? null,
});

export const rowToEntry = (r: VocabularyRow): VocabularyEntry => ({
  id: r.id,
  lang: r.lang,
  key: r.word_key,
  word: r.word,
  state: r.state,
  ...(r.hint ? { hint: r.hint } : {}),
  occurrences: r.occurrences ?? [],
  createdAt: Number(r.created_at),
  modifiedAt: Number(r.modified_at),
  deletedAt: r.deleted_at == null ? null : Number(r.deleted_at),
});

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why a pushed row is rejected, or null when it's well-formed. */
export const validateRow = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return 'not an object';
  const r = value as Record<string, unknown>;
  if (!isString(r['lang']) || !isString(r['word_key']) || !isString(r['word'])) {
    return 'lang, word_key and word must be strings';
  }
  if (!r['word_key'] || r['id'] !== entryId(r['lang'], r['word_key'])) return 'id mismatch';
  if (!STATES.includes(r['state'] as VocabularyState)) return 'bad state';
  if (r['hint'] != null && !isString(r['hint'])) return 'bad hint';
  if (!isNumber(r['created_at']) || !isNumber(r['modified_at'])) return 'bad timestamps';
  if (r['deleted_at'] != null && !isNumber(r['deleted_at'])) return 'bad deleted_at';
  const occ = r['occurrences'];
  if (!Array.isArray(occ) || occ.length > MAX_OCCURRENCES) return 'bad occurrences';
  if (!occ.every((o) => o && isString(o.sentence) && isNumber(o.at))) return 'bad occurrence';
  if (JSON.stringify(value).length > MAX_ROW_BYTES) return 'row too large';
  return null;
};
