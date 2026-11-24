// The Anki link (#789): reading words back out of Anki notes and deciding what
// an import or a send changes. See
// docs/superpowers/specs/2026-11-04-anki-link-design.md
import { TRANSLATOR_LANGS } from '@/services/constants';
import { buildBookAppLink } from '@/utils/deeplink';
import { getLanguageName } from '@/utils/lang';
import { entryId, normalizeWordKey, vocabularyLang } from './entry';
import { UNSPACED, ankiCardOf, ankiPartsOf, escapeHtml } from './export';
import type {
  AnkiFieldSource,
  AnkiProfile,
  AnkiProfileSettings,
  VocabularyEntry,
  VocabularyImport,
  VocabularyState,
} from './types';

const MAX_WORD_LEN = 40;
const MAX_WORD_COUNT = 5;
const MAX_UNSPACED_LEN = 12;
// The hint input's maxLength in VocabularyDetail.
const MAX_HINT_LEN = 80;

/** The deck Sync reads, with every subdeck under it. */
export const ANKI_DECK = 'Readest Vocabulary';
/** Readest's own note type, which Sync creates. */
export const ANKI_NOTE_TYPE = 'Readest Vocabulary';

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

/**
 * Remove every tag. One pass already leaves no `<…>` pair; repeating until
 * nothing changes is the form code scanning recognises as complete.
 */
const stripTags = (html: string) => {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text;
};

/** The visible text of an Anki field, one entry per non-empty line. */
export const cleanAnkiField = (html: string): string[] => {
  const text = decodeEntities(stripTags(html.replace(BREAKS, '\n')));
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
  /** The live words whose cards are mature: `applied` for the next plan. */
  matured: string[];
}

// Anki collapses each run of whitespace on a card, so a word Readest saved with
// a no-break or double space is found by its collapsed key.
const collapseKey = (key: string) => key.replace(/\s+/g, ' ');

/** Words by the id a card's key gives: a live word first, then the exact spelling. */
const byCardId = (entries: Record<string, VocabularyEntry>) => {
  const rank = (e: VocabularyEntry) =>
    (e.deletedAt ? 2 : 0) + (collapseKey(e.key) === e.key ? 0 : 1);
  const index = new Map<string, VocabularyEntry>();
  for (const e of Object.values(entries)) {
    const id = entryId(e.lang, collapseKey(e.key));
    const seen = index.get(id);
    if (!seen || rank(e) < rank(seen)) index.set(id, e);
  }
  return index;
};

/**
 * What importing a deck changes. New words come in as Learning (Mastered when
 * mature); words already there only move up to Mastered, and only get a hint
 * when they have none. Deleted words stay deleted. A word in `applied` already
 * had its mature card applied, so a word lowered since stays lowered until
 * the card lapses and matures again.
 */
export const planAnkiImport = (
  notes: AnkiImportNote[],
  entries: Record<string, VocabularyEntry>,
  lang: string,
  applied: ReadonlySet<string> = new Set(),
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
  const matured: string[] = [];
  const index = byCardId(entries);
  let added = 0;
  let mastered = 0;
  for (const [id, w] of byId) {
    const current = index.get(id);
    if (current?.deletedAt) {
      skipped++;
      continue;
    }
    if (w.mature) matured.push(current?.id ?? id);
    if (!current) {
      ops.push({
        word: w.word,
        lang: w.lang,
        state: w.mature ? 'mastered' : 'learning',
        hint: w.hint,
      });
      added++;
      if (w.mature) mastered++;
    } else {
      const op: VocabularyImport = { word: current.word, lang: current.lang };
      if (w.mature && !applied.has(current.id) && current.state !== 'mastered') {
        op.state = 'mastered';
        mastered++;
      }
      if (w.hint && !current.hint) op.hint = w.hint;
      if (op.state || op.hint) ops.push(op);
    }
  }
  return { ops, added, mastered, skipped, matured };
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

/**
 * The subdeck Sync adds a word's note to: its language's English name, so a
 * change of UI language never starts a second deck ("Spanish; Castilian" is
 * cut to "Spanish"). Words of unknown language stay in the parent deck.
 */
export const ankiDeckName = (lang: string): string =>
  lang === 'und' ? ANKI_DECK : `${ANKI_DECK}::${getLanguageName(lang).split(/[;,]/)[0]!.trim()}`;

/**
 * The locale Anki's `[anki:tts]` reads a word in (`de_DE`): with a bare `de`
 * AnkiDroid finds no voice. Empty, so no audio, when the language is unknown.
 */
export const ankiTtsLang = (lang: string): string => {
  if (lang === 'und') return '';
  try {
    const { language, region } = new Intl.Locale(lang).maximize();
    return region ? `${language}_${region}` : '';
  } catch {
    return '';
  }
};

/**
 * A note the AnkiDroid link adds to `deck`. Without `modelId` it is Readest's
 * own note type: Front and Back, which Sync matches and reads hints from, then
 * Word and Language for the card's audio, and Entry for the dictionary entry
 * (#7728). With it, the fields are that note type's, in its order (#7849).
 */
export interface AnkiOutgoingNote {
  deck: string;
  modelId?: number;
  fields: string[];
  tags: string[];
}

/** A note type in the reader's collection. */
export interface AnkiNoteType {
  id: number;
  name: string;
  fields: string[];
}

/** The profile a word's cards follow (#7849): its latest book's, else its language's. */
export const ankiProfileOf = (
  e: VocabularyEntry,
  settings: AnkiProfileSettings | undefined,
): AnkiProfile | undefined => {
  if (!settings) return undefined;
  const book = e.occurrences[0]?.bookHash;
  const id = (book && settings.books[book]) || settings.languages[e.lang];
  return id ? settings.profiles.find((p) => p.id === id) : undefined;
};

/**
 * The note type a profile sends with: one this collection has, with a field
 * for the word. Without its word a note matches nothing, and would be sent
 * again on every Sync.
 */
export const ankiProfileNoteType = (profile: AnkiProfile, noteTypes: AnkiNoteType[]) => {
  const type = noteTypes.find((t) => t.name === profile.noteType);
  return type?.fields.some((f) => profile.fields[f] === 'word') ? type : undefined;
};

/** Where Sync finds a note type's word, hint and dictionary entry fields; -1 for none. */
export interface AnkiLayout {
  word: number;
  hint: number;
  entry: number;
}

/**
 * The layouts of the note types profiles use, by note type id, plus Readest's
 * own when given. Other note types read their word and hint from their first
 * two fields. A note type two profiles map differently reads as the first.
 */
export const ankiLayouts = (
  settings: AnkiProfileSettings | undefined,
  noteTypes: AnkiNoteType[],
  readest?: { id?: number; fields?: string[] },
): Map<number, AnkiLayout> => {
  const layouts = new Map<number, AnkiLayout>();
  if (readest?.id !== undefined) {
    layouts.set(readest.id, { word: 0, hint: 1, entry: readest.fields?.indexOf('Entry') ?? -1 });
  }
  for (const p of settings?.profiles ?? []) {
    const type = p.noteType ? noteTypes.find((t) => t.name === p.noteType) : undefined;
    if (!type) continue;
    const at = (source: AnkiFieldSource) => type.fields.findIndex((f) => p.fields[f] === source);
    // Profiles of a note type agree on these fields, but a mapping to a field
    // renamed away reads nothing: each comes from the first profile that has it.
    const l = layouts.get(type.id);
    layouts.set(type.id, {
      word: l && l.word >= 0 ? l.word : at('word'),
      hint: l && l.hint >= 0 ? l.hint : at('hint'),
      entry: l && l.entry >= 0 ? l.entry : at('entry'),
    });
  }
  return layouts;
};

/** A note with its word and hint fields first, as the import and the matching read them. */
export const ankiNoteView = <T extends { mid: number; fields: string[] }>(
  n: T,
  layouts: Map<number, AnkiLayout>,
): T => {
  const l = layouts.get(n.mid);
  if (!l || (l.word === 0 && l.hint === 1)) return n;
  return { ...n, fields: [n.fields[l.word] ?? '', n.fields[l.hint] ?? ''] };
};

/**
 * The notes Sync works with (#7849): Readest's notes, and every other note of
 * Readest's deck family (`own`) that isn't of a profile's note type. `known`
 * are the reader's own notes of a profile's note type, wherever they are: they
 * only keep Sync from adding the same word again.
 */
export const ankiSyncNotes = <T extends { id: number; mid: number; tags: string }>(
  own: T[],
  other: T[],
  layouts: Map<number, AnkiLayout>,
): { notes: T[]; known: T[] } => {
  const seen = new Set(own.map((n) => n.id));
  const all = [...own, ...other.filter((n) => !seen.has(n.id))];
  const readers = (n: T) => !isReadestNote(n.tags) && layouts.has(n.mid);
  return {
    notes: all.filter((n) => isReadestNote(n.tags) || (seen.has(n.id) && !readers(n))),
    known: all.filter(readers),
  };
};

/** What a profile's field gets for a word; `entry` is its looked-up dictionary entry. */
const profileField = (source: AnkiFieldSource | undefined, e: VocabularyEntry, entry: string) => {
  const parts = ankiPartsOf(e);
  const occ = e.occurrences[0];
  switch (source) {
    case 'word':
    case 'sentence':
    case 'hint':
    case 'book':
    case 'author':
      return parts[source];
    case 'entry':
      return entry;
    case 'audio': {
      const lang = ankiTtsLang(e.lang);
      return lang ? `[anki:tts lang=${lang}]${parts.word}[/anki:tts]` : '';
    }
    case 'language':
      return e.lang;
    case 'link':
      return occ?.bookHash
        ? `<a href="${escapeHtml(buildBookAppLink(occ.bookHash, occ.cfi))}">${parts.book || 'Readest'}</a>`
        : '';
    default:
      return '';
  }
};

// Keyed by what the card's first field shows, without the import's length
// limits, so anything Sync wrote is recognised next time.
const noteKey = (fields: string[]) => normalizeWordKey(ankiHeadwordOf(fields));

/**
 * The words Sync adds notes for. A word is left out when the deck already has a
 * note for it, under any note type, tagged with the same language or with none.
 */
export const ankiWordsToSend = (
  entries: VocabularyEntry[],
  existing: { fields: string[]; tags: string }[],
): VocabularyEntry[] => {
  const have = new Set<string>();
  for (const n of existing) {
    const key = noteKey(n.fields);
    if (key) have.add(`${ankiLangOf(n.tags) ?? '*'}:${key}`);
  }
  return entries.filter((e) => {
    if (e.deletedAt) return false;
    const key = noteKey([ankiCardOf(e).front]);
    return !have.has(`${e.lang}:${key}`) && !have.has(`*:${key}`);
  });
};

/**
 * The notes Sync adds (see `ankiWordsToSend`), with the dictionary entries
 * looked up for them (#7728) by word id, each built as its profile says
 * (#7849). A word whose profile's note type isn't in `noteTypes` waits.
 */
export const ankiNotesToSend = (
  entries: VocabularyEntry[],
  existing: { fields: string[]; tags: string }[],
  entryOf: Record<string, string> = {},
  profiles?: AnkiProfileSettings,
  noteTypes: AnkiNoteType[] = [],
): AnkiOutgoingNote[] =>
  ankiWordsToSend(entries, existing).flatMap((e) => {
    const { word, front, back, tags } = ankiCardOf(e);
    const mark = MARK_TAGS[e.state];
    const profile = ankiProfileOf(e, profiles);
    const deck = profile?.deck || ankiDeckName(e.lang);
    const noteTags = [
      ...new Set([...tags, ankiLangTag(e.lang), ...(mark ? [mark] : []), ...(profile?.tags ?? [])]),
    ];
    const entry = entryOf[e.id] ?? '';
    if (!profile?.noteType) {
      return [{ deck, fields: [front, back, word, ankiTtsLang(e.lang), entry], tags: noteTags }];
    }
    const type = ankiProfileNoteType(profile, noteTypes);
    if (!type) return [];
    const fields = type.fields.map((f) => profileField(profile.fields[f], e, entry));
    return [{ deck, modelId: type.id, fields, tags: noteTags }];
  });

/**
 * A note whose dictionary entry Sync can fill (#7728): its entry field's
 * index, and the word to look up, in its language.
 */
export interface AnkiEntryGap {
  id: number;
  field: number;
  word: string;
  lang: string;
}

/**
 * The notes whose entry field (see `ankiLayouts`) is empty, oldest first,
 * starting after note `after`: a Sync that looks up only some goes on from the
 * last one it tried, so words the dictionary lacks don't hold back the rest.
 * Notes read before this Sync added the field count as empty; the native side
 * checks again before writing.
 */
export const ankiEntryGaps = (
  notes: { id: number; mid: number; fields: string[]; tags: string }[],
  layouts: Map<number, AnkiLayout>,
  lang: string,
  after = 0,
): AnkiEntryGap[] => {
  const gaps = notes
    .flatMap((n) => {
      const field = layouts.get(n.mid)?.entry ?? -1;
      if (field < 0 || n.fields[field]?.trim()) return [];
      const word = ankiHeadwordOf(ankiNoteView(n, layouts).fields);
      return word ? [{ id: n.id, field, word, lang: ankiLangOf(n.tags) ?? lang }] : [];
    })
    .sort((a, b) => a.id - b.id);
  const start = gaps.findIndex((g) => g.id > after);
  return start <= 0 ? gaps : [...gaps.slice(start), ...gaps.slice(0, start)];
};

/**
 * Notes with their language made explicit, as Sync reads them. A note without a
 * language tag (added by hand, or from the file export) belongs to the word
 * Readest already has with its key: a live one before a deleted one, `lang`
 * before another language, the exact spelling before one with odd spacing.
 * Otherwise it gets `lang`. The tag is added so the pull, the push and the tag
 * mirror all file the note the same way.
 */
export const withNoteLangs = <T extends { fields: string[]; tags: string }>(
  notes: T[],
  entries: Record<string, VocabularyEntry>,
  lang: string,
): T[] => {
  const rank = (e: VocabularyEntry) =>
    (e.deletedAt ? 4 : 0) + (e.lang === lang ? 0 : 2) + (collapseKey(e.key) === e.key ? 0 : 1);
  const best = new Map<string, VocabularyEntry>();
  for (const e of Object.values(entries)) {
    const key = collapseKey(e.key);
    const seen = best.get(key);
    if (!seen || rank(e) < rank(seen)) best.set(key, e);
  }
  return notes.map((n) => {
    if (ankiLangOf(n.tags)) return n;
    const noteLang = best.get(noteKey(n.fields))?.lang ?? lang;
    return { ...n, tags: `${n.tags.trim()} ${ankiLangTag(noteLang)}`.trim() };
  });
};

/** The Word and Language an upgraded note type fills on a note Sync added before. */
export interface AnkiNoteFill {
  id: number;
  word: string;
  language: string;
}

/** Fills for notes read with their language tags (see `withNoteLangs`). */
export const ankiNoteFills = (
  notes: { id: number; fields: string[]; tags: string }[],
): AnkiNoteFill[] =>
  notes.flatMap((n) => {
    const word = ankiHeadwordOf(n.fields);
    if (!word) return [];
    const language = ankiTtsLang(ankiLangOf(n.tags) ?? 'und');
    return [{ id: n.id, word: escapeHtml(word), language }];
  });

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
  const index = byCardId(entries);
  for (const n of notes) {
    const key = noteKey(n.fields);
    const e = key ? index.get(entryId(ankiLangOf(n.tags) ?? lang, key)) : undefined;
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
