import { Book, BooksGroup } from '@/types/book';
import {
  LibraryGroupByType,
  LibrarySecondarySortByType,
  LibrarySortByType,
} from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';
import { md5Fingerprint } from '@/utils/md5';

/** Valid sort types for the library */
const VALID_SORT_TYPES: LibrarySortByType[] = Object.values(LibrarySortByType);

/** Valid group by types for the library */
const VALID_GROUP_BY_TYPES: LibraryGroupByType[] = Object.values(LibraryGroupByType);

/**
 * Safely cast a query parameter to LibrarySortByType with fallback.
 * Returns the value if valid, otherwise returns the fallback.
 */
export const ensureLibrarySortByType = (
  value: string | null | undefined,
  fallback: LibrarySortByType,
): LibrarySortByType => {
  if (value && VALID_SORT_TYPES.includes(value as LibrarySortByType)) {
    return value as LibrarySortByType;
  }
  return fallback;
};

/**
 * Safely cast a query parameter to LibrarySecondarySortByType with fallback.
 * Accepts any valid primary sort type plus the literal 'none'.
 */
export const ensureLibrarySecondarySortByType = (
  value: string | null | undefined,
  fallback: LibrarySecondarySortByType,
): LibrarySecondarySortByType => {
  if (value === 'none') return 'none';
  if (value && VALID_SORT_TYPES.includes(value as LibrarySortByType)) {
    return value as LibrarySortByType;
  }
  return fallback;
};

/**
 * Resolve the *effective* primary sort key, applying smart defaults derived
 * from the current `groupBy`. The stored `librarySortBy` is left unchanged;
 * this only substitutes a sensible implicit default when the user is still on
 * auto, so grouping by Series lands an alphabetical-by-series-name listing
 * without any extra clicks.
 *
 * - !isAuto                              -> use stored as-is
 * - groupBy=Series and isAuto            -> Series
 * - everything else                      -> stored
 */
export const resolveEffectivePrimarySort = (
  stored: LibrarySortByType,
  groupBy: LibraryGroupByType,
  isAuto: boolean,
): LibrarySortByType => {
  if (!isAuto) return stored;
  if (groupBy === LibraryGroupByType.Series) return LibrarySortByType.Series;
  return stored;
};

/**
 * Resolve the *effective* secondary sort key, applying smart defaults derived
 * from the current `groupBy`. The stored secondary stays whatever the user
 * picked; this only substitutes 'none' with a sensible implicit default so
 * users get useful behavior out of the box (e.g. drilling into an Author
 * group lands a series-ordered list without any extra clicks).
 *
 * - explicit secondary (any non-'none')  -> use as-is
 * - groupBy=Author and stored='none'     -> Series
 * - everything else                      -> 'none'
 *
 * groupBy=Series doesn't default to anything because `createWithinGroupSorter`
 * already orders by `seriesIndex` for series groups.
 */
export const resolveEffectiveSecondarySort = (
  secondary: LibrarySecondarySortByType,
  groupBy: LibraryGroupByType,
): LibrarySecondarySortByType => {
  if (secondary !== 'none') return secondary;
  if (groupBy === LibraryGroupByType.Author) return LibrarySortByType.Series;
  return 'none';
};

/**
 * Safely cast a query parameter to LibraryGroupByType with fallback.
 * Returns the value if valid, otherwise returns the fallback.
 */
export const ensureLibraryGroupByType = (
  value: string | null | undefined,
  fallback: LibraryGroupByType,
): LibraryGroupByType => {
  if (value && VALID_GROUP_BY_TYPES.includes(value as LibraryGroupByType)) {
    return value as LibraryGroupByType;
  }
  return fallback;
};

/**
 * Find a group by ID from a list of bookshelf items.
 * Works for both manual groups and series/author groups.
 */
export const findGroupById = (
  items: (Book | BooksGroup)[],
  groupId: string,
): BooksGroup | undefined => {
  return items.find((item): item is BooksGroup => 'books' in item && item.id === groupId);
};

/**
 * Get the display name for a group, useful for breadcrumbs.
 */
export const getGroupDisplayName = (
  items: (Book | BooksGroup)[],
  groupId: string,
): string | undefined => {
  const group = findGroupById(items, groupId);
  return group?.displayName || group?.name;
};

/**
 * Expand a list of selection ids (book hashes or group ids from the rendered
 * bookshelf) into the unique book hashes those ids represent.
 *
 * Group ids resolve to every (non-soft-deleted) book in the group's visible
 * rollup — `generateBookshelfItems` already folds nested-folder books into
 * their top-level group, so the rendered `BooksGroup.books` is the source of
 * truth. Standalone book hashes (and any unknown ids) pass through unchanged,
 * letting callers like the bookshelf delete flow collect the right set up
 * front instead of re-deriving it later.
 */
export const expandBookshelfSelection = (ids: string[], items: (Book | BooksGroup)[]): string[] => {
  const hashes = new Set<string>();
  for (const id of ids) {
    const group = findGroupById(items, id);
    if (group) {
      for (const book of group.books) {
        if (!book.deletedAt) hashes.add(book.hash);
      }
    } else {
      hashes.add(id);
    }
  }
  return [...hashes];
};

export const createBookFilter = (queryTerm: string | null) => (item: Book) => {
  if (!queryTerm) return true;
  if (item.deletedAt) return false;
  let searchTerm: RegExp;
  try {
    searchTerm = new RegExp(queryTerm, 'i');
  } catch {
    const lowerQuery = queryTerm.toLowerCase();
    const title = formatTitle(item.title).toLowerCase();
    const authors = formatAuthors(item.author).toLowerCase();

    return (
      title.includes(lowerQuery) ||
      authors.includes(lowerQuery) ||
      item.format.toLowerCase().includes(lowerQuery) ||
      (item.groupName && item.groupName.toLowerCase().includes(lowerQuery)) ||
      (item.metadata?.description && item.metadata.description.toLowerCase().includes(lowerQuery))
    );
  }
  const title = formatTitle(item.title);
  const authors = formatAuthors(item.author);
  return (
    searchTerm.test(title) ||
    searchTerm.test(authors) ||
    searchTerm.test(item.format) ||
    (item.groupName && searchTerm.test(item.groupName)) ||
    (item.metadata?.description && searchTerm.test(item.metadata?.description))
  );
};

const compareBookByKey = (a: Book, b: Book, sortBy: string, uiLanguage: string): number => {
  switch (sortBy) {
    case LibrarySortByType.Title: {
      const aTitle = formatTitle(a.title);
      const bTitle = formatTitle(b.title);
      return aTitle.localeCompare(bTitle, uiLanguage || navigator.language);
    }
    case LibrarySortByType.Author: {
      const aAuthors = formatAuthors(a.author, a?.primaryLanguage || 'en', true);
      const bAuthors = formatAuthors(b.author, b?.primaryLanguage || 'en', true);
      return aAuthors.localeCompare(bAuthors, uiLanguage || navigator.language);
    }
    case LibrarySortByType.Updated:
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    case LibrarySortByType.Created:
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case LibrarySortByType.Format:
      return a.format.localeCompare(b.format, uiLanguage || navigator.language);
    case LibrarySortByType.Series:
      return (a.metadata?.seriesIndex || 0) - (b.metadata?.seriesIndex || 0);
    case LibrarySortByType.Published: {
      const aPublished = a.metadata?.published || '0001-01-01';
      const bPublished = b.metadata?.published || '0001-01-01';

      // Handle cases where published date might not exist
      if (!aPublished && !bPublished) return 0;
      if (!aPublished) return 1; // Books without published date go to the end
      if (!bPublished) return -1;

      // Try to parse dates - handle various date formats
      const aDate = new Date(aPublished).getTime();
      const bDate = new Date(bPublished).getTime();

      // If dates are invalid (NaN), fall back to string comparison
      if (isNaN(aDate) && isNaN(bDate)) {
        return aPublished.localeCompare(bPublished, uiLanguage || navigator.language);
      }
      if (isNaN(aDate)) return 1;
      if (isNaN(bDate)) return -1;

      return aDate - bDate;
    }
    default:
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  }
};

/**
 * @param secondarySortBy - Optional tiebreaker key applied when the primary
 *   comparison returns 0. Pass `'none'` (or omit) to disable. Series-index ties
 *   on a Series secondary fall through to the underlying primary tie.
 */
export const createBookSorter =
  (sortBy: string, uiLanguage: string, secondarySortBy: LibrarySecondarySortByType = 'none') =>
  (a: Book, b: Book): number => {
    const primary = compareBookByKey(a, b, sortBy, uiLanguage);
    if (primary !== 0 || secondarySortBy === 'none') return primary;
    return compareBookByKey(a, b, secondarySortBy, uiLanguage);
  };

/**
 * Build a `groupName -> max(book.updatedAt)` map for all groups touched by
 * the given books. Each book bumps both its direct group and every ancestor
 * group along its path (e.g. a book in "Literature/Fiction" also bumps
 * "Literature"), so parent groups don't sink just because their direct
 * members are stale.
 */
export const buildGroupNameUpdatedAt = (books: Book[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const book of books) {
    if (!book.groupName || !book.updatedAt) continue;
    let path: string | undefined = book.groupName;
    while (path) {
      const prev = map.get(path) ?? 0;
      if (book.updatedAt > prev) map.set(path, book.updatedAt);
      const slash = path.lastIndexOf('/');
      path = slash === -1 ? undefined : path.slice(0, slash);
    }
  }
  return map;
};

export const getBreadcrumbs = (currentPath: string) => {
  if (!currentPath) return [];
  const segments = currentPath.split('/');
  return segments.map((segment, index) => ({
    name: segment,
    path: segments.slice(0, index + 1).join('/'),
  }));
};

/**
 * Parse a combined author string into individual author names.
 * Handles common separators like ", ", " & ", " and ".
 */
export const parseAuthors = (authorString: string): string[] => {
  if (!authorString || !authorString.trim()) {
    return [];
  }

  // Split by common separators: comma, ampersand, "and"
  // Use regex to handle variations with different spacing
  const authors = authorString
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((author) => author.trim())
    .filter((author) => author.length > 0);

  return authors;
};

/**
 * Create groups from books based on the groupBy setting.
 * Returns a mix of BooksGroup and ungrouped Book items.
 */
export const createBookGroups = (
  books: Book[],
  groupBy: LibraryGroupByType,
): (Book | BooksGroup)[] => {
  // Filter out deleted books
  const activeBooks = books.filter((book) => !book.deletedAt);

  if (groupBy === LibraryGroupByType.None) {
    return activeBooks;
  }

  if (groupBy === LibraryGroupByType.Series) {
    return createSeriesGroups(activeBooks);
  }

  if (groupBy === LibraryGroupByType.Author) {
    return createAuthorGroups(activeBooks);
  }

  // 'group' mode is handled separately by generateBookshelfItems
  return activeBooks;
};

/**
 * Group books by series metadata.
 * Books without series appear as individual items.
 */
const createSeriesGroups = (books: Book[]): (Book | BooksGroup)[] => {
  const seriesMap = new Map<string, Book[]>();
  const ungroupedBooks: Book[] = [];

  for (const book of books) {
    const seriesName = book.metadata?.series?.trim();

    if (seriesName) {
      const existing = seriesMap.get(seriesName);
      if (existing) {
        existing.push(book);
      } else {
        seriesMap.set(seriesName, [book]);
      }
    } else {
      ungroupedBooks.push(book);
    }
  }

  const groups: BooksGroup[] = Array.from(seriesMap.entries()).map(([seriesName, seriesBooks]) => ({
    id: md5Fingerprint(`series:${seriesName}`),
    name: seriesName,
    displayName: seriesName,
    books: seriesBooks,
    updatedAt: Math.max(...seriesBooks.map((b) => b.updatedAt)),
  }));

  return [...groups, ...ungroupedBooks];
};

/**
 * Group books by author.
 * Books with multiple authors appear in ALL matching author groups.
 * Books without author appear as individual items.
 */
const createAuthorGroups = (books: Book[]): (Book | BooksGroup)[] => {
  const authorMap = new Map<string, Book[]>();
  const ungroupedBooks: Book[] = [];

  for (const book of books) {
    const authorString = book.author?.trim();

    if (!authorString) {
      ungroupedBooks.push(book);
      continue;
    }

    const authors = parseAuthors(authorString);

    if (authors.length === 0) {
      ungroupedBooks.push(book);
      continue;
    }

    // Add book to each author's group
    for (const author of authors) {
      const existing = authorMap.get(author);
      if (existing) {
        existing.push(book);
      } else {
        authorMap.set(author, [book]);
      }
    }
  }

  const groups: BooksGroup[] = Array.from(authorMap.entries()).map(([authorName, authorBooks]) => ({
    id: md5Fingerprint(`author:${authorName}`),
    name: authorName,
    displayName: authorName,
    books: authorBooks,
    updatedAt: Math.max(...authorBooks.map((b) => b.updatedAt)),
  }));

  return [...groups, ...ungroupedBooks];
};

/**
 * Create a sorter for books within a group.
 * For series groups: sort by seriesIndex first (always ascending), then by global sort for items without index.
 * For other groupings: when a secondary key is supplied, sort by secondary key first (always ascending),
 *   with the primary global sort as tiebreaker. Without secondary, follow global sort setting.
 * @param sortAscending - When true (default), sort direction is ascending. Series index and the
 *   secondary key are always ascending regardless of this flag; the flag affects the fallback /
 *   primary tiebreaker only.
 * @param secondarySortBy - When non-'none', acts as the *primary* within-group ordering for
 *   non-series groupings (matches the user's mental model: "group by author, then sort by series"
 *   should land series order inside each author).
 */
export const createWithinGroupSorter =
  (
    groupBy: LibraryGroupByType,
    sortBy: LibrarySortByType,
    uiLanguage: string,
    sortAscending: boolean = true,
    secondarySortBy: LibrarySecondarySortByType = 'none',
  ) =>
  (a: Book, b: Book): number => {
    const sortDirection = sortAscending ? 1 : -1;

    if (groupBy === LibraryGroupByType.Series) {
      const aIndex = a.metadata?.seriesIndex;
      const bIndex = b.metadata?.seriesIndex;

      // Both have series index - always sort ascending by index
      if (aIndex != null && bIndex != null) {
        return aIndex - bIndex;
      }

      // Only one has series index - the one with index comes first
      if (aIndex != null) return -1;
      if (bIndex != null) return 1;

      // Neither has series index - fall back to global sort with direction
      return createBookSorter(sortBy, uiLanguage)(a, b) * sortDirection;
    }

    // For author and other non-series groupings: when a secondary key is provided,
    // use it as the within-group primary order with the global key as tiebreaker.
    if (secondarySortBy !== 'none') {
      const bySecondary = compareBookByKey(a, b, secondarySortBy, uiLanguage);
      if (bySecondary !== 0) return bySecondary;
      return createBookSorter(sortBy, uiLanguage)(a, b) * sortDirection;
    }

    return createBookSorter(sortBy, uiLanguage)(a, b) * sortDirection;
  };

/**
 * Get the sort value from a book for comparison with groups.
 */
export const getBookSortValue = (book: Book, sortBy: LibrarySortByType): number | string => {
  switch (sortBy) {
    case LibrarySortByType.Title:
      return formatTitle(book.title);

    case LibrarySortByType.Author:
      return formatAuthors(book.author, book?.primaryLanguage || 'en', true);

    case LibrarySortByType.Updated:
      return book.updatedAt;

    case LibrarySortByType.Created:
      return book.createdAt;

    case LibrarySortByType.Format:
      return book.format;

    case LibrarySortByType.Published: {
      const published = book.metadata?.published;
      if (!published) return 0;
      const publishedTime = new Date(published).getTime();
      return isNaN(publishedTime) ? 0 : publishedTime;
    }

    default:
      return book.updatedAt;
  }
};

/**
 * Get the aggregate sort value from a group for sorting groups.
 */
export const getGroupSortValue = (
  group: BooksGroup,
  sortBy: LibrarySortByType,
  groupBy?: LibraryGroupByType,
): number | string => {
  const books = group.books;

  if (books.length === 0) {
    return sortBy === LibrarySortByType.Title ||
      sortBy === LibrarySortByType.Series ||
      sortBy === LibrarySortByType.Author ||
      sortBy === LibrarySortByType.Format
      ? group.name
      : 0;
  }

  switch (sortBy) {
    case LibrarySortByType.Title:
    case LibrarySortByType.Series:
    case LibrarySortByType.Format:
      return group.name;

    case LibrarySortByType.Author: {
      if (groupBy === LibraryGroupByType.Author) {
        // Author group: format the group name (single author) with last-name-first
        return formatAuthors(group.name, 'en', true);
      }
      if (groupBy === LibraryGroupByType.Series) {
        // Series group: use the first book's author for sorting
        const firstBook = books[0]!;
        return formatAuthors(firstBook.author, firstBook.primaryLanguage || 'en', true);
      }
      // Custom/other groups: fall back to group name
      return group.name;
    }

    case LibrarySortByType.Updated:
      // Return the most recent updatedAt
      return Math.max(...books.map((b) => b.updatedAt));

    case LibrarySortByType.Created:
      // Return the most recent createdAt
      return Math.max(...books.map((b) => b.createdAt));

    case LibrarySortByType.Published: {
      // Return the most recent published date
      const publishedDates = books
        .map((b) => b.metadata?.published)
        .filter((d): d is string => !!d)
        .map((d) => new Date(d).getTime())
        .filter((t) => !isNaN(t));

      return publishedDates.length > 0 ? Math.max(...publishedDates) : 0;
    }

    default:
      return Math.max(...books.map((b) => b.updatedAt));
  }
};

/**
 * Compare two sort values (string or number) for sorting.
 */
export const compareSortValues = (
  aValue: number | string,
  bValue: number | string,
  uiLanguage: string,
): number => {
  // String comparison for text-based sorts
  if (typeof aValue === 'string' && typeof bValue === 'string') {
    return aValue.localeCompare(bValue, uiLanguage || navigator.language);
  }

  // Numeric comparison for date-based sorts
  if (typeof aValue === 'number' && typeof bValue === 'number') {
    return aValue - bValue;
  }

  return 0;
};

/**
 * Create a sorter for groups themselves based on sort criteria.
 */
export const createGroupSorter =
  (sortBy: LibrarySortByType, uiLanguage: string, groupBy?: LibraryGroupByType) =>
  (a: BooksGroup, b: BooksGroup): number => {
    const aValue = getGroupSortValue(a, sortBy, groupBy);
    const bValue = getGroupSortValue(b, sortBy, groupBy);

    // String comparison for text-based sorts
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return aValue.localeCompare(bValue, uiLanguage || navigator.language);
    }

    // Numeric comparison for date-based sorts
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return aValue - bValue;
    }

    return 0;
  };

export type BookContextMenuItemId =
  | 'select'
  | 'group'
  | 'markFinished'
  | 'markUnread'
  | 'clearStatus'
  | 'showDetails'
  | 'showInFinder'
  | 'download'
  | 'upload'
  | 'share'
  | 'delete';

/**
 * Resolve the ordered list of context-menu item ids for a book from its state.
 *
 * The native menu MUST be built from this list in a single `Menu.new({ items })`
 * call. Appending items one at a time with un-awaited `Menu.append()` promises
 * races on the Tauri IPC boundary, so the items land in a non-deterministic
 * order and the menu appears to shuffle on every open (issue #4389).
 */
export const getBookContextMenuItemIds = (book: Book): BookContextMenuItemId[] => {
  const ids: BookContextMenuItemId[] = ['select', 'group'];
  ids.push(book.readingStatus === 'finished' ? 'markUnread' : 'markFinished');
  // "Clear Status" is offered only when the book has an explicit status set.
  if (book.readingStatus === 'finished' || book.readingStatus === 'unread') {
    ids.push('clearStatus');
  }
  ids.push('showDetails', 'showInFinder');
  if (book.uploadedAt && !book.downloadedAt) ids.push('download');
  if (!book.uploadedAt && book.downloadedAt) ids.push('upload');
  // Share is offered for any local-or-uploaded book; the dialog uploads first
  // if the book hasn't been pushed yet.
  if (book.downloadedAt || book.uploadedAt) ids.push('share');
  ids.push('delete');
  return ids;
};
