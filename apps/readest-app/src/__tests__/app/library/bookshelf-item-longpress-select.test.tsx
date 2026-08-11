import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5596 — long-pressing a book on Android selected it and then
 * deselected it again ~100ms later, while the finger was still down.
 *
 * A long press produces two independent signals: our own 500ms timer and the
 * WebView's native `contextmenu` event, and on Android both are wired to the
 * same "select this item" action. Whichever arrives first cancels the other,
 * so on most devices only one of them runs — but when the WebView fires
 * `contextmenu` *after* our timer has already fired, the item is toggled
 * twice by a single press.
 */

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn(async () => ({ popup: vi.fn(), close: vi.fn() })) },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

const appService = vi.hoisted(() => ({
  hasContextMenu: false,
  isLinuxApp: false,
  isAndroidApp: true,
  isMobileApp: true,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
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

/**
 * Mirrors the library page: select mode and the selected set live above the
 * item, so every toggle re-renders it with new props.
 */
const Harness = ({ onToggle }: { onToggle: (id: string) => void }) => {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selected, setSelected] = useState(false);
  return (
    <BookshelfItem
      mode='grid'
      item={book}
      coverFit='crop'
      isSelectMode={isSelectMode}
      itemSelected={selected}
      transferProgress={null}
      setLoading={vi.fn()}
      toggleSelection={(id: string) => {
        setSelected((prev) => !prev);
        onToggle(id);
      }}
      handleGroupBooks={vi.fn()}
      handleBookDownload={vi.fn(async () => true)}
      handleBookUpload={vi.fn(async () => true)}
      handleBookDelete={vi.fn(async () => true)}
      handleSetSelectMode={setIsSelectMode}
      handleShowDetailsBook={vi.fn()}
      handleLibraryNavigation={vi.fn()}
      handleUpdateReadingStatus={vi.fn()}
      showTimeRemaining={false}
    />
  );
};

const getItem = () => screen.getByRole('button', { name: 'Test Book' });

describe('long-press selection on Android (issue #5596)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('selects once when the WebView fires contextmenu after the long-press timer', () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const item = getItem();

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 50, clientY: 50 });
    // Our own long-press timer wins the race and selects the book.
    act(() => void vi.advanceTimersByTime(500));
    expect(onToggle).toHaveBeenCalledTimes(1);

    // The WebView's native long-press callout lands a moment later, still
    // within the same press.
    fireEvent.contextMenu(item, { clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));

    expect(onToggle).toHaveBeenCalledTimes(1);

    // Lifting the finger must not count as a tap either.
    fireEvent.pointerUp(item, { pointerId: 1, clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('selects once when the WebView fires contextmenu before the long-press timer', () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const item = getItem();

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.contextMenu(item, { clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));

    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(item, { pointerId: 1, clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('still toggles on a plain tap once select mode is on', () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const item = getItem();

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));
    fireEvent.pointerUp(item, { pointerId: 1, clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(item, { pointerId: 2, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(item, { pointerId: 2, clientX: 50, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
