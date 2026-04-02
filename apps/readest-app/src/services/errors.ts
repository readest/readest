import { stubTranslation as _ } from '@/utils/misc';

export class BookFileNotFoundError extends Error {
  constructor() {
    super('Book file not found');
    this.name = 'BookFileNotFoundError';
  }
}

export class ImportError extends Error {
  constructor(cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(msg);
    this.name = 'ImportError';
  }
}

const IMPORT_ERROR_MAP: [string, string][] = [
  ['No chapters detected', _('No chapters detected')],
  ['Failed to parse EPUB', _('Failed to parse the EPUB file')],
  ['Unsupported format', _('This book format is not supported')],
  ['Failed to open file', _('Failed to open the book file')],
  ['Invalid or empty book file', _('The book file is empty')],
  ['Unsupported or corrupted book file', _('The book file is corrupted')],
];

export const getImportErrorMessage = (errorMsg: string): string => {
  const match = IMPORT_ERROR_MAP.find(([str]) => errorMsg.includes(str));
  return match ? match[1] : errorMsg;
};
