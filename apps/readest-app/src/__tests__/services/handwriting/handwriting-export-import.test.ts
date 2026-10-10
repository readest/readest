import { describe, it, expect } from 'vitest';

import {
  buildAnnotationExport,
  parseAnnotationExport,
  READEST_ANNOTATION_FORMAT,
} from '@/services/annotation/providers/readest';
import { mergeImportedHandwriting } from '@/services/handwriting/persistence';
import { HANDWRITING_VERSION, type HandwritingDoc } from '@/services/handwriting/model';
import type { BooknoteGroup } from '@/types/book';

const stroke = (id: string) => ({
  id,
  color: '#1a1a1a',
  width: 0.004,
  points: [[0.1, 0.2] as [number, number]],
});

const ink = (pages: Record<string, { strokes: ReturnType<typeof stroke>[]; updatedAt: number }>) =>
  ({ version: HANDWRITING_VERSION, pages }) as HandwritingDoc;

const emptyGroup: BooknoteGroup = {
  id: 0,
  href: 'chapter1.xhtml',
  label: 'Chapter 1',
  booknotes: [],
};

const build = (handwriting?: HandwritingDoc) =>
  buildAnnotationExport({
    book: { title: 'Book', author: 'Author', hash: 'abc', format: 'EPUB' },
    groups: [emptyGroup],
    exportedAt: 7000,
    handwriting,
  });

describe('handwriting in the annotation export envelope', () => {
  it('carries ink verbatim alongside annotations', () => {
    const doc = ink({ 'pdf:1': { strokes: [stroke('s1')], updatedAt: 1000 } });
    const payload = build(doc);
    expect(payload.handwriting).toEqual(doc);
  });

  it('omits the key when there is no ink', () => {
    expect(build().handwriting).toBeUndefined();
    expect(build(ink({})).handwriting).toBeUndefined();
  });

  it('round-trips ink through the file format', () => {
    const doc = ink({
      'pdf:1': { strokes: [stroke('s1')], updatedAt: 1000 },
      'epub:ch2.xhtml': { strokes: [stroke('s2'), stroke('s3')], updatedAt: 2000 },
    });
    const parsed = parseAnnotationExport(JSON.stringify(build(doc)));
    expect(parsed?.handwriting).toEqual(doc);
  });

  it('imports a file that carries only handwriting', () => {
    const doc = ink({ 'pdf:3': { strokes: [stroke('s1')], updatedAt: 1000 } });
    const parsed = parseAnnotationExport(JSON.stringify(build(doc)));
    expect(parsed?.annotations).toEqual([]);
    expect(parsed?.handwriting).toEqual(doc);
  });

  it('accepts a v1 file with no handwriting key', () => {
    const parsed = parseAnnotationExport(
      JSON.stringify({
        $format: READEST_ANNOTATION_FORMAT,
        version: 1,
        exportedAt: 1,
        book: { title: 'B', author: 'A' },
        annotations: [],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.handwriting).toBeUndefined();
  });

  it('drops malformed strokes rather than failing the whole import', () => {
    const parsed = parseAnnotationExport(
      JSON.stringify({
        $format: READEST_ANNOTATION_FORMAT,
        version: 1,
        exportedAt: 1,
        book: { title: 'B', author: 'A' },
        annotations: [],
        handwriting: {
          version: HANDWRITING_VERSION,
          pages: {
            'pdf:1': {
              strokes: [
                { id: 'ok', color: '#000', width: 0.1, points: [[0.1, 0.1]] },
                { id: 'bad' },
              ],
              updatedAt: 1,
            },
          },
        },
      }),
    );
    expect(Object.keys(parsed?.handwriting?.pages ?? {})).toEqual(['pdf:1']);
    expect(parsed?.handwriting?.pages['pdf:1']?.strokes).toHaveLength(1);
  });
});

describe('mergeImportedHandwriting', () => {
  it('adds pages that are new to the book', () => {
    const merged = mergeImportedHandwriting(
      ink({ 'pdf:1': { strokes: [stroke('a')], updatedAt: 1000 } }),
      ink({ 'pdf:2': { strokes: [stroke('b')], updatedAt: 1000 } }),
    );
    expect(Object.keys(merged?.pages ?? {})).toEqual(['pdf:1', 'pdf:2']);
  });

  it('keeps local ink on pages the import does not mention', () => {
    const merged = mergeImportedHandwriting(
      ink({ 'pdf:1': { strokes: [stroke('mine')], updatedAt: 1000 } }),
      ink({ 'pdf:9': { strokes: [stroke('theirs')], updatedAt: 1000 } }),
    );
    expect(merged?.pages['pdf:1']?.strokes[0]?.id).toBe('mine');
    expect(merged?.pages['pdf:9']?.strokes[0]?.id).toBe('theirs');
  });

  it('replaces a page only when the imported copy is newer', () => {
    const older = mergeImportedHandwriting(
      ink({ 'pdf:1': { strokes: [stroke('theirs')], updatedAt: 500 } }),
      ink({ 'pdf:1': { strokes: [stroke('local')], updatedAt: 900 } }),
    );
    expect(older?.pages['pdf:1']?.strokes[0]?.id).toBe('local');

    const newer = mergeImportedHandwriting(
      ink({ 'pdf:1': { strokes: [stroke('local')], updatedAt: 900 } }),
      ink({ 'pdf:1': { strokes: [stroke('theirs')], updatedAt: 1500 } }),
    );
    expect(newer?.pages['pdf:1']?.strokes[0]?.id).toBe('theirs');
  });

  it('returns null when nothing would change, so the save is skipped', () => {
    const same = ink({ 'pdf:1': { strokes: [stroke('a')], updatedAt: 1000 } });
    expect(mergeImportedHandwriting(same, same)).toBeNull();
  });

  it('imports into a book that has no ink yet', () => {
    const merged = mergeImportedHandwriting(
      undefined,
      ink({ 'pdf:1': { strokes: [stroke('a')], updatedAt: 1 } }),
    );
    expect(Object.keys(merged?.pages ?? {})).toEqual(['pdf:1']);
  });
});
