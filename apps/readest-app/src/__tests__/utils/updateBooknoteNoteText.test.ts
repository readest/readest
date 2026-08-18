import { describe, expect, it } from 'vitest';
import { updateBooknoteNoteText } from '@/utils/updateBooknoteNoteText';
import { BookNote } from '@/types/book';

const makeBooknote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  note: 'original note',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('updateBooknoteNoteText', () => {
  it('updates the note text of the booknote matching the given id', () => {
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text' })];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result!.updatedBooknote.note).toBe('new text');
  });

  it('leaves booknotes other than the targeted one unchanged', () => {
    const other = makeBooknote({ id: 'note-2', note: 'untouched', cfi: 'C2' });
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text' }), other];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result!.booknotes.find((n) => n.id === 'note-2')).toEqual(other);
  });

  it('does not mutate the input booknotes array', () => {
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text', updatedAt: 1000 })];
    const snapshotBeforeCall = JSON.parse(JSON.stringify(booknotes));

    updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(booknotes).toEqual(snapshotBeforeCall);
  });

  it('does not mutate the original booknote object being edited', () => {
    const original = makeBooknote({ id: 'note-1', note: 'old text', updatedAt: 1000 });
    const booknotes = [original];

    updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(original.note).toBe('old text');
    expect(original.updatedAt).toBe(1000);
  });

  it('returns a new booknotes array and a new updated booknote, not the same references', () => {
    const original = makeBooknote({ id: 'note-1', note: 'old text' });
    const booknotes = [original];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result!.booknotes).not.toBe(booknotes);
    expect(result!.updatedBooknote).not.toBe(original);
  });

  it('normalizes a whitespace-only note to an empty string', () => {
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text' })];

    const result = updateBooknoteNoteText(booknotes, 'note-1', '   \n\t  ', 5000);

    expect(result!.updatedBooknote.note).toBe('');
  });

  it('keeps non-blank note text exactly as given, without trimming surrounding whitespace', () => {
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text' })];

    const result = updateBooknoteNoteText(booknotes, 'note-1', '  hello  ', 5000);

    expect(result!.updatedBooknote.note).toBe('  hello  ');
  });

  it('sets updatedAt to the injected now value rather than the current time', () => {
    const booknotes = [makeBooknote({ id: 'note-1', updatedAt: 1000 })];
    const injectedNow = 918273645;

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', injectedNow);

    expect(result!.updatedBooknote.updatedAt).toBe(injectedNow);
  });

  it('returns null when no booknote with the given id exists', () => {
    const booknotes = [makeBooknote({ id: 'note-1' })];

    const result = updateBooknoteNoteText(booknotes, 'missing-id', 'new text', 5000);

    expect(result).toBeNull();
  });

  it('returns null for a deleted booknote instead of reviving it', () => {
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text', deletedAt: 4000 })];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result).toBeNull();
  });

  it('preserves every other BookNote field when only the note text changes', () => {
    const original = makeBooknote({
      id: 'note-1',
      note: 'old text',
      bookHash: 'hash-abc',
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
      text: 'highlighted words',
      style: 'highlight',
      color: 'yellow',
      page: 12,
      global: true,
      createdAt: 100,
    });
    const booknotes = [original];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result!.updatedBooknote).toEqual({
      ...original,
      note: 'new text',
      updatedAt: 5000,
    });
  });

  it('reports the note text as it was before the update, as previousNoteText', () => {
    const booknotes = [makeBooknote({ id: 'note-1', note: 'old text' })];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result!.previousNoteText).toBe('old text');
  });

  it('updates the note text of a booknote regardless of its type, not only annotations', () => {
    const booknotes = [makeBooknote({ id: 'note-1', type: 'bookmark', note: 'old text' })];

    const result = updateBooknoteNoteText(booknotes, 'note-1', 'new text', 5000);

    expect(result!.updatedBooknote.note).toBe('new text');
  });
});
