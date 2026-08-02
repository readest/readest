import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { BookNote } from '@/types/book';
import {
  convertAnnotationExportToBookNotes,
  parseAnnotationExport,
  type ReadestAnnotationExport,
} from '@/services/annotation/providers/readest';

/**
 * End-to-end anchor matching against a real EPUB and a real exported file.
 *
 * `alice-annotations.json` is a trimmed slice of an actual Readest export
 * (Alice's Adventures in Wonderland, the same edition as the sample EPUB
 * fixture). It is kept because synthetic DOM fixtures encoded the same wrong
 * assumptions as the implementation and so could not catch the bookmark bug
 * below — only real annotation data did.
 *
 * The slice keeps every bookmark and excerpt, every note-bearing annotation,
 * a spread of plain highlights, and the two entries that legitimately fail to
 * verify.
 */
describe('importing a real Readest export into the book it came from', () => {
  let bookDoc: BookDoc;
  let payload: ReadestAnnotationExport;

  beforeAll(async () => {
    const buffer = readFileSync(resolve(__dirname, '../fixtures/data/sample-alice.epub'));
    const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
    ({ book: bookDoc } = await new DocumentLoader(file).open());

    const json = readFileSync(
      resolve(__dirname, '../fixtures/data/alice-annotations.json'),
      'utf-8',
    );
    payload = parseAnnotationExport(json)!;
  }, 60000);

  const convert = () => convertAnnotationExportToBookNotes(payload, bookDoc);
  const byId = (notes: BookNote[]) => new Map(notes.map((n) => [n.id, n]));

  it('parses the real export without dropping any entry', () => {
    expect(payload).not.toBeNull();
    expect(payload.book.title).toBe("Alice's Adventures in Wonderland");
    expect(payload.annotations).toHaveLength(24);
  });

  it('places every entry whose text is genuinely still in the book', async () => {
    const result = await convert();
    expect(result.total).toBe(24);
    expect(result.notes).toHaveLength(23);
    expect(result.reanchored).toBe(1);
    expect(result.unmatched).toBe(1);
  });

  it('leaves every verified annotation on its original CFI', async () => {
    const result = await convert();
    const notes = byId(result.notes);
    const moved = payload.annotations
      .filter((entry) => notes.has(entry.id) && notes.get(entry.id)!.cfi !== entry.cfi)
      .map((entry) => entry.id);
    // Only the chapter-heading entry below should ever move.
    expect(moved).toEqual(['9082665']);
  });

  /**
   * Regression for the bookmark rule. A bookmark's `text` is a display snippet
   * of the surrounding paragraph, not an anchor assertion: these six include
   * collapsed point CFIs that cover no text at all, snippets truncated
   * mid-sentence, and one whose text is the chapter label "in Chapter 9 - The
   * Mock Turtle's Story" rather than anything in the book. Verifying bookmarks
   * against their text dropped three of them and relocated two more.
   */
  it('keeps all six real bookmarks exactly where they were', async () => {
    const result = await convert();
    const notes = byId(result.notes);
    const bookmarks = payload.annotations.filter((entry) => entry.type === 'bookmark');
    expect(bookmarks).toHaveLength(6);
    for (const bookmark of bookmarks) {
      expect(notes.get(bookmark.id)?.cfi).toBe(bookmark.cfi);
    }
  });

  it('re-anchors the heading whose stored text disagrees with its own CFI', async () => {
    const result = await convert();
    const entry = payload.annotations.find((a) => a.id === '9082665')!;
    const note = byId(result.notes).get('9082665')!;
    // The stored CFI covers "hapter 2\nThe Pool" while the note's text is
    // "The Pool of Tears", so it is re-anchored to where that text really is.
    expect(entry.text).toBe('The Pool of Tears');
    expect(note.cfi).not.toBe(entry.cfi);
  });

  it('drops the annotation anchored to translator-injected text', async () => {
    const result = await convert();
    // This highlight sits on a Chinese paragraph inserted by Parallel Read;
    // that text exists only in the rendered view, never in the book file, so
    // no portable anchor can be recovered for it.
    const entry = payload.annotations.find((a) => a.id === 'xmkgmpg')!;
    expect(entry.text).toContain('猫说');
    expect(byId(result.notes).has('xmkgmpg')).toBe(false);
  });

  it('is idempotent: converting the same file twice yields identical anchors', async () => {
    const first = await convert();
    const second = await convert();
    expect(second.notes).toEqual(first.notes);
    expect(second.reanchored).toBe(first.reanchored);
    expect(second.unmatched).toBe(first.unmatched);
  });
});
