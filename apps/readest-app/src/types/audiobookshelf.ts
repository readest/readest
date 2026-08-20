/** A configured Audiobookshelf server. Mirrors OPDSCatalog (src/types/opds.ts). */
export interface ABSServer {
  id: string;
  name: string;
  url: string; // origin, no trailing slash, e.g. http://192.168.2.3:13378
  username?: string;
  password?: string;
  /** ABS >= 2.26 short-lived JWT, or the legacy long-lived token on old servers. */
  accessToken?: string;
  /** ABS >= 2.26 only; absent on legacy servers. */
  refreshToken?: string;
  serverVersion?: string;
  /** ABS library ids selected for sync; undefined = all book-type libraries. */
  libraryIds?: string[];
  lastSyncedAt?: number;
  disabled?: boolean;
  contentId?: string;
  addedAt?: number;
  deletedAt?: number;
  reincarnation?: string;
  lastSeenCipher?: Record<string, string>;
}

/** Subset of GET /api/libraries response we consume. */
export interface ABSLibrary {
  id: string;
  name: string;
  mediaType: 'book' | 'podcast';
}

export interface ABSTrack {
  index: number;
  startOffset: number; // seconds from book start
  duration: number; // seconds
  contentUrl: string; // server-relative, e.g. /api/items/<id>/file/<ino>
  mimeType: string;
}

export interface ABSChapter {
  id: number;
  start: number; // global seconds
  end: number; // global seconds
  title: string;
}

/** Subset of a library item (list or expanded) we consume. */
export interface ABSLibraryItem {
  id: string;
  mediaType: 'book' | 'podcast';
  updatedAt?: number;
  media: {
    metadata: { title?: string | null; authorName?: string | null; language?: string | null };
    duration?: number;
    numTracks?: number;
    numAudioFiles?: number;
    tracks?: ABSTrack[];
    chapters?: ABSChapter[];
  };
}

/** Subset of user.mediaProgress entries from GET /api/me. */
export interface ABSMediaProgress {
  libraryItemId: string;
  currentTime: number; // seconds
  duration: number; // seconds
  isFinished: boolean;
  lastUpdate: number; // ms epoch
}

/** Subset of POST /api/items/:id/play response. */
export interface ABSPlaybackSession {
  id: string;
  /** Server-side resume position at session open, seconds. */
  currentTime: number;
  audioTracks: ABSTrack[];
}
