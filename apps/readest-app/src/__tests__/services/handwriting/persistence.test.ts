import { describe, it, expect } from 'vitest';
import { loadHandwritingEditor, withHandwriting } from '@/services/handwriting/persistence';
import { HANDWRITING_VERSION } from '@/services/handwriting/model';
import type { BookConfig } from '@/types/book';

const base: BookConfig = { updatedAt: 1, location: 'epubcfi(/6/2)', booknotes: [] };

describe('handwriting persistence', () => {
  it('loads an empty editor from a config that predates handwriting', () => {
    const ed = loadHandwritingEditor(base)!;
    expect(ed.strokes('0')).toEqual([]);
  });

  it('saves into the config without touching other fields', () => {
    const ed = loadHandwritingEditor(base)!;
    ed.addStroke('0', {
      id: 'a',
      color: '#000',
      width: 0.004,
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
    });
    const saved = withHandwriting(base, ed);
    expect(saved.location).toBe(base.location);
    expect(saved.booknotes).toBe(base.booknotes);
    expect(saved.handwriting?.version).toBe(HANDWRITING_VERSION);
  });

  it('reloads what was saved, surviving a JSON round trip', () => {
    const ed = loadHandwritingEditor(base)!;
    ed.addStroke('7', {
      id: 'a',
      color: '#123456',
      width: 0.004,
      points: [
        [0.1, 0.1, 0.5],
        [0.2, 0.2, 0.6],
      ],
    });
    const saved = JSON.parse(JSON.stringify(withHandwriting(base, ed))) as BookConfig;
    expect(loadHandwritingEditor(saved)!.strokes('7')[0]!.color).toBe('#123456');
  });

  it('does not add an empty handwriting field when there is no ink', () => {
    expect(withHandwriting(base, loadHandwritingEditor(base)!).handwriting).toBeUndefined();
  });

  it('refuses to load ink written by a newer schema so it is never overwritten', () => {
    const future = { ...base, handwriting: { version: HANDWRITING_VERSION + 1, pages: {} } };
    expect(loadHandwritingEditor(future)).toBeNull();
  });
});
