// The Anki link (#789): reading words back out of Anki notes and deciding what
// an import or a send changes. See
// docs/superpowers/specs/2026-11-04-anki-link-design.md
import { TRANSLATOR_LANGS } from '@/services/constants';
import { getLanguageName } from '@/utils/lang';
import { entryId, normalizeWordKey, vocabularyLang } from './entry';
import { UNSPACED, ankiCardOf } from './export';
import type { VocabularyEntry, VocabularyImport, VocabularyState } from './types';

const MAX_WORD_LEN = 40;
const MAX_WORD_COUNT = 5;
const MAX_UNSPACED_LEN = 12;
// The hint input's maxLength in VocabularyDetail.
const MAX_HINT_LEN = 80;

const LANG_TAG_PREFIX = 'readest::lang::';
// The mark tag Sync keeps on each note in step with the word (none for Looked Up).
const MARK_TAGS: Partial<Record<VocabularyState, string>> = {
  learning: 'readest::learning',
  mastered: 'readest::mastered',
};
const isMarkTag = (tag: string) => Object.values(MARK_TAGS).includes(tag.toLowerCase());

// Older Anki editors start each new line with an opening <div>, newer ones close it.
const BREAKS = /<br\s*\/?>|<\/?(?:div|p|li|h[1-6]|tr)\b[^>]*>/gi;
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

/** What a note's first field names: its first cloze answer, else its first line. */
export const ankiHeadwordOf = (fields: string[]): string => {
  const lines = cleanAnkiField(fields[0] ?? '');
  const cloze = lines.join('\n').match(CLOZE);
  return (cloze ? cloze[1]!.trim() : lines[0]) ?? '';
};

/** The headword a note stands for, or null when it holds no usable word. */
export const ankiWordOf = (fields: string[]): string | null => {
  const word = ankiHeadwordOf(fields);
  return word && !tooLong(word) ? word : null;
};

const isReadestNote = (tags: string) => tags.split(/\s+/).includes('readest');

export const ankiHintOf = (fields: string[], tags = ''): string | undefined => {
  let back = fields[1] ?? '';
  // A Readest card's back ends with the book line in <small>; it is never the hint.
  if (isReadestNote(tags)) back = back.replace(/<small>[\s\S]*?<\/small>/gi, '');
  const line = cleanAnkiField(back)[0];
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
    const hint = ankiHintOf(n.fields, n.tags);
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

/** A note the AnkiDroid link adds: Front and Back, plus tags. */
export interface AnkiOutgoingNote {
  fields: [string, string];
  tags: string[];
}

// Keyed by what the card's first field shows, without the import's length
// limits, so anything Sync wrote is recognised next time.
const noteKey = (fields: string[]) => normalizeWordKey(ankiHeadwordOf(fields));

/**
 * The notes Sync adds. A word is left out when the deck already has a note for
 * it, under any note type, tagged with the same language or with none.
 */
export const ankiNotesToSend = (
  entries: VocabularyEntry[],
  existing: { fields: string[]; tags: string }[],
): AnkiOutgoingNote[] => {
  const have = new Set<string>();
  for (const n of existing) {
    const key = noteKey(n.fields);
    if (key) have.add(`${ankiLangOf(n.tags) ?? '*'}:${key}`);
  }
  const notes: AnkiOutgoingNote[] = [];
  for (const e of entries) {
    if (e.deletedAt) continue;
    const { front, back, tags } = ankiCardOf(e);
    const key = noteKey([front]);
    if (have.has(`${e.lang}:${key}`) || have.has(`*:${key}`)) continue;
    const mark = MARK_TAGS[e.state];
    notes.push({
      fields: [front, back],
      tags: [...tags, ankiLangTag(e.lang), ...(mark ? [mark] : [])],
    });
  }
  return notes;
};

/**
 * Notes with their language made explicit, as Sync reads them. A note without a
 * language tag (added by hand, or from the file export) belongs to the word
 * Readest already has with its key: a live one before a deleted one, `lang`
 * before another language. Otherwise it gets `lang`. The tag is added so the
 * pull, the push and the tag mirror all file the note the same way.
 */
export const withNoteLangs = <T extends { fields: string[]; tags: string }>(
  notes: T[],
  entries: Record<string, VocabularyEntry>,
  lang: string,
): T[] => {
  const rank = (e: VocabularyEntry) => (e.deletedAt ? 2 : 0) + (e.lang === lang ? 0 : 1);
  const best = new Map<string, VocabularyEntry>();
  for (const e of Object.values(entries)) {
    const seen = best.get(e.key);
    if (!seen || rank(e) < rank(seen)) best.set(e.key, e);
  }
  return notes.map((n) => {
    if (ankiLangOf(n.tags)) return n;
    const noteLang = best.get(noteKey(n.fields))?.lang ?? lang;
    return { ...n, tags: `${n.tags.trim()} ${ankiLangTag(noteLang)}`.trim() };
  });
};

/** A note's full tag list, as Sync writes it back. */
export interface AnkiTagUpdate {
  id: number;
  tags: string[];
}

/**
 * The notes whose mark tag no longer matches their word in Readest. Notes
 * without a live word are left as they are, and so are their other tags.
 */
export const ankiTagUpdates = (
  notes: { id: number; fields: string[]; tags: string }[],
  entries: Record<string, VocabularyEntry>,
  lang: string,
): AnkiTagUpdate[] => {
  const updates: AnkiTagUpdate[] = [];
  for (const n of notes) {
    const key = noteKey(n.fields);
    const e = key ? entries[entryId(ankiLangOf(n.tags) ?? lang, key)] : undefined;
    if (!e || e.deletedAt) continue;
    const tags = n.tags.split(/\s+/).filter(Boolean);
    const marks = tags.filter(isMarkTag).map((t) => t.toLowerCase());
    const want = MARK_TAGS[e.state];
    if (want ? marks.length === 1 && marks[0] === want : !marks.length) continue;
    updates.push({
      id: n.id,
      tags: [...tags.filter((t) => !isMarkTag(t)), ...(want ? [want] : [])],
    });
  }
  return updates;
};
