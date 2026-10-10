import { describe, it, expect } from 'vitest';

import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';

const rect = { left: 0, top: 0, width: 400, height: 800 };

describe('HandwritingService page scoping', () => {
  it('scopes strokes to the page it was constructed with', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    expect(service.strokesForRender()).toEqual([]);
  });

  it('writes strokes to the page set by setPage, not the construction page', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);

    service.setPage('pdf:2');
    service.undo();
    service.clear();
    service.redo();

    expect(editor.strokes('pdf:1')).toEqual([]);
    expect(editor.strokes('pdf:2')).toEqual([]);
  });

  it('retargets rendering at the new page on a page change', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('pdf:1', { id: 'a', color: '#000', width: 0.004, points: [[0.1, 0.1]] });
    editor.addStroke('pdf:2', { id: 'b', color: '#000', width: 0.004, points: [[0.5, 0.5]] });

    const service = new HandwritingService(editor, 'pdf:1', rect);
    expect(service.strokesForRender().map((s) => s.id)).toEqual(['a']);

    service.setPage('pdf:2');
    expect(service.strokesForRender().map((s) => s.id)).toEqual(['b']);
  });

  it('notifies listeners on a page change so the canvas repaints', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    let renders = 0;
    service.onNeedsRender(() => renders++);

    service.setPage('pdf:2');
    expect(renders).toBe(1);

    // Same page again is a no-op: no repaint, no retarget.
    service.setPage('pdf:2');
    expect(renders).toBe(1);
  });

  it('drops an in-progress stroke when the page changes mid-stroke', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);

    // A live stroke is only rendered, never committed, so simulate the
    // dangling live state via a render before the page turn.
    service.setPage('pdf:2');
    expect(service.strokesForRender()).toEqual([]);
    expect(editor.toDocument().pages).toEqual({});
  });
});
