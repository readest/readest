import { BookSearchConfig, SearchMode } from '@/types/book';

export const DEFAULT_NEARBY_WORDS = 10;

export const modeToWholeWords = (mode: SearchMode): boolean => mode === 'whole-words';

// v2 configs (and pre-v3 sync peers) encode whole-word matching as a boolean and
// have no `mode`. Derive the mode from the boolean when `mode` is absent.
export const ensureSearchMode = (config: Partial<BookSearchConfig>): SearchMode =>
  config.mode ?? (config.matchWholeWords ? 'whole-words' : 'contains');
