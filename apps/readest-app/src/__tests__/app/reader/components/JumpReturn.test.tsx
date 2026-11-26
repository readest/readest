// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import JumpReturn from '@/app/reader/components/JumpReturn';

const h = vi.hoisted(() => {
  const view = Object.assign(new EventTarget(), {
    history: Object.assign(new EventTarget(), { canGoBack: true, canGoForward: false }),
  });
  return { view, store: { hoveredBookKey: '', bottomBarTab: '' } };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: unknown) => unknown) =>
    select({ getView: () => h.view, viewStates: { book1: {} }, ...h.store }),
}));

const jump = (from: string, to: string) =>
  act(() => {
    h.view.dispatchEvent(new CustomEvent('reader-jump', { detail: { from, to } }));
  });

afterEach(() => {
  cleanup();
  h.store.hoveredBookKey = '';
  h.store.bottomBarTab = '';
});

describe('JumpReturn label', () => {
  it('names the chapter it returns to', () => {
    render(<JumpReturn bookKey='book1' gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    jump('Chapter 1', 'Chapter 6');
    expect(screen.getByRole('button', { name: /^Go Back/ }).textContent).toBe(
      'Go Back · Chapter 1',
    );
  });

  it('leaves out the chapter when the jump stays in it', () => {
    render(<JumpReturn bookKey='book1' gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    jump('Chapter 6', 'Chapter 6');
    expect(screen.getByRole('button', { name: /^Go Back/ }).textContent).toBe('Go Back');
  });
});

describe('JumpReturn under a toolbar panel', () => {
  it('stays out of the way while a phone toolbar panel is open', () => {
    h.store.hoveredBookKey = 'book1';
    h.store.bottomBarTab = 'progress';
    render(<JumpReturn bookKey='book1' gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }} />);
    jump('Chapter 1', 'Chapter 6');
    expect(screen.queryByRole('group', { name: 'Navigation History' })).toBeNull();
  });
});
