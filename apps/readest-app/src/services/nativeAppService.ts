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
  WriteFileOptions,
} from '@tauri-apps/plugin-fs';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  join,
  basename,
  appDataDir,
  appConfigDir,
  appCacheDir,
  appLogDir,
  tempDir,
} from '@tauri-apps/api/path';
import { type as osType } from '@tauri-apps/plugin-os';

import { FileSystem, BaseDir, AppPlatform, ResolvedPath } from '@/types/system';
import { getOSPlatform, isContentURI, isValidURL } from '@/utils/misc';
import { getDirPath, getFilename } from '@/utils/path';
import { NativeFile, RemoteFile } from '@/utils/file';
import { copyURIToPath } from '@/utils/bridge';

import { BaseAppService } from './appService';
import {
  LOCAL_BOOKS_SUBDIR,
  LOCAL_DATA_SUBDIR,
  LOCAL_FONTS_SUBDIR,
  SETTINGS_FILENAME,
} from './constants';

declare global {
  interface Window {
    __READEST_UPDATER_DISABLED?: boolean;
  }
}

const OS_TYPE = osType();

// Helper function to create a path resolver based on custom root directory and portable mode
// 0. If no custom root dir and not portable mode, use default Tauri BaseDirectory
// 1. If custom root dir is set, use it as base dir (baseDir = 0)
// 2. If portable mode is detected (Settings.json in executable dir), use executable dir as base dir (baseDir = 0)
// 3. If both custom root dir and portable mode are set, use custom root dir as base dir (baseDir = 0)
// Path Resolver Usage:
//  - appService.resolvePath and use returned baseDir + fp, when baseDir is 0, fp will be absolute path
//  - fileSystem.getPrefix and use prefix + path
const getPathResolver = ({
  customRootDir,
  isPortable,
  execDir,
}: {
  customRootDir?: string;
  isPortable?: boolean;
  execDir?: string;
} = {}) => {
  const customBaseDir = customRootDir ? 0 : undefined;
  const isCustomBaseDir = Boolean(customRootDir);
  const getCustomBasePrefixSync = isCustomBaseDir
    ? (baseDir: BaseDir) => {
        return () =>
          `${customRootDir}/${['Settings', 'Data', 'Books', 'Fonts'].includes(baseDir) ? '' : baseDir}`;
      }
    : undefined;

  const getCustomBasePrefix = getCustomBasePrefixSync
    ? (baseDir: BaseDir) => async () => getCustomBasePrefixSync(baseDir)()
    : undefined;

  return (path: string, base: BaseDir): ResolvedPath => {
    const customBasePrefixSync = getCustomBasePrefixSync?.(base);
    const customBasePrefix = getCustomBasePrefix?.(base);
    switch (base) {
      case 'Settings':
        return {
          baseDir: isPortable ? 0 : BaseDirectory.AppConfig,
          basePrefix: isPortable && execDir ? async () => execDir : appConfigDir,
          fp: isPortable && execDir ? `${execDir}/${path}` : path,
          base,
        };
      case 'Cache':
        return {
          baseDir: BaseDirectory.AppCache,
          basePrefix: appCacheDir,
          fp: path,
          base,
        };
      case 'Log':
        return {
          baseDir: isCustomBaseDir ? 0 : BaseDirectory.AppLog,
          basePrefix: customBasePrefix ?? appLogDir,
          fp: customBasePrefixSync ? `${customBasePrefixSync()}/${path}` : path,
          base,
        };
      case 'Data':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix ?? appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_DATA_SUBDIR}/${path}`
            : `${LOCAL_DATA_SUBDIR}/${path}`,
          base,
        };
      case 'Books':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix || appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_BOOKS_SUBDIR}/${path}`
            : `${LOCAL_BOOKS_SUBDIR}/${path}`,
          base,
        };
      case 'Fonts':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix || appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_FONTS_SUBDIR}/${path}`
            : `${LOCAL_FONTS_SUBDIR}/${path}`,
          base,
        };
      case 'None':
        return {
          baseDir: 0,
          basePrefix: async () => '',
          fp: path,
          base,
        };
      case 'Temp':
      default:
        return {
          baseDir: BaseDirectory.Temp,
          basePrefix: tempDir,
          fp: path,
          base,
        };
    }
  };
};

export const nativeFileSystem: FileSystem = {
  resolvePath: getPathResolver(),

  async getPrefix(base: BaseDir) {
    const { basePrefix, fp, baseDir } = this.resolvePath('', base);
    const basePath = await basePrefix();
    return fp ? (baseDir === 0 ? fp : await join(basePath, fp)) : basePath;
  },
  getURL(path: string) {
    return isValidURL(path) ? path : convertFileSrc(path);
  },
  async getBlobURL(path: string, base: BaseDir) {
    const content = await this.readFile(path, base, 'binary');
    return URL.createObjectURL(new Blob([content]));
  },
  async openFile(path: string, base: BaseDir, name?: string) {
    const { fp, baseDir } = this.resolvePath(path, base);
    let fname = name || getFilename(fp);
    if (isValidURL(path)) {
      return await new RemoteFile(path, fname).open();
    } else if (isContentURI(path)) {
      fname = await basename(path);
      if (path.includes('com.android.externalstorage')) {
        // If the URI is from shared internal storage (like /storage/emulated/0),
        // we can access it directly using the path — no need to copy.
        return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
      } else {
        // Otherwise, for content:// URIs (e.g. from MediaStore, Drive, or third-party apps),
        // we cannot access the file directly — so we copy it to a temporary cache location.
        const prefix = await this.getPrefix('Cache');
        const dst = await join(prefix, fname);
        const res = await copyURIToPath({ uri: path, dst });
        if (!res.success) {
          console.error('Failed to open file:', res);
          throw new Error('Failed to open file');
        }
        return await new NativeFile(dst, fname, baseDir ? baseDir : null).open();
      }
    } else {
      const prefix = await this.getPrefix(base);
      const absolutePath = path.startsWith('/') ? path : prefix ? await join(prefix, path) : null;
      if (absolutePath && OS_TYPE !== 'android') {
        // NOTE: RemoteFile currently performs about 2× faster than NativeFile
        // due to an unresolved performance issue in Tauri (see tauri-apps/tauri#9190).
        // Once the bug is resolved, we should switch back to using NativeFile.
        // RemoteFile is not usable on Android due to unknown issues of range fetch with Android WebView.
        return await new RemoteFile(this.getURL(absolutePath), fname).open();
      } else {
        return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
      }
    }
  },
  async copyFile(srcPath: string, dstPath: string, base: BaseDir) {
    if (isContentURI(srcPath)) {
      const prefix = await this.getPrefix(base);
      if (!prefix) {
        throw new Error('Invalid base directory');
      }
      const res = await copyURIToPath({
        uri: srcPath,
        dst: await join(prefix, dstPath),
      });
      if (!res.success) {
        console.error('Failed to copy file:', res);
        throw new Error('Failed to copy file');
      }
    } else {
      const { fp, baseDir } = this.resolvePath(dstPath, base);
      await copyFile(srcPath, fp, baseDir ? { toPathBaseDir: baseDir } : undefined);
    }
  },
  async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
    const { fp, baseDir } = this.resolvePath(path, base);

    return mode === 'text'
      ? (readTextFile(fp, baseDir ? { baseDir } : undefined) as Promise<string>)
      : ((await readFile(fp, baseDir ? { baseDir } : undefined)).buffer as ArrayBuffer);
  },
  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File) {
    // NOTE: this could be very slow for large files and might block the UI thread
    // so do not use this for large files
    const { fp, baseDir } = this.resolvePath(path, base);
    if (!(await this.exists(getDirPath(path), base))) {
      await this.createDir(getDirPath(path), base, true);
    }

    if (typeof content === 'string') {
      return writeTextFile(fp, content, baseDir ? { baseDir } : undefined);
    } else if (content instanceof File) {
      const writeOptions = {
        write: true,
        create: true,
        baseDir: baseDir ? baseDir : undefined,
      } as WriteFileOptions;
      return await writeFile(fp, content.stream(), writeOptions);
    } else {
      return await writeFile(fp, new Uint8Array(content), baseDir ? { baseDir } : undefined);
    }
  },
  async removeFile(path: string, base: BaseDir) {
    const { fp, baseDir } = this.resolvePath(path, base);

    return remove(fp, baseDir ? { baseDir } : undefined);
  },
  async createDir(path: string, base: BaseDir, recursive = false) {
    const { fp, baseDir } = this.resolvePath(path, base);

    await mkdir(fp, { baseDir: baseDir ? baseDir : undefined, recursive });
  },
  async removeDir(path: string, base: BaseDir, recursive = false) {
    const { fp, baseDir } = this.resolvePath(path, base);

    await remove(fp, { baseDir: baseDir ? baseDir : undefined, recursive });
  },
  async readDir(path: string, base: BaseDir) {
    const { fp, baseDir } = this.resolvePath(path, base);

    const list = await readDir(fp, baseDir ? { baseDir } : undefined);
    return list.map((entity) => {
      return {
        path: entity.name,
        isDir: entity.isDirectory,
      };
    });
  },
  async exists(path: string, base: BaseDir) {
    const { fp, baseDir } = this.resolvePath(path, base);

    try {
      const res = await exists(fp, baseDir ? { baseDir } : undefined);
      return res;
    } catch {
      return false;
    }
  },
};

export class NativeAppService extends BaseAppService {
  fs = nativeFileSystem;
  override appPlatform = 'tauri' as AppPlatform;
  override isAppDataSandbox = ['android', 'ios'].includes(OS_TYPE);
  override isMobile = ['android', 'ios'].includes(OS_TYPE);
  override isAndroidApp = OS_TYPE === 'android';
  override isIOSApp = OS_TYPE === 'ios';
  override isMacOSApp = OS_TYPE === 'macos';
  override isLinuxApp = OS_TYPE === 'linux';
  override isMobileApp = ['android', 'ios'].includes(OS_TYPE);
  override hasTrafficLight = OS_TYPE === 'macos';
  override hasWindow = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  override hasWindowBar = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  override hasContextMenu = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  override hasRoundedWindow = OS_TYPE === 'linux';
  override hasSafeAreaInset = OS_TYPE === 'ios' || OS_TYPE === 'android';
  override hasHaptics = OS_TYPE === 'ios' || OS_TYPE === 'android';
  override hasUpdater =
    OS_TYPE !== 'ios' &&
    !process.env['NEXT_PUBLIC_DISABLE_UPDATER'] &&
    !window.__READEST_UPDATER_DISABLED;
  // orientation lock is not supported on iPad
  override hasOrientationLock =
    (OS_TYPE === 'ios' && getOSPlatform() === 'ios') || OS_TYPE === 'android';
  override canCustomRootDir = OS_TYPE !== 'ios';
  override distChannel = process.env['NEXT_PUBLIC_DIST_CHANNEL'] || 'readest';

  override async init() {
    const execDir = await invoke<string>('get_executable_dir');
    if (
      process.env['NEXT_PUBLIC_PORTABLE_APP'] ||
      (await this.fs.exists(`${execDir}/${SETTINGS_FILENAME}`, 'None'))
    ) {
      this.isPortableApp = true;
      this.fs.resolvePath = getPathResolver({
        customRootDir: execDir,
        isPortable: this.isPortableApp,
        execDir,
      });
    }
    const settings = await this.loadSettings();
    if (settings.customRootDir) {
      this.fs.resolvePath = getPathResolver({
        customRootDir: settings.customRootDir,
        isPortable: this.isPortableApp,
        execDir,
      });
    }
    await super.init();
  }

  override resolvePath(fp: string, base: BaseDir): ResolvedPath {
    return this.fs.resolvePath(fp, base);
  }

  async selectDirectory(): Promise<string> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
    });
    return selected as string;
  }

  async selectFiles(name: string, extensions: string[]): Promise<string[]> {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name, extensions }],
    });
    return Array.isArray(selected) ? selected : selected ? [selected] : [];
  }
}
