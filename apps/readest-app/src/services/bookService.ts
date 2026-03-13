import { SystemSettings } from '@/types/settings';
import { FileSystem, AppPlatform, BaseDir } from '@/types/system';
import { Book, BookConfig, BookContent, BookFormat, FIXED_LAYOUT_FORMATS } from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getCoverFilename,
  getConfigFilename,
  INIT_BOOK_CONFIG,
  formatTitle,
  formatAuthors,
  getPrimaryLanguage,
  getMetadataHash,
} from '@/utils/book';
import { partialMD5, md5 } from '@/utils/md5';
import { getBaseFilename, getFilename } from '@/utils/path';
import { BookDoc, DocumentLoader, EXTS } from '@/libs/document';
import { DEFAULT_BOOK_SEARCH_CONFIG, DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS } from './constants';
import { isContentURI, isValidURL, makeSafeFilename } from '@/utils/misc';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import { ClosableFile } from '@/utils/file';
import { TxtToEpubConverter } from '@/utils/txt';
import { svg2png } from '@/utils/svg';
import { BookFileNotFoundError } from './errors';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// --- Cover Image ---

export interface CoverContext {
  fs: FileSystem;
  appPlatform: AppPlatform;
  localBooksDir: string;
}

export function getCoverImageUrl(ctx: CoverContext, book: Book): string {
  return ctx.fs.getURL(`${ctx.localBooksDir}/${getCoverFilename(book)}`);
}

export async function getCoverImageBlobUrl(ctx: CoverContext, book: Book): Promise<string> {
  return ctx.fs.getBlobURL(`${ctx.localBooksDir}/${getCoverFilename(book)}`, 'None');
}

export async function getCachedImageUrl(ctx: CoverContext, pathOrUrl: string): Promise<string> {
  const cachedKey = `img_${md5(pathOrUrl)}`;
  const cachePrefix = await ctx.fs.getPrefix('Cache');
  const cachedPath = `${cachePrefix}/${cachedKey}`;
  if (await ctx.fs.exists(cachedPath, 'None')) {
    return await ctx.fs.getImageURL(cachedPath);
  } else {
    const file = await ctx.fs.openFile(pathOrUrl, 'None');
    await ctx.fs.writeFile(cachedKey, 'Cache', await file.arrayBuffer());
    return await ctx.fs.getImageURL(cachedPath);
  }
}

export async function generateCoverImageUrl(ctx: CoverContext, book: Book): Promise<string> {
  return ctx.appPlatform === 'web'
    ? await getCoverImageBlobUrl(ctx, book)
    : getCoverImageUrl(ctx, book);
}

function imageToArrayBuffer(
  ctx: CoverContext,
  imageUrl?: string,
  imageFile?: string,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (!imageUrl && !imageFile) {
      reject(new Error('No image URL or file provided'));
      return;
    }
    if (ctx.appPlatform === 'web' && imageUrl && imageUrl.startsWith('blob:')) {
      fetch(imageUrl)
        .then((response) => response.arrayBuffer())
        .then(resolve)
        .catch(reject);
    } else if (ctx.appPlatform === 'tauri' && imageFile) {
      ctx.fs
        .openFile(imageFile, 'None')
        .then((file) => file.arrayBuffer())
        .then(resolve)
        .catch(reject);
    } else if (ctx.appPlatform === 'tauri' && imageUrl) {
      tauriFetch(imageUrl, { method: 'GET' })
        .then((response) => response.arrayBuffer())
        .then(resolve)
        .catch(reject);
    } else {
      reject(new Error('Unsupported platform or missing image data'));
    }
  });
}

export async function updateCoverImage(
  ctx: CoverContext,
  book: Book,
  imageUrl?: string,
  imageFile?: string,
): Promise<void> {
  if (imageUrl === '_blank') {
    await ctx.fs.removeFile(getCoverFilename(book), 'Books');
  } else if (imageUrl || imageFile) {
    const arrayBuffer = await imageToArrayBuffer(ctx, imageUrl, imageFile);
    await ctx.fs.writeFile(getCoverFilename(book), 'Books', arrayBuffer);
  }
}

// --- Book Import ---

export async function importBook(
  fs: FileSystem,
  // file might be:
  // 1.1 absolute path for local file on Desktop
  // 1.2 /private/var inbox file path on iOS
  // 2. remote url
  // 3. content provider uri
  // 4. File object from browsers
  file: string | File,
  books: Book[],
  saveBook: boolean,
  saveCover: boolean,
  overwrite: boolean,
  transient: boolean,
  saveBookConfigFn: (book: Book, config: BookConfig) => Promise<void>,
  generateCoverImageUrlFn: (book: Book) => Promise<string>,
): Promise<Book | null> {
  try {
    let loadedBook: BookDoc;
    let format: BookFormat;
    let filename: string;
    let fileobj: File;

    if (transient && typeof file !== 'string') {
      throw new Error('Transient import is only supported for file paths');
    }

    try {
      if (typeof file === 'string') {
        fileobj = await fs.openFile(file, 'None');
        filename = fileobj.name || getFilename(file);
      } else {
        fileobj = file;
        filename = file.name;
      }
      if (/\.txt$/i.test(filename)) {
        const txt2epub = new TxtToEpubConverter();
        ({ file: fileobj } = await txt2epub.convert({ file: fileobj }));
      }
      if (!fileobj || fileobj.size === 0) {
        throw new Error('Invalid or empty book file');
      }
      ({ book: loadedBook, format } = await new DocumentLoader(fileobj).open());
      if (!loadedBook) {
        throw new Error('Unsupported or corrupted book file');
      }
      const metadataTitle = formatTitle(loadedBook.metadata.title);
      if (!metadataTitle || !metadataTitle.trim() || metadataTitle === filename) {
        loadedBook.metadata.title = getBaseFilename(filename);
      }
    } catch (error) {
      throw new Error(`Failed to open the book file: ${(error as Error).message || error}`);
    }

    const hash = await partialMD5(fileobj);
    const metaHash = getMetadataHash(loadedBook.metadata);
    let existingBook = books.filter((b) => b.hash === hash)[0];
    let metaHashMatch = false;
    let oldBookDir: string | undefined;
    if (existingBook) {
      if (!transient) {
        existingBook.deletedAt = null;
      }
      existingBook.createdAt = Date.now();
      existingBook.updatedAt = Date.now();
    }

    // Check for metaHash match if no exact file match (different file, same book metadata)
    if (!existingBook && !transient && metaHash) {
      const metaHashBook = books.find((b) => b.metaHash === metaHash && !b.deletedAt);
      if (metaHashBook) {
        oldBookDir = getDir(metaHashBook);
        existingBook = metaHashBook;
        metaHashMatch = true;
        existingBook.createdAt = Date.now();
        existingBook.updatedAt = Date.now();
      }
    }

    const primaryLanguage = getPrimaryLanguage(loadedBook.metadata.language);
    const book: Book = {
      hash,
      format,
      metaHash,
      title: formatTitle(loadedBook.metadata.title),
      sourceTitle: formatTitle(loadedBook.metadata.title),
      primaryLanguage,
      author: formatAuthors(loadedBook.metadata.author, primaryLanguage),
      metadata: loadedBook.metadata,
      createdAt: existingBook ? existingBook.createdAt : Date.now(),
      uploadedAt: existingBook ? existingBook.uploadedAt : null,
      deletedAt: transient ? Date.now() : null,
      downloadedAt: Date.now(),
      updatedAt: Date.now(),
    };
    // update series info from metadata
    if (book.metadata?.belongsTo?.series) {
      const belongsTo = book.metadata.belongsTo.series;
      const series = Array.isArray(belongsTo) ? belongsTo[0] : belongsTo;
      if (series) {
        book.metadata.series = formatTitle(series.name);
        book.metadata.seriesIndex = parseFloat(series.position || '0');
      }
    }
    // update book metadata when reimporting the same book
    if (existingBook && metaHashMatch) {
      // MetaHash match (different file, same book): override metadata and hash
      existingBook.hash = hash;
      existingBook.format = book.format;
      existingBook.metaHash = metaHash;
      existingBook.title = book.title;
      existingBook.sourceTitle = book.sourceTitle;
      existingBook.author = book.author;
      existingBook.primaryLanguage = book.primaryLanguage;
      existingBook.metadata = book.metadata;
      existingBook.uploadedAt = null;
      existingBook.downloadedAt = Date.now();
    } else if (existingBook) {
      // Same file hash: preserve user edits
      existingBook.format = book.format;
      existingBook.metaHash = metaHash;
      existingBook.title = existingBook.title.trim() ? existingBook.title.trim() : book.title;
      existingBook.sourceTitle = existingBook.sourceTitle ?? book.sourceTitle;
      existingBook.author = existingBook.author ?? book.author;
      existingBook.primaryLanguage = existingBook.primaryLanguage ?? book.primaryLanguage;
      existingBook.metadata = book.metadata;
      existingBook.downloadedAt = Date.now();
    }

    if (!(await fs.exists(getDir(book), 'Books'))) {
      await fs.createDir(getDir(book), 'Books');
    }
    const bookFilename = getLocalBookFilename(book);
    if (saveBook && !transient && (!(await fs.exists(bookFilename, 'Books')) || overwrite)) {
      if (/\.txt$/i.test(filename)) {
        await fs.writeFile(bookFilename, 'Books', fileobj);
      } else if (typeof file === 'string' && isContentURI(file)) {
        await fs.copyFile(file, bookFilename, 'Books');
      } else if (typeof file === 'string' && !isValidURL(file)) {
        try {
          // try to copy the file directly first in case of large files to avoid memory issues
          // on desktop when reading recursively from selected directory the direct copy will fail
          // due to permission issues, then fallback to read and write files
          await fs.copyFile(file, bookFilename, 'Books');
        } catch {
          await fs.writeFile(bookFilename, 'Books', await fileobj.arrayBuffer());
        }
      } else {
        await fs.writeFile(bookFilename, 'Books', fileobj);
      }
    }
    if (saveCover && (!(await fs.exists(getCoverFilename(book), 'Books')) || overwrite)) {
      let cover = await loadedBook.getCover();
      if (cover?.type === 'image/svg+xml') {
        try {
          console.log('Converting SVG cover to PNG...');
          cover = await svg2png(cover);
        } catch {}
      }
      if (cover) {
        await fs.writeFile(getCoverFilename(book), 'Books', await cover.arrayBuffer());
      }
    }
    // Never overwrite the config file only when it's not existed
    if (!existingBook) {
      await saveBookConfigFn(book, INIT_BOOK_CONFIG);
      books.splice(0, 0, book);
    } else if (metaHashMatch && oldBookDir && oldBookDir !== getDir(book)) {
      // Migrate config from old directory to new directory, updating bookHash and metaHash
      const oldConfigPath = `${oldBookDir}/config.json`;
      if (await fs.exists(oldConfigPath, 'Books')) {
        const configData = (await fs.readFile(oldConfigPath, 'Books', 'text')) as string;
        const config: Partial<BookConfig> = JSON.parse(configData);
        config.bookHash = hash;
        config.metaHash = metaHash;
        await fs.writeFile(getConfigFilename(book), 'Books', JSON.stringify(config));
      } else {
        await saveBookConfigFn(book, INIT_BOOK_CONFIG);
      }
      // Clean up old directory
      if (await fs.exists(oldBookDir, 'Books')) {
        await fs.removeDir(oldBookDir, 'Books', true);
      }
    }

    // update file links with url or path or content uri
    if (typeof file === 'string') {
      if (isValidURL(file)) {
        book.url = file;
        if (existingBook) existingBook.url = file;
      }
      if (transient) {
        book.filePath = file;
        if (existingBook) existingBook.filePath = file;
      }
    }
    book.coverImageUrl = await generateCoverImageUrlFn(book);
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }

    return existingBook || book;
  } catch (error) {
    console.error('Error importing book:', error);
    throw error;
  }
}

// --- Book Content & Config ---

export async function isBookAvailable(fs: FileSystem, book: Book): Promise<boolean> {
  const fp = getLocalBookFilename(book);
  if (await fs.exists(fp, 'Books')) {
    return true;
  }
  if (book.filePath) {
    return await fs.exists(book.filePath, 'None');
  }
  if (book.url) {
    return isValidURL(book.url);
  }
  return false;
}

export async function getBookFileSize(fs: FileSystem, book: Book): Promise<number | null> {
  const fp = getLocalBookFilename(book);
  if (await fs.exists(fp, 'Books')) {
    const file = await fs.openFile(fp, 'Books');
    const size = file.size;
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    return size;
  }
  return null;
}

export async function loadBookContent(fs: FileSystem, book: Book): Promise<BookContent> {
  let file: File;
  const fp = getLocalBookFilename(book);
  if (await fs.exists(fp, 'Books')) {
    file = await fs.openFile(fp, 'Books');
  } else if (book.filePath) {
    file = await fs.openFile(book.filePath, 'None');
  } else if (book.url) {
    file = await fs.openFile(book.url, 'None');
  } else {
    // 0.9.64 has a bug that book.title might be modified but the filename is not updated
    const bookDir = getDir(book);
    const files = await fs.readDir(getDir(book), 'Books');
    if (files.length > 0) {
      const bookFile = files.find((f) => f.path.endsWith(`.${EXTS[book.format]}`));
      if (bookFile) {
        file = await fs.openFile(`${bookDir}/${bookFile.path}`, 'Books');
      } else {
        throw new BookFileNotFoundError();
      }
    } else {
      throw new BookFileNotFoundError();
    }
  }
  return { book, file };
}

export async function loadBookConfig(
  fs: FileSystem,
  book: Book,
  settings: SystemSettings,
): Promise<BookConfig> {
  const globalViewSettings = {
    ...settings.globalViewSettings,
    ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
  };
  try {
    let str = '{}';
    if (await fs.exists(getConfigFilename(book), 'Books')) {
      str = (await fs.readFile(getConfigFilename(book), 'Books', 'text')) as string;
    }
    return deserializeConfig(str, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
  } catch {
    return deserializeConfig('{}', globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
  }
}

export async function saveBookConfig(
  fs: FileSystem,
  book: Book,
  config: BookConfig,
  settings?: SystemSettings,
): Promise<void> {
  let serializedConfig: string;
  if (settings) {
    const globalViewSettings = {
      ...settings.globalViewSettings,
      ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
    };
    serializedConfig = serializeConfig(config, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
  } else {
    serializedConfig = JSON.stringify(config);
  }
  await fs.writeFile(getConfigFilename(book), 'Books', serializedConfig);
}

export async function fetchBookDetails(
  fs: FileSystem,
  book: Book,
  downloadBookFn: (book: Book) => Promise<void>,
): Promise<BookDoc['metadata']> {
  const fp = getLocalBookFilename(book);
  if (!(await fs.exists(fp, 'Books')) && book.uploadedAt) {
    await downloadBookFn(book);
  }
  const { file } = await loadBookContent(fs, book);
  const bookDoc = (await new DocumentLoader(file).open()).book;
  const f = file as ClosableFile;
  if (f && f.close) {
    await f.close();
  }
  return bookDoc.metadata;
}

export async function exportBook(
  fs: FileSystem,
  book: Book,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  copyFile: (srcPath: string, dstPath: string, base: BaseDir) => Promise<void>,
  saveFile: (
    filename: string,
    content: ArrayBuffer,
    filepath: string,
    mimeType?: string,
  ) => Promise<boolean>,
): Promise<boolean> {
  const { file } = await loadBookContent(fs, book);
  const content = await file.arrayBuffer();
  const filename = `${makeSafeFilename(book.title)}.${book.format.toLowerCase()}`;
  let filepath = await resolveFilePath(getLocalBookFilename(book), 'Books');
  const fileType = file.type || 'application/octet-stream';
  if (getFilename(filepath) !== filename) {
    await copyFile(filepath, filename, 'Temp');
    filepath = await resolveFilePath(filename, 'Temp');
  }
  return await saveFile(filename, content, filepath, fileType);
}
