import { BookMetadata, EXTS } from '@/libs/document';
import { Book, BookConfig, BookProgress, WritingMode } from '@/types/book';
import { SUPPORTED_LANGS } from '@/services/constants';
import { getUserLang, makeSafeFilename } from './misc';
import { getStorageType } from './storage';
import { getDirFromLanguage } from './rtl';
import { code6392to6391, isValidLang, normalizedLangCode } from './lang';
import { md5 } from './md5';

export const getDir = (book: Book) => {
  return `${book.hash}`;
};
export const getLibraryFilename = () => {
  return 'library.json';
};
export const getLibraryBackupFilename = () => {
  return 'library_backup.json';
};
export const getRemoteBookFilename = (book: Book) => {
  // S3 storage: https://docs.aws.amazon.com/zh_cn/AmazonS3/latest/userguide/object-keys.html
  if (getStorageType() === 'r2') {
    return `${book.hash}/${makeSafeFilename(book.sourceTitle || book.title)}.${EXTS[book.format]}`;
  } else if (getStorageType() === 's3') {
    return `${book.hash}/${book.hash}.${EXTS[book.format]}`;
  } else {
    return '';
  }
};
export const getLocalBookFilename = (book: Book) => {
  return `${book.hash}/${makeSafeFilename(book.sourceTitle || book.title)}.${EXTS[book.format]}`;
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

export const INIT_BOOK_CONFIG: BookConfig = {
  updatedAt: 0,
};

export interface LanguageMap {
  [key: string]: string;
}

export interface Identifier {
  scheme: string;
  value: string;
}

export interface Contributor {
  name: LanguageMap;
}

const formatLanguageMap = (x: string | LanguageMap, defaultLang = false): string => {
  const userLang = getUserLang();
  if (!x) return '';
  if (typeof x === 'string') return x;
  const keys = Object.keys(x);
  return defaultLang ? x[keys[0]!]! : x[userLang] || x[keys[0]!]!;
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

export const flattenContributors = (
  contributors: string | string[] | Contributor | Contributor[],
) => {
  if (!contributors) return '';
  return Array.isArray(contributors)
    ? contributors
        .map((contributor) =>
          typeof contributor === 'string' ? contributor : formatLanguageMap(contributor?.name),
        )
        .join(', ')
    : typeof contributors === 'string'
      ? contributors
      : formatLanguageMap(contributors?.name);
};

// prettier-ignore
const LASTNAME_AUTHOR_SORT_LANGS = [ 'ar', 'bo', 'de', 'en', 'es', 'fr', 'hi', 'it', 'nl', 'pl', 'pt', 'ru', 'th', 'tr', 'uk' ];

const formatAuthorName = (name: string, lastNameFirst: boolean) => {
  if (!name) return '';
  const parts = name.split(' ');
  if (lastNameFirst && parts.length > 1) {
    return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
  }
  return name;
};

export const formatAuthors = (
  contributors: string | string[] | Contributor | Contributor[],
  bookLang?: string | string[],
  sortAs?: boolean,
) => {
  const langCode = getBookLangCode(bookLang) || 'en';
  const lastNameFirst = !!sortAs && LASTNAME_AUTHOR_SORT_LANGS.includes(langCode);
  return Array.isArray(contributors)
    ? listFormater(langCode === 'zh', langCode).format(
        contributors.map((contributor) =>
          typeof contributor === 'string'
            ? formatAuthorName(contributor, lastNameFirst)
            : formatAuthorName(formatLanguageMap(contributor?.name), lastNameFirst),
        ),
      )
    : typeof contributors === 'string'
      ? formatAuthorName(contributors, lastNameFirst)
      : formatAuthorName(formatLanguageMap(contributors?.name), lastNameFirst);
};

export const formatTitle = (title: string | LanguageMap) => {
  return typeof title === 'string' ? title : formatLanguageMap(title);
};

export const formatDescription = (description?: string | LanguageMap) => {
  if (!description) return '';
  const text = typeof description === 'string' ? description : formatLanguageMap(description);
  return text
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&#\d+;/g, '')
    .trim();
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

// Should return valid ISO-639-1 language code, fallback to 'en' if not valid
export const getPrimaryLanguage = (lang: string | string[] | undefined) => {
  const primaryLang = Array.isArray(lang) ? lang[0] : lang;
  if (isValidLang(primaryLang)) {
    const normalizedLang = normalizedLangCode(primaryLang);
    return code6392to6391(normalizedLang) || normalizedLang;
  }
  return 'en';
};

export const formatDate = (date: string | number | Date | null | undefined, isUTC = false) => {
  if (!date) return;
  const userLang = getUserLang();
  try {
    return new Date(date).toLocaleDateString(userLang, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: isUTC ? 'UTC' : undefined,
    });
  } catch {
    return;
  }
};

export const formatBytes = (bytes?: number | null, locale = 'en-US') => {
  if (!bytes) return '';
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[i],
    unitDisplay: 'short',
    maximumFractionDigits: 2,
  });
  return formatter.format(value);
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

const getTitleForHash = (title: string | LanguageMap) => {
  return typeof title === 'string' ? title : formatLanguageMap(title, true);
};

const getAuthorsList = (contributors: string | string[] | Contributor | Contributor[]) => {
  if (!contributors) return [];
  return Array.isArray(contributors)
    ? contributors
        .map((contributor) =>
          typeof contributor === 'string'
            ? contributor
            : formatLanguageMap(contributor?.name, true),
        )
        .filter(Boolean)
    : [
        typeof contributors === 'string'
          ? contributors
          : formatLanguageMap(contributors?.name, true),
      ];
};

const normalizeIdentifier = (identifier: string) => {
  try {
    if (identifier.includes('urn:')) {
      // Slice after the last ':'
      return identifier.match(/[^:]+$/)?.[0] || '';
    } else if (identifier.includes(':')) {
      // Slice after the first ':'
      return identifier.match(/^[^:]+:(.+)$/)?.[1] || '';
    }
  } catch {
    return identifier;
  }
  return identifier;
};

const getPreferredIdentifier = (identifiers: string[] | Identifier[]) => {
  for (const scheme of ['uuid', 'calibre', 'isbn']) {
    const found = identifiers.find((identifier) =>
      typeof identifier === 'string'
        ? identifier.toLowerCase().includes(scheme)
        : identifier.scheme.toLowerCase() === scheme,
    );
    if (found) {
      return typeof found === 'string' ? normalizeIdentifier(found) : found.value;
    }
  }
  return;
};

const getIdentifiersList = (
  identifiers: undefined | string | string[] | Identifier | Identifier[],
) => {
  if (!identifiers) return [];
  if (Array.isArray(identifiers)) {
    const preferred = getPreferredIdentifier(identifiers);
    if (preferred) {
      return [preferred];
    }
  }
  return Array.isArray(identifiers)
    ? identifiers
        .map((identifier) =>
          typeof identifier === 'string' ? normalizeIdentifier(identifier) : identifier.value,
        )
        .filter(Boolean)
    : typeof identifiers === 'string'
      ? [normalizeIdentifier(identifiers)]
      : [identifiers.value];
};

export const getMetadataHash = (metadata: BookMetadata) => {
  try {
    const title = getTitleForHash(metadata.title);
    const authors = getAuthorsList(metadata.author).join(',');
    const identifiers = getIdentifiersList(metadata.altIdentifier || metadata.identifier).join(',');
    const hashSource = `${title}|${authors}|${identifiers}`;
    const metaHash = md5(hashSource.normalize('NFC'));
    return metaHash;
  } catch (error) {
    console.error('Error generating metadata hash:', error);
  }
  return;
};
