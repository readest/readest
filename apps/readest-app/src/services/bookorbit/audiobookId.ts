// Recognising a BookOrbit audiobook inside an ordinary OPDS catalog.
//
// The user configures one BookOrbit for sync and browses the same server
// through OPDS. When those are the same host, the audiobook API can serve the
// entry far better than its OPDS links can: real chapters, byte ranges and a
// shared listening position, none of which OPDS can express. BookOrbit's
// acquisition href carries the book id, so no extra lookup is needed to tell.
import type { BookOrbitSettings } from '@/types/settings';

/** Scheme prefix for the synthetic filePath of a BookOrbit streaming audiobook. */
export const BOOKORBIT_AUDIO_SCHEME = 'bookorbit://';

/** `/api/v1/opds/<bookId>/download?fileId=<n>` — the id is the book, not the file. */
const OPDS_DOWNLOAD = /\/api\/v1\/opds\/(\d+)\/download(?:[?#]|$)/;

const sameHost = (url: string, serverUrl: string): boolean => {
  try {
    const a = new URL(url);
    const b = new URL(serverUrl);
    return a.host === b.host && a.protocol === b.protocol;
  } catch {
    return false;
  }
};

/**
 * The BookOrbit book these acquisition links belong to, or null when the
 * native path does not apply and the generic OPDS audio path should be used.
 */
export const matchBookOrbitAudiobook = (
  hrefs: string[],
  settings: Pick<BookOrbitSettings, 'serverUrl' | 'password'>,
): { bookId: number } | null => {
  // The audiobook API authenticates with a JWT, which needs the real password.
  // A sync set up with only a `userkey` cannot log in, so stay on OPDS.
  if (!settings.serverUrl || !settings.password) return null;
  if (hrefs.length === 0) return null;

  const ids = new Set<number>();
  for (const href of hrefs) {
    if (!sameHost(href, settings.serverUrl)) return null;
    const id = OPDS_DOWNLOAD.exec(href)?.[1];
    if (!id) return null;
    ids.add(Number(id));
  }
  // Tracks spread across several books is not something we can model; the
  // OPDS path handles whatever that entry actually is.
  return ids.size === 1 ? { bookId: [...ids][0]! } : null;
};

export const makeBookOrbitAudioFilePath = (bookId: number): string =>
  `${BOOKORBIT_AUDIO_SCHEME}${bookId}`;

export const isBookOrbitAudioFilePath = (filePath: string | undefined): boolean =>
  !!filePath && filePath.startsWith(BOOKORBIT_AUDIO_SCHEME);

export const parseBookOrbitAudioFilePath = (filePath: string | undefined): number | null => {
  if (!isBookOrbitAudioFilePath(filePath)) return null;
  const raw = filePath!.slice(BOOKORBIT_AUDIO_SCHEME.length);
  return /^\d+$/.test(raw) ? Number(raw) : null;
};
