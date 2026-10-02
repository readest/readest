import { describe, it, expect, vi } from 'vitest';
import {
  expandGlobalAnnotation,
  removeGlobalAnnotationOverlays,
} from '@/app/reader/utils/globalAnnotations';
import {
  applyNoteBubbleTransition,
  removeBookNoteOverlays,
} from '@/app/reader/utils/annotatorUtil';
import { BookNote } from '@/types/book';
import { FoliateView, NOTE_PREFIX } from '@/types/view';

/**
 * Regression coverage for issue #4575: highlighting recurring character names
 * (global annotations) made page turning very laggy. The `progress` effect
 * re-fans-out every global annotation across every rendered section on EVERY
 * page turn. Because the overlays are already drawn, re-walking the DOM and
 * re-computing `view.getCFI()` for every occurrence is pure wasted work — the
 * dominant per-page-turn cost on books with frequent highlighted words.
 *
 * `expandGlobalAnnotation` must therefore be idempotent: expanding the same
 * note into the same (already-expanded) section a second time must do no work.
 */

const note = (overrides: Partial<BookNote>): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'home-cfi',
  note: '',
  text: 'foo',
  style: 'highlight',
  color: 'yellow',
  global: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** A jsdom section document where `text` recurs `count` times. */
const makeDoc = (needle: string, count: number): Document => {
  const doc = document.implementation.createHTMLDocument('section');
  const body = Array.from({ length: count }, () => `${needle} `).join('gap ');
  doc.body.innerHTML = `<p>${body}</p>`;
  return doc;
};

type FakeView = FoliateView & { getCfiCalls: number };

/**
 * Minimal stand-in for the foliate view. `getCFI` returns a unique value per
 * call (so it never collides with the note's home anchor) and counts how many
 * times it ran — our proxy for the expensive per-occurrence work a page turn
 * would repeat.
 */
const makeView = (docs: Document[]): FakeView => {
  const overlayer = { add: vi.fn(), remove: vi.fn() };
  const view = {
    getCfiCalls: 0,
    renderer: {
      getContents: () => docs.map((doc, index) => ({ index, doc, overlayer })),
    },
    getCFI(_index: number, _range: Range) {
      this.getCfiCalls += 1;
      return `cfi-${this.getCfiCalls}`;
    },
    dispatchEvent: () => true,
  };
  return view as unknown as FakeView;
};

describe('expandGlobalAnnotation idempotency (issue #4575)', () => {
  it('expands every occurrence on first call for a section', () => {
    const doc = makeDoc('foo', 3);
    const view = makeView([doc]);
    const added = expandGlobalAnnotation(view, note({}), doc, 0);
    expect(added).toHaveLength(3);
    expect(view.getCfiCalls).toBe(3);
  });

  it('does NO work when re-expanding the same note into the same section', () => {
    const doc = makeDoc('foo', 3);
    const view = makeView([doc]);
    const n = note({ id: 'same-note' });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(view.getCfiCalls).toBe(3);

    // Second pass simulates the next page turn — overlays already exist.
    const added2 = expandGlobalAnnotation(view, n, doc, 0);
    expect(added2).toEqual([]);
    expect(view.getCfiCalls).toBe(3); // unchanged: no re-walk, no re-getCFI
  });

  it('re-expands when the note content changes (edit/recolor bumps updatedAt)', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const n = note({ id: 'edited-note', updatedAt: 10 });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(view.getCfiCalls).toBe(2);
    const added = expandGlobalAnnotation(view, { ...n, updatedAt: 11 }, doc, 0);
    expect(added).toHaveLength(2);
    expect(view.getCfiCalls).toBe(4);
  });

  it('re-expands after overlays are removed (toggle global off then on)', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const n = note({ id: 'retoggle-note' });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(view.getCfiCalls).toBe(2);

    // Toggle off: overlays torn down and the memo cleared.
    removeGlobalAnnotationOverlays(view, n);

    // Toggle back on with identical content — must re-fan-out, not short-circuit.
    const added = expandGlobalAnnotation(view, n, doc, 0);
    expect(added).toHaveLength(2);
    expect(view.getCfiCalls).toBe(4);
  });

  it('re-expands into a freshly rendered section (different doc)', () => {
    const docA = makeDoc('foo', 2);
    const docB = makeDoc('foo', 2);
    const view = makeView([docA, docB]);
    const n = note({ id: 'multi-section' });
    expandGlobalAnnotation(view, n, docA, 0);
    const addedB = expandGlobalAnnotation(view, n, docB, 1);
    expect(addedB).toHaveLength(2);
    expect(view.getCfiCalls).toBe(4); // 2 per distinct section
  });
});

/**
 * Issue #6186: a note on a global annotation (e.g. a character name) must be
 * reachable from every occurrence, so each fan-out copy carries the note
 * bubble too, not only the home anchor.
 */
describe('global annotation note bubbles (issue #6186)', () => {
  const makeDrawingView = (docs: Document[]) => {
    const overlayer = { add: vi.fn(), remove: vi.fn() };
    const drawn: string[] = [];
    let calls = 0;
    const view = {
      renderer: {
        getContents: () => docs.map((doc, index) => ({ index, doc, overlayer })),
      },
      getCFI: () => `cfi-${++calls}`,
      addAnnotation: vi.fn(),
      dispatchEvent: (event: CustomEvent) => {
        drawn.push(event.detail.annotation.value);
        return true;
      },
    };
    return { view: view as unknown as FoliateView, overlayer, drawn };
  };
  const bubbles = (values: string[]) => values.filter((v) => v.startsWith(NOTE_PREFIX));

  it('draws a note bubble on every occurrence of a global note', () => {
    const doc = makeDoc('Thorin', 3);
    const { view, drawn } = makeDrawingView([doc]);
    const added = expandGlobalAnnotation(
      view,
      note({ id: 'with-note', text: 'Thorin', note: 'Dwarf king' }),
      doc,
      0,
    );
    expect(bubbles(added)).toHaveLength(3);
    expect(bubbles(drawn)).toHaveLength(3);
  });

  it('draws no bubbles for a global highlight without a note', () => {
    const doc = makeDoc('Thorin', 3);
    const { view, drawn } = makeDrawingView([doc]);
    expandGlobalAnnotation(view, note({ id: 'no-note', text: 'Thorin' }), doc, 0);
    expect(bubbles(drawn)).toHaveLength(0);
  });

  it('removes the fan-out bubbles along with the highlights', () => {
    const doc = makeDoc('Thorin', 2);
    const { view, overlayer } = makeDrawingView([doc]);
    const n = note({ id: 'remove-note', text: 'Thorin', note: 'Dwarf king' });
    const added = expandGlobalAnnotation(view, n, doc, 0);
    removeGlobalAnnotationOverlays(view, n);
    const removed = overlayer.remove.mock.calls.map(([value]) => value);
    for (const value of added) expect(removed).toContain(value);
  });

  it('adds bubbles to the copies when a note is written on a global highlight', () => {
    const doc = makeDoc('Thorin', 2);
    const { view, drawn } = makeDrawingView([doc]);
    const n = note({ id: 'add-note', text: 'Thorin', updatedAt: 1 });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(bubbles(drawn)).toHaveLength(0);

    applyNoteBubbleTransition([view], { ...n, note: 'Dwarf king', updatedAt: 2 }, 'add');
    expect(bubbles(drawn)).toHaveLength(2);
  });

  it("removes the copies' bubbles when the note is cleared", () => {
    const doc = makeDoc('Thorin', 2);
    const { view, overlayer } = makeDrawingView([doc]);
    const n = note({ id: 'clear-note', text: 'Thorin', note: 'Dwarf king', updatedAt: 1 });
    const added = expandGlobalAnnotation(view, n, doc, 0);

    applyNoteBubbleTransition([view], { ...n, note: '', updatedAt: 2 }, 'remove');
    const removed = overlayer.remove.mock.calls.map(([value]) => value);
    for (const value of bubbles(added)) expect(removed).toContain(value);
  });

  it('removes the copies when a global note is deleted', () => {
    const doc = makeDoc('Thorin', 2);
    const { view, overlayer } = makeDrawingView([doc]);
    const n = note({ id: 'delete-note', text: 'Thorin', note: 'Dwarf king' });
    const added = expandGlobalAnnotation(view, n, doc, 0);

    removeBookNoteOverlays(view, n);
    const removed = overlayer.remove.mock.calls.map(([value]) => value);
    for (const value of added) expect(removed).toContain(value);
  });
});
