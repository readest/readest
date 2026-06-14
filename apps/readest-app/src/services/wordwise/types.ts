// Word Wise: inline native-language hints above difficult words.
// See docs/superpowers/specs/2026-06-14-word-wise-design.md

/** Book source language as an ISO-639-1 base code (en, zh, es, …). */
export type WordWiseSourceLang = string;

/** A difficulty rank + native-language gloss for one headword. */
export interface GlossEntry {
  /** Frequency rank; lower = more common. Number.MAX_SAFE_INTEGER if unknown. */
  rank: number;
  /** Short native-language hint shown above the word. */
  gloss: string;
}

/** Anything the planner can ask "is this word difficult, and what's its gloss?". */
export interface GlossSource {
  /** Resolve a surface word (handling case + inflection) to its entry, or null. */
  lookup(word: string): GlossEntry | null;
}

/** One word to gloss, located by character offsets into the section's plain text. */
export interface GlossOccurrence {
  /** Inclusive start offset into the section text model string. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Surface form as it appears in the text. */
  word: string;
  /** Native-language gloss to render in <rt>. */
  gloss: string;
}

/** On-disk shape of a downloaded gloss pack (data/wordwise/<pair>.json, served from R2). */
export interface GlossIndexData {
  meta: { source: string; target: string; metric: string; version: number; count: number };
  /** headword -> { r: rank, g: gloss }. Compact keys to shrink the asset. */
  entries: Record<string, { r: number; g: string }>;
  /** inflected form -> lemma, e.g. { running: "run" }. */
  inflections: Record<string, string>;
}
