import { describe, it, expect } from 'vitest';
import {
  HANDWRITING_VERSION,
  emptyHandwriting,
  parseHandwriting,
  serializeHandwriting,
  type InkStroke,
} from '@/services/handwriting/model';

const stroke = (id: string): InkStroke => ({
  id,
  color: '#000000',
  width: 0.004,
  points: [
    [0.12, 0.33, 0.5],
    [0.13, 0.34, 0.55],
  ],
});

describe('handwriting model', () => {
  it('round-trips through serialize/parse', () => {
    const doc = emptyHandwriting();
    doc.pages['3'] = { strokes: [stroke('a'), stroke('b')], updatedAt: 10 };
    expect(parseHandwriting(serializeHandwriting(doc))).toEqual(doc);
  });

  it('stamps the current schema version', () => {
    expect(emptyHandwriting().version).toBe(HANDWRITING_VERSION);
  });

  it('returns an empty document for missing or malformed input', () => {
    expect(parseHandwriting(undefined)).toEqual(emptyHandwriting());
    expect(parseHandwriting('not json')).toEqual(emptyHandwriting());
    expect(parseHandwriting('{"pages":5}')).toEqual(emptyHandwriting());
  });

  it('rejects documents from a newer schema instead of misreading them', () => {
    const future = JSON.stringify({ version: HANDWRITING_VERSION + 1, pages: {} });
    expect(parseHandwriting(future)).toBeNull();
  });

  it('drops malformed strokes and points but keeps valid ones', () => {
    const raw = JSON.stringify({
      version: 1,
      pages: {
        '0': {
          updatedAt: 1,
          strokes: [
            stroke('ok'),
            { id: 'bad', color: '#000', width: 0.01, points: [[1]] },
            { id: 'nan', color: '#000', width: 0.01, points: [[0.1, null, 0.5]] },
          ],
        },
      },
    });
    const doc = parseHandwriting(raw)!;
    expect(doc.pages['0']!.strokes.map((s) => s.id)).toEqual(['ok']);
  });

  it('treats a missing pressure as absent, not zero', () => {
    const raw = JSON.stringify({
      version: 1,
      pages: {
        '0': {
          updatedAt: 1,
          strokes: [{ id: 's', color: '#000', width: 0.01, points: [[0.1, 0.2]] }],
        },
      },
    });
    expect(parseHandwriting(raw)!.pages['0']!.strokes[0]!.points[0]).toEqual([0.1, 0.2]);
  });
});
