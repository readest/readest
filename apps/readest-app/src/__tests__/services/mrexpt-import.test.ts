import { afterEach, describe, test, expect, vi } from 'vitest';
import type { BookNote } from '@/types/book';
import { mergeImportedBookNotes } from '@/services/annotation/providers/mrexpt';
import { mergeNotes } from '@/services/sync/file/merge';

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

// An import is a change made on this device now (#6762). Keeping the export's
// old updatedAt let any remote deletion of the same note win the next sync, so
// the imported highlights vanished once the book was reopened, and native sync
// never pushed a note whose old updatedAt predates its last sync.
describe('mergeImportedBookNotes stamps the import time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a newly added note is stamped with the import time', () => {
    vi.useFakeTimers({ now: 50_000 });
    const result = mergeImportedBookNotes([], [makeNote({ updatedAt: 1000 })]);
    expect(result.merged[0]!.updatedAt).toBe(50_000);
    expect(result.applied[0]!.updatedAt).toBe(50_000);
  });

  test('a note updated from a newer copy is stamped with the import time', () => {
    vi.useFakeTimers({ now: 50_000 });
    const existing = [makeNote({ note: 'old', updatedAt: 1000 })];
    const result = mergeImportedBookNotes(existing, [makeNote({ note: 'new', updatedAt: 2000 })]);
    expect(result.merged[0]!.updatedAt).toBe(50_000);
  });

  test('re-importing the same file later is still a no-op', () => {
    vi.useFakeTimers({ now: 50_000 });
    const first = mergeImportedBookNotes([], [makeNote()]);
    vi.setSystemTime(60_000);
    const second = mergeImportedBookNotes(first.merged, [makeNote()]);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.merged[0]!.updatedAt).toBe(50_000);
  });

  test('an imported note survives a remote deletion made before the import', () => {
    vi.useFakeTimers({ now: 50_000 });
    const tombstone = makeNote({ updatedAt: 1000, deletedAt: 20_000 });
    const added = mergeImportedBookNotes([], [makeNote()]).merged;
    expect(mergeNotes(added, [tombstone])[0]!.deletedAt).toBeFalsy();
  });

  test('a note restored by import survives the remote deletion it undoes', () => {
    vi.useFakeTimers({ now: 50_000 });
    const tombstone = makeNote({ updatedAt: 1000, deletedAt: 20_000 });
    const restored = mergeImportedBookNotes([tombstone], [makeNote()]).merged;
    expect(mergeNotes(restored, [tombstone])[0]!.deletedAt).toBeFalsy();
  });
});
