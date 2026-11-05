import { md5, partialMD5Ranges } from '@/utils/md5';
import type { GrimmoryClient } from './GrimmoryClient';
import type { GrimmoryBookMatch, GrimmorySyncStore } from './GrimmorySyncStore';
import type { GrimmoryBookFile } from './types';

type MatchClient = Pick<GrimmoryClient, 'listBooks' | 'readContent'>;
type MatchStore = Pick<GrimmorySyncStore, 'getBook' | 'setBook'>;

/**
 * Grimmory names its files by the same KOReader partial MD5 Readest uses as
 * Book.hash, but no endpoint looks a book up by it. Its book list does give
 * each file's size, so a file of the right size is read back in the dozen 1 KB
 * ranges the hash covers and hashed here.
 */
export const remotePartialMD5 = async (
  client: Pick<GrimmoryClient, 'readContent'>,
  bookId: number,
  file: GrimmoryBookFile,
  fileSize: number,
): Promise<string> => {
  const chunks = await Promise.all(
    partialMD5Ranges(fileSize).map(([start, end]) =>
      client.readContent(bookId, file.bookType, start, end),
    ),
  );
  const hasher = md5.create();
  for (const chunk of chunks) hasher.update(chunk);
  return hasher.hex();
};

export const findGrimmoryBook = async (
  client: MatchClient,
  local: { hash: string; fileSize: number },
): Promise<GrimmoryBookMatch | null> => {
  const sizeKb = Math.floor(local.fileSize / 1024);
  const books = await client.listBooks();
  for (const book of books) {
    const files: [GrimmoryBookFile | null | undefined, boolean][] = [
      [book.primaryFile, true],
      ...(book.alternativeFormats ?? []).map((file): [GrimmoryBookFile, boolean] => [file, false]),
    ];
    for (const [file, isPrimary] of files) {
      if (!file || file.fileSizeKb !== sizeKb) continue;
      if ((await remotePartialMD5(client, book.id, file, local.fileSize)) !== local.hash) continue;
      return {
        bookId: book.id,
        bookFileId: file.id,
        bookType: file.bookType ?? null,
        isPrimary,
        statusPushedAt: 0,
      };
    }
  }
  return null;
};

// A book not on the server is looked for again after this long, so adding it
// to Grimmory later doesn't need an app restart.
const MISS_TTL_MS = 10 * 60 * 1000;
const misses = new Map<string, number>();
const inFlight = new Map<string, Promise<GrimmoryBookMatch | null>>();

/**
 * The Grimmory book a local book is, from the store or found on the server.
 * Without the file size (no open file) only a stored match is returned.
 */
export const resolveGrimmoryBook = async (params: {
  client: MatchClient;
  store: MatchStore;
  account: string;
  hash: string;
  fileSize?: number;
}): Promise<GrimmoryBookMatch | null> => {
  const { client, store, account, hash, fileSize } = params;
  const stored = await store.getBook(account, hash);
  if (stored || !fileSize) return stored;

  const key = `${account}|${hash}`;
  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = (async () => {
    const found = await findGrimmoryBook(client, { hash, fileSize });
    if (found) {
      await store.setBook(account, hash, found);
      misses.delete(key);
    } else {
      misses.set(key, Date.now());
    }
    return found;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, lookup);
  return lookup;
};
