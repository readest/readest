import { Book, BooksGroup } from '@/types/book';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { md5Fingerprint } from '@/utils/md5';
import { LibraryGroupByType, type SystemSettings } from '@/types/settings';
import type { BookshelfResult } from './evaluate';
import { resolveBookshelfGroupBy } from './grouping';
import {
  createBookGroups,
  createBookSorter,
  createGroupSorter,
  createWithinGroupSorter,
  getBookSortValue,
  getGroupSortValue,
  compareSortValues,
  withTimeRemainingLast,
  resolveCurrentShelfBooks,
} from '@/app/library/utils/libraryUtils';

export const generateBookshelfItems = (
  books: Book[],
  parentGroupName: string,
): (Book | BooksGroup)[] => {
  const groupsMap = new Map<string, BooksGroup>();

  for (const book of books) {
    if (book.deletedAt) continue;

    const groupName = book.groupName || BOOK_UNGROUPED_NAME;
    if (
      parentGroupName &&
      groupName !== parentGroupName &&
      !groupName.startsWith(parentGroupName + '/')
    ) {
      continue;
    }

    const relativePath = parentGroupName ? groupName.slice(parentGroupName.length + 1) : groupName;
    // Get the immediate child group name (or empty if book is directly in parent)
    const slashIndex = relativePath.indexOf('/');
    const immediateChild = slashIndex > 0 ? relativePath.slice(0, slashIndex) : relativePath;
    // Determine if this book belongs directly to the parent group
    const isDirectChild =
      groupName === parentGroupName || (groupName === BOOK_UNGROUPED_NAME && !parentGroupName);
    // Build the full group name for this level
    const fullGroupName = isDirectChild
      ? BOOK_UNGROUPED_NAME
      : parentGroupName
        ? `${parentGroupName}/${immediateChild}`
        : immediateChild;

    const mapKey = fullGroupName;
    const existingGroup = groupsMap.get(mapKey);
    if (existingGroup) {
      existingGroup.books.push(book);
      existingGroup.updatedAt = Math.max(existingGroup.updatedAt, book.updatedAt);
    } else {
      groupsMap.set(mapKey, {
        id: isDirectChild ? BOOK_UNGROUPED_ID : md5Fingerprint(fullGroupName),
        name: fullGroupName,
        displayName: isDirectChild ? BOOK_UNGROUPED_NAME : immediateChild,
        books: [book],
        updatedAt: book.updatedAt,
      });
    }
  }

  for (const group of groupsMap.values()) {
    group.books.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const ungroupedGroup = groupsMap.get(BOOK_UNGROUPED_NAME);
  const ungroupedBooks = ungroupedGroup?.books || [];
  const groupedBooks = Array.from(groupsMap.values()).filter(
    (group) => group.name !== BOOK_UNGROUPED_NAME,
  );

  return [...ungroupedBooks, ...groupedBooks].sort((a, b) => b.updatedAt - a.updatedAt);
};

export const presentBookshelf = (
  result: BookshelfResult,
  settings: Partial<SystemSettings>,
  uiLanguage: string,
  pageDurations?: Readonly<Record<string, number>>,
  groupId = '',
  manualGroupName?: string,
): (Book | BooksGroup)[] => {
  const groupBy = resolveBookshelfGroupBy(
    result.definition,
    settings.libraryGroupBy || LibraryGroupByType.Group,
  );
  const { by, ascending, thenBy, thenAscending } = result.definition.sort;
  const sortBy = by;
  const thenSortBy = thenBy;
  const sortOrder = ascending ? 'asc' : 'desc';
  const thenSortOrder = thenAscending ? 'asc' : 'desc';
  const books = resolveCurrentShelfBooks(result.books, groupBy, groupId, manualGroupName);
  const currentBookshelfItems =
    groupBy === LibraryGroupByType.Group
      ? generateBookshelfItems(books, manualGroupName || '')
      : groupId
        ? books
        : createBookGroups(books, groupBy);
  const sortOrderMultiplier = sortOrder === 'asc' ? 1 : -1;

  // Separate into ungrouped books and groups
  const ungroupedBooks = currentBookshelfItems.filter((item): item is Book => 'format' in item);
  const groups = currentBookshelfItems.filter((item): item is BooksGroup => 'books' in item);

  // Sort books within each group
  // For series groups, series index is always ascending; sort direction applies to fallback only
  const sortAscending = sortOrder === 'asc';
  const thenSortAscending = thenSortOrder === 'asc';
  const withinGroupSorter = withTimeRemainingLast<Book>(
    sortBy,
    createWithinGroupSorter(
      groupBy,
      sortBy,
      uiLanguage,
      sortAscending,
      thenSortBy,
      thenSortAscending,
      pageDurations,
    ),
  );
  groups.forEach((group) => {
    group.books.sort(withinGroupSorter);
  });

  // Sort ungrouped books - use within-group sorter if we're inside a group
  // (for series, this ensures books are sorted by series index)
  // `bookSorter` already carries both sort directions, so it is never multiplied
  // by `sortOrderMultiplier` — that would flip the secondary key too (#5119).
  const bookSorter = createBookSorter(
    sortBy,
    uiLanguage,
    thenSortBy,
    sortAscending,
    thenSortAscending,
    pageDurations,
  );
  if (groupId && groupBy !== LibraryGroupByType.Group && groupBy !== LibraryGroupByType.None) {
    ungroupedBooks.sort(withinGroupSorter);
    // When inside a group, books are already sorted correctly — return directly
    // to avoid the merge sort below overriding the within-group sort order
    return ungroupedBooks;
  } else {
    ungroupedBooks.sort(withTimeRemainingLast<Book>(sortBy, bookSorter));
  }

  // Merge groups and ungrouped books, then sort them together
  const allItems: (Book | BooksGroup)[] = [...groups, ...ungroupedBooks];
  const groupSorter = createGroupSorter(sortBy, uiLanguage, groupBy);

  allItems.sort(
    withTimeRemainingLast<Book | BooksGroup>(sortBy, (a, b) => {
      const isAGroup = 'books' in a;
      const isBGroup = 'books' in b;

      // If both are groups, use group sorter
      if (isAGroup && isBGroup) {
        return groupSorter(a, b) * sortOrderMultiplier;
      }

      // If both are books, use book sorter
      if (!isAGroup && !isBGroup) {
        return bookSorter(a, b);
      }

      // For series/author groups: compare sort values to interleave properly
      if (isAGroup && !isBGroup) {
        const groupValue = getGroupSortValue(a, sortBy, groupBy);
        const bookValue = getBookSortValue(b, sortBy);
        return compareSortValues(groupValue, bookValue, uiLanguage) * sortOrderMultiplier;
      } else if (!isAGroup && isBGroup) {
        const bookValue = getBookSortValue(a, sortBy);
        const groupValue = getGroupSortValue(b, sortBy, groupBy);
        return compareSortValues(bookValue, groupValue, uiLanguage) * sortOrderMultiplier;
      }
      return 0;
    }),
  );

  return allItems;
};
