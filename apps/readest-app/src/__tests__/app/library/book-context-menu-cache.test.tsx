import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5181 — the native context menu takes several hundred ms to appear
 * because every right-click rebuilds the full menu over the Tauri IPC
 * boundary (Menu.new with a dozen items) before popup() can run.
 *
 * The menu must be built once and cached: repeated openings reuse the cached
 * menu, hovering the item prewarms it so the first right-click pops
 * instantly, and any state baked into the items (selection label, book
 * status) invalidates the cache so the next opening rebuilds.
 */

const popupSpy = vi.hoisted(() => vi.fn(async () => {}));
const closeSpy = vi.hoisted(() => vi.fn(async () => {}));
const menuNew = vi.hoisted(() => vi.fn(async () => ({ popup: popupSpy, close: closeSpy })));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNew },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: async () => ({ width: 2048, height: 1536 }),
    scaleFactor: async () => 2,
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

type ItemOverrides = { itemSelected?: boolean; item?: Book };

const renderItem = (overrides: ItemOverrides = {}) => {
  const props = {
    mode: 'grid' as const,
    item: book,
    coverFit: 'crop' as const,
    isSelectMode: false,
    itemSelected: false,
    transferProgress: null,
    setLoading: vi.fn(),
    toggleSelection: vi.fn(),
    handleGroupBooks: vi.fn(),
    handleBookDownload: vi.fn(async () => true),
    handleBookUpload: vi.fn(async () => true),
    handleBookDelete: vi.fn(async () => true),
    handleSetSelectMode: vi.fn(),
    handleShowDetailsBook: vi.fn(),
    handleLibraryNavigation: vi.fn(),
    handleUpdateReadingStatus: vi.fn(),
    showTimeRemaining: false,
    ...overrides,
  };
  const utils = render(<BookshelfItem {...props} />);
  const rerenderItem = (nextOverrides: ItemOverrides) =>
    utils.rerender(<BookshelfItem {...props} {...nextOverrides} />);
  return { ...utils, rerenderItem };
};

const openContextMenu = () =>
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
    clientX: 10,
    clientY: 20,
  });

describe('library context menu caching (issue #5181)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('builds the menu once and reuses it across repeated openings', async () => {
    renderItem();

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(2));

    expect(menuNew).toHaveBeenCalledTimes(1);
  });

  it('prewarms the menu on pointer enter so the first popup is instant', async () => {
    renderItem();

    // React synthesizes onPointerEnter from pointerover transitions, so
    // dispatch pointerOver (pointerEnter does not bubble and jsdom delivers
    // it past React's delegated listeners).
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Test Book' }));

    await waitFor(() => expect(menuNew).toHaveBeenCalledTimes(1));
    expect(popupSpy).not.toHaveBeenCalled();

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));
    expect(menuNew).toHaveBeenCalledTimes(1);
  });

  it('closes and rebuilds the cached menu when the selection state changes', async () => {
    const { rerenderItem } = renderItem();

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));
    expect(menuNew).toHaveBeenCalledTimes(1);

    rerenderItem({ itemSelected: true });
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(2));
    expect(menuNew).toHaveBeenCalledTimes(2);
  });
});

/**
 * The native popup blocks Tauri's main thread until the menu is dismissed and
 * holds the webview resources table lock for that whole time, while
 * menu.close() destroys the resource through a *synchronous* command that runs
 * on that same main thread. Releasing a menu while a popup is on screen
 * therefore deadlocks the app: the main thread waits for a lock only the
 * dismissal can release, and the blocked main thread can no longer dismiss.
 * A re-render during the library's startup churn used to do exactly that.
 */
describe('library context menu release while a popup is on screen', () => {
  let resolvePopup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    popupSpy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePopup = resolve;
        }),
    );
  });

  afterEach(() => {
    cleanup();
    popupSpy.mockImplementation(async () => {});
  });

  it('defers releasing the menu until the popup is dismissed', async () => {
    const { rerenderItem } = renderItem();

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));

    rerenderItem({ itemSelected: true });
    await waitFor(() => expect(menuNew).toHaveBeenCalledTimes(1));
    expect(closeSpy).not.toHaveBeenCalled();

    resolvePopup();
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
  });

  it('defers a release queued by another item while a popup is on screen', async () => {
    const other = renderItem({ item: { ...book, hash: 'hash-2', title: 'Other Book' } });
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Other Book' }));
    await waitFor(() => expect(menuNew).toHaveBeenCalledTimes(1));

    renderItem();
    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));

    other.unmount();
    await waitFor(() => expect(menuNew).toHaveBeenCalledTimes(2));
    expect(closeSpy).not.toHaveBeenCalled();

    resolvePopup();
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
  });
});
