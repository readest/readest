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
  stat,
  BaseDirectory,
  WriteFileOptions,
  DirEntry,
} from '@tauri-apps/plugin-fs';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog, ask } from '@tauri-apps/plugin-dialog';
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
import { shareFile } from '@choochmeque/tauri-plugin-sharekit-api';

import {
  FileSystem,
  BaseDir,
  AppPlatform,
  ResolvedPath,
  FileItem,
  DistChannel,
} from '@/types/system';
import { getOSPlatform, isContentURI, isFileURI, isValidURL } from '@/utils/misc';
import { getDirPath, getFilename } from '@/utils/path';
import { NativeFile, RemoteFile } from '@/utils/file';
import { copyURIToPath, getStorefrontRegionCode } from '@/utils/bridge';
import { copyFiles } from '@/utils/files';

import { BaseAppService } from './appService';
import {
  DATA_SUBDIR,
  LOCAL_BOOKS_SUBDIR,
  LOCAL_FONTS_SUBDIR,
  LOCAL_IMAGES_SUBDIR,
  SETTINGS_FILENAME,
} from './constants';

declare global {
  interface Window {
    __READEST_IS_EINK?: boolean;
    __READEST_IS_APPIMAGE?: boolean;
    __READEST_UPDATER_DISABLED?: boolean;
  }
}

const OS_TYPE = osType();

const safeDecodePath = (input: string) => {
  try {
    return decodeURI(input);
  } catch {
    return input;
  }
};

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
        return () => {
          const dataDirs = ['Settings', 'Data', 'Books', 'Fonts', 'Images'];
          const leafDir = dataDirs.includes(baseDir) ? '' : baseDir;
          return leafDir ? `${customRootDir}/${leafDir}` : customRootDir!;
        };
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
          fp: isPortable && execDir ? `${execDir}${path ? `/${path}` : ''}` : path,
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
          fp: customBasePrefixSync ? `${customBasePrefixSync()}${path ? `/${path}` : ''}` : path,
          base,
        };
      case 'Data':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix ?? appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${DATA_SUBDIR}${path ? `/${path}` : ''}`
            : `${DATA_SUBDIR}${path ? `/${path}` : ''}`,
          base,
        };
      case 'Books':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix || appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_BOOKS_SUBDIR}${path ? `/${path}` : ''}`
            : `${LOCAL_BOOKS_SUBDIR}${path ? `/${path}` : ''}`,
          base,
        };
      case 'Fonts':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix || appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_FONTS_SUBDIR}${path ? `/${path}` : ''}`
            : `${LOCAL_FONTS_SUBDIR}${path ? `/${path}` : ''}`,
          base,
        };
      case 'Images':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix || appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_IMAGES_SUBDIR}${path ? `/${path}` : ''}`
            : `${LOCAL_IMAGES_SUBDIR}${path ? `/${path}` : ''}`,
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
    let basePath = await basePrefix();
    basePath = basePath.replace(/\/+$/, '');
    return fp ? (baseDir === 0 ? fp : await join(basePath, fp)) : basePath;
  },
  getURL(path: string) {
    return isValidURL(path) ? path : convertFileSrc(path);
  },
  async getBlobURL(path: string, base: BaseDir) {
    const content = await this.readFile(path, base, 'binary');
    return URL.createObjectURL(new Blob([content]));
  },
  async getImageURL(path: string) {
    return this.getURL(path);
  },
  async openFile(path: string, base: BaseDir, name?: string) {
    const normalizedPath = OS_TYPE === 'ios' ? safeDecodePath(path) : path;
    const { fp, baseDir } = this.resolvePath(normalizedPath, base);
    let fname = safeDecodePath(name || getFilename(fp));
    if (isValidURL(path)) {
      return await new RemoteFile(path, fname).open();
    } else if (isContentURI(path) || (isFileURI(path) && OS_TYPE === 'ios')) {
      fname = safeDecodePath(await basename(path));
      if (path.includes('com.android.externalstorage')) {
        // If the URI is from shared internal storage (like /storage/emulated/0),
        // we can access it directly using the path — no need to copy.
        return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
      } else {
        // Otherwise, for content:// URIs (e.g. from MediaStore, Drive, or third-party apps),
        // or file:// URIs is security scoped resource in iOS (e.g. from Files app),
        // we cannot access the file directly — so we copy it to a temporary cache location.
        const prefix = await this.getPrefix('Cache');
        const dst = await join(prefix, decodeURIComponent(fname));
        const res = await copyURIToPath({ uri: path, dst });
        if (!res.success) {
          console.error('Failed to open file:', res);
          throw new Error('Failed to open file');
        }
        return await new NativeFile(dst, fname, baseDir ? baseDir : null).open();
      }
    } else if (isFileURI(path)) {
      return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
    } else {
      if (OS_TYPE === 'android' || OS_TYPE === 'ios') {
        // NOTE: RemoteFile is not usable on Android due to a known issue of range request in Android WebView.
        // see https://issues.chromium.org/issues/40739128
        // On iOS, importing picker Inbox files should also use NativeFile to avoid fetch/HEAD issues.
        return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
      } else {
        // NOTE: RemoteFile currently performs about 2× faster than NativeFile
        // due to an unresolved performance issue in Tauri (see tauri-apps/tauri#9190).
        // Once the bug is resolved, we should switch back to using NativeFile.
        const prefix = await this.getPrefix(base);
        const absolutePath = prefix ? await join(prefix, path) : path;
        return await new RemoteFile(this.getURL(absolutePath), fname).open();
      }
    }
  },
  async copyFile(srcPath: string, dstPath: string, base: BaseDir) {
    try {
      if (!(await this.exists(getDirPath(dstPath), base))) {
        await this.createDir(getDirPath(dstPath), base, true);
      }
    } catch (error) {
      console.log('Failed to create directory for copying file:', error);
    }
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

    await remove(fp, baseDir ? { baseDir } : undefined);
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

    const getRelativePath = (filePath: string, basePath: string): string => {
      let relativePath = filePath;
      if (filePath.toLowerCase().startsWith(basePath.toLowerCase())) {
        relativePath = filePath.substring(basePath.length);
      }
      if (relativePath.startsWith('\\') || relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
      return relativePath;
    };

    // Use Rust WalkDir for massive performance gain on absolute paths
    if (!baseDir || baseDir === 0) {
      try {
        const files = await invoke<{ path: string; size: number }[]>('read_dir', {
          path: fp,
          recursive: true,
          extensions: ['*'],
        });

        return files.map((file) => ({
          path: getRelativePath(file.path, fp),
          size: file.size,
        }));
      } catch (e) {
        console.error('Rust read_dir failed, falling back to JS recursion', e);
      }
    }

    // Fallback to readDir for non-absolute paths or on error
    const entries = await readDir(fp, baseDir ? { baseDir } : undefined);
    const fileList: FileItem[] = [];
    const readDirRecursively = async (
      parent: string,
      relative: string,
      entries: DirEntry[],
      fileList: FileItem[],
    ) => {
      for (const entry of entries) {
        if (entry.isDirectory) {
          const dir = await join(parent, entry.name);
          const relativeDir = relative ? await join(relative, entry.name) : entry.name;
          try {
            const entries = await readDir(dir, baseDir ? { baseDir } : undefined);
            await readDirRecursively(dir, relativeDir, entries, fileList);
          } catch {
            console.warn(`Skipping unreadable dir: ${dir}`);
          }
        } else {
          const filePath = await join(parent, entry.name);
          const relativePath = relative ? await join(relative, entry.name) : entry.name;
          const opts = baseDir ? { baseDir } : undefined;
          const fileSize = await stat(filePath, opts)
            .then((info) => info.size)
            .catch(() => 0);
          fileList.push({
            path: relativePath,
            size: fileSize,
          });
        }
      }
    };
    await readDirRecursively(fp, '', entries, fileList);
    return fileList;
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
  async stats(path: string, base: BaseDir) {
    const { fp, baseDir } = this.resolvePath(path, base);

    return await stat(fp, baseDir ? { baseDir } : undefined);
  },
};

const DIST_CHANNEL = (process.env['NEXT_PUBLIC_DIST_CHANNEL'] || 'readest') as DistChannel;

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
  override isDesktopApp = ['macos', 'windows', 'linux'].includes(OS_TYPE);
  override isAppImage = Boolean(window.__READEST_IS_APPIMAGE);
  override isEink = Boolean(window.__READEST_IS_EINK);
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
  override hasScreenBrightness = OS_TYPE === 'ios' || OS_TYPE === 'android';
  override hasIAP = OS_TYPE === 'ios' || (OS_TYPE === 'android' && DIST_CHANNEL === 'playstore');
  // CustomizeRootDir has a blocker on macOS App Store builds due to Security Scoped Resource restrictions.
  // See: https://github.com/tauri-apps/tauri/issues/3716
  override canCustomizeRootDir = DIST_CHANNEL !== 'appstore';
  override canReadExternalDir = DIST_CHANNEL !== 'appstore' && DIST_CHANNEL !== 'playstore';
  override distChannel = DIST_CHANNEL;
  override storefrontRegionCode: string | null = null;
  override isOnlineCatalogsAccessible = true;

  private execDir?: string = undefined;

  override async init() {
    const execDir = await invoke<string>('get_executable_dir');
    this.execDir = execDir;
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
    if (this.isIOSApp) {
      this.isOnlineCatalogsAccessible = this.distChannel !== 'appstore';
      const res = await getStorefrontRegionCode();
      if (res.regionCode) {
        this.storefrontRegionCode = res.regionCode;
      }
    }
    await this.prepareBooksDir();
    await this.runMigrations();
  }

  override async runMigrations() {
    try {
      const settings = await this.loadSettings();
      const lastMigrationVersion = settings.migrationVersion || 0;

      await super.runMigrations(lastMigrationVersion);

      if (lastMigrationVersion < 20251029) {
        try {
          await this.migrate20251029();
        } catch (error) {
          console.error('Error migrating to version 20251029:', error);
        }
      }

      if (lastMigrationVersion < this.CURRENT_MIGRATION_VERSION) {
        await this.saveSettings({
          ...settings,
          migrationVersion: this.CURRENT_MIGRATION_VERSION,
        });
      }
    } catch (error) {
      console.error('Failed to run migrations:', error);
    }
  }

  override resolvePath(fp: string, base: BaseDir): ResolvedPath {
    return this.fs.resolvePath(fp, base);
  }

  async setCustomRootDir(customRootDir: string) {
    this.fs.resolvePath = getPathResolver({
      customRootDir,
      isPortable: this.isPortableApp,
      execDir: this.execDir,
    });
    await this.prepareBooksDir();
  }

  async selectDirectory(): Promise<string> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      recursive: true,
    });
    return selected as string;
  }

  async selectFiles(name: string, extensions: string[]): Promise<string[]> {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name, extensions }],
    });
    const files = Array.isArray(selected) ? selected : selected ? [selected] : [];
    return OS_TYPE === 'ios' ? files.map((f) => safeDecodePath(f)) : files;
  }

  async saveFile(
    filename: string,
    content: string | ArrayBuffer,
    filepath: string,
    mimeType?: string,
  ): Promise<boolean> {
    try {
      const ext = filename.split('.').pop() || '';
      if (this.isIOSApp) {
        await shareFile(filepath, {
          mimeType: mimeType || 'application/octet-stream',
        });
      } else {
        const filePath = await saveDialog({
          defaultPath: filename,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (!filePath) return false;

        if (typeof content === 'string') {
          await writeTextFile(filePath, content);
        } else {
          await writeFile(filePath, new Uint8Array(content));
        }
      }
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  }

  async ask(message: string): Promise<boolean> {
    return await ask(message);
  }

  async migrate20251029() {
    console.log('Running migration 20251029 to update paths in Images dir...');
    const rootPath = await this.resolveFilePath('..', 'Data');
    const newDir = await this.fs.getPrefix('Images');
    const oldDir = await join(rootPath, 'Images', 'Readest', 'Images');

    await copyFiles(this, oldDir, newDir);

    const dirToDelete = await join(rootPath, 'Images', 'Readest');
    await this.deleteDir(dirToDelete, 'None', true);
  }
}
