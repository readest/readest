import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5181 — the library context menu flashes and disappears on Wayland
 * when opened with a touchpad two-finger tap.
 *
 * `menu.popup()` without a position makes muda anchor the GTK popup to the
 * screen's root window (muda gtk show_context_menu). X11 has a real root
 * window so that works; Wayland has none, so the popup gets no parent and the
 * compositor refuses to map it:
 *
 *   Gdk-WARNING **: Couldn't map as window 0x… as popup because it doesn't
 *   have a parent
 *
 * Passing an explicit position makes muda anchor to the app window's own
 * GdkWindow instead, which always has a parent. So the popup call must carry
 * the pointer position from the triggering contextmenu event.
 */

const popupSpy = vi.hoisted(() => vi.fn(async () => {}));
const menuNew = vi.hoisted(() => vi.fn(async () => ({ popup: popupSpy })));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNew },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { hasContextMenu: true, isAndroidApp: false, isMobileApp: false },
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { localBooksDir: '/books' } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: vi.fn() }),
}));

vi.mock('@/app/library/components/BookItem', () => ({
  default: () => null,
}));

vi.mock('@/app/library/components/GroupItem', () => ({
  default: () => null,
}));

const BookshelfItem = (await import('@/app/library/components/BookshelfItem')).default;

const book: Book = {
  hash: 'hash-1',
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: 0,
  updatedAt: 0,
  downloadedAt: 1,
};

const renderItem = () =>
  render(
    <BookshelfItem
      mode='grid'
      item={book}
      coverFit='crop'
      isSelectMode={false}
      itemSelected={false}
      transferProgress={null}
      setLoading={vi.fn()}
      toggleSelection={vi.fn()}
      handleGroupBooks={vi.fn()}
      handleBookDownload={vi.fn(async () => true)}
      handleBookUpload={vi.fn(async () => true)}
      handleBookDelete={vi.fn(async () => true)}
      handleSetSelectMode={vi.fn()}
      handleShowDetailsBook={vi.fn()}
      handleLibraryNavigation={vi.fn()}
      handleUpdateReadingStatus={vi.fn()}
      showTimeRemaining={false}
    />,
  );

describe('library context menu popup position (issue #5181)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the contextmenu pointer position to menu.popup', async () => {
    renderItem();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
      clientX: 123,
      clientY: 456,
    });

    await waitFor(() => expect(popupSpy).toHaveBeenCalled());
    expect(popupSpy).toHaveBeenCalledWith(expect.objectContaining({ x: 123, y: 456 }));
  });
});
