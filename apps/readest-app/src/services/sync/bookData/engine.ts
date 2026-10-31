// Moves a book's data files between a local store (a kind) and every
// destination. Files are content-named and immutable, so the protocol is an
// existence check: a listed name already has the right bytes. Deletions never
// propagate; remote files go when the book is deleted.
//
// A unit (one TTS pack) is several files uploaded in order; its last file
// marks it complete, and pull trusts only complete units. Push re-uploads
// every file of an incomplete unit, because Readest Cloud lists a file once its
// row exists, before its bytes land.
//
// Fire-and-forget housekeeping: failures are logged, never thrown.

import type { BookDataDestination } from './types';

export interface BookDataKind {
  /** Remote folder name under the book, e.g. 'tts'. */
  readonly id: string;
  /** Units offered for upload, e.g. '3-f00.mp3'. */
  listLocal(): Promise<string[]>;
  /** A unit's remote files in upload order; the last one marks it complete. */
  filesOf(unit: string): string[];
  contentTypeOf(file: string): string;
  readLocal(unit: string, file: string): Promise<ArrayBuffer | null>;
  /** The unit a remote file completes, or null for any other file. */
  unitOf(file: string): string | null;
  hasLocal(unit: string): Promise<boolean>;
  importUnit(unit: string, read: (file: string) => Promise<ArrayBuffer | null>): Promise<boolean>;
}

/**
 * What each destination holds (null: it declined the book), by destination
 * id, for one sync session of a book. A pull lists afresh; a push reuses the
 * listing and adds what it uploads, so the push rounds of a chapter download
 * (one per finished section) list each destination once.
 */
export type BookDataListings = Map<string, Set<string> | null>;

const pushTo = async (
  kind: BookDataKind,
  bookHash: string,
  units: string[],
  dest: BookDataDestination,
  listings?: BookDataListings,
  recorded?: Record<string, string[]>,
): Promise<number> => {
  let remote = listings?.get(dest.id);
  if (remote === undefined) {
    // The record (synced in the book's config) only rules work out: with
    // something to upload, list first, which checks the destination still
    // takes the book and skips what a peer already uploaded.
    const known = recorded?.[dest.id];
    if (known && units.every((unit) => known.includes(unit))) return 0;
    remote = await dest.list(bookHash, kind.id);
    listings?.set(dest.id, remote);
  }
  if (!remote) return 0;
  let pushed = 0;
  for (const unit of units) {
    const files = kind.filesOf(unit);
    if (files.every((file) => remote.has(file))) continue;
    const bodies: ArrayBuffer[] = [];
    for (const file of files) {
      const body = await kind.readLocal(unit, file).catch(() => null);
      if (!body) break;
      bodies.push(body);
    }
    if (bodies.length < files.length) continue;
    try {
      for (const [i, file] of files.entries()) {
        await dest.write(bookHash, kind.id, file, bodies[i]!, kind.contentTypeOf(file));
        remote.add(file);
      }
    } catch (err) {
      // Quota, auth or network: the rest of this round would fail the same way.
      console.warn(`Book data push to ${dest.id} stopped at ${unit}`, err);
      break;
    }
    pushed++;
  }
  return pushed;
};

/** Upload the units each destination lacks. Returns units pushed, summed over destinations. */
export const pushBookData = async (
  kind: BookDataKind,
  bookHash: string,
  destinations: BookDataDestination[],
  listings?: BookDataListings,
  recorded?: Record<string, string[]>,
): Promise<number> => {
  let units: string[];
  try {
    units = await kind.listLocal();
  } catch (err) {
    console.warn('Book data push failed', err);
    return 0;
  }
  if (!units.length) return 0;
  let pushed = 0;
  for (const dest of destinations) {
    try {
      pushed += await pushTo(kind, bookHash, units, dest, listings, recorded);
    } catch (err) {
      console.warn(`Book data push to ${dest.id} failed`, err);
    }
  }
  return pushed;
};

/** Import complete remote units the device lacks. Returns units imported. */
export const pullBookData = async (
  kind: BookDataKind,
  bookHash: string,
  destinations: BookDataDestination[],
  listings?: BookDataListings,
): Promise<number> => {
  const sources = new Map<string, BookDataDestination>();
  for (const dest of destinations) {
    try {
      const remote = await dest.list(bookHash, kind.id);
      listings?.set(dest.id, remote);
      if (!remote) continue;
      for (const file of remote) {
        const unit = kind.unitOf(file);
        if (!unit || sources.has(unit)) continue;
        if (kind.filesOf(unit).every((f) => remote.has(f))) sources.set(unit, dest);
      }
    } catch (err) {
      console.warn(`Book data listing on ${dest.id} failed`, err);
    }
  }
  let imported = 0;
  for (const [unit, dest] of sources) {
    try {
      if (await kind.hasLocal(unit)) continue;
      if (await kind.importUnit(unit, (file) => dest.read(bookHash, kind.id, file))) imported++;
    } catch (err) {
      console.warn(`Book data pull of ${unit} from ${dest.id} failed`, err);
    }
  }
  return imported;
};
