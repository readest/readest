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
import { copyURIToPath, getStorefrontRegionCode, saveImageToGallery } from '@/utils/bridge';
import { copyFiles } from '@/utils/files';

import { BaseAppService } from './appService';
import { DatabaseOpts, DatabaseService } from '@/types/database';
import { SchemaType } from '@/services/database/migrate';
import {
  DATA_SUBDIR,
  LOCAL_BOOKS_SUBDIR,
  LOCAL_DICTIONARIES_SUBDIR,
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

/**
 * In-process cache of directories we've already verified (or just created)
 * in this app session.
 *
 * Why: `writeFile` / `copyFile` defensively call `fs.exists(dir)` before
 * every write to make sure the parent directory exists. On the hot path
 * for `saveBookConfig` (fires roughly once every 1.5s while the user is
 * reading via `useProgressAutoSave`) the parent is always the same book
 * directory that's been there since the book was opened — so the
 * `exists` IPC is pure overhead.
 *
 * The cost shows up clearly in Chrome DevTools' Bottom-Up profile of a
 * release Android build: the `A` (= `plugin:fs|exists`) branch following
 * each `sendIpcMessage` accounts for ~50% of the IPC time during a
 * reading session, doubling the per-save IPC cost.
 *
 * Cache semantics:
 *   - Key = `${base}:${dirPath}` (BaseDir + normalized directory path).
 *   - Membership = "this process has at some point seen the directory
 *     exist". We do NOT track deletions performed outside the app, but
 *     the directories that matter for the read-path (per-book config
 *     dirs, library dir) are created by the app and only deleted via
 *     `removeDir` / book removal, both of which clear the relevant
 *     entries below.
 *   - On a fresh app start the cache is empty, so the first write to a
 *     directory still does the original `exists`+`createDir` dance —
 *     this is a perf cache, not a correctness shortcut.
 */
const knownExistingDirs = new Set<string>();
const dirCacheKey = (base: BaseDir, dir: string) => `${base}:${dir}`;
const markDirKnown = (base: BaseDir, dir: string) => {
  // Empty string is a valid path: it represents the BaseDir itself, which
  // is the parent dir for root-level files like `settings.json`. We must
  // cache it too, otherwise every root-level write would re-probe the
  // BaseDir via `exists()`.
  knownExistingDirs.add(dirCacheKey(base, dir));
};
const forgetDirKnown = (base: BaseDir, dir: string) => {
  knownExistingDirs.delete(dirCacheKey(base, dir));
};

/**
 * Helper used by `writeFile` / `copyFile`. If we already know this
 * directory exists, returns immediately. Otherwise performs the normal
 * `exists` IPC + `createDir` fallback and records the result in the
 * cache so subsequent writes skip both round-trips.
 *
 * `dir` may be the empty string, which represents the BaseDir itself
 * (i.e. when writing a root-level file like `settings.json` whose
 * `getDirPath` is ""). On a fresh install the BaseDir may not exist
 * yet — the underlying Tauri `exists("", base)` / `createDir("", base,
 * recursive)` calls handle the empty path correctly by operating on
 * the BaseDir itself, so we must NOT short-circuit on empty string.
 */
async function ensureDirExists(
  self: {
    exists: (path: string, base: BaseDir) => Promise<boolean>;
    createDir: (path: string, base: BaseDir, recursive?: boolean) => Promise<void>;
  },
  dir: string,
  base: BaseDir,
): Promise<void> {
  const key = dirCacheKey(base, dir);
  if (knownExistingDirs.has(key)) return;
  if (!(await self.exists(dir, base))) {
    await self.createDir(dir, base, true);
  }
  knownExistingDirs.add(key);
}

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
          const dataDirs = ['Settings', 'Data', 'Books', 'Fonts', 'Images', 'Dictionaries'];
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
      case 'Dictionaries':
        return {
          baseDir: customBaseDir ?? BaseDirectory.AppData,
          basePrefix: customBasePrefix || appDataDir,
          fp: customBasePrefixSync
            ? `${customBasePrefixSync()}/${LOCAL_DICTIONARIES_SUBDIR}${path ? `/${path}` : ''}`
            : `${LOCAL_DICTIONARIES_SUBDIR}${path ? `/${path}` : ''}`,
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
    } else if (OS_TYPE === 'android') {
      // Android can't use the asset protocol for ranged reads — its WebView
      // re-applies a `Range` header's offset to intercepted bodies and corrupts
      // non-zero-start reads (Chromium 40739128). Instead route reads through
      // the `rangefile` custom scheme, which carries the range in the URL query
      // (no `Range` header) so the WebView delivers the bytes verbatim, still
      // over the network stack rather than the slow Tauri IPC bridge.
      // Falls back to NativeFile if the path is outside the asset scope.
      try {
        const prefix = await this.getPrefix(base);
        const absolutePath = prefix ? await join(prefix, path) : path;
        return await RemoteFile.fromNativePath(absolutePath, fname).open();
      } catch {
        return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
      }
    } else if (OS_TYPE === 'ios') {
      // On iOS, importing picker Inbox files should use NativeFile to avoid
      // fetch/HEAD issues.
      return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
    } else {
      // NOTE: RemoteFile currently performs about 2× faster than NativeFile
      // due to an unresolved performance issue in Tauri (see tauri-apps/tauri#9190).
      // Once the bug is resolved, we should switch back to using NativeFile.
      try {
        const prefix = await this.getPrefix(base);
        const absolutePath = prefix ? await join(prefix, path) : path;
        return await new RemoteFile(this.getURL(absolutePath), fname).open();
      } catch {
        return await new NativeFile(fp, fname, baseDir ? baseDir : null).open();
      }
    }
  },
  async copyFile(srcPath: string, srcBase: BaseDir, dstPath: string, dstBase: BaseDir) {
    try {
      // Uses the in-process dir cache (see `knownExistingDirs` above) so a
      // burst of copies into the same destination dir doesn't fire an
      // `exists` IPC per file.
      await ensureDirExists(this, getDirPath(dstPath), dstBase);
    } catch (error) {
      console.log('Failed to create directory for copying file:', error);
    }
    if (isContentURI(srcPath)) {
      const prefix = await this.getPrefix(dstBase);
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
      const { fp: srcFp, baseDir: srcBaseDir } = this.resolvePath(srcPath, srcBase);
      const { fp: dstFp, baseDir: dstBaseDir } = this.resolvePath(dstPath, dstBase);
      const opts: { fromPathBaseDir?: number; toPathBaseDir?: number } = {};
      if (srcBaseDir) opts.fromPathBaseDir = srcBaseDir;
      if (dstBaseDir) opts.toPathBaseDir = dstBaseDir;
      await copyFile(srcFp, dstFp, Object.keys(opts).length > 0 ? opts : undefined);
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
    // Skip the redundant `exists` IPC after the first write to this dir
    // in the current session — `useProgressAutoSave` writes to the same
    // per-book directory once every ~1.5s while the user is reading, so
    // checking each time roughly doubles the IPC cost of saveBookConfig.
    // See `knownExistingDirs` near the top of this file for the cache
    // invariants.
    await ensureDirExists(this, getDirPath(path), base);

    if (typeof content === 'string') {
      return writeTextFile(fp, content, baseDir ? { baseDir } : undefined);
    } else if (content instanceof File) {
      // Fast path for NativeFile inputs (e.g. user-picked source on import):
      // do a native filesystem copy at the Rust side rather than pumping
      // ~1 MB chunks through the Tauri IPC bridge. On Android the stream
      // path costs ~400 ms per IPC round-trip, which puts a 250 MB file
      // at ~100 s; the native copy is bound by disk throughput instead.
      try {
        if (content instanceof NativeFile) {
          const src = content.getNativeLocation();
          const opts: { fromPathBaseDir?: number; toPathBaseDir?: number } = {};
          if (src.baseDir != null) opts.fromPathBaseDir = src.baseDir;
          if (baseDir) opts.toPathBaseDir = baseDir;
          return await copyFile(src.path, fp, Object.keys(opts).length > 0 ? opts : undefined);
        }
      } catch (error) {
        console.warn('Native copy failed, falling back to stream copy:', error);
      }
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
    // Now that the dir is on disk, record it so subsequent writes can
    // skip the `exists` probe.
    markDirKnown(base, path);
  },
  async removeDir(path: string, base: BaseDir, recursive = false) {
    const { fp, baseDir } = this.resolvePath(path, base);

    await remove(fp, { baseDir: baseDir ? baseDir : undefined, recursive });
    // The cached entry for this dir is now stale, and a recursive remove
    // also tears down everything beneath it. Drop every cached entry that
    // points at this dir or any of its descendants so the next write
    // here goes through the slow `exists`+`createDir` path again.
    const prefix = dirCacheKey(base, path);
    forgetDirKnown(base, path);
    if (recursive) {
      // Iterate a snapshot — Set forbids mutation during iteration.
      for (const key of Array.from(knownExistingDirs)) {
        if (key === prefix || key.startsWith(prefix + '/')) {
          knownExistingDirs.delete(key);
        }
      }
    }
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
  override isWindowsApp = OS_TYPE === 'windows';
  override isMobileApp = ['android', 'ios'].includes(OS_TYPE);
  override isDesktopApp = ['macos', 'windows', 'linux'].includes(OS_TYPE);
  override isAppImage = Boolean(window.__READEST_IS_APPIMAGE);
  override isEink = Boolean(window.__READEST_IS_EINK);
  override hasTrafficLight = OS_TYPE === 'macos';
  override hasWindow = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  override hasWindowBar = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  override hasContextMenu = !(OS_TYPE === 'ios' || OS_TYPE === 'android');
  // No desktop platform draws a rounded, transparent window anymore: the Linux
  // window is opaque with square corners to avoid the WebKitGTK "turns
  // invisible while busy" bug (#3682).
  override hasRoundedWindow = false;
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
  override supportsCanvasContext2DFilter =
    OS_TYPE !== 'ios' && OS_TYPE !== 'macos' && OS_TYPE !== 'linux';
  override distChannel = DIST_CHANNEL;
  override storefrontRegionCode: string | null = null;
  override isOnlineCatalogsAccessible = true;

  private execDir?: string = undefined;
  private customRootDir?: string = undefined;

  constructor(customRootDir?: string) {
    super();
    if (customRootDir) {
      this.customRootDir = customRootDir;
    }
  }

  override async init() {
    const execDir = await invoke<string>('get_executable_dir');
    this.execDir = execDir;
    // Report the WebView User-Agent so Sentry can tag crashes with the
    // engine/version (the injected browser SDK's UA context isn't forwarded).
    try {
      await invoke('set_webview_info', { userAgent: navigator.userAgent });
    } catch (err) {
      console.warn('[nativeAppService] set_webview_info failed:', err);
    }
    // Ask Rust whether the in-app updater must stay hidden (READEST_DISABLE_UPDATER,
    // Flatpak, or a Linux deb/rpm/pacman install that Tauri can't self-update). The
    // command is the reliable source of truth; the `__READEST_UPDATER_DISABLED`
    // init-script global isn't dependable on every Linux/WebKitGTK setup (#4874).
    if (this.isDesktopApp) {
      try {
        const updaterDisabled = await invoke<boolean>('is_updater_disabled');
        this.hasUpdater = this.hasUpdater && !updaterDisabled;
      } catch (err) {
        console.warn('[nativeAppService] is_updater_disabled failed:', err);
      }
    }
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
    if (this.customRootDir || settings.customRootDir) {
      this.fs.resolvePath = getPathResolver({
        customRootDir: this.customRootDir || settings.customRootDir,
        isPortable: this.isPortableApp,
        execDir,
      });
    }
    if (this.isIOSApp) {
      this.isOnlineCatalogsAccessible = this.distChannel !== 'appstore';
      try {
        const res = await getStorefrontRegionCode();
        if (res?.regionCode) {
          this.storefrontRegionCode = res.regionCode;
        }
      } catch (err) {
        // Storefront.current is nil on simulators without a signed-in
        // App Store account, and may also fail on real devices with no
        // StoreKit configuration. Treat as "unknown region" — we leave
        // storefrontRegionCode as null and let downstream features that
        // depend on region degrade gracefully.
        console.warn('[nativeAppService] getStorefrontRegionCode failed:', err);
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
    // On mobile, Tauri's dialog plugin rejects folder picks with
    // "FolderPickerNotImplemented" — neither iOS nor Android ship a
    // folder picker via that surface. Route through the native-bridge
    // plugin instead, where each platform has a native implementation
    // (Android: ACTION_OPEN_DOCUMENT_TREE, iOS:
    // UIDocumentPickerViewController with `.folder`). The bridge
    // returns `{ path, uri, cancelled }`; we surface the path string
    // so the rest of the app can treat it like any local directory.
    if (this.isIOSApp || this.isAndroidApp) {
      const { selectDirectory } = await import('@/utils/bridge');
      const result = await selectDirectory();
      const path = result.path ?? '';
      if (path) {
        // Match the desktop branch — make sure both fs_scope and the
        // asset-protocol scope can read from the chosen directory.
        await this.allowPathsInScopes([path], true);
      }
      return path;
    }

    const selected = await openDialog({
      directory: true,
      multiple: false,
      recursive: true,
    });
    if (selected) {
      // Tauri's dialog plugin only auto-grants fs_scope; the asset
      // protocol scope still needs an explicit allow before
      // RemoteFile / convertFileSrc-based reads can succeed against
      // arbitrary user paths. Persisted-scope plugin makes this
      // sticky across restarts.
      await this.allowPathsInScopes([selected as string], true);
    }
    return selected as string;
  }

  async selectFiles(name: string, extensions: string[]): Promise<string[]> {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name, extensions }],
    });
    const files = Array.isArray(selected) ? selected : selected ? [selected] : [];
    const decoded = OS_TYPE === 'ios' ? files.map((f) => safeDecodePath(f)) : files;
    if (decoded.length > 0) {
      // See the note in selectDirectory above.
      await this.allowPathsInScopes(decoded, false);
    }
    return decoded;
  }

  /**
   * Best-effort: ask the Rust side to extend `fs_scope` and
   * `asset_protocol_scope` to cover the given paths. Errors are logged
   * and swallowed because the import path can still succeed via the
   * NativeFile fallback even when scope extension fails.
   */
  async allowPathsInScopes(paths: string[], isDirectory: boolean): Promise<void> {
    try {
      await invoke('allow_paths_in_scopes', { paths, isDirectory });
    } catch (e) {
      console.warn('allow_paths_in_scopes failed:', e);
    }
  }

  async saveFile(
    filename: string,
    content: string | ArrayBuffer | null,
    options?: {
      filePath?: string;
      mimeType?: string;
      share?: boolean;
      sharePosition?: { x: number; y: number; preferredEdge?: 'top' | 'bottom' | 'left' | 'right' };
    },
  ): Promise<boolean> {
    try {
      const ext = filename.split('.').pop() || '';
      // Linux desktop has no system share sheet; Windows WebView2's native
      // share UI (via tauri-plugin-sharekit) blocks the main thread waiting
      // on complete/cancel callbacks that may never fire when the user
      // dismisses the picker, freezing the app (issue #4343). Both fall
      // through to saveDialog instead.
      const wantShare = !this.isLinuxApp && !this.isWindowsApp && (this.isIOSApp || options?.share);
      if (wantShare) {
        let shareablePath = options?.filePath;
        if (!shareablePath) {
          // Write into a Temp SUBDIRECTORY, never the Temp root. On Android the
          // sharekit plugin copies the shared file to `<cacheDir>/<name>` before
          // sharing, and Tauri's Temp dir IS `<cacheDir>` — writing to the root
          // makes that a copy onto itself, whose output stream truncates the
          // source to 0 bytes (the shared image came out 0 KB). A subdirectory
          // gives the plugin's copy a distinct source path. (#4680)
          const shareDir = await this.resolveFilePath('shared', 'Temp');
          await mkdir(shareDir, { recursive: true });
          shareablePath = await this.resolveFilePath(`shared/${filename}`, 'Temp');
          if (typeof content === 'string') {
            await writeTextFile(shareablePath, content);
          } else if (content) {
            await writeFile(shareablePath, new Uint8Array(content));
          }
        }
        try {
          await shareFile(shareablePath, {
            mimeType: options?.mimeType || 'application/octet-stream',
            // Anchor the macOS NSSharingServicePicker / iPad popover to
            // the trigger button. Without this, the picker pops at the
            // WebView's top-left corner.
            ...(options?.sharePosition ? { position: options.sharePosition } : {}),
          });
        } catch (error) {
          // The plugin throws on user cancellation (e.g. dismissing the
          // Android share sheet returns "Share cancelled"). That's not a
          // failure — the user explicitly chose not to share, so we must
          // NOT fall back to saveDialog and pop a "Save As..." prompt.
          // Same goes for any other share error: the caller asked for a
          // share sheet, fulfilled or not, the saveDialog flow is a
          // completely different user intent.
          console.warn('shareFile did not complete:', error);
        }
        return true;
      }

      const filePath = await saveDialog({
        defaultPath: filename,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!filePath) return false;

      if (typeof content === 'string') {
        await writeTextFile(filePath, content);
      } else if (content) {
        await writeFile(filePath, new Uint8Array(content));
      }
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  }

  async saveImageToGallery(
    filename: string,
    content: ArrayBuffer,
    mimeType: string,
  ): Promise<boolean> {
    // MediaStore is Android-only; other platforms keep the saveFile/share path.
    if (!this.isAndroidApp) return false;
    // Write the bytes to a Temp subdirectory (not the Temp root, mirroring the
    // share path), then hand the path to the native MediaStore insert.
    const shareDir = await this.resolveFilePath('shared', 'Temp');
    await mkdir(shareDir, { recursive: true });
    const srcPath = await this.resolveFilePath(`shared/${filename}`, 'Temp');
    try {
      await writeFile(srcPath, new Uint8Array(content));
      const res = await saveImageToGallery({
        srcPath,
        fileName: filename,
        mimeType,
        albumName: 'Readest',
      });
      return res.success;
    } catch (error) {
      console.error('Failed to save image to gallery:', error);
      return false;
    } finally {
      // Best-effort cleanup of the staged file.
      await remove(srcPath).catch(() => {});
    }
  }

  async ask(message: string): Promise<boolean> {
    return await ask(message);
  }

  async openDatabase(
    schema: SchemaType,
    path: string,
    base: BaseDir,
    opts?: DatabaseOpts,
  ): Promise<DatabaseService> {
    const fullPath = await this.resolveFilePath(path, base);
    const { NativeDatabaseService } = await import('./database/nativeDatabaseService');
    const db = await NativeDatabaseService.open(`sqlite:${fullPath}`, opts);
    const { migrate } = await import('./database/migrate');
    const { getMigrations } = await import('./database/migrations');
    await migrate(db, getMigrations(schema));
    return db;
  }

  async migrate20251029() {
    console.log('Running migration 20251029 to update paths in Images dir...');
    const rootPath = await this.resolveFilePath('..', 'Data');
    const newDir = await this.fs.getPrefix('Images');
    const oldDir = await join(rootPath, 'Images', 'Readest', 'Images');
    const dirToDelete = await join(rootPath, 'Images', 'Readest');

    // Skip silently on fresh installs that never had the legacy layout.
    // copyFiles / deleteDir would otherwise throw `os error 2` when the
    // old directory does not exist, which is harmless but noisy.
    if (!(await this.fs.exists(oldDir, 'None'))) {
      console.log('Migration 20251029: legacy Images/Readest/Images not found, skipping.');
      return;
    }

    await copyFiles(this, oldDir, newDir);

    if (await this.fs.exists(dirToDelete, 'None')) {
      await this.deleteDir(dirToDelete, 'None', true);
    }
  }
}
