import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import type { LocalSendFile } from './types';

/**
 * Split an incoming LocalSend file list into book files Readest can import
 * and files to decline. The receive dialog accepts only `supported`;
 * partial accept is native to the protocol, so the sender sees the split.
 */
export function partitionSupportedFiles(files: LocalSendFile[]): {
  supported: LocalSendFile[];
  skipped: LocalSendFile[];
} {
  const supported: LocalSendFile[] = [];
  const skipped: LocalSendFile[] = [];
  for (const file of files) {
    const ext = file.fileName.split('.').pop()?.toLowerCase() ?? '';
    (file.fileName.includes('.') && SUPPORTED_BOOK_EXTS.includes(ext) ? supported : skipped).push(
      file,
    );
  }
  return { supported, skipped };
}
