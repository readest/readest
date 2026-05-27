import { describe, test, expect } from 'vitest';
import type { BookNote } from '@/types/book';
import { mergeImportedBookNotes } from '@/services/annotation/providers/mrexpt';

const makeNote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'mrexpt-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4)',
  text: 'hello',
  style: 'highlight',
  color: 'yellow',
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('mergeImportedBookNotes', () => {
  test('adds notes that do not yet exist', () => {
    const result = mergeImportedBookNotes([], [makeNote()]);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.applied).toHaveLength(1);
    expect(result.merged).toHaveLength(1);
  });

  test('skips notes that were already imported unchanged', () => {
    const existing = [makeNote()];
    const result = mergeImportedBookNotes(existing, [makeNote()]);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.applied).toHaveLength(0);
    expect(result.merged).toHaveLength(1);
  });

  test('reports zero changes when every incoming note is a duplicate', () => {
    // Regression: a re-import of an unchanged file must surface as
    // "nothing new" (added + updated === 0), never as "Imported 0".
    const existing = [makeNote({ id: 'a' }), makeNote({ id: 'b' })];
    const incoming = [makeNote({ id: 'a' }), makeNote({ id: 'b' })];
    const result = mergeImportedBookNotes(existing, incoming);
    expect(result.added + result.updated).toBe(0);
  });

  test('resurrects a soft-deleted note', () => {
    const existing = [makeNote({ deletedAt: 5000 })];
    const result = mergeImportedBookNotes(existing, [makeNote()]);
    expect(result.added).toBe(1);
    expect(result.merged[0]!.deletedAt).toBeNull();
    expect(result.applied).toHaveLength(1);
  });

  test('updates an existing note when the incoming copy is newer', () => {
    const existing = [makeNote({ note: 'old', updatedAt: 1000 })];
    const result = mergeImportedBookNotes(existing, [makeNote({ note: 'new', updatedAt: 2000 })]);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
    expect(result.merged[0]!.note).toBe('new');
  });

  test('preserves unrelated existing notes', () => {
    const existing = [makeNote({ id: 'keep', type: 'bookmark' })];
    const result = mergeImportedBookNotes(existing, [makeNote({ id: 'new' })]);
    expect(result.merged).toHaveLength(2);
    expect(result.merged.some((n) => n.id === 'keep')).toBe(true);
  });
});
