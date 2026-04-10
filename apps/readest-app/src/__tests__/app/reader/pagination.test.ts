import { describe, it, expect, vi } from 'vitest';
import { viewPagination } from '@/app/reader/hooks/usePagination';
import { getNavigationHandler } from '@/app/reader/components/footerbar/utils';

const makeView = (dir: 'ltr' | 'rtl') => {
  const prev = vi.fn();
  const next = vi.fn();
  return {
    prev,
    next,
    book: { dir },
    renderer: {
      scrolled: false,
      size: 600,
      prevSection: vi.fn(),
      nextSection: vi.fn(),
      isOverflowX: () => false,
      isOverflowY: () => false,
    },
  };
};

const makeViewSettings = (overrides: Record<string, unknown> = {}) => ({
  rtl: false,
  showHeader: false,
  showFooter: false,
  showBarsOnScroll: false,
  scrollingOverlap: 0,
  zoomLevel: 100,
  zoomMode: 'fit-page',
  ...overrides,
});

describe('viewPagination – LTR books', () => {
  it('left calls prev()', () => {
    const view = makeView('ltr');
    viewPagination(view as never, makeViewSettings() as never, 'left', 'page');
    expect(view.prev).toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  it('right calls next()', () => {
    const view = makeView('ltr');
    viewPagination(view as never, makeViewSettings() as never, 'right', 'page');
    expect(view.next).toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });
});

describe('viewPagination – RTL books (viewSettings.rtl is authoritative)', () => {
  // Typical Arabic book: horizontal-tb writing mode sets view.book.dir='ltr',
  // but the document CSS sets viewSettings.rtl=true. viewPagination must use
  // viewSettings.rtl, not view.book.dir.
  it('left calls next() when viewSettings.rtl=true, even if book.dir is ltr', () => {
    const view = makeView('ltr'); // real Arabic book with horizontal-tb mode
    viewPagination(view as never, makeViewSettings({ rtl: true }) as never, 'left', 'page');
    expect(view.next).toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });

  it('right calls prev() when viewSettings.rtl=true, even if book.dir is ltr', () => {
    const view = makeView('ltr');
    viewPagination(view as never, makeViewSettings({ rtl: true }) as never, 'right', 'page');
    expect(view.prev).toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  it('left calls next() when both book.dir and viewSettings.rtl are rtl', () => {
    const view = makeView('rtl');
    viewPagination(view as never, makeViewSettings({ rtl: true }) as never, 'left', 'page');
    expect(view.next).toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });

  it('right calls prev() when both book.dir and viewSettings.rtl are rtl', () => {
    const view = makeView('rtl');
    viewPagination(view as never, makeViewSettings({ rtl: true }) as never, 'right', 'page');
    expect(view.prev).toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });
});

describe('footer bar page navigation – RTL double-swap regression', () => {
  /**
   * DesktopFooterBar/NavigationPanel previously used getNavigationHandler() to
   * swap which handler the left/right buttons call for RTL. But viewPagination()
   * also swaps for RTL (via viewSettings.rtl). Double-swap = wrong direction.
   *
   * Fix: remove getNavigationHandler from page-nav buttons. Left button calls
   * onPrevPage directly; viewPagination does the single RTL swap.
   *
   * Real Arabic book scenario: view.book.dir='ltr' (horizontal-tb overrides it),
   * viewSettings.rtl=true (from document CSS).
   */
  it('left page button in RTL should advance reading (call next)', () => {
    const view = makeView('ltr'); // real Arabic book: book.dir='ltr'
    const vs = makeViewSettings({ rtl: true });

    // Fixed: footer bar calls onPrevPage directly — viewPagination does the swap.
    const onPrevPage = () => viewPagination(view as never, vs as never, 'left', 'page');
    onPrevPage();

    expect(view.next).toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });

  it('right page button in RTL should go back (call prev)', () => {
    const view = makeView('ltr');
    const vs = makeViewSettings({ rtl: true });

    const onNextPage = () => viewPagination(view as never, vs as never, 'right', 'page');
    onNextPage();

    expect(view.prev).toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  it('getNavigationHandler double-swap produces wrong direction (documents the bug)', () => {
    // Demonstrates why getNavigationHandler must NOT be used for page buttons:
    // it swaps at the UI layer, then viewPagination swaps again → double-swap → wrong.
    const view = makeView('ltr'); // real Arabic book scenario
    const vs = makeViewSettings({ rtl: true });

    const onPrevPage = () => viewPagination(view as never, vs as never, 'left', 'page');
    const onNextPage = () => viewPagination(view as never, vs as never, 'right', 'page');

    // getNavigationHandler: for RTL, left button → onNextPage
    const brokenHandler = getNavigationHandler(true, onPrevPage, onNextPage);
    brokenHandler(); // onNextPage → viewPagination('right') → swap → view.prev() ← WRONG

    expect(view.prev).toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });
});
