import { Book, BooksGroup } from '@/types/book';
import { LibraryGroupByType, LibrarySortByType } from '@/types/settings';
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

export const createBookSorter = (sortBy: string, uiLanguage: string) => (a: Book, b: Book) => {
  switch (sortBy) {
    case LibrarySortByType.Title:
      const aTitle = formatTitle(a.title);
      const bTitle = formatTitle(b.title);
      return aTitle.localeCompare(bTitle, uiLanguage || navigator.language);
    case LibrarySortByType.Author:
      const aAuthors = formatAuthors(a.author, a?.primaryLanguage || 'en', true);
      const bAuthors = formatAuthors(b.author, b?.primaryLanguage || 'en', true);
      return aAuthors.localeCompare(bAuthors, uiLanguage || navigator.language);
    case LibrarySortByType.Updated:
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    case LibrarySortByType.Created:
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case LibrarySortByType.Format:
      return a.format.localeCompare(b.format, uiLanguage || navigator.language);
    case LibrarySortByType.Published:
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
    default:
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  }
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

  // 'manual' mode is handled separately by generateBookshelfItems
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
 * For series groups: sort by seriesIndex first, then by global sort for items without index.
 * For author groups: follow global sort setting.
 */
export const createWithinGroupSorter =
  (groupBy: LibraryGroupByType, sortBy: LibrarySortByType, uiLanguage: string) =>
  (a: Book, b: Book): number => {
    if (groupBy === LibraryGroupByType.Series) {
      const aIndex = a.metadata?.seriesIndex;
      const bIndex = b.metadata?.seriesIndex;

      // Both have series index - sort by index
      if (aIndex != null && bIndex != null) {
        return aIndex - bIndex;
      }

      // Only one has series index - the one with index comes first
      if (aIndex != null) return -1;
      if (bIndex != null) return 1;

      // Neither has series index - fall back to global sort
      return createBookSorter(sortBy, uiLanguage)(a, b);
    }

    // For author and other groupings, use global sort
    return createBookSorter(sortBy, uiLanguage)(a, b);
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
): number | string => {
  const books = group.books;

  if (books.length === 0) {
    return sortBy === LibrarySortByType.Title ||
      sortBy === LibrarySortByType.Author ||
      sortBy === LibrarySortByType.Format
      ? group.name
      : 0;
  }

  switch (sortBy) {
    case LibrarySortByType.Title:
    case LibrarySortByType.Author:
    case LibrarySortByType.Format:
      // For text-based sorts, use the group name
      // This isn't perfect, especially with the
      return group.name;

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
  (sortBy: LibrarySortByType, uiLanguage: string) =>
  (a: BooksGroup, b: BooksGroup): number => {
    const aValue = getGroupSortValue(a, sortBy);
    const bValue = getGroupSortValue(b, sortBy);

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
