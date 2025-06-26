import { EXTS } from '@/libs/document';
import { Book, BookConfig, BookProgress, WritingMode } from '@/types/book';
import { getUserLang, isContentURI, isFileURI, isValidURL, makeSafeFilename } from './misc';
import { getStorageType } from './object';
import { getDirFromLanguage } from './rtl';
import { SUPPORTED_LANGS } from '@/services/constants';

export const getDir = (book: Book) => {
  return `${book.hash}`;
};
export const getLibraryFilename = () => {
  return 'library.json';
};
export const getRemoteBookFilename = (book: Book) => {
  // S3 storage: https://docs.aws.amazon.com/zh_cn/AmazonS3/latest/userguide/object-keys.html
  if (getStorageType() === 'r2') {
    return `${book.hash}/${makeSafeFilename(book.title)}.${EXTS[book.format]}`;
  } else if (getStorageType() === 's3') {
    return `${book.hash}/${book.hash}.${EXTS[book.format]}`;
  } else {
    return '';
  }
};
export const getLocalBookFilename = (book: Book) => {
  return `${book.hash}/${makeSafeFilename(book.title)}.${EXTS[book.format]}`;
};
export const getCoverFilename = (book: Book) => {
  return `${book.hash}/cover.png`;
};
export const getConfigFilename = (book: Book) => {
  return `${book.hash}/config.json`;
};
export const isBookFile = (filename: string) => {
  return Object.values(EXTS).includes(filename.split('.').pop()!);
};
export const getFilename = (fileOrUri: string) => {
  if (isValidURL(fileOrUri) || isContentURI(fileOrUri) || isFileURI(fileOrUri)) {
    fileOrUri = decodeURI(fileOrUri);
  }
  const normalizedPath = fileOrUri.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  const lastPart = parts.pop()!;
  return lastPart.split('?')[0]!;
};
export const getBaseFilename = (filename: string) => {
  const normalizedPath = filename.replace(/\\/g, '/');
  const baseName = normalizedPath.split('/').pop()?.split('.').slice(0, -1).join('.') || '';
  return baseName;
};

export const INIT_BOOK_CONFIG: BookConfig = {
  updatedAt: 0,
};

export interface LanguageMap {
  [key: string]: string;
}

export interface Contributor {
  name: LanguageMap;
}

const formatLanguageMap = (x: string | LanguageMap): string => {
  const userLang = getUserLang();
  if (!x) return '';
  if (typeof x === 'string') return x;
  const keys = Object.keys(x);
  return x[userLang] || x[keys[0]!]!;
};

export const listFormater = (narrow = false, lang = '') => {
  lang = lang ? lang : getUserLang();
  if (narrow) {
    return new Intl.ListFormat('en', { style: 'narrow', type: 'unit' });
  } else {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' });
  }
};

export const getBookLangCode = (lang: string | string[] | undefined) => {
  try {
    const bookLang = typeof lang === 'string' ? lang : lang?.[0];
    return bookLang ? bookLang.split('-')[0]! : '';
  } catch {
    return '';
  }
};

export const formatAuthors = (
  contributors: string | Contributor | [string | Contributor],
  bookLang?: string | string[],
) => {
  const langCode = getBookLangCode(bookLang) || 'en';
  return Array.isArray(contributors)
    ? listFormater(langCode === 'zh', langCode).format(
        contributors.map((contributor) =>
          typeof contributor === 'string' ? contributor : formatLanguageMap(contributor?.name),
        ),
      )
    : typeof contributors === 'string'
      ? contributors
      : formatLanguageMap(contributors?.name);
};
export const formatTitle = (title: string | LanguageMap) => {
  return typeof title === 'string' ? title : formatLanguageMap(title);
};

export const formatPublisher = (publisher: string | LanguageMap) => {
  return typeof publisher === 'string' ? publisher : formatLanguageMap(publisher);
};

const langCodeToLangName = (langCode: string) => {
  return SUPPORTED_LANGS[langCode] || langCode.toUpperCase();
};

export const formatLanguage = (lang: string | string[] | undefined): string => {
  return Array.isArray(lang)
    ? lang.map(langCodeToLangName).join(', ')
    : langCodeToLangName(lang || '');
};

export const getPrimaryLanguage = (lang: string | string[] | undefined) => {
  return Array.isArray(lang) ? lang[0] : lang;
};

export const formatDate = (date: string | number | Date | null | undefined) => {
  if (!date) return;
  const userLang = getUserLang();
  try {
    return new Date(date).toLocaleDateString(userLang, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return;
  }
};

export const formatSubject = (subject: string | string[] | undefined) => {
  if (!subject) return '';
  return Array.isArray(subject) ? subject.join(', ') : subject;
};

export const formatFileSize = (size: number | null) => {
  if (size === null) return '';
  const formatter = new Intl.NumberFormat('en', {
    style: 'unit',
    unit: 'byte',
    unitDisplay: 'narrow',
    notation: 'compact',
    compactDisplay: 'short',
  });
  return formatter.format(size);
};

export const getCurrentPage = (book: Book, progress: BookProgress) => {
  const bookFormat = book.format;
  const { section, pageinfo } = progress;
  return bookFormat === 'PDF'
    ? section
      ? section.current + 1
      : 0
    : pageinfo
      ? pageinfo.current + 1
      : 0;
};

export const getBookDirFromWritingMode = (writingMode: WritingMode) => {
  switch (writingMode) {
    case 'horizontal-tb':
      return 'ltr';
    case 'horizontal-rl':
    case 'vertical-rl':
      return 'rtl';
    default:
      return 'auto';
  }
};

export const getBookDirFromLanguage = (language: string | string[] | undefined) => {
  const lang = getPrimaryLanguage(language) || '';
  return getDirFromLanguage(lang);
};
