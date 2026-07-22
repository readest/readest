import { describe, expect, it } from 'vitest';
import { unifyAnnotations } from '@/utils/booknoteMigration';
import { BookNote } from '@/types/book';

const note = (over: Partial<BookNote>): BookNote => ({
  id: 'id',
  type: 'annotation',
  cfi: 'C',
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('unifyAnnotations', () => {
  it('merges a separate highlight and note at the same cfi into a survivor + a tombstone', () => {
    const input = [
      note({
        id: 'h',
        cfi: 'C1',
        style: 'highlight',
        color: 'yellow',
        text: 'hello',
        note: '',
        createdAt: 10,
      }),
      note({ id: 'n', cfi: 'C1', text: 'hello', note: 'my note', createdAt: 20 }),
    ];
    const out = unifyAnnotations(input);
    const survivor = out.find((n) => n.id === 'h')!;
    const tombstone = out.find((n) => n.id === 'n')!;
    expect(survivor.style).toBe('highlight');
    expect(survivor.note).toBe('my note');
    expect(survivor.deletedAt).toBeFalsy();
    expect(tombstone.deletedAt).toBeTruthy();
  });

  it('deterministically prefers the styled record as survivor', () => {
    const input = [
      note({ id: 'n', cfi: 'C', note: 'note', createdAt: 5 }),
      note({ id: 'h', cfi: 'C', style: 'highlight', note: '', createdAt: 50 }),
    ];
    const out = unifyAnnotations(input);
    expect(out.find((n) => n.id === 'h')!.deletedAt).toBeFalsy();
    expect(out.find((n) => n.id === 'n')!.deletedAt).toBeTruthy();
  });

  it('keeps the latest-updated non-empty note', () => {
    const input = [
      note({ id: 'h', cfi: 'C', style: 'highlight', note: 'old', updatedAt: 10, createdAt: 1 }),
      note({ id: 'n', cfi: 'C', note: 'new', updatedAt: 99, createdAt: 2 }),
    ];
    const out = unifyAnnotations(input);
    expect(out.find((n) => n.id === 'h')!.note).toBe('new');
  });

  it('leaves a single annotation per cfi untouched (same reference)', () => {
    const input = [note({ id: 'a', cfi: 'C', style: 'highlight', note: 'x' })];
    expect(unifyAnnotations(input)).toBe(input);
  });

  it('is idempotent', () => {
    const input = [
      note({ id: 'h', cfi: 'C', style: 'highlight', note: '', createdAt: 10 }),
      note({ id: 'n', cfi: 'C', note: 'note', createdAt: 20 }),
    ];
    const once = unifyAnnotations(input);
    const twice = unifyAnnotations(once);
    expect(twice.filter((n) => !n.deletedAt).length).toBe(once.filter((n) => !n.deletedAt).length);
    expect(twice.find((n) => n.id === 'h')!.note).toBe('note');
  });

  it('does not merge bookmarks, excerpts, or global highlights', () => {
    const input = [
      note({ id: 'b1', cfi: 'C', type: 'bookmark' }),
      note({ id: 'b2', cfi: 'C', type: 'bookmark' }),
      note({ id: 'e1', cfi: 'C', type: 'excerpt' }),
      note({ id: 'e2', cfi: 'C', type: 'excerpt' }),
      note({ id: 'g1', cfi: 'C2', style: 'highlight', global: true, note: '' }),
      note({ id: 'g2', cfi: 'C2', style: 'highlight', global: true, note: '' }),
    ];
    const out = unifyAnnotations(input);
    expect(out.filter((n) => n.deletedAt).length).toBe(0);
  });

  it('collapses three records at one cfi to a single survivor + two tombstones', () => {
    const input = [
      note({ id: 'h', cfi: 'C', style: 'highlight', note: '', createdAt: 10 }),
      note({ id: 'n1', cfi: 'C', note: 'first', updatedAt: 20, createdAt: 11 }),
      note({ id: 'n2', cfi: 'C', note: 'second', updatedAt: 30, createdAt: 12 }),
    ];
    const out = unifyAnnotations(input);
    expect(out.filter((n) => !n.deletedAt).length).toBe(1);
    const survivor = out.find((n) => !n.deletedAt)!;
    expect(survivor.id).toBe('h');
    expect(survivor.note).toBe('second');
  });
});
