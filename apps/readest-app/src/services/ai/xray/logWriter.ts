import type { AppService } from '@/types/system';
import { makeSafeFilename } from '@/utils/misc';

const XRAY_LOG_DIR = 'xray';

export const getXRayLogPath = (bookTitle: string, bookHash: string): string => {
  const safeTitle = makeSafeFilename(bookTitle || 'book');
  const hashSuffix = bookHash ? `_${bookHash.slice(0, 8)}` : '';
  return `${XRAY_LOG_DIR}/xray_${safeTitle || 'book'}${hashSuffix}.md`;
};

export const getXRayDebugLogPath = (bookTitle: string, bookHash: string): string => {
  const safeTitle = makeSafeFilename(bookTitle || 'book');
  const hashSuffix = bookHash ? `_${bookHash.slice(0, 8)}` : '';
  return `${XRAY_LOG_DIR}/xray_debug_${safeTitle || 'book'}${hashSuffix}.log`;
};

const ensureLogDir = async (appService: AppService): Promise<void> => {
  if (!(await appService.exists(XRAY_LOG_DIR, 'Log'))) {
    await appService.createDir(XRAY_LOG_DIR, 'Log', true);
  }
};

export const appendXRayLog = async (
  appService: AppService,
  bookTitle: string,
  bookHash: string,
  content: string,
): Promise<void> => {
  if (!content) return;
  const logPath = getXRayLogPath(bookTitle, bookHash);
  await ensureLogDir(appService);
  let existing = '';
  if (await appService.exists(logPath, 'Log')) {
    const data = await appService.readFile(logPath, 'Log', 'text');
    existing = typeof data === 'string' ? data : '';
  }
  await appService.writeFile(logPath, 'Log', `${existing}${content}`);
};

export const appendXRayDebugLog = async (
  appService: AppService,
  bookTitle: string,
  bookHash: string,
  content: string,
): Promise<void> => {
  if (!content) return;
  const logPath = getXRayDebugLogPath(bookTitle, bookHash);
  await ensureLogDir(appService);
  let existing = '';
  if (await appService.exists(logPath, 'Log')) {
    const data = await appService.readFile(logPath, 'Log', 'text');
    existing = typeof data === 'string' ? data : '';
  }
  await appService.writeFile(logPath, 'Log', `${existing}${content}`);
};
