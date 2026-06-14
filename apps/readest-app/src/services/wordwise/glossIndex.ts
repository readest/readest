import type { GlossEntry, GlossIndexData, GlossSource } from './types';

/** In-memory, synchronous gloss lookup built from a downloaded gloss pack. */
export class GlossIndex implements GlossSource {
  #entries: Map<string, GlossEntry>;
  #inflections: Map<string, string>;

  private constructor(entries: Map<string, GlossEntry>, inflections: Map<string, string>) {
    this.#entries = entries;
    this.#inflections = inflections;
  }

  static fromData(data: GlossIndexData): GlossIndex {
    const entries = new Map<string, GlossEntry>();
    for (const [word, { r, g }] of Object.entries(data.entries)) {
      entries.set(word.toLowerCase(), { rank: r, gloss: g });
    }
    const inflections = new Map<string, string>();
    for (const [form, lemma] of Object.entries(data.inflections)) {
      inflections.set(form.toLowerCase(), lemma.toLowerCase());
    }
    return new GlossIndex(entries, inflections);
  }

  lookup(word: string): GlossEntry | null {
    const w = word.trim().toLowerCase();
    if (!w) return null;
    const direct = this.#entries.get(w);
    if (direct) return direct;
    const lemma = this.#inflections.get(w);
    if (lemma) return this.#entries.get(lemma) ?? null;
    return null;
  }
}
