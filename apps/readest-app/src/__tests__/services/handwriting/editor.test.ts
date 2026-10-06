import { describe, it, expect } from 'vitest';
import { HandwritingEditor } from '@/services/handwriting/editor';
import type { InkStroke } from '@/services/handwriting/model';

const s = (id: string, pts: [number, number][]): InkStroke => ({
  id,
  color: '#000',
  width: 0.004,
  points: pts.map(([x, y]) => [x, y]),
});

describe('HandwritingEditor', () => {
  it('adds strokes to the page', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0.1, 0.1],
        [0.2, 0.2],
      ]),
    );
    expect(ed.strokes('1').map((x) => x.id)).toEqual(['a']);
  });

  it('ignores empty strokes', () => {
    const ed = new HandwritingEditor();
    ed.addStroke('1', s('a', []));
    expect(ed.strokes('1')).toEqual([]);
  });

  it('undoes and redoes the last stroke', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.addStroke(
      '1',
      s('b', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.undo('1');
    expect(ed.strokes('1').map((x) => x.id)).toEqual(['a']);
    ed.redo('1');
    expect(ed.strokes('1').map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('clears redo history when a new stroke is added', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.undo('1');
    ed.addStroke(
      '1',
      s('b', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.redo('1');
    expect(ed.strokes('1').map((x) => x.id)).toEqual(['b']);
  });

  it('erases every stroke the eraser path touches and can undo the erase', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0.1, 0.5],
        [0.9, 0.5],
      ]),
    );
    ed.addStroke(
      '1',
      s('b', [
        [0.1, 0.9],
        [0.9, 0.9],
      ]),
    );
    const erased = ed.erase(
      '1',
      [
        [0.5, 0.45],
        [0.5, 0.55],
      ],
      0.02,
    );
    expect(erased).toBe(1);
    expect(ed.strokes('1').map((x) => x.id)).toEqual(['b']);
    ed.undo('1');
    expect(
      ed
        .strokes('1')
        .map((x) => x.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('does not erase strokes the eraser misses', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0.1, 0.5],
        [0.9, 0.5],
      ]),
    );
    expect(ed.erase('1', [[0.5, 0.8]], 0.02)).toBe(0);
  });

  it('clears a page and can undo the clear', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.clear('1');
    expect(ed.strokes('1')).toEqual([]);
    ed.undo('1');
    expect(ed.strokes('1').map((x) => x.id)).toEqual(['a']);
  });

  it('keeps pages independent', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.addStroke(
      '2',
      s('b', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.clear('1');
    expect(ed.strokes('2').map((x) => x.id)).toEqual(['b']);
  });

  it('exports and reloads a persisted document', () => {
    const ed = new HandwritingEditor();
    ed.addStroke(
      '1',
      s('a', [
        [0, 0],
        [1, 1],
      ]),
    );
    const reloaded = new HandwritingEditor(ed.toDocument());
    expect(reloaded.strokes('1').map((x) => x.id)).toEqual(['a']);
  });

  it('notifies listeners once per change', () => {
    const ed = new HandwritingEditor();
    let n = 0;
    ed.subscribe(() => n++);
    ed.addStroke(
      '1',
      s('a', [
        [0, 0],
        [1, 1],
      ]),
    );
    ed.undo('1');
    expect(n).toBe(2);
  });
});
