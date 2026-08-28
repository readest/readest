import { describe, expect, it } from 'vitest';
import { BookNote } from '@/types/book';
import {
  NOTEBOOK_ID,
  NOTEBOOK_MAX_BYTES,
  findNotebookRecord,
  getNotebookByteLength,
  insertNotebookMarkdown,
  upsertNotebookRecord,
  validateNotebookMutation,
} from '@/app/reader/utils/notebookDocument';

const makeNotebook = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: NOTEBOOK_ID,
  type: 'notebook',
  cfi: 'epubcfi(/6/2!/4/2/1:0)',
  note: 'saved text',
  createdAt: 100,
  updatedAt: 200,
  ...overrides,
});

describe('Notebook document helpers', () => {
  it('measures the UTF-8 byte length instead of UTF-16 code units', () => {
    expect(getNotebookByteLength('a你🙂')).toBe(8);
  });

  it('accepts the exact 256 KiB limit and rejects the next byte', () => {
    const atLimit = 'a'.repeat(NOTEBOOK_MAX_BYTES);

    expect(validateNotebookMutation('', atLimit)).toEqual({ accepted: true, bytes: 262_144 });
    expect(validateNotebookMutation('', `${atLimit}a`)).toEqual({
      accepted: false,
      bytes: 262_145,
    });
  });

  it('allows an already-oversize document only to get smaller until it is under the limit', () => {
    const oversize = 'a'.repeat(NOTEBOOK_MAX_BYTES + 10);

    expect(validateNotebookMutation(oversize, oversize.slice(0, -1)).accepted).toBe(true);
    expect(validateNotebookMutation(oversize, `${oversize}a`).accepted).toBe(false);
    expect(validateNotebookMutation(oversize, oversize).accepted).toBe(false);
  });

  it('finds the reserved record without treating a tombstone as live', () => {
    expect(findNotebookRecord([makeNotebook()])?.note).toBe('saved text');
    expect(findNotebookRecord([makeNotebook({ deletedAt: 300 })])).toBeNull();
  });

  it('does not create an untouched blank document', () => {
    const result = upsertNotebookRecord([], '', 'epubcfi(/6/2)', 300, false);

    expect(result).toBeNull();
  });

  it('requires a compatibility CFI before creating the singleton', () => {
    expect(upsertNotebookRecord([], 'draft', null, 300, true)).toBeNull();
  });

  it('creates one stable Notebook record on the first edit', () => {
    const annotation: BookNote = {
      id: 'annotation-1',
      type: 'annotation',
      cfi: 'epubcfi(/6/4)',
      note: '',
      createdAt: 50,
      updatedAt: 50,
    };

    const result = upsertNotebookRecord([annotation], 'draft', 'epubcfi(/6/2)', 300, true)!;

    expect(result.notebook).toEqual({
      id: NOTEBOOK_ID,
      type: 'notebook',
      cfi: 'epubcfi(/6/2)',
      note: 'draft',
      createdAt: 300,
      updatedAt: 300,
    });
    expect(result.booknotes).toEqual([annotation, result.notebook]);
  });

  it('updates rather than duplicates the singleton and keeps a cleared document live', () => {
    const existing = makeNotebook({ xpointer0: '/2/4', xpointer1: '/2/4.0' });

    const result = upsertNotebookRecord([existing], '', 'epubcfi(/6/8)', 400, true)!;

    expect(result.booknotes).toHaveLength(1);
    expect(result.notebook).toEqual({
      ...existing,
      note: '',
      updatedAt: 400,
    });
  });

  it('revives the same tombstoned record and retains its identity and anchor', () => {
    const tombstone = makeNotebook({ note: '', deletedAt: 350 });

    const result = upsertNotebookRecord([tombstone], 'revived', 'epubcfi(/6/8)', 400, true)!;

    expect(result.booknotes).toHaveLength(1);
    expect(result.notebook).toEqual({
      ...tombstone,
      note: 'revived',
      updatedAt: 400,
      deletedAt: null,
    });
  });

  it('inserts into an empty document without surrounding blank lines', () => {
    expect(insertNotebookMarkdown('', '\n> quote\n\n', 0, 0)).toEqual({
      content: '> quote',
      insertedStart: 0,
      insertedEnd: 7,
    });
  });

  it('adds one blank line when appending at a caret', () => {
    expect(insertNotebookMarkdown('alpha', '> quote', 5, 5)).toEqual({
      content: 'alpha\n\n> quote',
      insertedStart: 7,
      insertedEnd: 14,
    });
  });

  it('replaces a selected range and returns the inserted selection', () => {
    expect(insertNotebookMarkdown('before selected after', '> quote', 7, 15)).toEqual({
      content: 'before \n\n> quote\n\n after',
      insertedStart: 9,
      insertedEnd: 16,
    });
  });

  it('uses CRLF separators when the document already uses CRLF', () => {
    expect(insertNotebookMarkdown('alpha\r\nbeta', '> quote', 5, 5)).toEqual({
      content: 'alpha\r\n\r\n> quote\r\n\r\nbeta',
      insertedStart: 9,
      insertedEnd: 16,
    });
  });
});
