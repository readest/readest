import type { Book } from '@/types/book';
import type { BookshelfDefinition, BookshelfFilterGroup, BookshelfRule } from '@/types/bookshelf';
import { createBookSorter, withTimeRemainingLast } from '@/app/library/utils/libraryUtils';
import { bookshelfSchema, effectiveBookshelves, FINISHED_BOOKSHELF_ID } from './definitions';
import { getBookshelfField } from './fields';

const normalized = (value: unknown) => String(value).normalize('NFKC').toLocaleLowerCase();
const isSet = (value: unknown) =>
  value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
/** Matches one book against a filter node already resolved and normalized. */
type CompiledMatcher = (book: Book, now: number) => boolean;
/**
 * Resolve the field and normalize the rule's constant value once, then return a
 * matcher that computes only what its operator needs. Filters run once per book
 * per shelf, so nothing constant per rule may be repeated per book.
 */
const compileRule = (rule: BookshelfRule): CompiledMatcher => {
  const read = getBookshelfField(rule.field, rule.kind)?.read;
  const expected = rule.kind === 'date' ? Date.parse(String(rule.value)) : rule.value;
  const expectedText = normalized(expected);
  // Date comparisons use whole UTC calendar days, matching date-only editor inputs.
  const value = (book: Book) => {
    const actual = read?.(book);
    return rule.kind === 'date' && typeof actual === 'number'
      ? Math.floor(actual / 86400000) * 86400000
      : actual;
  };
  switch (rule.operator) {
    case 'set':
      return (book) => isSet(value(book));
    case 'unset':
      return (book) => !isSet(value(book));
    case 'withinLast': {
      if (
        rule.kind !== 'date' ||
        typeof rule.value !== 'number' ||
        !rule.unit ||
        !Number.isSafeInteger(rule.value) ||
        rule.value <= 0
      )
        return () => false;
      const { unit, value: amount } = rule;
      return (book, now) => {
        const left = value(book);
        if (typeof left !== 'number') return false;
        const today = Math.floor(now / 86400000) * 86400000;
        const start = new Date(today);
        if (unit === 'days') start.setUTCDate(start.getUTCDate() - amount);
        else {
          const day = start.getUTCDate();
          start.setUTCDate(1);
          start.setUTCMonth(start.getUTCMonth() - amount * (unit === 'years' ? 12 : 1));
          const monthEnd = new Date(start);
          monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
          start.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
        }
        // Intervals beyond JavaScript's date range cover every past date.
        const lower = Number.isFinite(start.getTime()) ? start.getTime() : -Infinity;
        return left >= lower && left <= today;
      };
    }
    // A book that lacks the field satisfies the negated operators: "Tags does
    // not contain kids" keeps untagged books instead of hiding them.
    case 'equals':
    case 'notEquals': {
      const want = rule.operator === 'equals';
      return (book) => {
        const left = value(book);
        if (!isSet(left)) return !want;
        const equal =
          typeof left === 'string' ? normalized(left) === expectedText : left === expected;
        return equal === want;
      };
    }
    case 'contains':
    case 'notContains': {
      const want = rule.operator === 'contains';
      return (book) => {
        const left = value(book);
        if (!isSet(left)) return !want;
        const contains = Array.isArray(left)
          ? left.some((v) => normalized(v) === expectedText)
          : normalized(left).includes(expectedText);
        return contains === want;
      };
    }
    case 'startsWith':
      return (book) => {
        const left = value(book);
        return isSet(left) && normalized(left).startsWith(expectedText);
      };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof expected !== 'number') return () => false;
      const operator = rule.operator;
      return (book) => {
        const left = value(book);
        if (typeof left !== 'number') return false;
        return operator === 'gt'
          ? left > expected
          : operator === 'gte'
            ? left >= expected
            : operator === 'lt'
              ? left < expected
              : left <= expected;
      };
    }
  }
};
const compileFilter = (group: BookshelfFilterGroup): CompiledMatcher => {
  if (!group.children.length) return () => true;
  const children = group.children.map((node) =>
    node.type === 'group' ? compileFilter(node) : compileRule(node),
  );
  return group.match === 'all'
    ? (book, now) => children.every((match) => match(book, now))
    : (book, now) => children.some((match) => match(book, now));
};
export const matchBookshelfFilter = (
  book: Book,
  group: BookshelfFilterGroup,
  now = Date.now(),
): boolean => compileFilter(group)(book, now);
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
): Map<string, Book[]> =>
  new Map(
    definitions.map((definition): [string, Book[]] => {
      if (!bookshelfSchema.safeParse(definition).success) return [definition.id, []];
      const match = compileFilter(definition.filters);
      return [definition.id, books.filter((b) => !b.deletedAt && match(b, now))];
    }),
  );
/** Invalid shelves own nothing: `matchBookshelves` already gave them no matches. */
export const assignBookshelfOwnership = (
  definitions: BookshelfDefinition[],
  matches: Map<string, Book[]>,
) => {
  const owners = new Map<string, string>();
  for (const shelf of effectiveBookshelves(definitions)) {
    if (!shelf.enabled || !shelf.exclusive) continue;
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
