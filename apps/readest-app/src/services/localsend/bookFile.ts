import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { EXTS, MIMETYPES } from '@/libs/document';
import { getLocalBookFilename } from '@/utils/book';
import { makeSafeFilename } from '@/utils/misc';
import type { SendFileInput } from './types';

/**
 * Resolve the on-disk file for a book so it can be handed to the LocalSend
 * client, mirroring the OS-share flow in Bookshelf: the managed copy under
 * Books/<hash>/ first, then the device-local in-place import path. Returns
 * null for cloud-only books (no local file to send).
 */
export async function resolveBookSendFile(
  book: Book,
  appService: AppService,
): Promise<SendFileInput | null> {
  const managedPath = getLocalBookFilename(book);
  let path: string;
  let base: 'Books' | 'None';
  if (await appService.exists(managedPath, 'Books')) {
    path = managedPath;
    base = 'Books';
  } else if (book.filePath && (await appService.exists(book.filePath, 'None'))) {
    path = book.filePath;
    base = 'None';
  } else {
    return null;
  }
  const ext = EXTS[book.format] ?? 'bin';
  const mimeType = MIMETYPES[book.format]?.[0] ?? 'application/octet-stream';
  const fileName = `${makeSafeFilename(book.sourceTitle || book.title || book.hash)}.${ext}`;
  return { path: await appService.resolveFilePath(path, base), fileName, mimeType };
}
