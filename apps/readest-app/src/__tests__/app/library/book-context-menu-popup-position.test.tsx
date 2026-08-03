import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * The native context menu (macOS and Windows; Linux renders it in-app, see
 * book-context-menu-linux-inapp.test.tsx) is popped at an explicit position
 * rather than through a positionless `menu.popup()`, which anchors to the
 * current mouse location. Keyboard invocation — ContextMenu / Shift+F10 — has
 * no mouse to anchor to, so the menu must open at the focused item instead of
 * wherever the pointer was last left.
 *
 * CSS px are window-logical px on both platforms (Tauri leaves webview zoom
 * hotkeys disabled), so the client coordinates pass through unchanged.
 */

const popupSpy = vi.hoisted(() => vi.fn(async (_pos?: unknown) => {}));
const menuNew = vi.hoisted(() => vi.fn(async () => ({ popup: popupSpy, close: vi.fn() })));

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

const popupPosition = () =>
  popupSpy.mock.calls[0]![0] as unknown as { type: string; x: number; y: number };

describe('library context menu popup position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('passes the contextmenu position to menu.popup in window-logical pixels', async () => {
    renderItem();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
      clientX: 123,
      clientY: 456,
    });

    await waitFor(() => expect(popupSpy).toHaveBeenCalled());
    const pos = popupPosition();
    expect(pos.type).toBe('Logical');
    expect(pos.x).toBeCloseTo(123);
    expect(pos.y).toBeCloseTo(456);
  });

  it('anchors a keyboard-invoked menu at the center of the focused item', async () => {
    renderItem();

    const item = screen.getByRole('button', { name: 'Test Book' });
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 100,
      width: 160,
      height: 240,
    } as DOMRect);

    fireEvent.keyDown(item, { key: 'ContextMenu' });

    await waitFor(() => expect(popupSpy).toHaveBeenCalled());
    const pos = popupPosition();
    expect(pos.x).toBeCloseTo(280);
    expect(pos.y).toBeCloseTo(220);
  });
});
