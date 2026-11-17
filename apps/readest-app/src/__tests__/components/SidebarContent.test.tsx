// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  config: { viewSettings: { sideBarTab: 'toc' } },
  setConfig: vi.fn(),
  setHoveredBookKey: vi.fn(),
  setSearchBarVisible: vi.fn(),
  setSideBarVisible: vi.fn(),
  // The tabs whose module has been evaluated
  loaded: new Set<string>(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: h.setHoveredBookKey }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setSearchBarVisible: h.setSearchBarVisible,
    setSideBarVisible: h.setSideBarVisible,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getConfig: () => h.config,
    setConfig: h.setConfig,
  })),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: false } } }),
}));

vi.mock('overlayscrollbars-react', () => ({
  OverlayScrollbarsComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/app/reader/components/sidebar/TOCView', () => ({
  default: () => <div>toc content</div>,
}));

vi.mock('@/app/reader/components/sidebar/BooknoteView', () => {
  h.loaded.add('BooknoteView');
  return { default: ({ type }: { type: string }) => <div>{type} content</div> };
});

vi.mock('@/app/reader/components/sidebar/ChatHistoryView', () => {
  h.loaded.add('ChatHistoryView');
  return { default: () => <div>history content</div> };
});

vi.mock('@/app/reader/components/sidebar/TabNavigation', () => ({
  default: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: string;
    onTabChange: (tab: string) => void;
  }) => (
    <div>
      <span>active: {activeTab}</span>
      <button type='button' onClick={() => onTabChange('annotations')}>
        annotations tab
      </button>
      <button type='button' onClick={() => onTabChange('bookmarks')}>
        bookmarks tab
      </button>
    </div>
  ),
}));

import SidebarContent from '@/app/reader/components/sidebar/Content';

describe('SidebarContent tab transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.config.viewSettings.sideBarTab = 'toc';
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // The notes tab brings the Markdown and math renderers; the contents tab doesn't need them.
  test('loads the other tabs only when one is first shown', async () => {
    render(<SidebarContent bookDoc={{ toc: [] } as never} sideBarBookKey='book-1' />);
    expect(screen.getByText('toc content')).toBeTruthy();
    expect(h.loaded.has('BooknoteView')).toBe(false);
    expect(h.loaded.has('ChatHistoryView')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'annotations tab' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await vi.dynamicImportSettled();
    });
    expect(h.loaded.has('BooknoteView')).toBe(true);
    expect(screen.getByText('annotation content')).toBeTruthy();
  });

  test('keeps the old tab faded until the delayed swap is persisted', async () => {
    const { container } = render(
      <SidebarContent bookDoc={{ toc: [] } as never} sideBarBookKey='book-1' />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'annotations tab' }));

    expect(screen.getByText('toc content')).toBeTruthy();
    expect(container.querySelector('.scroll-container')?.className).toContain('opacity-0');
    expect(h.config.viewSettings.sideBarTab).toBe('toc');
    expect(h.setConfig).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByText('toc content')).toBeTruthy();
    expect(h.setConfig).not.toHaveBeenCalled();

    // The notes tab's code loads when it is first shown.
    await act(async () => {
      vi.advanceTimersByTime(1);
      await vi.dynamicImportSettled();
    });
    expect(screen.getByText('annotation content')).toBeTruthy();
    expect(container.querySelector('.scroll-container')?.className).toContain('opacity-100');
    expect(h.setConfig).toHaveBeenCalledOnce();
    expect(h.setConfig).toHaveBeenCalledWith('book-1', {
      viewSettings: { sideBarTab: 'annotations' },
    });
  });

  test('lets the latest tab choice replace a pending transition', () => {
    render(<SidebarContent bookDoc={{ toc: [] } as never} sideBarBookKey='book-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'annotations tab' }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole('button', { name: 'bookmarks tab' }));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.getByText('toc content')).toBeTruthy();
    expect(h.setConfig).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByText('bookmark content')).toBeTruthy();
    expect(h.setConfig).toHaveBeenCalledOnce();
    expect(h.setConfig).toHaveBeenCalledWith('book-1', {
      viewSettings: { sideBarTab: 'bookmarks' },
    });
  });

  test('cancels a pending transition when the configured tab changes externally', () => {
    const props = { bookDoc: { toc: [] } as never, sideBarBookKey: 'book-1' };
    const { rerender } = render(<SidebarContent {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'annotations tab' }));
    h.config.viewSettings.sideBarTab = 'bookmarks';
    rerender(<SidebarContent {...props} />);

    expect(screen.getByText('bookmark content')).toBeTruthy();
    act(() => vi.advanceTimersByTime(300));
    expect(h.setConfig).not.toHaveBeenCalled();
    expect(screen.getByText('bookmark content')).toBeTruthy();
  });
});
