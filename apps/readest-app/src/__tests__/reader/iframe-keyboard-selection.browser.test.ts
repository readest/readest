import { describe, test, expect, afterEach } from 'vitest';
import { extendSelectionFromContents } from '@/utils/sel';

// Standard desktop selection shortcuts (#4728). The parent (where focus sits
// after a selection) extends the iframe selection via this helper. Selection.modify()
// needs a real layout engine, so this runs in the Chromium browser lane.

const iframes: HTMLIFrameElement[] = [];

// Render an isolated document in an iframe, the way foliate renders a section.
const renderSection = (bodyHtml: string) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = bodyHtml;
  return { doc, win: iframe.contentWindow! };
};

// Mimic a real left-to-right mouse drag: setBaseAndExtent establishes the
// anchor/focus directionality that Selection.modify() needs. (addRange() leaves
// the selection directionless, so backward modify() would silently no-op — a
// test artifact, not how a user-made selection behaves.)
const selectRange = (win: Window, node: Node, start: number, end: number) => {
  const sel = win.getSelection()!;
  sel.setBaseAndExtent(node, start, node, end);
  return sel;
};

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('extendSelectionFromContents (#4728)', () => {
  test('Shift+ArrowRight extends the selection by a character', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    const sel = selectRange(win, doc.querySelector('p')!.firstChild!, 0, 5); // "Hello"

    const handled = extendSelectionFromContents(
      [{ doc }],
      { key: 'ArrowRight', shiftKey: true },
      true,
    );

    expect(handled).toBe(true);
    expect(sel.toString().length).toBe(6);
    expect(sel.toString().startsWith('Hello')).toBe(true);
  });

  test('Ctrl+Shift+ArrowRight extends the selection by a word', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    const sel = selectRange(win, doc.querySelector('p')!.firstChild!, 0, 5); // "Hello"

    extendSelectionFromContents(
      [{ doc }],
      { key: 'ArrowRight', shiftKey: true, ctrlKey: true },
      true,
    );

    expect(sel.toString()).toContain('world');
    expect(sel.toString().length).toBeGreaterThan(6);
  });

  test('Alt(Option)+Shift+ArrowRight extends by a word (macOS modifier)', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    const sel = selectRange(win, doc.querySelector('p')!.firstChild!, 0, 5);

    extendSelectionFromContents(
      [{ doc }],
      { key: 'ArrowRight', shiftKey: true, altKey: true },
      true,
    );

    expect(sel.toString()).toContain('world');
  });

  test('Shift+ArrowLeft moves the active edge back by a character', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    const sel = selectRange(win, doc.querySelector('p')!.firstChild!, 0, 5); // "Hello"

    extendSelectionFromContents([{ doc }], { key: 'ArrowLeft', shiftKey: true }, true);

    expect(sel.toString()).toBe('Hell');
  });

  test('with extend=false it reports the selection but does not modify it', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    const sel = selectRange(win, doc.querySelector('p')!.firstChild!, 0, 5);

    // Mirrors the iframe-focused case: the browser already extended natively, so
    // the parent only needs to confirm a selection exists (to suppress nav).
    const handled = extendSelectionFromContents(
      [{ doc }],
      { key: 'ArrowRight', shiftKey: true },
      false,
    );

    expect(handled).toBe(true);
    expect(sel.toString()).toBe('Hello'); // unchanged
  });

  test('returns false when no selection is active so navigation still works', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    win.getSelection()!.removeAllRanges();

    const handled = extendSelectionFromContents(
      [{ doc }],
      { key: 'ArrowRight', shiftKey: true },
      true,
    );

    expect(handled).toBe(false);
  });

  test('returns false when Meta/Cmd is held (reserved for native line selection)', () => {
    const { doc, win } = renderSection('<p>Hello world from Readest</p>');
    const sel = selectRange(win, doc.querySelector('p')!.firstChild!, 0, 5);

    const handled = extendSelectionFromContents(
      [{ doc }],
      { key: 'ArrowRight', shiftKey: true, metaKey: true },
      true,
    );

    expect(handled).toBe(false);
    expect(sel.toString()).toBe('Hello');
  });

  test('finds the selection across multiple rendered section documents', () => {
    const a = renderSection('<p>First section</p>');
    const b = renderSection('<p>Second section</p>');
    a.win.getSelection()!.removeAllRanges();
    const sel = selectRange(b.win, b.doc.querySelector('p')!.firstChild!, 0, 6); // "Second"

    const handled = extendSelectionFromContents(
      [{ doc: a.doc }, { doc: b.doc }],
      { key: 'ArrowRight', shiftKey: true, ctrlKey: true },
      true,
    );

    expect(handled).toBe(true);
    expect(sel.toString()).toContain('section');
  });
});
