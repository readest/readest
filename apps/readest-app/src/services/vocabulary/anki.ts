// The Anki link (#789): reading words back out of Anki notes and deciding what
// an import or a send changes. See
// docs/superpowers/specs/2026-11-04-anki-link-design.md
import { TRANSLATOR_LANGS } from '@/services/constants';
import { getLanguageName } from '@/utils/lang';
import { entryId, normalizeWordKey, vocabularyLang } from './entry';
import { UNSPACED } from './export';
import type { VocabularyEntry, VocabularyImport } from './types';

const MAX_WORD_LEN = 40;
const MAX_WORD_COUNT = 5;
const MAX_UNSPACED_LEN = 12;
// The hint input's maxLength in VocabularyDetail.
const MAX_HINT_LEN = 80;

const LANG_TAG_PREFIX = 'readest::lang::';

const BREAKS = /<br\s*\/?>|<\/(?:div|p|li|h[1-6]|tr)\s*>/gi;
const SOUND = /\[sound:[^\]]*\]/g;
const CLOZE = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/;

// One reused element decodes entities: a textarea's content is parsed as text,
// so nothing in a field can load or run. Parsing a new document per field cost
// seconds on a large deck.
let decoder: HTMLTextAreaElement | null = null;
const decodeEntities = (s: string) => {
  if (!s.includes('&')) return s;
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = s;
  return decoder.value;
};

/** The visible text of an Anki field, one entry per non-empty line. */
export const cleanAnkiField = (html: string): string[] => {
  const text = decodeEntities(html.replace(BREAKS, '\n').replace(/<[^>]*>/g, ''));
  return text
    .replace(SOUND, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const tooLong = (word: string) =>
  word.length > MAX_WORD_LEN ||
  word.split(' ').length > MAX_WORD_COUNT ||
  (UNSPACED.test(word) && word.length > MAX_UNSPACED_LEN);

/** The headword a note stands for, or null when it holds no usable word. */
export const ankiWordOf = (fields: string[]): string | null => {
  const lines = cleanAnkiField(fields[0] ?? '');
  const cloze = lines.join('\n').match(CLOZE);
  const word = (cloze ? cloze[1]!.trim() : lines[0]) ?? '';
  return word && !tooLong(word) ? word : null;
};

export const ankiHintOf = (fields: string[]): string | undefined => {
  const line = cleanAnkiField(fields[1] ?? '')[0];
  return line ? line.slice(0, MAX_HINT_LEN) : undefined;
};

export const ankiLangTag = (lang: string): string => `${LANG_TAG_PREFIX}${lang}`;

export const ankiLangOf = (tags: string): string | undefined => {
  const tag = tags
    .split(/\s+/)
    .find((t) => t.toLowerCase().startsWith(LANG_TAG_PREFIX) && t.length > LANG_TAG_PREFIX.length);
  return tag?.slice(LANG_TAG_PREFIX.length);
};

/** A note read from an Anki deck; `mature` when any of its cards is. */
export interface AnkiImportNote {
  fields: string[];
  tags: string;
  mature: boolean;
}

export interface AnkiImportPlan {
  ops: VocabularyImport[];
  added: number;
  mastered: number;
  skipped: number;
}

/**
 * What importing a deck changes. New words come in as Learning (Mastered when
 * mature); words already there only move up to Mastered, and only get a hint
 * when they have none. Deleted words stay deleted.
 */
export const planAnkiImport = (
  notes: AnkiImportNote[],
  entries: Record<string, VocabularyEntry>,
  lang: string,
): AnkiImportPlan => {
  let skipped = 0;
  const byId = new Map<string, { word: string; lang: string; mature: boolean; hint?: string }>();
  for (const n of notes) {
    const word = ankiWordOf(n.fields);
    const key = word ? normalizeWordKey(word) : '';
    if (!word || !key) {
      skipped++;
      continue;
    }
    const noteLang = ankiLangOf(n.tags) ?? lang;
    const id = entryId(noteLang, key);
    const hint = ankiHintOf(n.fields);
    const seen = byId.get(id);
    if (seen) {
      seen.mature ||= n.mature;
      seen.hint ??= hint;
    } else {
      byId.set(id, { word, lang: noteLang, mature: n.mature, hint });
    }
  }

  const ops: VocabularyImport[] = [];
  let added = 0;
  let mastered = 0;
  for (const [id, w] of byId) {
    const current = entries[id];
    if (current?.deletedAt) {
      skipped++;
    } else if (!current) {
      ops.push({
        word: w.word,
        lang: w.lang,
        state: w.mature ? 'mastered' : 'learning',
        hint: w.hint,
      });
      added++;
      if (w.mature) mastered++;
    } else {
      const op: VocabularyImport = { word: w.word, lang: w.lang };
      if (w.mature && current.state !== 'mastered') {
        op.state = 'mastered';
        mastered++;
      }
      if (w.hint && !current.hint) op.hint = w.hint;
      if (op.state || op.hint) ops.push(op);
    }
  }
  return { ops, added, mastered, skipped };
};

const liveLangCounts = (entries: Record<string, VocabularyEntry>) => {
  const counts = new Map<string, number>();
  for (const e of Object.values(entries)) {
    if (!e.deletedAt) counts.set(e.lang, (counts.get(e.lang) ?? 0) + 1);
  }
  return counts;
};

/** The languages an import can file words under: base codes, labelled. */
export const importLanguageOptions = (
  entries: Record<string, VocabularyEntry>,
): { code: string; label: string }[] => {
  const options = new Map<string, string>([['zh', '中文']]);
  for (const [code, name] of Object.entries(TRANSLATOR_LANGS)) {
    const base = vocabularyLang(code);
    if (!options.has(base)) options.set(base, name);
  }
  for (const code of liveLangCounts(entries).keys()) {
    if (code !== 'und' && !options.has(code)) options.set(code, getLanguageName(code));
  }
  return [...options]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

/** The language most of the reader's words are filed under, else English. */
export const defaultImportLang = (entries: Record<string, VocabularyEntry>): string => {
  let best = 'en';
  let max = 0;
  for (const [code, n] of liveLangCounts(entries)) {
    if (code !== 'und' && n > max) [best, max] = [code, n];
  }
  return best;
};
