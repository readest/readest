import {
  findFuzzyMatches as findFuzzyMatchesImpl,
  MAX_FUZZY_QUERY_LENGTH as MAX_FUZZY_QUERY_LENGTH_IMPL,
} from '../../public/workers/library-search-algorithms.js';

export const MAX_FUZZY_QUERY_LENGTH = MAX_FUZZY_QUERY_LENGTH_IMPL as number;

export interface FuzzySearchOptions {
  matchCase: boolean;
  matchDiacritics: boolean;
}

export interface FuzzyMatch {
  start: number;
  end: number;
  runs: Array<{ start: number; end: number }>;
  typoCount: number;
}

export interface FuzzySearchState {
  truncated?: boolean;
}

export const findFuzzyMatches = findFuzzyMatchesImpl as (
  text: string,
  rawQuery: string,
  options: FuzzySearchOptions,
  limit?: number,
  state?: FuzzySearchState,
) => FuzzyMatch[];
