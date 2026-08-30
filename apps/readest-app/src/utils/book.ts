import { BookMetadata, CalibreCustomColumn, EXTS } from '@/libs/document';
import {
  Book,
  BOOK_CONFIG_SCHEMA_VERSION,
  BookConfig,
  BookProgress,
  WritingMode,
} from '@/types/book';
import { SUPPORTED_LANGS } from '@/services/constants';
import { getLocale, getUserLang, makeSafeFilename } from './misc';
import { getStorageType } from './storage';
import { getDirFromLanguage } from './rtl';
import { code6392to6391, isValidLang, normalizedLangCode } from './lang';
import { md5 } from './md5';

export const getDir = (book: Book) => {
  return `${book.hash}`;
};
/**
 * The `<hash>` dir a Books/-relative path lives in, or undefined for a
 * root-level file (library metadata). Accepts host separators, so a Windows
 * `readDirectory` path (`hash\cover.png`) resolves the same as a POSIX one.
 */
export const getBookDirOfPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  const slashIdx = normalized.indexOf('/');
  return slashIdx < 0 ? undefined : normalized.slice(0, slashIdx);
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
export const getBookNavFilename = (book: Book) => {
  return `${book.hash}/nav.json`;
};
export const isBookFile = (filename: string) => {
  return Object.values(EXTS).includes(filename.split('.').pop()!);
};

export const INIT_BOOK_CONFIG: BookConfig = {
  schemaVersion: BOOK_CONFIG_SCHEMA_VERSION,
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

export interface Collection {
  name: string;
  position?: string;
  total?: string;
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

export const getContributorNames = (
  contributors: string | string[] | Contributor | Contributor[] | undefined,
): string[] => {
  if (!contributors) return [];
  const values = Array.isArray(contributors) ? contributors : [contributors];
  return [...new Set(values.map((value) => flattenContributors(value).trim()).filter(Boolean))];
};

// biome-ignore format: keep the language codes compact on a single line
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

/**
 * The series position, or undefined when the book has none. Tolerates the two
 * shapes found in real libraries: readerStore/bookService default a missing
 * calibre:series_index to 0 (so 0 means "no position"), and indices edited
 * before the metadata form coerced numbers were persisted (and synced) as
 * strings like "2".
 */
export const getSeriesIndex = (seriesIndex?: number | string): number | undefined => {
  const index = typeof seriesIndex === 'string' ? parseFloat(seriesIndex) : seriesIndex;
  return typeof index === 'number' && Number.isFinite(index) && index > 0 ? index : undefined;
};

export const formatSeries = (series?: string, seriesIndex?: number) => {
  const name = series?.trim();
  if (!name) return '';
  const index = getSeriesIndex(seriesIndex);
  return index !== undefined ? `${name} #${index}` : name;
};

/**
 * Book metadata as inert `data-*` attributes for Custom Reader UI CSS (#5776):
 * the running header and HeaderBar only print the title, so series readers
 * append "Series #2" themselves via `attr()`. Series attributes are omitted
 * (undefined, so React drops them) for standalone books, keeping
 * `[data-book-series]` presence checks meaningful. Persisted metadata is not
 * runtime-validated (backup restore, sync index), so a non-string series is
 * treated as absent rather than thrown on.
 */
export const getBookDataAttributes = (
  title?: string,
  metadata?: Pick<BookMetadata, 'series' | 'seriesIndex'>,
) => {
  const series =
    typeof metadata?.series === 'string' ? metadata.series.trim() || undefined : undefined;
  return {
    'data-book-title': title || undefined,
    'data-book-series': series,
    'data-book-series-index': series ? getSeriesIndex(metadata?.seriesIndex) : undefined,
  };
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

/** The group-membership fields resolved together by {@link pickFresherGroup}. */
export interface BookGroupFields {
  groupId?: string;
  groupName?: string;
  groupUpdatedAt?: number | null;
}

/**
 * Field-level last-writer-wins for group membership (issue #5911), the client
 * mirror of `resolveGroupMerge` in `pages/api/sync.ts`. Shared by the native
 * cloud merge (`useBooksSync`) and the third-party file-sync merge
 * (`services/sync/file/merge.ts`) so both backends resolve a group the same way.
 *
 * Group membership used to ride the row's `updatedAt`, which is stamped by
 * operations that have nothing to do with grouping — above all
 * `cloudService.uploadBook`, which bumps it on every UPLOAD. A peer holding a
 * never-grouped copy of a row could therefore win whole-row LWW and erase the
 * group, and the emptied row then propagated to every other device.
 *
 * Resolution, in order:
 *   1. Different stamps → the newer stamp wins. This is what makes a real
 *      grouping edit — including a removal — propagate regardless of who won
 *      the row (#4942).
 *   2. Equal stamps, one side grouped and the other not → the GROUPED side
 *      wins. On a tie an absent group is ambiguous: "never grouped" and
 *      "ungrouped by a client too old to stamp" are indistinguishable, and the
 *      legacy fleet is entirely unstamped (0 === 0). Erasing a real group is
 *      unrecoverable; losing an un-group is not, and the next stamped edit
 *      resolves it.
 *   3. Equal stamps and both sides agree about having a group → the row winner,
 *      preserving the historical behaviour for two genuinely competing groups.
 */
export const pickFresherGroup = <T extends BookGroupFields>(
  local: T,
  remote: T,
  remoteRowWins: boolean,
): BookGroupFields => {
  const localMs = local.groupUpdatedAt ?? 0;
  const remoteMs = remote.groupUpdatedAt ?? 0;
  let winner: T;
  if (localMs !== remoteMs) {
    winner = remoteMs > localMs ? remote : local;
  } else {
    const localHasGroup = !!local.groupId || !!local.groupName;
    const remoteHasGroup = !!remote.groupId || !!remote.groupName;
    if (localHasGroup !== remoteHasGroup) {
      winner = localHasGroup ? local : remote;
    } else {
      winner = remoteRowWins ? remote : local;
    }
  }
  return {
    groupId: winner.groupId,
    groupName: winner.groupName,
    groupUpdatedAt: winner.groupUpdatedAt,
  };
};

/** True when `resolved` names a different group than `current` does. */
export const bookGroupDiffers = (current: BookGroupFields, resolved: BookGroupFields): boolean =>
  (current.groupId ?? undefined) !== (resolved.groupId ?? undefined) ||
  (current.groupName ?? undefined) !== (resolved.groupName ?? undefined);

// Immutably apply edited metadata to a book, returning a NEW book object.
// Callers must not mutate the existing book in place: <BookCover> is memoized
// and compares fields off the book, so an in-place mutation makes the memo's
// previous snapshot point to the same object and skips re-rendering the cover.
export const getBookWithUpdatedMetadata = (
  book: Book,
  metadata: BookMetadata,
  tags?: string[],
): Book => {
  const now = Date.now();
  const updatedBook: Book = {
    ...book,
    metadata,
    ...(tags ? { tags: [...tags] } : {}),
    title: formatTitle(metadata.title),
    author: formatAuthors(metadata.author),
    primaryLanguage: getPrimaryLanguage(metadata.language),
    updatedAt: now,
    // The metadata group merges on its own clock so a page turn elsewhere
    // (which dominates updatedAt) cannot clobber this edit (issue #5438).
    metadataUpdatedAt: now,
  };
  const newCoverImageUrl = metadata.coverImageBlobUrl || metadata.coverImageUrl;
  if (newCoverImageUrl) {
    updatedBook.coverImageUrl = newCoverImageUrl;
  }
  return updatedBook;
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

export const formatCalibreColumnValue = (column: CalibreCustomColumn): string => {
  const { datatype, value, extra } = column;
  if (Array.isArray(value)) return value.join(', ');
  switch (datatype) {
    case 'rating': {
      // 0-10 in half stars, like calibre's own rendering
      const rating = typeof value === 'number' ? value : 0;
      return '★'.repeat(Math.floor(rating / 2)) + (rating % 2 ? '½' : '');
    }
    case 'series':
      return extra != null ? `${value} [${extra}]` : String(value);
    case 'datetime':
      return formatDate(String(value), true) || '';
    case 'comments':
      return String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'bool':
      return value ? '✓' : '✗';
    default:
      return String(value);
  }
};

export const formatLocaleDateTime = (date: number | Date) => {
  const userLang = getLocale();
  return new Date(date).toLocaleString(userLang);
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

/**
 * A book is "currently reading" iff it has real reading progress and has not
 * been parked. Importing a book sets timestamps but never `progress` (only
 * opening it does), so the progress gate drops freshly-added-but-unopened
 * books; the status gate drops finished, abandoned (on hold) and
 * manually-marked-unread books. A book actively being read has `readingStatus`
 * either `undefined` (cleared from 'unread' on first open) or `'reading'`, both
 * of which pass. Shared by the library's recently-read shelf and the
 * home-screen reading widget so the two surfaces stay in sync.
 */
export const isCurrentlyReadingBook = (book: Book): boolean =>
  !book.deletedAt &&
  book.progress != null &&
  book.readingStatus !== 'finished' &&
  book.readingStatus !== 'abandoned' &&
  book.readingStatus !== 'unread';

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

const getPreferredIdentifier = (identifiers: (string | Identifier)[]) => {
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
  identifiers: undefined | string | Identifier | (string | Identifier)[],
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

export interface MetadataHashInfo {
  title: string;
  authors: string[];
  identifiers: string[];
  hashSource: string;
  metaHash: string;
}

export const getMetadataHashInfo = (
  metadata: BookMetadata,
  filename?: string,
): MetadataHashInfo | undefined => {
  if (!metadata) return;
  try {
    const title = getTitleForHash(metadata.title);
    const authors = getAuthorsList(metadata.author);
    const identifiers = getIdentifiersList(metadata.altIdentifier || metadata.identifier);
    let hashSource = `${title}|${authors.join(',')}|${identifiers.join(',')}`;
    if (filename) hashSource += `|${filename}`;
    const metaHash = md5(hashSource.normalize('NFC'));
    return { title, authors, identifiers, hashSource, metaHash };
  } catch (error) {
    console.error('Error generating metadata hash:', error);
  }
  return;
};

export const getMetadataHash = (metadata: BookMetadata, filename?: string) => {
  return getMetadataHashInfo(metadata, filename)?.metaHash;
};

// A bare UUID identifies an export, not a book: calibre mints a fresh one on
// every conversion, so every AO3 / FanFicFare re-download of the same work
// carries a different `dc:identifier` (issue #5959).
const VOLATILE_IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isVolatileIdentifier = (identifier: string | Identifier) =>
  VOLATILE_IDENTIFIER.test(
    typeof identifier === 'string' ? normalizeIdentifier(identifier) : identifier.value,
  );

/**
 * Metadata hash computed with volatile identifiers left out, so two exports of
 * the same book still hash alike. Returns undefined when the metadata carries
 * no volatile identifier — `getMetadataHash` is already stable for those and
 * the caller has nothing extra to look up.
 *
 * This is a local, import-time key only. Never use it as a sync key:
 * `getMetadataHash` is a wire format shared with the sync server and with the
 * KOReader plugin (which caches it as `meta_hash_v1`), so its output has to
 * stay byte-identical across versions and across the two implementations.
 */
export const getStableMetadataHash = (metadata: BookMetadata) => {
  if (!metadata) return;
  try {
    const identifier = metadata.altIdentifier || metadata.identifier;
    const all = identifier ? (Array.isArray(identifier) ? identifier : [identifier]) : [];
    const stable = all.filter((id) => !isVolatileIdentifier(id));
    if (stable.length === all.length) return;
    const title = getTitleForHash(metadata.title);
    const authors = getAuthorsList(metadata.author);
    const identifiers = getIdentifiersList(stable);
    const hashSource = `${title}|${authors.join(',')}|${identifiers.join(',')}`;
    return md5(hashSource.normalize('NFC'));
  } catch (error) {
    console.error('Error generating stable metadata hash:', error);
  }
  return;
};
