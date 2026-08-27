/**
 * The scope banner.
 *
 * Settings panels write the global defaults or the values of the open book.
 * `viewSettings.isGlobal` always decided which one. But the flag stayed behind
 * one checkmark in the overflow menu. The default is global. A font that the
 * reader sets with a book open thus goes to all books. A reader who flips the
 * checkmark gets the opposite result, and the change then stays with one book.
 * The screen shows neither state.
 *
 * Read this note before you trust the mock. `setBookScope` REPLACES the
 * view-settings object, but `applyViewSettings` sends the same reference
 * through. The mock also ignores a selector argument. This file thus cannot
 * show that the full subscription is necessary. It shows only what the banner
 * renders for a given scope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { MdOutlineMenuBook, MdOutlinePublic } from 'react-icons/md';

const h = await vi.hoisted(async () => {
  const { create: createStore } = await import('zustand');
  return {
    readerMock: createStore(() => ({
      viewStates: {} as Record<string, { viewSettings: Record<string, unknown> } | undefined>,
    })),
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => {
    const viewStates = h.readerMock((s) => s.viewStates);
    return {
      getViewSettings: (key: string) => viewStates[key]?.viewSettings,
    };
  },
}));

import SettingsScopeBanner from '@/components/settings/SettingsScopeBanner';

const setBookScope = (isGlobal: boolean) =>
  h.readerMock.setState({ viewStates: { 'book-1': { viewSettings: { isGlobal } } } });

const show = (bookKey: string, alwaysGlobal = false) =>
  render(<SettingsScopeBanner bookKey={bookKey} alwaysGlobal={alwaysGlobal} />);

// The icon and the words are the only signals that stay on e-ink, because
// `eink-bordered` removes the tint and the coloured edge. react-icons puts no
// name in the DOM. Thus compare the path data with the same icon rendered
// alone.
const iconOf = (el: Element | null) =>
  Array.from(el?.querySelectorAll('path') ?? [])
    .map((path) => path.getAttribute('d'))
    .join('|');

const iconIs = (Icon: React.ComponentType) => {
  const { container, unmount } = render(<Icon />);
  const drawn = iconOf(container);
  unmount();
  return drawn;
};

describe('SettingsScopeBanner', () => {
  beforeEach(() => {
    h.readerMock.setState({ viewStates: {} });
  });
  afterEach(cleanup);

  it('says the change reaches every book, in global scope', () => {
    setBookScope(true);
    show('book-1');

    expect(screen.getByText('Global Settings')).toBeTruthy();
  });

  it('says it overrides the global, in book scope', () => {
    setBookScope(false);
    show('book-1');

    expect(screen.getByText('This Book — Overrides Global Settings')).toBeTruthy();
  });

  it('reads the store on each render, so a later scope change reaches it', () => {
    setBookScope(true);
    show('book-1');

    act(() => setBookScope(false));

    expect(screen.getByText('This Book — Overrides Global Settings')).toBeTruthy();
  });

  it('defaults to global for a book that has never been scoped', () => {
    // The view settings of the book hold no `isGlobal`. The factory default is
    // global. The banner must thus not report that such a book holds its own
    // values.
    h.readerMock.setState({ viewStates: { 'book-1': { viewSettings: {} } } });
    show('book-1');

    expect(screen.getByText('Global Settings')).toBeTruthy();
  });

  it('reads global in the library, where there is no book', () => {
    show('');

    expect(screen.getByText('Global Settings')).toBeTruthy();
  });

  /**
   * Integrations and AI hold no per-book values. The flag thus does not control
   * them. The banner says "Always" and states that fact. A ⋮ toggle that leaves
   * this banner unchanged then looks correct, and not broken. A missing banner
   * would be ambiguous, because it could also mean a render failure.
   */
  it('reads "Always Global Settings" on a panel with no per-book form', () => {
    setBookScope(false);
    show('book-1', true);

    expect(screen.getByText('Always Global Settings')).toBeTruthy();
    // The book holds its own values, but the panel ignores that.
    expect(screen.queryByText('This Book — Overrides Global Settings')).toBeNull();
  });

  /**
   * These tests read the colour and the icon, and not the words. On e-ink both
   * tints become one flat surface. The icon is thus one of the two signals that
   * stay. A swap of either condition changes no text, and the text tests
   * therefore cannot find it.
   */
  it('draws the two icons differently, so the comparisons below can fail', () => {
    // `iconOf` reads path data. If react-icons renders these icons without a
    // path, both sides become empty. Each icon test below then passes on
    // nothing.
    expect(iconIs(MdOutlinePublic)).not.toBe('');
    expect(iconIs(MdOutlineMenuBook)).not.toBe('');
    expect(iconIs(MdOutlinePublic)).not.toBe(iconIs(MdOutlineMenuBook));
  });

  it('shows the globe and the info colour in global scope', () => {
    setBookScope(true);
    show('book-1');
    const banner = screen.getByRole('status');

    expect(banner.className).toContain('border-info');
    expect(banner.className).toContain('bg-info/15');
    expect(banner.className).not.toContain('border-warning');
    expect(banner.className).not.toContain('bg-warning');
    // `eink-bordered` must sit on the element that holds the tint. On another
    // element it removes neither the tint nor the thick edge on e-ink.
    expect(banner.className).toContain('eink-bordered');
    expect(iconOf(banner)).toBe(iconIs(MdOutlinePublic));
  });

  it('shows the book and the warning colour in book scope', () => {
    setBookScope(false);
    show('book-1');
    const banner = screen.getByRole('status');

    expect(banner.className).toContain('border-warning');
    expect(banner.className).toContain('bg-warning/10');
    expect(banner.className).not.toContain('border-info');
    expect(banner.className).not.toContain('bg-info');
    expect(banner.className).toContain('eink-bordered');
    expect(iconOf(banner)).toBe(iconIs(MdOutlineMenuBook));
  });

  it('shows the global icon and colour on an always-global panel', () => {
    // The book holds its own values. Only `alwaysGlobal` thus makes this state
    // global. Without it the banner would show "Always Global Settings" with a
    // book icon on amber, and disagree with itself.
    setBookScope(false);
    show('book-1', true);
    const banner = screen.getByRole('status');

    expect(banner.className).toContain('border-info');
    expect(iconOf(banner)).toBe(iconIs(MdOutlinePublic));
  });
});
