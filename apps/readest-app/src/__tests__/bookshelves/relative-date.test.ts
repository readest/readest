import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import { bookshelfSchema, createBookshelf } from '@/services/bookshelves/definitions';
import { evaluateBookshelves } from '@/services/bookshelves/evaluate';
import { bookshelfFieldOperators } from '@/services/bookshelves/fields';

const relativeShelf = (
  field = 'created',
  value: unknown = 1,
  unit: unknown = 'months',
  kind = 'date',
) => ({
  ...createBookshelf('Recent'),
  filters: {
    type: 'group',
    match: 'all',
    children: [{ type: 'rule', field, kind, operator: 'withinLast', value, unit }],
  },
});
const book = (hash: string, created: string): Book => ({
  hash,
  title: hash,
  author: 'Author',
  format: 'EPUB',
  createdAt: Date.parse(created),
  updatedAt: Date.parse(created),
});
afterEach(() => vi.useRealTimers());
describe('relative bookshelf dates', () => {
  it('offers relative dates only for date fields and validates their count and unit', () => {
    expect(bookshelfFieldOperators('published', 'date')).toContain('withinLast');
    expect(bookshelfFieldOperators('calibre:#read', 'date')).toContain('withinLast');
    expect(bookshelfFieldOperators('progress', 'number')).not.toContain('withinLast');
    for (const unit of ['days', 'months', 'years'])
      expect(bookshelfSchema.safeParse(relativeShelf('created', 2, unit)).success).toBe(true);
    for (const amount of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '', '7', undefined]) {
      const definition = relativeShelf();
      definition.filters.children[0]!.value = amount;
      expect(bookshelfSchema.safeParse(definition).success).toBe(false);
    }
    for (const unit of ['', 'weeks', undefined]) {
      const definition = relativeShelf();
      definition.filters.children[0]!.unit = unit;
      expect(bookshelfSchema.safeParse(definition).success).toBe(false);
    }
    expect(bookshelfSchema.safeParse(relativeShelf('progress', 7, 'days', 'number')).success).toBe(
      false,
    );
  });
  it.each([
    ['2024-03-31T12:00:00Z', 1, 'months', '2024-02-29', '2024-02-28'],
    ['2024-02-29T12:00:00Z', 1, 'years', '2023-02-28', '2023-02-27'],
    ['2025-01-01T12:00:00Z', 2, 'months', '2024-11-01', '2024-10-31'],
    ['2025-03-10T12:00:00Z', 7, 'days', '2025-03-03', '2025-03-02'],
  ])('matches calendar boundaries at %s for %i %s', (now, amount, unit, boundary, older) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const definition = bookshelfSchema.parse(relativeShelf('created', amount, unit));
    const matches = evaluateBookshelves(
      [
        book('boundary', boundary),
        book('older', older),
        book('today', now),
        book('future', '2030-01-01'),
      ],
      [definition],
    )[0]!
      .books.map((b) => b.hash)
      .sort();
    expect(matches).toEqual(['boundary', 'today']);
    vi.setSystemTime(new Date(Date.parse(now) + 86400000));
    if (unit === 'days')
      expect(evaluateBookshelves([book('boundary', boundary)], [definition])[0]!.books).toEqual([]);
  });
  it('supports added, read, published and Calibre dates, including nested conditions and missing values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    for (const field of ['created', 'updated', 'published', 'calibre:#date']) {
      const definition = bookshelfSchema.parse(relativeShelf(field, 30, 'days'));
      definition.filters.children = [
        { type: 'group', match: 'any', children: definition.filters.children },
      ];
      const recent: Book = {
        ...book('recent', '2025-06-01'),
        metadata: {
          title: 'Recent',
          author: 'Author',
          language: 'en',
          published: '2025-06-01',
          calibreColumns: [
            { label: '#date', name: 'Date', datatype: 'datetime', value: '2025-06-01' },
          ],
        },
      };
      expect(
        evaluateBookshelves([recent, book('old', '2020-01-01')], [definition])[0]!.books.map(
          (b) => b.hash,
        ),
      ).toEqual(['recent']);
    }
  });
});
