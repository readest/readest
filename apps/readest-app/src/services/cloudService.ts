import { AppService, FileSystem, BaseDir, DeleteAction } from '@/types/system';
import { Book } from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getRemoteBookFilename,
  getCoverFilename,
} from '@/utils/book';
import {
  downloadFile,
  uploadFile,
  uploadReplicaFile,
  deleteFile as deleteCloudFile,
  createProgressHandler,
  batchGetDownloadUrls,
} from '@/libs/storage';
import { ClosableFile } from '@/utils/file';
import { ProgressHandler } from '@/utils/transfer';
import { CLOUD_BOOKS_SUBDIR, CLOUD_REPLICAS_SUBDIR } from './constants';
import { isBookFileContentSource, resolveBookContentSource } from './bookContent';

export async function deleteBook(
  fs: FileSystem,
  book: Book,
  deleteAction: DeleteAction,
): Promise<void> {
  if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
    const source = await resolveBookContentSource(fs, book);
    // Only remove files Readest itself created. A 'managed' source lives under
    // our Books/<hash>/ dir (a copy we made on import), so it is ours to delete.
    // An 'external' source is the user's own file at a user-controlled location
    // (book.filePath, base 'None') — e.g. a "Read books in place" import or a
    // transiently-opened file. Deleting a book from Readest must NEVER remove
    // that source file; doing so silently destroyed users' originals.
    if (source.kind === 'managed' && deleteAction !== 'purge') {
      // Purge wipes the whole directory below, so skip the per-file removal.
      if (await fs.exists(source.path, source.base)) {
        await fs.removeFile(source.path, source.base);
      }
    }

    // Purge erases the entire app-generated Books/<hash>/ directory — the
    // managed book file, cover.png, and (the reason for issue #4615)
    // config.json (reading progress, notes, bookmarks) + nav.json that the
    // other delete actions leave behind. In-place books keep their external
    // source file untouched; this only clears Readest's own sidecar dir.
    if (deleteAction === 'purge') {
      const dir = getDir(book);
      if (await fs.exists(dir, 'Books')) {
        await fs.removeDir(dir, 'Books', true);
      }
    }

    if (deleteAction === 'both' && (await fs.exists(getCoverFilename(book), 'Books'))) {
      await fs.removeFile(getCoverFilename(book), 'Books');
    }
    if (deleteAction === 'local' || deleteAction === 'purge') {
      // Mirror 'local': mark not-downloaded but leave the tombstone (deletedAt)
      // to the caller. The page's handleBookDelete sets deletedAt and queues the
      // cloud deletion for purge, exactly as it does for the 'both' action.
      book.downloadedAt = null;
    } else {
      book.deletedAt = Date.now();
      book.downloadedAt = null;
      book.coverDownloadedAt = null;
    }
  }
  if ((deleteAction === 'cloud' || deleteAction === 'both') && book.uploadedAt) {
    const fps = [getRemoteBookFilename(book), getCoverFilename(book)];
    for (const fp of fps) {
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
      try {
        deleteCloudFile(cfp);
      } catch (error) {
        console.log('Failed to delete uploaded file:', error);
      }
    }
    book.uploadedAt = null;
  }
}

export async function uploadFileToCloud(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  lfp: string,
  cfp: string,
  base: BaseDir,
  handleProgress: ProgressHandler,
  hash: string,
  temp: boolean = false,
): Promise<string | undefined> {
  console.log('Uploading file:', lfp, 'to', cfp);
  const file = await fs.openFile(lfp, base, cfp);
  const localFullpath = await resolveFilePath(lfp, base);
  const downloadUrl = await uploadFile(file, localFullpath, handleProgress, hash, temp);
  const f = file as ClosableFile;
  if (f && f.close) {
    await f.close();
  }
  return downloadUrl;
}

// Upload a single replica binary to the cloud under
// CLOUD_REPLICAS_SUBDIR/<kind>/<replicaId>/<filename>. Filename is the
// caller-supplied logical name (server-validated; see replicaSchemas.ts).
export async function uploadReplicaFileToCloud(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  opts: {
    kind: string;
    replicaId: string;
    filename: string;
    lfp: string;
    base: BaseDir;
    onProgress: ProgressHandler;
  },
): Promise<void> {
  const cfp = `${CLOUD_REPLICAS_SUBDIR}/${opts.kind}/${opts.replicaId}/${opts.filename}`;
  console.log('Uploading replica file:', opts.lfp, 'to', cfp);
  const file = await fs.openFile(opts.lfp, opts.base, opts.filename);
  const localFullpath = await resolveFilePath(opts.lfp, opts.base);
  await uploadReplicaFile(file, localFullpath, cfp, opts.kind, opts.replicaId, opts.onProgress);
  const f = file as ClosableFile;
  if (f && f.close) {
    await f.close();
  }
}

// Cloud key for a replica binary. Centralized so adapters and the
// download path share the same path-construction rule.
export const replicaCloudKey = (kind: string, replicaId: string, filename: string): string =>
  `${CLOUD_REPLICAS_SUBDIR}/${kind}/${replicaId}/${filename}`;

export async function downloadReplicaFileFromCloud(
  appService: AppService,
  opts: {
    kind: string;
    replicaId: string;
    filename: string;
    dst: string;
    onProgress?: ProgressHandler;
  },
): Promise<void> {
  const cfp = replicaCloudKey(opts.kind, opts.replicaId, opts.filename);
  await downloadFile({
    appService,
    cfp,
    dst: opts.dst,
    onProgress: opts.onProgress,
  });
}

export async function deleteReplicaBundleFromCloud(
  kind: string,
  replicaId: string,
  filenames: string[],
): Promise<void> {
  for (const filename of filenames) {
    const cfp = replicaCloudKey(kind, replicaId, filename);
    try {
      await deleteCloudFile(cfp);
    } catch (error) {
      console.log(`Failed to delete replica file ${cfp}:`, error);
    }
  }
}

export async function uploadBook(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  book: Book,
  onProgress?: ProgressHandler,
): Promise<void> {
  const completedFiles = { count: 0 };
  const coverExist = await fs.exists(getCoverFilename(book), 'Books');

  let bookSource = await resolveBookContentSource(fs, book);
  if (bookSource.kind === 'url') {
    const fileobj = await fs.openFile(bookSource.path, bookSource.base);
    await fs.writeFile(getLocalBookFilename(book), 'Books', await fileobj.arrayBuffer());
    const f = fileobj as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    bookSource = { kind: 'managed', path: getLocalBookFilename(book), base: 'Books' };
  }

  if (!isBookFileContentSource(bookSource)) {
    throw new Error('Book file not uploaded');
  }

  const toUploadFpCount = coverExist ? 2 : 1;
  const handleProgress = createProgressHandler(toUploadFpCount, completedFiles, onProgress);

  if (coverExist) {
    const lfp = getCoverFilename(book);
    const cfp = `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`;
    await uploadFileToCloud(fs, resolveFilePath, lfp, cfp, 'Books', handleProgress, book.hash);
    completedFiles.count++;
  }

  const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
  await uploadFileToCloud(
    fs,
    resolveFilePath,
    bookSource.path,
    cfp,
    bookSource.base,
    handleProgress,
    book.hash,
  );
  completedFiles.count++;

  book.deletedAt = null;
  book.updatedAt = Date.now();
  book.uploadedAt = Date.now();
  book.downloadedAt = Date.now();
  book.coverDownloadedAt = Date.now();
}

export async function downloadCloudFile(
  appService: AppService,
  localBooksDir: string,
  lfp: string,
  cfp: string,
  onProgress: ProgressHandler,
): Promise<void> {
  console.log('Downloading file:', cfp, 'to', lfp);
  const dstPath = `${localBooksDir}/${lfp}`;
  await downloadFile({ appService, cfp, dst: dstPath, onProgress });
}

export async function downloadBookCovers(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  books: Book[],
): Promise<void> {
  const booksLfps = new Map(
    books.map((book) => {
      const lfp = getCoverFilename(book);
      return [lfp, book];
    }),
  );
  const filePaths = books.map((book) => ({
    lfp: getCoverFilename(book),
    cfp: `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`,
  }));
  const downloadUrls = await batchGetDownloadUrls(filePaths);
  await Promise.all(
    books.map(async (book) => {
      if (!(await fs.exists(getDir(book), 'Books'))) {
        await fs.createDir(getDir(book), 'Books');
      }
    }),
  );
  await Promise.all(
    downloadUrls.map(async (file) => {
      try {
        const dst = `${localBooksDir}/${file.lfp}`;
        if (!file.downloadUrl) return;
        await downloadFile({ appService, dst, cfp: file.cfp, url: file.downloadUrl });
        const book = booksLfps.get(file.lfp);
        if (book && !book.coverDownloadedAt) {
          book.coverDownloadedAt = Date.now();
        }
      } catch (error) {
        console.log(`Failed to download cover file for book: '${file.lfp}'`, error);
      }
    }),
  );
}

export async function downloadBook(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  book: Book,
  onlyCover: boolean = false,
  redownload: boolean = false,
  onProgress?: ProgressHandler,
): Promise<void> {
  let bookDownloaded = false;
  let bookCoverDownloaded = false;
  const completedFiles = { count: 0 };
  let toDownloadFpCount = 0;
  const needDownCover = !(await fs.exists(getCoverFilename(book), 'Books')) || redownload;
  const needDownBook =
    (!onlyCover && !(await fs.exists(getLocalBookFilename(book), 'Books'))) || redownload;
  if (needDownCover) {
    toDownloadFpCount++;
  }
  if (needDownBook) {
    toDownloadFpCount++;
  }

  const handleProgress = createProgressHandler(toDownloadFpCount, completedFiles, onProgress);

  if (!(await fs.exists(getDir(book), 'Books'))) {
    await fs.createDir(getDir(book), 'Books');
  }

  try {
    if (needDownCover) {
      const lfp = getCoverFilename(book);
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${lfp}`;
      await downloadCloudFile(appService, localBooksDir, lfp, cfp, handleProgress);
      bookCoverDownloaded = true;
    }
  } catch (error) {
    // don't throw error here since some books may not have cover images at all
    console.log(`Failed to download cover file for book: '${book.title}'`, error);
  } finally {
    if (needDownCover) {
      completedFiles.count++;
    }
  }

  if (needDownBook) {
    const lfp = getLocalBookFilename(book);
    const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
    await downloadCloudFile(appService, localBooksDir, lfp, cfp, handleProgress);
    const localFullpath = `${localBooksDir}/${lfp}`;
    bookDownloaded = await fs.exists(localFullpath, 'None');
    completedFiles.count++;
  }
  // some books may not have cover image, so we need to check if the book is downloaded
  if (bookDownloaded || (!onlyCover && !needDownBook)) {
    book.downloadedAt = Date.now();
  }
  if ((bookCoverDownloaded || !needDownCover) && !book.coverDownloadedAt) {
    book.coverDownloadedAt = Date.now();
  }
}
