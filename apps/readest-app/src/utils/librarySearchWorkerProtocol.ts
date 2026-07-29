import type { FuzzyMatch, FuzzySearchOptions } from './fuzzySearch';
import type { NearbyMatch, NearbySearchOptions } from './nearbySearch';

export type LibrarySearchWorkerMatch = FuzzyMatch | NearbyMatch;

export interface LibrarySearchWorkerRequest {
  type: 'search';
  payload: {
    id: number;
    sectionKey: string;
    text: string;
    query: string;
    mode: 'fuzzy' | 'nearby-words';
    fuzzyOptions: FuzzySearchOptions;
    nearbyOptions: NearbySearchOptions;
    limit: number;
  };
}

export interface LibrarySearchWorkerResult {
  matches: LibrarySearchWorkerMatch[];
  truncated: boolean;
}

export type LibrarySearchWorkerResponse =
  | { type: 'success'; id: number; matches: LibrarySearchWorkerMatch[]; truncated: boolean }
  | { type: 'error'; id: number; message: string; code?: string };
