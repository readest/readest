// Vocabulary builder (#789) and the per-word Word Lens marks (#6613).
// See docs/superpowers/specs/2026-11-03-vocabulary-builder-design.md

/**
 * `none`: only looked up, Word Lens decides from its pack.
 * `learning`: always hinted. `mastered`: never hinted.
 */
export type VocabularyState = 'none' | 'learning' | 'mastered';

/** One sentence a word was looked up in. */
export interface VocabularyOccurrence {
  sentence: string;
  bookHash?: string;
  bookTitle?: string;
  bookAuthor?: string;
  cfi?: string;
  /** Epoch ms of the lookup. */
  at: number;
}

export interface VocabularyEntry {
  /** `${lang}:${key}`, the same on every device. */
  id: string;
  /** Book source language as a base code (`en`), or `und` when unknown. */
  lang: string;
  /** Normalized lowercase headword used for matching. */
  key: string;
  /** Display form as first captured. */
  word: string;
  state: VocabularyState;
  /** Word Lens hint saved by the reader; the pack's gloss is used when unset. */
  hint?: string;
  /** Newest first, at most MAX_OCCURRENCES. */
  occurrences: VocabularyOccurrence[];
  createdAt: number;
  /** Epoch ms of the last change on any device; the newer side wins on merge. */
  modifiedAt: number;
  /** Tombstone; a deleted entry keeps syncing so other devices drop it too. */
  deletedAt?: number | null;
  /** Local only: changed since the last successful push. */
  dirty?: boolean;
}

/** One word an import creates or changes; unset fields are left as they are. */
export interface VocabularyImport {
  word: string;
  lang: string;
  state?: VocabularyState;
  hint?: string;
}

/** What Readest puts in a field of a card profile's note type (#7849). */
export type AnkiFieldSource =
  | 'word'
  | 'sentence'
  | 'hint'
  | 'book'
  | 'author'
  | 'entry'
  | 'audio'
  | 'link'
  | 'language';

/** The deck, note type, fields and tags Sync with Anki uses for some words (#7849). */
export interface AnkiProfile {
  id: string;
  name: string;
  /** Deck name; empty for the word's language subdeck under Readest Vocabulary. */
  deck: string;
  /** Note type name; empty for Readest's own note type, whose fields Readest fills. */
  noteType: string;
  /** The source of each field of the note type, by field name; others stay empty. */
  fields: Record<string, AnkiFieldSource>;
  /** Added to every note the profile sends. */
  tags: string[];
}

export interface AnkiProfileSettings {
  profiles: AnkiProfile[];
  /** Profile id by language (base code). */
  languages: Record<string, string>;
  /** Profile id by book hash; wins over the language's. */
  books: Record<string, string>;
}
