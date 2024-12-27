import { EXTS } from '@/libs/document';
import { Book, BookConfig, BookProgress } from '@/types/book';
import { getUserLang, makeSafeFilename } from './misc';

export const getDir = (book: Book) => {
  return `${book.hash}`;
};
export const getLibraryFilename = () => {
  return 'library.json';
};
export const getFilename = (book: Book) => {
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
export const getBaseFilename = (filename: string) => {
  const normalizedPath = filename.replace(/\\/g, '/');
  const baseName = normalizedPath.split('/').pop()?.split('.').slice(0, -1).join('.') || '';
  return baseName;
};
export const INIT_BOOK_CONFIG: BookConfig = {
  updatedAt: 0,
};

interface LanguageMap {
  [key: string]: string;
}

interface Contributor {
  name: LanguageMap;
}

const userLang = getUserLang();

const formatLanguageMap = (x: string | LanguageMap): string => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  const keys = Object.keys(x);
  return x[userLang] || x[keys[0]!]!;
};

const listFormat = (lang: string) => {
  if (lang === 'zh') {
    return new Intl.ListFormat('en', { style: 'narrow', type: 'unit' });
  } else {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' });
  }
};

const getBookLangCode = (lang: string | string[] | undefined) => {
  try {
    const bookLang = typeof lang === 'string' ? lang : lang?.[0];
    return bookLang ? bookLang.split('-')[0]! : 'en';
  } catch {
    return 'en';
  }
};

export const formatAuthors = (
  bookLang: string | string[] | undefined,
  contributors: string | Contributor | [string | Contributor],
) =>
  Array.isArray(contributors)
    ? listFormat(getBookLangCode(bookLang)).format(
        contributors.map((contributor) =>
          typeof contributor === 'string' ? contributor : formatLanguageMap(contributor?.name),
        ),
      )
    : typeof contributors === 'string'
      ? contributors
      : formatLanguageMap(contributors?.name);

export const formatTitle = (title: string | LanguageMap) => {
  return typeof title === 'string' ? title : formatLanguageMap(title);
};

export const formatDate = (date: string | number | Date | undefined) => {
  if (!date) return;
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
