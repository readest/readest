import { describe, it, expect } from 'vitest';
import {
  buildAnnotationIndex,
  selectLocationAnnotations,
} from '@/app/reader/utils/annotationIndex';
import { uniqueId } from '@/utils/misc';
import { BookNote } from '@/types/book';

describe('buildAnnotationIndex / selectLocationAnnotations', () => {
  const note = (overrides: Partial<BookNote>): BookNote => ({
    id: uniqueId(),
    type: 'annotation',
    cfi: 'epubcfi(/6/6!/4/2/2,/1:0,/1:10)',
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });

  // A relocate always reports a single-section location (foliate joins the
  // section base CFI with the in-document range), so the spine prefix keys
  // the bucket. `epubcfi(/6/6)` covers everything anchored in section /6/6.
  const location = 'epubcfi(/6/6)';

  it('buckets a styled annotation under its spine prefix', () => {
    const highlight = note({ style: 'highlight', color: 'yellow' });
    const { bySection, globals } = buildAnnotationIndex([highlight]);
    expect(bySection.get('/6/6')).toEqual([highlight]);
    expect(globals).toEqual([]);
  });

  it('buckets a note-only annotation (no style) so its bubble survives relocate', () => {
    // Regression: notes added via the Notebook flow carry a `note` but no
    // `style`/`color`. They must still be tracked so the note bubble is
    // re-applied on page turns, not just at section first-render.
    const noteOnly = note({ note: 'a margin note' });
    const { bySection } = buildAnnotationIndex([noteOnly]);
    expect(bySection.get('/6/6')).toEqual([noteOnly]);
  });

  it('splits styled global highlights into their own array', () => {
    const global = note({ style: 'highlight', color: 'yellow', text: 'x', global: true });
    const { bySection, globals } = buildAnnotationIndex([global]);
    expect(globals).toEqual([global]);
    expect(bySection.size).toBe(0);
  });

  it('skips deleted, non-annotation, and empty (no style, no note) entries', () => {
    const deleted = note({ style: 'highlight', deletedAt: 9 });
    const bookmark = note({ type: 'bookmark' });
    const empty = note({ note: '   ' });
    const { bySection, globals } = buildAnnotationIndex([deleted, bookmark, empty]);
    expect(bySection.size).toBe(0);
    expect(globals).toEqual([]);
  });

  it('skips an annotation deleted in place after the index was built (stale index)', () => {
    // #4773: the re-apply effect holds a memoized index. A quick delete stamps
    // `deletedAt` on the SAME object that is still sitting in the bucket (the
    // memo has not recomputed yet). If the read trusts the build-time filter,
    // the just-deleted highlight gets re-drawn and its overlay is orphaned —
    // visible on the page until the book is reopened. The read must re-check.
    const highlight = note({ style: 'highlight', color: 'yellow', note: 'hi' });
    const index = buildAnnotationIndex([highlight]);
    // The user deletes the highlight: `deletedAt` is stamped in place on the
    // booknote object that the stale index still references.
    highlight.deletedAt = 123;
    const { annotations, notes } = selectLocationAnnotations(index, location);
    expect(annotations).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('classifies a styled annotation into annotations only', () => {
    const highlight = note({ style: 'highlight', color: 'yellow' });
    const index = buildAnnotationIndex([highlight]);
    const { annotations, notes } = selectLocationAnnotations(index, location);
    expect(annotations).toEqual([highlight]);
    expect(notes).toEqual([]);
  });

  it('classifies a note-only annotation into notes only', () => {
    const noteOnly = note({ note: 'hello' });
    const index = buildAnnotationIndex([noteOnly]);
    const { annotations, notes } = selectLocationAnnotations(index, location);
    expect(annotations).toEqual([]);
    expect(notes).toEqual([noteOnly]);
  });

  it('classifies a styled+noted annotation into both lists', () => {
    const both = note({ style: 'highlight', color: 'yellow', note: 'hi' });
    const index = buildAnnotationIndex([both]);
    const { annotations, notes } = selectLocationAnnotations(index, location);
    expect(annotations).toEqual([both]);
    expect(notes).toEqual([both]);
  });

  it('excludes annotations anchored in a different section', () => {
    const other = note({ cfi: 'epubcfi(/6/8!/4/2/2,/1:0,/1:10)', style: 'highlight' });
    const index = buildAnnotationIndex([other]);
    const { annotations, notes } = selectLocationAnnotations(index, location);
    expect(annotations).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('returns empty lists for a null/empty location', () => {
    const index = buildAnnotationIndex([note({ style: 'highlight' })]);
    expect(selectLocationAnnotations(index, null)).toEqual({ annotations: [], notes: [] });
    expect(selectLocationAnnotations(index, '')).toEqual({ annotations: [], notes: [] });
  });
});
