import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

export interface LatexSourceSidecar {
  version: 1;
  sourceName: string;
  rawSource: string;
  createdAt: number;
  syncTexName?: string;
}

export const latexSourcePath = (book: Pick<Book, 'hash'>) => `${book.hash}/latex-source.json`;

export const saveLatexSource = async (
  appService: AppService,
  book: Pick<Book, 'hash'>,
  sourceFile: File,
  syncTexFile?: File,
): Promise<LatexSourceSidecar> => {
  const sidecar: LatexSourceSidecar = {
    version: 1,
    sourceName: sourceFile.name,
    rawSource: await sourceFile.text(),
    createdAt: Date.now(),
    syncTexName: syncTexFile?.name,
  };
  if (syncTexFile) {
    await appService.writeFile(syncTexPath(book), 'Books', await syncTexFile.arrayBuffer());
  }
  await appService.writeFile(latexSourcePath(book), 'Books', JSON.stringify(sidecar));
  return sidecar;
};

export const syncTexPath = (book: Pick<Book, 'hash'>) => `${book.hash}/source.synctex`;

export const loadSyncTex = async (
  appService: AppService,
  book: Pick<Book, 'hash'>,
): Promise<ArrayBuffer | null> => {
  const path = syncTexPath(book);
  if (!(await appService.exists(path, 'Books'))) return null;
  try {
    return (await appService.readFile(path, 'Books', 'binary')) as ArrayBuffer;
  } catch {
    return null;
  }
};

const isLatexSourceSidecar = (value: unknown): value is LatexSourceSidecar => {
  if (!value || typeof value !== 'object') return false;
  const sidecar = value as Partial<LatexSourceSidecar>;
  return (
    sidecar.version === 1 &&
    typeof sidecar.sourceName === 'string' &&
    typeof sidecar.rawSource === 'string' &&
    typeof sidecar.createdAt === 'number'
  );
};

export const loadLatexSource = async (
  appService: AppService,
  book: Pick<Book, 'hash'>,
): Promise<LatexSourceSidecar | null> => {
  const path = latexSourcePath(book);
  if (!(await appService.exists(path, 'Books'))) return null;
  try {
    const sidecar = JSON.parse(String(await appService.readFile(path, 'Books', 'text')));
    return isLatexSourceSidecar(sidecar) ? sidecar : null;
  } catch {
    return null;
  }
};

export const sourcePairKey = (filename: string): string =>
  filename
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(?:pdf|tex|synctex(?:\.gz)?)$/i, '')
    .toLocaleLowerCase();

export const pairLatexImports = <T>(files: T[], getFilename: (file: T) => string) => {
  const sources = new Map<string, T>();
  const syncTexFiles = new Map<string, T>();
  for (const file of files) {
    const filename = getFilename(file);
    if (/\.tex$/i.test(filename)) sources.set(sourcePairKey(filename), file);
    if (/\.synctex(?:\.gz)?$/i.test(filename)) syncTexFiles.set(sourcePairKey(filename), file);
  }
  const importableFiles = files.filter(
    (file) => !/\.(?:tex|synctex(?:\.gz)?)$/i.test(getFilename(file)),
  );
  const pairedKeys = new Set(
    importableFiles
      .map(getFilename)
      .filter((filename) => /\.pdf$/i.test(filename))
      .map(sourcePairKey)
      .filter((key) => sources.has(key)),
  );
  const unpairedSources = [...sources]
    .filter(([key]) => !pairedKeys.has(key))
    .map(([, source]) => source);
  const unpairedSyncTexFiles = [...syncTexFiles]
    .filter(([key]) => !pairedKeys.has(key))
    .map(([, syncTex]) => syncTex);
  return { importableFiles, sources, syncTexFiles, unpairedSources, unpairedSyncTexFiles };
};
