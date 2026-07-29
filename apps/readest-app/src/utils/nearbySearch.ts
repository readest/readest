import {
  findNearbyMatches as findNearbyMatchesImpl,
  segmentNearbyWords as segmentNearbyWordsImpl,
} from '../../public/workers/library-search-algorithms.js';

export interface NearbySearchOptions {
  locale?: string;
  matchCase: boolean;
  matchDiacritics: boolean;
  nearbyWords: number;
}

export interface NearbyWord {
  text: string;
  wordIndex: number;
  start: number;
  end: number;
}

export interface NearbyMatch {
  start: number;
  end: number;
  runs: Array<{ start: number; end: number }>;
}

export interface NearbySearchState {
  truncated?: boolean;
}

export const segmentNearbyWords = segmentNearbyWordsImpl as (
  text: string,
  locale?: string,
) => NearbyWord[];

export const findNearbyMatches = findNearbyMatchesImpl as (
  text: string,
  rawQuery: string,
  options: NearbySearchOptions,
  words?: NearbyWord[],
  limit?: number,
  state?: NearbySearchState,
) => NearbyMatch[];
