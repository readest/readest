import {
  exists,
  mkdir,
  readTextFile,
  readFile,
  writeTextFile,
  writeFile,
  readDir,
  remove,
  copyFile,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open, message } from '@tauri-apps/plugin-dialog';
import { join, appDataDir } from '@tauri-apps/api/path';
import { type as osType } from '@tauri-apps/plugin-os';

import { Book } from '@/types/book';
import { ToastType, FileSystem, BaseDir, AppPlatform } from '@/types/system';
import { getCoverFilename } from '@/utils/book';
import { isValidURL } from '@/utils/misc';

import { BaseAppService } from './appService';
import { LOCAL_BOOKS_SUBDIR } from './constants';

declare global {
  interface Window {
    IS_ROUNDED?: boolean;
  }
}

const OS_TYPE = osType();

const resolvePath = (fp: string, base: BaseDir): { baseDir: number; base: BaseDir; fp: string } => {
  switch (base) {
    case 'Settings':
      return { baseDir: BaseDirectory.AppConfig, fp, base };
    case 'Data':
      return { baseDir: BaseDirectory.AppData, fp, base };
    case 'Cache':
      return { baseDir: BaseDirectory.AppCache, fp, base };
    case 'Log':
      return { baseDir: BaseDirectory.AppLog, fp, base };
    case 'Books':
      return {
        baseDir: BaseDirectory.AppData,
        fp: `${LOCAL_BOOKS_SUBDIR}/${fp}`,
        base,
      };
    default:
      return {
        baseDir: BaseDirectory.Temp,
        fp,
        base,
      };
  }
};

export const nativeFileSystem: FileSystem = {
  getURL(path: string) {
    return isValidURL(path) ? path : convertFileSrc(path);
  },
  async getBlobURL(path: string, base: BaseDir) {
    const content = await this.readFile(path, base, 'binary');
    return URL.createObjectURL(new Blob([content]));
  },
  async copyFile(srcPath: string, dstPath: string, base: BaseDir) {
    const { fp, baseDir } = resolvePath(dstPath, base);
    await copyFile(srcPath, fp, base && { toPathBaseDir: baseDir });
  },
  async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
    const { fp, baseDir } = resolvePath(path, base);

    return mode === 'text'
      ? (readTextFile(fp, base && { baseDir }) as Promise<string>)
      : ((await readFile(fp, base && { baseDir })).buffer as ArrayBuffer);
  },
  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer) {
    const { fp, baseDir } = resolvePath(path, base);

    return typeof content === 'string'
      ? writeTextFile(fp, content, base && { baseDir })
      : writeFile(fp, new Uint8Array(content), base && { baseDir });
  },
  async removeFile(path: string, base: BaseDir) {
    const { fp, baseDir } = resolvePath(path, base);

    return remove(fp, base && { baseDir });
  },
  async createDir(path: string, base: BaseDir, recursive = false) {
    const { fp, baseDir } = resolvePath(path, base);

    await mkdir(fp, base && { baseDir, recursive });
  },
  async removeDir(path: string, base: BaseDir, recursive = false) {
    const { fp, baseDir } = resolvePath(path, base);

    await remove(fp, base && { baseDir, recursive });
  },
  async readDir(path: string, base: BaseDir) {
    const { fp, baseDir } = resolvePath(path, base);

    const list = await readDir(fp, base && { baseDir });
    return list.map((entity) => {
      return {
        path: entity.name,
        isDir: entity.isDirectory,
      };
    });
  },
  async exists(path: string, base: BaseDir) {
    const { fp, baseDir } = resolvePath(path, base);

    try {
      const res = await exists(fp, base && { baseDir });
      return res;
    } catch {
      return false;
    }
  },
};

export class NativeAppService extends BaseAppService {
  fs = nativeFileSystem;
  appPlatform = 'tauri' as AppPlatform;
  isAppDataSandbox = ['android', 'ios'].includes(OS_TYPE);
  isMobile = ['android', 'ios'].includes(OS_TYPE);
  isAndroidApp = OS_TYPE === 'android';
  isIOSApp = OS_TYPE === 'ios';
  hasTrafficLight = OS_TYPE === 'macos';
  hasWindow = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  hasWindowBar = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  hasContextMenu = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  hasRoundedWindow = !(OS_TYPE === 'ios' || OS_TYPE === 'android') && !!window.IS_ROUNDED;
  hasSafeAreaInset = OS_TYPE === 'ios' || OS_TYPE === 'android';
  hasHaptics = OS_TYPE === 'ios' || OS_TYPE === 'android';
  hasSysFontsList = !(OS_TYPE === 'ios' || OS_TYPE === 'android');

  override resolvePath(fp: string, base: BaseDir): { baseDir: number; base: BaseDir; fp: string } {
    return resolvePath(fp, base);
  }

  async getInitBooksDir(): Promise<string> {
    return join(await appDataDir(), LOCAL_BOOKS_SUBDIR);
  }

  async selectFiles(name: string, extensions: string[]): Promise<string[]> {
    const selected = await open({
      multiple: true,
      filters: [{ name, extensions }],
    });
    return Array.isArray(selected) ? selected : selected ? [selected] : [];
  }

  async showMessage(
    msg: string,
    kind: ToastType = 'info',
    title?: string,
    okLabel?: string,
  ): Promise<void> {
    await message(msg, { kind, title, okLabel });
  }

  getCoverImageUrl = (book: Book): string => {
    return this.fs.getURL(`${this.localBooksDir}/${getCoverFilename(book)}`);
  };

  getCoverImageBlobUrl = async (book: Book): Promise<string> => {
    return this.fs.getBlobURL(`${this.localBooksDir}/${getCoverFilename(book)}`, 'None');
  };
}
