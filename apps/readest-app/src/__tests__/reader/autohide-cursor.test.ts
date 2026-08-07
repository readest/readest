import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// Pins the foliate-js CursorAutohider contract the reader wiring relies on
// (readest#5178): the `autohide-cursor` attribute on <foliate-view> arms a
// 1s idle timer that hides the cursor; mousemove events with unchanged
// screen coordinates (the synthetic ones browsers fire when content scrolls
// or pages turn under a stationary pointer) must not reveal it.

const IDLE_HIDE_MS = 1000;

const createView = (): HTMLElement => document.createElement('foliate-view');

const move = (el: HTMLElement, screenX: number, screenY: number) =>
  el.dispatchEvent(new MouseEvent('mousemove', { screenX, screenY }));

const selectText = () => {
  const paragraph = document.createElement('p');
  paragraph.textContent = 'a selected passage';
  document.body.appendChild(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

beforeAll(async () => {
  await import('foliate-js/view.js');
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('foliate-view autohide-cursor', () => {
  test('hides the cursor after idle when the attribute is set', () => {
    const view = createView();
    view.setAttribute('autohide-cursor', '');

    move(view, 5, 5);
    expect(view.style.cursor).not.toBe('none');

    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).toBe('none');
  });

  test('stays hidden on mousemove with unchanged coordinates (scroll / page turn)', () => {
    const view = createView();
    view.setAttribute('autohide-cursor', '');

    move(view, 5, 5);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).toBe('none');

    move(view, 5, 5);
    expect(view.style.cursor).toBe('none');
  });

  test('reappears when the pointer actually moves', () => {
    const view = createView();
    view.setAttribute('autohide-cursor', '');

    move(view, 5, 5);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).toBe('none');

    move(view, 6, 9);
    expect(view.style.cursor).not.toBe('none');
  });

  test('keeps the cursor visible while a selection is active', () => {
    const view = createView();
    view.setAttribute('autohide-cursor', '');

    // Arm the idle timer, then select without moving again: double-click and
    // keyboard word selection fire no further mousemove.
    move(view, 5, 5);
    selectText();
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).not.toBe('none');

    // A paused selection drag re-arms the timer while the selection stands.
    move(view, 6, 9);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).not.toBe('none');
  });

  test('hides again once the selection is cleared', () => {
    const view = createView();
    view.setAttribute('autohide-cursor', '');

    move(view, 5, 5);
    selectText();
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).not.toBe('none');

    document.getSelection()!.removeAllRanges();
    move(view, 6, 9);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).toBe('none');
  });

  test('never hides without the attribute', () => {
    const view = createView();

    move(view, 5, 5);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).not.toBe('none');
  });

  test('removing the attribute at runtime disarms hiding', () => {
    const view = createView();
    view.setAttribute('autohide-cursor', '');

    move(view, 5, 5);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).toBe('none');

    view.removeAttribute('autohide-cursor');
    move(view, 6, 9);
    expect(view.style.cursor).not.toBe('none');

    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(view.style.cursor).not.toBe('none');
  });
});
