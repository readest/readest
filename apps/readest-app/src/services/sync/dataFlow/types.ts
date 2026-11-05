import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/** The reading data an integration can bring in or take out. */
export type FlowKind = 'progress' | 'notes' | 'books';

/** `pull` moves data into Readest, `push` moves it out. */
export type FlowDirection = 'pull' | 'push';

export type ConnectorId =
  | 'readest-cloud'
  | 'kosync'
  | 'bookorbit'
  | 'grimmory'
  | 'readwise'
  | 'hardcover'
  | 'pagebound'
  | 'notion'
  | 'audiobookshelf'
  | 'opds'
  | 'localsend'
  | 'send'
  | FileSyncBackendKind;

export interface ConnectionCheck {
  ok: boolean;
  message?: string;
}

/** One sync attempt. A missing `count` means one entry moved; an `error` means none did. */
export interface FlowEntryInput {
  connector: ConnectorId;
  direction: FlowDirection;
  kind: FlowKind;
  count?: number;
  bookTitle?: string;
  error?: string;
}

export interface FlowEntry extends FlowEntryInput {
  count: number;
  at: number;
}

export interface FlowTotal {
  count: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
}

export interface FlowState {
  totals: Record<string, FlowTotal>;
  /** Newest first. */
  entries: FlowEntry[];
  checks: Partial<Record<ConnectorId, ConnectionCheck & { at: number }>>;
}
