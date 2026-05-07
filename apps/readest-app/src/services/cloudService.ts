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

export async function deleteBook(
  fs: FileSystem,
  book: Book,
  deleteAction: DeleteAction,
): Promise<void> {
  if (deleteAction === 'local' || deleteAction === 'both') {
    const localDeleteFps =
      deleteAction === 'local'
        ? [getLocalBookFilename(book)]
        : [getLocalBookFilename(book), getCoverFilename(book)];
    for (const fp of localDeleteFps) {
      if (await fs.exists(fp, 'Books')) {
        await fs.removeFile(fp, 'Books');
      }
    }
    if (deleteAction === 'local') {
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
  let uploaded = false;
  const completedFiles = { count: 0 };
  let toUploadFpCount = 0;
  const coverExist = await fs.exists(getCoverFilename(book), 'Books');
  let bookFileExist = await fs.exists(getLocalBookFilename(book), 'Books');
  if (coverExist) {
    toUploadFpCount++;
  }
  if (bookFileExist) {
    toUploadFpCount++;
  }
  if (!bookFileExist && book.url) {
    const fileobj = await fs.openFile(book.url, 'None');
    await fs.writeFile(getLocalBookFilename(book), 'Books', await fileobj.arrayBuffer());
    bookFileExist = true;
  }

  const handleProgress = createProgressHandler(toUploadFpCount, completedFiles, onProgress);

  if (coverExist) {
    const lfp = getCoverFilename(book);
    const cfp = `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`;
    await uploadFileToCloud(fs, resolveFilePath, lfp, cfp, 'Books', handleProgress, book.hash);
    uploaded = true;
    completedFiles.count++;
  }

  if (bookFileExist) {
    const lfp = getLocalBookFilename(book);
    const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
    await uploadFileToCloud(fs, resolveFilePath, lfp, cfp, 'Books', handleProgress, book.hash);
    uploaded = true;
    completedFiles.count++;
  }

  if (uploaded) {
    book.deletedAt = null;
    book.updatedAt = Date.now();
    book.uploadedAt = Date.now();
    book.downloadedAt = Date.now();
    book.coverDownloadedAt = Date.now();
  } else {
    throw new Error('Book file not uploaded');
  }
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
