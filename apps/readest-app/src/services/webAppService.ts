import { Book } from '@/types/book';
import { ToastType, FileSystem, BaseDir, AppPlatform } from '@/types/system';
import { getCoverFilename } from '@/utils/book';
import { getOSPlatform, isValidURL } from '@/utils/misc';

import { isPWA } from './environment';
import { BaseAppService } from './appService';
import { LOCAL_BOOKS_SUBDIR } from './constants';

const resolvePath = (fp: string, base: BaseDir): { baseDir: number; base: BaseDir; fp: string } => {
  switch (base) {
    case 'Books':
      return { baseDir: 0, fp: `${LOCAL_BOOKS_SUBDIR}/${fp}`, base };
    case 'None':
      return { baseDir: 0, fp, base };
    default:
      return { baseDir: 0, fp: `${base}/${fp}`, base };
  }
};

const dbName = 'AppFileSystem';
const dbVersion = 1;

async function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const indexedDBFileSystem: FileSystem = {
  getURL(path: string) {
    if (isValidURL(path)) {
      return path;
    } else {
      return URL.createObjectURL(new Blob([path]));
    }
  },
  async getBlobURL(path: string, base: BaseDir) {
    try {
      const content = await this.readFile(path, base, 'binary');
      return URL.createObjectURL(new Blob([content]));
    } catch {
      return path;
    }
  },
  async copyFile(srcPath: string, dstPath: string, base: BaseDir) {
    const { fp } = resolvePath(dstPath, base);
    const db = await openIndexedDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');
      const getRequest = store.get(srcPath);

      getRequest.onsuccess = () => {
        const data = getRequest.result;
        if (data) {
          store.put({ path: fp, content: data.content });
          resolve();
        } else {
          reject(new Error(`File not found: ${srcPath}`));
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  },
  async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
    const { fp } = resolvePath(path, base);
    const db = await openIndexedDB();

    return new Promise<string | ArrayBuffer>((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(fp);

      request.onsuccess = async () => {
        if (request.result) {
          const content = request.result.content;
          if (mode === 'text') resolve(content);
          else {
            if (content instanceof Blob) {
              const arrayBuffer = await content.arrayBuffer();
              resolve(arrayBuffer);
            } else if (content instanceof ArrayBuffer) {
              resolve(content);
            } else if (typeof content === 'string') {
              resolve(new TextEncoder().encode(content).buffer as ArrayBuffer);
            } else {
              reject(new Error('Unsupported content type in IndexedDB'));
            }
          }
        } else {
          reject(new Error(`File not found: ${fp}`));
        }
      };

      request.onerror = () => reject(request.error);
    });
  },
  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer) {
    const { fp } = resolvePath(path, base);
    const db = await openIndexedDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');

      store.put({ path: fp, content });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async removeFile(path: string, base: BaseDir) {
    const { fp } = resolvePath(path, base);
    const db = await openIndexedDB();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');

      store.delete(fp);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async createDir() {
    // Directories are virtual in IndexedDB; no-op
  },
  async removeDir() {
    // Directories are virtual in IndexedDB; no-op
  },
  async readDir(path: string) {
    const db = await openIndexedDB();
    return new Promise<{ path: string; isDir: boolean }[]>((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.getAll();

      request.onsuccess = () => {
        const files = request.result as { path: string }[];
        resolve(
          files
            .filter((file) => file.path.startsWith(path))
            .map((file) => ({ path: file.path, isDir: false })),
        );
      };

      request.onerror = () => reject(request.error);
    });
  },
  async exists(path: string, base: BaseDir) {
    const { fp } = resolvePath(path, base);
    const db = await openIndexedDB();

    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(fp);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  },
};

export class WebAppService extends BaseAppService {
  fs = indexedDBFileSystem;
  appPlatform = 'web' as AppPlatform;
  isAppDataSandbox = false;
  isMobile = ['android', 'ios'].includes(getOSPlatform());
  isAndroidApp = false;
  isIOSApp = false;
  hasTrafficLight = false;
  hasWindow = false;
  hasWindowBar = false;
  hasContextMenu = false;
  hasRoundedWindow = false;
  hasSafeAreaInset = isPWA();
  hasHaptics = false;
  hasSysFontsList = false;

  override resolvePath(fp: string, base: BaseDir): { baseDir: number; base: BaseDir; fp: string } {
    return resolvePath(fp, base);
  }

  async getInitBooksDir(): Promise<string> {
    return LOCAL_BOOKS_SUBDIR;
  }

  async selectDirectory(): Promise<string> {
    throw new Error('selectDirectory is not supported in browser');
  }

  async selectFiles(): Promise<string[]> {
    throw new Error('selectFiles is not supported in browser');
  }

  async showMessage(msg: string, kind: ToastType = 'info'): Promise<void> {
    alert(`${kind.toUpperCase()}: ${msg}`);
  }

  getCoverImageUrl = (book: Book): string => {
    return this.fs.getURL(`${LOCAL_BOOKS_SUBDIR}/${getCoverFilename(book)}`);
  };

  getCoverImageBlobUrl = async (book: Book): Promise<string> => {
    return this.fs.getBlobURL(`${LOCAL_BOOKS_SUBDIR}/${getCoverFilename(book)}`, 'None');
  };
}
