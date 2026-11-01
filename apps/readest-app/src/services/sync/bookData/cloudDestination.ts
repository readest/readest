import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { deleteFile as deleteCloudFile, downloadFile, listAllFiles } from '@/libs/storage';
import type { AppService } from '@/types/system';
import { isBookDataFileKey } from '@/utils/bookDataKey';
import type { BookDataDestination } from './types';

// Cloud transfers go through a file in the Cache folder: desktop and mobile
// upload and download from disk, not from memory. File names are content
// hashes, so two books never share one.
const OUTBOX_DIR = 'book-data-outbox';
const INBOX_DIR = 'book-data-inbox';

export const createReadestCloudDestination = (appService: AppService): BookDataDestination => {
  const cloudPathOf = (bookHash: string, kind: string, name: string) =>
    `${CLOUD_BOOKS_SUBDIR}/${bookHash}/${kind}/${name}`;

  return {
    id: 'readest',
    // One listing of all the book's files. Null when the book file itself is
    // not in Readest Cloud: `uploadedAt` is also set for a book that only a
    // file-sync backend holds (#5084). Throws on a failed listing, so push
    // skips Readest Cloud instead of uploading everything again.
    async list(bookHash, kind) {
      const folder = `/${bookHash}/${kind}/`;
      const files = await listAllFiles({ bookHash });
      let hasBook = false;
      const names = new Set<string>();
      for (const { file_key } of files) {
        if (!isBookDataFileKey(file_key)) {
          if (!/\.(png|jpe?g|webp|gif)$/i.test(file_key)) hasBook = true;
          continue;
        }
        const at = file_key.indexOf(folder);
        const name = at >= 0 ? file_key.slice(at + folder.length) : '';
        if (name && !name.includes('/')) names.add(name);
      }
      return hasBook ? names : null;
    },
    async read(bookHash, kind, name) {
      const lfp = `${INBOX_DIR}/${name}`;
      try {
        await appService.createDir(INBOX_DIR, 'Cache', true);
        const dst = await appService.resolveFilePath(lfp, 'Cache');
        await downloadFile({ appService, cfp: cloudPathOf(bookHash, kind, name), dst });
        return (await appService.readFile(lfp, 'Cache', 'binary')) as ArrayBuffer;
      } catch {
        return null;
      } finally {
        await appService.deleteFile(lfp, 'Cache').catch(() => {});
      }
    },
    async write(bookHash, kind, name, body) {
      const lfp = `${OUTBOX_DIR}/${name}`;
      const cfp = cloudPathOf(bookHash, kind, name);
      await appService.writeFile(lfp, 'Cache', body);
      try {
        await appService.uploadFileToCloud(lfp, cfp, 'Cache', () => {}, bookHash);
      } catch (err) {
        // The upload route records the file before its bytes land; drop that
        // row so a listing never shows a file with nothing behind it.
        await deleteCloudFile(cfp).catch(() => {});
        throw err;
      } finally {
        await appService.deleteFile(lfp, 'Cache').catch(() => {});
      }
    },
  };
};
