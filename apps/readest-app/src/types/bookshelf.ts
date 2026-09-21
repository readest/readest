import type {
  LibrarySortByType,
  LibrarySecondarySortByType,
  LibraryCoverFitType,
  LibraryGroupByType,
} from './settings';
import type { ReplicaRow } from './replica';

export type BookshelfLayout = 'carousel' | 'grid' | 'list';
export type BookshelfFieldKind = 'text' | 'collection' | 'number' | 'date' | 'boolean';
export type BookshelfDateUnit = 'days' | 'months' | 'years';
export type BookshelfOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'withinLast'
  | 'set'
  | 'unset';
export interface BookshelfRule {
  type: 'rule';
  field: string;
  /** Retained for missing Calibre columns, so their rules remain editable. */
  kind: BookshelfFieldKind;
  operator: BookshelfOperator;
  value?: string | number | boolean;
  /** Calendar interval for the withinLast date operator. */
  unit?: BookshelfDateUnit;
}
export interface BookshelfFilterGroup {
  type: 'group';
  match: 'all' | 'any';
  children: (BookshelfRule | BookshelfFilterGroup)[];
}
export interface BookshelfSort {
  by: LibrarySortByType;
  ascending: boolean;
  thenBy: LibrarySecondarySortByType;
  thenAscending: boolean;
}
export interface BookshelfDefinition {
  id: string;
  /** Empty built-in names are translated at render time. */
  name: string;
  enabled: boolean;
  layout: BookshelfLayout;
  /** Older definitions inherit the legacy library preference until edited. */
  hideCovers?: boolean;
  /** Older definitions inherit the legacy library cover sizing preference. */
  coverFit?: LibraryCoverFitType;
  /** Older definitions inherit the legacy library cover appearance. */
  skeuomorphicCovers?: boolean;
  filters: BookshelfFilterGroup;
  /** Missing on older definitions; inherit the View menu's grouping by default. */
  useGlobalGrouping?: boolean;
  groupBy?: LibraryGroupByType;
  /** Missing on older definitions; all shelves inherit global sorting by default. */
  useGlobalSort?: boolean;
  sort: BookshelfSort;
  /** Retained for older saved definitions; carousel results are no longer capped. */
  limit?: number;
  exclusive: boolean;
  includeExclusiveBooks: boolean;
}
export interface BookshelfState {
  rows: Record<string, ReplicaRow>;
  /** The previous library preferences have been copied into saved shelves. */
  legacySettingsMigrated?: boolean;
}
