export type KoDrawer = 'lighten' | 'underscore' | 'strikeout' | 'invert';

export interface PluginDeviceFields {
  deviceId: string;
  deviceModel: string;
  pluginVersion: string;
  deviceTime?: string;
}

export interface KoAnnotation {
  datetime: string;
  datetimeUpdated?: string;
  drawer: KoDrawer;
  color?: string;
  text?: string;
  note?: string;
  chapter?: string;
  pageno?: number;
  posFormat: 'xpointer' | 'pdf';
  pos0: string;
  pos1?: string;
}

export interface ExchangeKey {
  k: string;
  dt: string;
}

export interface ExchangeBookRequest {
  hash: string;
  keys: ExchangeKey[];
  keysComplete: boolean;
  changes: KoAnnotation[];
}

export interface ExchangeAddEntry {
  serverId: number;
  version: number;
  datetime: string;
  datetimeUpdated: string | null;
  drawer: string;
  color: string;
  text: string;
  note: string | null;
  chapter: string | null;
  posFormat: 'xpointer' | 'pdf';
  pos0: string;
  pos1: string | null;
  pageno: number | null;
}

export interface ExchangeEditEntry {
  serverId: number;
  version: number;
  key: string;
  datetime: string | null;
  datetimeUpdated: string;
  drawer: string;
  color: string;
  text: string;
  note: string | null;
  chapter: string | null;
}

export interface ExchangeDeleteEntry {
  serverId: number;
  key: string;
  datetime: string | null;
}

export interface ExchangeBookResult {
  hash: string;
  bookId: number;
  toApply: { add: ExchangeAddEntry[]; edit: ExchangeEditEntry[]; delete: ExchangeDeleteEntry[] };
  more: boolean;
  skippedNoPosition: number;
}

export interface ExchangeResponse {
  results: ExchangeBookResult[];
  unmatched: string[];
}

export interface ExchangeAckApplied {
  serverId: number;
  version: number;
  status: 'applied' | 'failed';
  verified?: boolean;
  corrected?: boolean;
  pos0?: string;
  pos1?: string;
  pageno?: number;
  datetimeUpdated?: string;
}

export interface ExchangeAckDeleted {
  serverId: number;
  status: 'applied' | 'failed';
}

export interface ExchangeAckBook {
  hash: string;
  applied: ExchangeAckApplied[];
  deleted: ExchangeAckDeleted[];
}

export interface KoBookmark {
  datetime: string;
  datetimeUpdated?: string;
  pos: string;
  pageno?: number;
  chapter?: string;
  note?: string;
}

export interface BookmarkExchangeBookRequest {
  hash: string;
  keys: ExchangeKey[];
  keysComplete: boolean;
  changes: KoBookmark[];
}

export interface BookmarkAddEntry {
  serverId: number;
  pos: string;
  pageno: number | null;
  title: string;
}

export interface BookmarkDeleteEntry {
  serverId: number;
  key: string;
  datetime: string | null;
}

export interface BookmarkExchangeBookResult {
  hash: string;
  bookId: number;
  toApply: { add: BookmarkAddEntry[]; delete: BookmarkDeleteEntry[] };
  more: boolean;
}

export interface BookmarkExchangeResponse {
  results: BookmarkExchangeBookResult[];
  unmatched: string[];
}

export interface BookmarkAckApplied {
  serverId: number;
  status: 'applied' | 'failed';
  key?: string;
  datetime?: string;
  pos?: string;
}

export interface BookmarkAckBook {
  hash: string;
  applied: BookmarkAckApplied[];
  deleted: ExchangeAckDeleted[];
}

export interface BookOrbitVersionInfo {
  pluginVersion: string;
  serverVersion: string;
  capabilities: string[];
}

export interface MatchCheckBook {
  hash: string;
  title?: string;
  authors?: string;
}

export interface MatchCheckResponse {
  matches: { hash: string; bookId: number; bookFileId: number }[];
  libraryVersion: string;
}

export interface PageStatsEventWire {
  page: number;
  startTime: number;
  durationSeconds: number;
  totalPages: number;
}

export interface PageStatsBookWire {
  hash: string;
  events: PageStatsEventWire[];
}

export interface BookStateEntry {
  hash: string;
  status?: 'reading' | 'complete' | 'abandoned';
  statusModified?: string;
}
