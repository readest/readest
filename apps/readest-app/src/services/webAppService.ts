import { FileSystem, BaseDir, AppPlatform, ResolvedPath } from '@/types/system';
import { getOSPlatform, isValidURL } from '@/utils/misc';
import { RemoteFile } from '@/utils/file';
import { isPWA } from './environment';
import { BaseAppService } from './appService';
import { LOCAL_BOOKS_SUBDIR, LOCAL_DATA_SUBDIR, LOCAL_FONTS_SUBDIR } from './constants';

const basePrefix = async () => '';

const resolvePath = (path: string, base: BaseDir): ResolvedPath => {
  switch (base) {
    case 'Data':
      return { baseDir: 0, basePrefix, fp: `${LOCAL_DATA_SUBDIR}/${path}`, base };
    case 'Books':
      return { baseDir: 0, basePrefix, fp: `${LOCAL_BOOKS_SUBDIR}/${path}`, base };
    case 'Fonts':
      return { baseDir: 0, basePrefix, fp: `${LOCAL_FONTS_SUBDIR}/${path}`, base };
    case 'None':
      return { baseDir: 0, basePrefix, fp: path, base };
    default:
      return { baseDir: 0, basePrefix, fp: `${base}/${path}`, base };
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
  resolvePath,
  async getPrefix(base: BaseDir) {
    const { basePrefix, fp } = this.resolvePath('', base);
    const basePath = await basePrefix();
    const prefix = fp ? (basePath ? `${basePath}/${fp}` : fp) : basePath;
    return prefix.replace(/\/+$/, '');
  },
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
  async openFile(path: string, base: BaseDir, filename?: string) {
    if (isValidURL(path)) {
      return await new RemoteFile(path, filename).open();
    } else {
      const content = await this.readFile(path, base, 'binary');
      return new File([content], filename || path);
    }
  },
  async copyFile(srcPath: string, dstPath: string, base: BaseDir) {
    const { fp } = this.resolvePath(dstPath, base);
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
    const { fp } = this.resolvePath(path, base);
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
  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File) {
    const { fp } = this.resolvePath(path, base);
    const db = await openIndexedDB();

    if (content instanceof File) {
      content = await content.arrayBuffer();
    }
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');

      store.put({ path: fp, content });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async removeFile(path: string, base: BaseDir) {
    const { fp } = this.resolvePath(path, base);
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
  async readDir(path: string, base: BaseDir) {
    const { fp } = this.resolvePath(path, base);
    const db = await openIndexedDB();

    return new Promise<{ path: string; isDir: boolean }[]>((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.getAll();

      request.onsuccess = () => {
        const files = request.result as { path: string }[];
        resolve(
          files
            .filter((file) => file.path.startsWith(fp))
            .map((file) => ({ path: file.path.slice(fp.length + 1), isDir: false })),
        );
      };

      request.onerror = () => reject(request.error);
    });
  },
  async exists(path: string, base: BaseDir) {
    const { fp } = this.resolvePath(path, base);
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
  override isMobile = ['android', 'ios'].includes(getOSPlatform());
  override appPlatform = 'web' as AppPlatform;
  override hasSafeAreaInset = isPWA();

  override async init() {
    await this.loadSettings();
    await super.init();
  }

  override resolvePath(fp: string, base: BaseDir): ResolvedPath {
    return this.fs.resolvePath(fp, base);
  }

  async selectDirectory(): Promise<string> {
    throw new Error('selectDirectory is not supported in browser');
  }

  async selectFiles(): Promise<string[]> {
    throw new Error('selectFiles is not supported in browser');
  }
}
