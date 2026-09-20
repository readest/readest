import type { Book } from '@/types/book';
import type { BookshelfDefinition, BookshelfFilterGroup, BookshelfRule } from '@/types/bookshelf';
import { createBookSorter, withTimeRemainingLast } from '@/app/library/utils/libraryUtils';
import { bookshelfSchema, effectiveBookshelves, FINISHED_BOOKSHELF_ID } from './definitions';
import { getBookshelfField } from './fields';

const normalized = (value: unknown) => String(value).normalize('NFKC').toLocaleLowerCase();
const matchesRule = (book: Book, rule: BookshelfRule, now: number): boolean => {
  const actual = getBookshelfField(rule.field, rule.kind)?.read(book);
  const isSet =
    actual !== undefined && actual !== '' && (!Array.isArray(actual) || actual.length > 0);
  if (rule.operator === 'set') return isSet;
  if (rule.operator === 'unset') return !isSet;
  if (!isSet) return false;
  const expected = rule.kind === 'date' ? Date.parse(String(rule.value)) : rule.value;
  // Date comparisons use whole UTC calendar days, matching date-only editor inputs.
  const left =
    rule.kind === 'date' && typeof actual === 'number'
      ? Math.floor(actual / 86400000) * 86400000
      : actual;
  if (rule.operator === 'withinLast') {
    if (
      rule.kind !== 'date' ||
      typeof left !== 'number' ||
      typeof rule.value !== 'number' ||
      !rule.unit ||
      !Number.isSafeInteger(rule.value) ||
      rule.value <= 0
    )
      return false;
    const today = Math.floor(now / 86400000) * 86400000;
    const start = new Date(today);
    if (rule.unit === 'days') start.setUTCDate(start.getUTCDate() - rule.value);
    else {
      const day = start.getUTCDate();
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - rule.value * (rule.unit === 'years' ? 12 : 1));
      const monthEnd = new Date(start);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
      start.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
    }
    // Intervals beyond JavaScript's date range cover every past date.
    const lower = Number.isFinite(start.getTime()) ? start.getTime() : -Infinity;
    return left >= lower && left <= today;
  }
  const equal =
    typeof left === 'string' ? normalized(left) === normalized(expected) : left === expected;
  const contains = Array.isArray(left)
    ? left.some((v) => normalized(v) === normalized(expected))
    : normalized(left).includes(normalized(expected));
  switch (rule.operator) {
    case 'equals':
      return equal;
    case 'notEquals':
      return !equal;
    case 'contains':
      return contains;
    case 'notContains':
      return !contains;
    case 'startsWith':
      return normalized(left).startsWith(normalized(expected));
    case 'gt':
      return typeof left === 'number' && typeof expected === 'number' && left > expected;
    case 'gte':
      return typeof left === 'number' && typeof expected === 'number' && left >= expected;
    case 'lt':
      return typeof left === 'number' && typeof expected === 'number' && left < expected;
    case 'lte':
      return typeof left === 'number' && typeof expected === 'number' && left <= expected;
  }
};
export const matchBookshelfFilter = (
  book: Book,
  group: BookshelfFilterGroup,
  now = Date.now(),
): boolean => {
  if (!group.children.length) return true;
  const match = (node: BookshelfFilterGroup | BookshelfRule) =>
    node.type === 'group' ? matchBookshelfFilter(book, node, now) : matchesRule(book, node, now);
  return group.match === 'all' ? group.children.every(match) : group.children.some(match);
};
export interface BookshelfResult {
  definition: BookshelfDefinition;
  books: Book[];
  matching: number;
  excluded: number;
}
/** Memoize this independently of sorting, selection and limits. Invalid shelves match nothing. */
export const matchBookshelves = (
  books: Book[],
  definitions: BookshelfDefinition[],
  now = Date.now(),
) =>
  new Map(
    definitions.map((definition) => [
      definition.id,
      bookshelfSchema.safeParse(definition).success
        ? books.filter((b) => !b.deletedAt && matchBookshelfFilter(b, definition.filters, now))
        : [],
    ]),
  );
export const assignBookshelfOwnership = (
  definitions: BookshelfDefinition[],
  matches: Map<string, Book[]>,
) => {
  const owners = new Map<string, string>();
  for (const shelf of effectiveBookshelves(definitions)) {
    if (!shelf.enabled || !shelf.exclusive || !bookshelfSchema.safeParse(shelf).success) continue;
    for (const book of matches.get(shelf.id) || [])
      if (shelf.id === FINISHED_BOOKSHELF_ID || !owners.has(book.hash))
        owners.set(book.hash, shelf.id);
  }
  return owners;
};
export const evaluateBookshelves = (
  books: Book[],
  definitions: BookshelfDefinition[],
  locale = '',
  pageDurations?: Readonly<Record<string, number>>,
  matches = matchBookshelves(books, definitions),
  owners = assignBookshelfOwnership(definitions, matches),
): BookshelfResult[] =>
  effectiveBookshelves(definitions)
    .filter((s) => s.enabled)
    .map((definition) => {
      const raw = matches.get(definition.id) || [];
      const available = raw.filter((b) =>
        definition.exclusive
          ? owners.get(b.hash) === definition.id
          : definition.includeExclusiveBooks || !owners.has(b.hash),
      );
      const { by, thenBy, ascending, thenAscending } = definition.sort;
      const compare = createBookSorter(by, locale, thenBy, ascending, thenAscending, pageDurations);
      available.sort(
        withTimeRemainingLast<Book>(by, (a, b) => compare(a, b) || a.hash.localeCompare(b.hash)),
      );
      return {
        definition,
        matching: raw.length,
        excluded: raw.length - available.length,
        books: available,
      };
    });
