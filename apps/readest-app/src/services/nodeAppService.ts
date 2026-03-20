import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

import { FileSystem, BaseDir, OsPlatform, ResolvedPath, FileItem, FileInfo } from '@/types/system';
import { DatabaseOpts, DatabaseService } from '@/types/database';
import { SchemaType } from '@/services/database/migrate';
import { BaseAppService } from './appService';
import {
  DATA_SUBDIR,
  LOCAL_BOOKS_SUBDIR,
  LOCAL_FONTS_SUBDIR,
  LOCAL_IMAGES_SUBDIR,
} from './constants';

const APP_NAME = 'Readest';

// System directory getters matching Tauri's appDataDir, appConfigDir, etc.
function getAppDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      return nodePath.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
    case 'win32':
      return nodePath.join(
        process.env['APPDATA'] || nodePath.join(os.homedir(), 'AppData', 'Roaming'),
        APP_NAME,
      );
    default:
      return nodePath.join(
        process.env['XDG_DATA_HOME'] || nodePath.join(os.homedir(), '.local', 'share'),
        APP_NAME,
      );
  }
}

function getAppConfigDir(): string {
  switch (process.platform) {
    case 'darwin':
      return nodePath.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
    case 'win32':
      return nodePath.join(
        process.env['APPDATA'] || nodePath.join(os.homedir(), 'AppData', 'Roaming'),
        APP_NAME,
      );
    default:
      return nodePath.join(
        process.env['XDG_CONFIG_HOME'] || nodePath.join(os.homedir(), '.config'),
        APP_NAME,
      );
  }
}

function getAppCacheDir(): string {
  switch (process.platform) {
    case 'darwin':
      return nodePath.join(os.homedir(), 'Library', 'Caches', APP_NAME);
    case 'win32':
      return nodePath.join(
        process.env['LOCALAPPDATA'] || nodePath.join(os.homedir(), 'AppData', 'Local'),
        APP_NAME,
        'Cache',
      );
    default:
      return nodePath.join(
        process.env['XDG_CACHE_HOME'] || nodePath.join(os.homedir(), '.cache'),
        APP_NAME,
      );
  }
}

function getAppLogDir(): string {
  switch (process.platform) {
    case 'darwin':
      return nodePath.join(os.homedir(), 'Library', 'Logs', APP_NAME);
    case 'win32':
      return nodePath.join(
        process.env['LOCALAPPDATA'] || nodePath.join(os.homedir(), 'AppData', 'Local'),
        APP_NAME,
        'Logs',
      );
    default:
      return nodePath.join(
        process.env['XDG_STATE_HOME'] || nodePath.join(os.homedir(), '.local', 'state'),
        APP_NAME,
      );
  }
}

function getTempDir(): string {
  return nodePath.join(os.tmpdir(), APP_NAME);
}

// Path resolver matching nativeAppService's getPathResolver pattern.
// When customRootDir is set, Settings/Data/Books/Fonts/Images all resolve under it.
// Otherwise they use standard system directories.
const getPathResolver = ({ customRootDir }: { customRootDir?: string } = {}) => {
  const isCustomBaseDir = Boolean(customRootDir);
  const getCustomBasePrefix = isCustomBaseDir
    ? (base: BaseDir) => {
        const dataDirs: BaseDir[] = ['Settings', 'Data', 'Books', 'Fonts', 'Images'];
        const leafDir = dataDirs.includes(base) ? '' : base;
        return leafDir ? `${customRootDir}/${leafDir}` : customRootDir!;
      }
    : undefined;

  return (fp: string, base: BaseDir): ResolvedPath => {
    const custom = getCustomBasePrefix?.(base);
    switch (base) {
      case 'Settings':
        return {
          baseDir: 0,
          basePrefix: async () => custom ?? getAppConfigDir(),
          fp: custom ? `${custom}${fp ? `/${fp}` : ''}` : fp,
          base,
        };
      case 'Cache':
        return {
          baseDir: 0,
          basePrefix: async () => getAppCacheDir(),
          fp,
          base,
        };
      case 'Log':
        return {
          baseDir: 0,
          basePrefix: async () => custom ?? getAppLogDir(),
          fp: custom ? `${custom}${fp ? `/${fp}` : ''}` : fp,
          base,
        };
      case 'Data':
        return {
          baseDir: 0,
          basePrefix: async () => custom ?? getAppDataDir(),
          fp: custom
            ? `${custom}/${DATA_SUBDIR}${fp ? `/${fp}` : ''}`
            : `${DATA_SUBDIR}${fp ? `/${fp}` : ''}`,
          base,
        };
      case 'Books':
        return {
          baseDir: 0,
          basePrefix: async () => custom ?? getAppDataDir(),
          fp: custom
            ? `${custom}/${LOCAL_BOOKS_SUBDIR}${fp ? `/${fp}` : ''}`
            : `${LOCAL_BOOKS_SUBDIR}${fp ? `/${fp}` : ''}`,
          base,
        };
      case 'Fonts':
        return {
          baseDir: 0,
          basePrefix: async () => custom ?? getAppDataDir(),
          fp: custom
            ? `${custom}/${LOCAL_FONTS_SUBDIR}${fp ? `/${fp}` : ''}`
            : `${LOCAL_FONTS_SUBDIR}${fp ? `/${fp}` : ''}`,
          base,
        };
      case 'Images':
        return {
          baseDir: 0,
          basePrefix: async () => custom ?? getAppDataDir(),
          fp: custom
            ? `${custom}/${LOCAL_IMAGES_SUBDIR}${fp ? `/${fp}` : ''}`
            : `${LOCAL_IMAGES_SUBDIR}${fp ? `/${fp}` : ''}`,
          base,
        };
      case 'None':
        return {
          baseDir: 0,
          basePrefix: async () => '',
          fp,
          base,
        };
      case 'Temp':
      default:
        return {
          baseDir: 0,
          basePrefix: async () => getTempDir(),
          fp,
          base,
        };
    }
  };
};

// Resolve an fp from resolvePath to an absolute path.
// When customRootDir is set, fp is already absolute; otherwise join with the base prefix.
async function toAbsolute(resolved: ResolvedPath): Promise<string> {
  if (nodePath.isAbsolute(resolved.fp)) return resolved.fp;
  const prefix = (await resolved.basePrefix()).replace(/\/+$/, '');
  return resolved.fp ? nodePath.join(prefix, resolved.fp) : prefix;
}

export const nodeFileSystem: FileSystem = {
  resolvePath: getPathResolver(),

  async getPrefix(base: BaseDir) {
    return toAbsolute(this.resolvePath('', base));
  },

  getURL(filePath: string) {
    return pathToFileURL(filePath).href;
  },

  async getBlobURL(filePath: string, base: BaseDir) {
    const content = await this.readFile(filePath, base, 'binary');
    return `data:application/octet-stream;base64,${Buffer.from(content as ArrayBuffer).toString('base64')}`;
  },

  async getImageURL(filePath: string) {
    return this.getURL(filePath);
  },

  async openFile(filePath: string, base: BaseDir, name?: string): Promise<File> {
    const fullPath = await toAbsolute(this.resolvePath(filePath, base));
    const buffer = await fsp.readFile(fullPath);
    const fileName = name || nodePath.basename(fullPath);
    return new File([buffer], fileName);
  },

  async copyFile(srcPath: string, dstPath: string, base: BaseDir): Promise<void> {
    const fullDst = await toAbsolute(this.resolvePath(dstPath, base));
    await fsp.mkdir(nodePath.dirname(fullDst), { recursive: true });
    await fsp.copyFile(srcPath, fullDst);
  },

  async readFile(
    filePath: string,
    base: BaseDir,
    mode: 'text' | 'binary',
  ): Promise<string | ArrayBuffer> {
    const fullPath = await toAbsolute(this.resolvePath(filePath, base));
    if (mode === 'text') {
      return await fsp.readFile(fullPath, 'utf-8');
    }
    const buffer = await fsp.readFile(fullPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },

  async writeFile(
    filePath: string,
    base: BaseDir,
    content: string | ArrayBuffer | File,
  ): Promise<void> {
    const fullPath = await toAbsolute(this.resolvePath(filePath, base));
    await fsp.mkdir(nodePath.dirname(fullPath), { recursive: true });
    if (typeof content === 'string') {
      await fsp.writeFile(fullPath, content, 'utf-8');
    } else if (content instanceof File) {
      const buffer = Buffer.from(await content.arrayBuffer());
      await fsp.writeFile(fullPath, buffer);
    } else {
      await fsp.writeFile(fullPath, Buffer.from(content));
    }
  },

  async removeFile(filePath: string, base: BaseDir): Promise<void> {
    const fullPath = await toAbsolute(this.resolvePath(filePath, base));
    await fsp.unlink(fullPath);
  },

  async createDir(dirPath: string, base: BaseDir, recursive = false): Promise<void> {
    const fullPath = await toAbsolute(this.resolvePath(dirPath, base));
    await fsp.mkdir(fullPath, { recursive });
  },

  async removeDir(dirPath: string, base: BaseDir, recursive = false): Promise<void> {
    const fullPath = await toAbsolute(this.resolvePath(dirPath, base));
    await fsp.rm(fullPath, { recursive, force: recursive });
  },

  async readDir(dirPath: string, base: BaseDir): Promise<FileItem[]> {
    const fullPath = await toAbsolute(this.resolvePath(dirPath, base));
    const items: FileItem[] = [];

    const walk = async (dir: string, relative: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const entryRelative = relative ? nodePath.join(relative, entry.name) : entry.name;
        const entryFull = nodePath.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryFull, entryRelative);
        } else if (entry.isFile()) {
          const stat = await fsp.stat(entryFull).catch(() => null);
          items.push({ path: entryRelative, size: stat?.size ?? 0 });
        }
      }
    };

    await walk(fullPath, '');
    return items;
  },

  async exists(filePath: string, base: BaseDir): Promise<boolean> {
    const fullPath = await toAbsolute(this.resolvePath(filePath, base));
    try {
      await fsp.access(fullPath);
      return true;
    } catch {
      return false;
    }
  },

  async stats(filePath: string, base: BaseDir): Promise<FileInfo> {
    const fullPath = await toAbsolute(this.resolvePath(filePath, base));
    const stat = await fsp.stat(fullPath);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtime: stat.mtime,
      atime: stat.atime,
      birthtime: stat.birthtime,
    };
  },
};

export class NodeAppService extends BaseAppService {
  protected fs = nodeFileSystem;
  override appPlatform = 'node' as const;
  override osPlatform: OsPlatform =
    process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'win32'
        ? 'windows'
        : process.platform === 'linux'
          ? 'linux'
          : 'unknown';

  constructor(customRootDir?: string) {
    super();
    if (customRootDir) {
      this.fs.resolvePath = getPathResolver({ customRootDir: nodePath.resolve(customRootDir) });
    }
  }

  protected resolvePath(fp: string, base: BaseDir): ResolvedPath {
    return this.fs.resolvePath(fp, base);
  }

  async init(): Promise<void> {
    await this.prepareBooksDir();
  }

  async setCustomRootDir(customRootDir: string): Promise<void> {
    this.fs.resolvePath = getPathResolver({ customRootDir: nodePath.resolve(customRootDir) });
    await this.prepareBooksDir();
  }

  async selectDirectory(): Promise<string> {
    throw new Error('selectDirectory is not supported in Node.js environment');
  }

  async selectFiles(): Promise<string[]> {
    throw new Error('selectFiles is not supported in Node.js environment');
  }

  async saveFile(
    _filename: string,
    content: string | ArrayBuffer,
    options?: { filePath?: string; mimeType?: string },
  ): Promise<boolean> {
    try {
      const filepath = options?.filePath ?? '';
      await fsp.mkdir(nodePath.dirname(filepath), { recursive: true });
      if (typeof content === 'string') {
        await fsp.writeFile(filepath, content, 'utf-8');
      } else {
        await fsp.writeFile(filepath, Buffer.from(content));
      }
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  }

  async ask(): Promise<boolean> {
    return false;
  }

  async openDatabase(
    schema: SchemaType,
    path: string,
    base: BaseDir,
    opts?: DatabaseOpts,
  ): Promise<DatabaseService> {
    const fullPath = await this.resolveFilePath(path, base);
    const { NodeDatabaseService } = await import('./database/nodeDatabaseService');
    const db = await NodeDatabaseService.open(fullPath, opts);
    const { migrate } = await import('./database/migrate');
    const { getMigrations } = await import('./database/migrations');
    await migrate(db, getMigrations(schema));
    return db;
  }
}
