import { describe, it, expect } from 'vitest';

import { HandwritingEditor } from '@/services/handwriting/editor';
import { simplifyHandwriting, type HandwritingDoc } from '@/services/handwriting/model';

const ink = (points: [number, number][], updatedAt = 1) => ({
  strokes: [{ id: 's', color: '#000', width: 0.004, points }],
  updatedAt,
});

describe('simplifyHandwriting', () => {
  it('drops points that sit on the line between their neighbours', () => {
    const straight: [number, number][] = [];
    for (let i = 0; i <= 100; i++) straight.push([i / 100, 0.5]);
    const doc: HandwritingDoc = { version: 1, pages: { 'pdf:1': ink(straight) } };

    const out = simplifyHandwriting(doc);
    // A perfectly straight line needs only its endpoints.
    expect(out.pages['pdf:1']?.strokes[0]?.points).toHaveLength(2);
    expect(out.pages['pdf:1']?.strokes[0]?.points[0]).toEqual([0, 0.5]);
    expect(out.pages['pdf:1']?.strokes[0]?.points[1]).toEqual([1, 0.5]);
  });

  it('keeps corners, which carry the shape of the stroke', () => {
    // right, down, right — every interior point is a genuine corner, so a
    // correct simplifier keeps all four.
    const corner: [number, number][] = [
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [1, 0.5],
    ];
    const doc: HandwritingDoc = { version: 1, pages: { 'pdf:1': ink(corner) } };

    const out = simplifyHandwriting(doc);
    expect(out.pages['pdf:1']?.strokes[0]?.points).toHaveLength(4);
  });

  it('drops the middle of a straight run between two corners', () => {
    // The collinear midpoint adds nothing to the shape.
    const withMidpoint: [number, number][] = [
      [0, 0],
      [0.25, 0],
      [0.5, 0],
      [0.5, 0.5],
    ];
    const doc: HandwritingDoc = { version: 1, pages: { 'pdf:1': ink(withMidpoint) } };

    const out = simplifyHandwriting(doc);
    expect(out.pages['pdf:1']?.strokes[0]?.points).toHaveLength(3);
  });

  it('never drops a stroke of one or two points', () => {
    const doc: HandwritingDoc = {
      version: 1,
      pages: {
        'pdf:1': {
          strokes: [{ id: 'a', color: '#000', width: 0.004, points: [[0.5, 0.5]] }],
          updatedAt: 1,
        },
        'pdf:2': {
          strokes: [
            {
              id: 'b',
              color: '#000',
              width: 0.004,
              points: [
                [0.1, 0.1],
                [0.2, 0.2],
              ],
            },
          ],
          updatedAt: 1,
        },
      },
    };
    expect(simplifyHandwriting(doc)).toBe(doc);
  });

  it('returns the same object when nothing changed, so callers can skip a rewrite', () => {
    const doc: HandwritingDoc = {
      version: 1,
      pages: {
        'pdf:1': ink([
          [0.1, 0.1],
          [0.9, 0.9],
        ]),
      },
    };
    expect(simplifyHandwriting(doc)).toBe(doc);
  });

  it('preserves stroke ids, colors, widths and timestamps', () => {
    const doc: HandwritingDoc = {
      version: 1,
      pages: {
        'pdf:1': {
          strokes: [
            {
              id: 'keep-me',
              color: '#1f6feb',
              width: 0.008,
              points: [
                [0, 0],
                [0.5, 0.5],
                [1, 0],
              ],
            },
          ],
          updatedAt: 4242,
        },
      },
    };
    const stroke = simplifyHandwriting(doc).pages['pdf:1']!.strokes[0]!;
    expect(stroke.id).toBe('keep-me');
    expect(stroke.color).toBe('#1f6feb');
    expect(stroke.width).toBe(0.008);
    expect(simplifyHandwriting(doc).pages['pdf:1']?.updatedAt).toBe(4242);
  });

  it('keeps pressure on retained samples', () => {
    const doc: HandwritingDoc = {
      version: 1,
      pages: {
        'pdf:1': {
          strokes: [
            {
              id: 's',
              color: '#000',
              width: 0.004,
              points: [
                [0, 0.5, 0.1],
                [0.5, 0.5, 0.9],
                [1, 0.5, 0.4],
              ],
            },
          ],
          updatedAt: 1,
        },
      },
    };
    const out = simplifyHandwriting(doc);
    expect(out.pages['pdf:1']?.strokes[0]?.points).toHaveLength(2);
    expect(out.pages['pdf:1']?.strokes[0]?.points[0]).toEqual([0, 0.5, 0.1]);
  });

  it('handles a long stroke without overflowing the stack', () => {
    // Recursive RDP would nest deeply on this; the iterative version must not.
    const many: [number, number][] = [];
    for (let i = 0; i < 20000; i++) many.push([i / 20000, i % 2 === 0 ? 0.5 : 0.5001]);
    const doc: HandwritingDoc = { version: 1, pages: { 'pdf:1': ink(many) } };
    expect(() => simplifyHandwriting(doc)).not.toThrow();
  });

  it('shrinks a realistically noisy stroke', () => {
    const noisy: [number, number][] = [];
    for (let i = 0; i < 2000; i++) noisy.push([i / 2000, 0.5 + Math.sin(i) * 0.0004]);
    const doc: HandwritingDoc = { version: 1, pages: { 'pdf:1': ink(noisy) } };
    const out = simplifyHandwriting(doc);
    const kept = out.pages['pdf:1']!.strokes[0]!.points.length;
    expect(kept).toBeLessThan(noisy.length);
    expect(kept).toBeGreaterThanOrEqual(2);
  });
});

describe('editor.restylePage', () => {
  it('repaints every stroke on the page in one undoable step', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('pdf:1', { id: 'a', color: '#000', width: 0.004, points: [[0.1, 0.1]] });
    editor.addStroke('pdf:1', { id: 'b', color: '#000', width: 0.004, points: [[0.2, 0.2]] });

    expect(editor.restylePage('pdf:1', { color: '#1f6feb', width: 0.008 })).toBe(true);
    for (const stroke of editor.strokes('pdf:1')) {
      expect(stroke.color).toBe('#1f6feb');
      expect(stroke.width).toBe(0.008);
    }

    // One undo reverts the whole restyle, not one stroke at a time.
    editor.undo('pdf:1');
    expect([...editor.strokes('pdf:1')].every((s) => s.color === '#000')).toBe(true);
    expect(editor.strokes('pdf:1')).toHaveLength(2);
  });

  it('leaves other pages alone', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('pdf:1', { id: 'a', color: '#000', width: 0.004, points: [[0.1, 0.1]] });
    editor.addStroke('pdf:2', { id: 'b', color: '#000', width: 0.004, points: [[0.2, 0.2]] });

    editor.restylePage('pdf:1', { color: '#15803d', width: 0.004 });
    expect(editor.strokes('pdf:1')[0]?.color).toBe('#15803d');
    expect(editor.strokes('pdf:2')[0]?.color).toBe('#000');
  });

  it('reports no change for an empty page', () => {
    expect(new HandwritingEditor().restylePage('pdf:9', { color: '#000', width: 0.004 })).toBe(
      false,
    );
  });

  it('reports no change when the page already uses that pen', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('pdf:1', { id: 'a', color: '#c2410c', width: 0.008, points: [[0.1, 0.1]] });
    expect(editor.restylePage('pdf:1', { color: '#c2410c', width: 0.008 })).toBe(false);

    // addStroke left one undo entry; a no-op restyle must not add another, so
    // the single undo unwinds the add rather than being swallowed by a no-op.
    editor.undo('pdf:1');
    expect(editor.strokes('pdf:1')).toHaveLength(0);
  });
});
