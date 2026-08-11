import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { EXTS, MIMETYPES } from '@/libs/document';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { makeSafeFilename } from '@/utils/misc';
import { coverPreviewBase64 } from './preview';
import type { SendFileInput } from './types';

/** Best-effort cover thumbnail for the receiver's accept dialog. */
async function resolveCoverPreview(
  book: Book,
  appService: AppService,
): Promise<string | undefined> {
  try {
    const coverPath = getCoverFilename(book);
    if (!(await appService.exists(coverPath, 'Books'))) return undefined;
    const bytes = await appService.readFile(coverPath, 'Books', 'binary');
    if (typeof bytes === 'string') return undefined;
    return (await coverPreviewBase64(bytes)) ?? undefined;
  } catch {
    return undefined;
  }
}

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
  return {
    path: await appService.resolveFilePath(path, base),
    fileName,
    mimeType,
    preview: await resolveCoverPreview(book, appService),
  };
}
