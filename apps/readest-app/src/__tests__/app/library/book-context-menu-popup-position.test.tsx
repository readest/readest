import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
 *
 * CSS pixels are not window-logical pixels when the webview carries a page
 * zoom. WebKitGTK folds the desktop text-scaling factor into such a zoom
 * without reflecting it in devicePixelRatio (e.g. GDK scale 2 × 0.8 text
 * scale: CSS→physical is 1.6 while dPR reports 2), so both raw client
 * coordinates and clientX×dPR land the menu offset from the click by a
 * factor that grows with distance. The zoom-proof conversion is the click's
 * *fraction* of the CSS viewport mapped onto the window's logical size:
 * any uniform zoom cancels out of the ratio.
 */

const popupSpy = vi.hoisted(() => vi.fn(async (_pos?: unknown) => {}));
const menuNew = vi.hoisted(() => vi.fn(async () => ({ popup: popupSpy, close: vi.fn() })));
const windowState = vi.hoisted(() => ({
  innerSize: { width: 2560, height: 1600 },
  scaleFactor: 2,
}));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNew },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: async () => windowState.innerSize,
    scaleFactor: async () => windowState.scaleFactor,
  }),
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

  afterEach(() => {
    cleanup();
  });

  const setViewport = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  };

  it('passes the contextmenu position to menu.popup in window-logical pixels', async () => {
    // CSS viewport matches the window logical size (1280×800): no zoom, so
    // the popup position equals the client coordinates.
    setViewport(1280, 800);
    renderItem();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
      clientX: 123,
      clientY: 456,
    });

    await waitFor(() => expect(popupSpy).toHaveBeenCalled());
    const pos = popupSpy.mock.calls[0]![0] as unknown as { type: string; x: number; y: number };
    expect(pos.type).toBe('Logical');
    expect(pos.x).toBeCloseTo(123);
    expect(pos.y).toBeCloseTo(456);
  });

  it('compensates a webview page zoom when mapping the click to window coordinates', async () => {
    // A 0.8 page zoom inflates the CSS viewport to 1600×1000 while the
    // window is still 1280×800 logical: client coordinates must shrink by
    // the same ratio or the menu lands past the click (issue #5181).
    setViewport(1600, 1000);
    renderItem();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
      clientX: 500,
      clientY: 250,
    });

    await waitFor(() => expect(popupSpy).toHaveBeenCalled());
    const pos = popupSpy.mock.calls[0]![0] as unknown as { type: string; x: number; y: number };
    expect(pos.type).toBe('Logical');
    expect(pos.x).toBeCloseTo(400);
    expect(pos.y).toBeCloseTo(200);
  });
});
