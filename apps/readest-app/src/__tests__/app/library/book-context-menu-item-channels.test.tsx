import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #6142 — every button in the library context menu did nothing on macOS
 * and Windows.
 *
 * `Menu.new({ items: [{ text, action }] })` builds each inline item as a
 * temporary on the Rust side: the action's channel is registered under the
 * item id, an Arc clone goes into the menu, and `MenuBuilder::build` then drops
 * the last clone because `Menu::append` keeps only muda's own item. Since
 * tauri 2.11.5 that drop unregisters the channel again (upstream #15679, which
 * Readest picked up in #6081), so the menu pops up but no click ever reaches
 * JS. Items created through `MenuItem.new` are owned by the webview's resource
 * table instead, so their channels outlive the build — and must be closed
 * explicitly when the menu is released.
 */

type MockMenuItem = { text: string; action: () => void; close: ReturnType<typeof vi.fn> };

const popupSpy = vi.hoisted(() => vi.fn(async () => {}));
const closeSpy = vi.hoisted(() => vi.fn(async () => {}));
const menuNew = vi.hoisted(() =>
  vi.fn(async (_options: { items: MockMenuItem[] }) => ({ popup: popupSpy, close: closeSpy })),
);
const menuItemNew = vi.hoisted(() =>
  vi.fn(async (options: { text: string; action: () => void }) => ({
    ...options,
    close: vi.fn(async () => {}),
  })),
);

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNew },
  MenuItem: { new: menuItemNew },
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

const handleShowDetailsBook = vi.fn();

const renderItem = (overrides: { itemSelected?: boolean } = {}) => {
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
    handleShowDetailsBook,
    handleLibraryNavigation: vi.fn(),
    handleUpdateReadingStatus: vi.fn(),
    showTimeRemaining: false,
    ...overrides,
  };
  const utils = render(<BookshelfItem {...props} />);
  const rerenderItem = (nextOverrides: { itemSelected?: boolean }) =>
    utils.rerender(<BookshelfItem {...props} {...nextOverrides} />);
  return { ...utils, rerenderItem };
};

const openContextMenu = () =>
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
    clientX: 10,
    clientY: 20,
  });

describe('library context menu item ownership (issue #6142)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('builds the menu from owned MenuItem resources so the actions stay wired', async () => {
    renderItem();

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));

    expect(menuItemNew).toHaveBeenCalled();
    const built = await Promise.all(menuItemNew.mock.results.map((result) => result.value));
    const passed = menuNew.mock.calls[0]![0]!.items;
    // Every entry handed to Menu.new must be a MenuItem resource, in the same
    // order the item list was built in — no inline `{ text, action }` payloads.
    expect(passed).toEqual(built);
    expect(passed.map((item) => item.text)).toEqual(built.map((item) => item.text));

    const details = passed.find((item) => item.text === 'Show Book Details');
    expect(details).toBeDefined();
    details!.action();
    expect(handleShowDetailsBook).toHaveBeenCalledWith(book);
  });

  it('closes the item resources along with the menu it released', async () => {
    const { rerenderItem } = renderItem();

    openContextMenu();
    await waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));
    const items = await Promise.all(menuItemNew.mock.results.map((result) => result.value));
    expect(items.length).toBeGreaterThan(0);

    rerenderItem({ itemSelected: true });
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      for (const item of items) expect(item.close).toHaveBeenCalledTimes(1);
    });
  });
});
