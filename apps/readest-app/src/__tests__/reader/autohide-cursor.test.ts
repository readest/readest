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

beforeAll(async () => {
  await import('foliate-js/view.js');
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
