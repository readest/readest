import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';

const saveViewSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/helpers/settings', () => ({ saveViewSettings }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({ openParallelView: vi.fn() }),
}));

// eslint-disable-next-line import/first
import BookMenu from '@/app/reader/components/sidebar/BookMenu';

const setBook = (bookDoc: object, viewSettings: object) => {
  (useReaderStore.setState as unknown as (state: unknown) => void)({
    bookKeys: ['book1'],
    viewStates: { book1: { viewSettings } },
  });
  (useBookDataStore.setState as unknown as (state: unknown) => void)({
    booksData: { book1: { id: 'book1', book: null, file: null, config: null, bookDoc } },
  });
};

beforeEach(() => {
  (useSettingsStore.setState as unknown as (state: unknown) => void)({
    settings: DEFAULT_SYSTEM_SETTINGS,
  });
  useSidebarStore.setState({ sideBarBookKey: 'book1' });
  saveViewSettings.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('BookMenu page thumbnails toggle', () => {
  it('is not offered for books without page thumbnails', () => {
    setBook({}, { showTOCThumbnails: true });
    render(<BookMenu />);
    expect(screen.queryByRole('menuitem', { name: 'Show Page Thumbnails' })).toBeNull();
  });

  it('turns page thumbnails off for the current book only', () => {
    setBook({ getPageThumbnail: vi.fn() }, { showTOCThumbnails: true });
    const setIsDropdownOpen = vi.fn();
    render(<BookMenu setIsDropdownOpen={setIsDropdownOpen} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Page Thumbnails' }));

    expect(saveViewSettings).toHaveBeenCalledWith(
      {},
      'book1',
      'showTOCThumbnails',
      false,
      true,
      false,
    );
    expect(setIsDropdownOpen).toHaveBeenCalledWith(false);
  });

  it('turns page thumbnails back on', () => {
    setBook({ getPageThumbnail: vi.fn() }, { showTOCThumbnails: false });
    render(<BookMenu />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Page Thumbnails' }));

    expect(saveViewSettings).toHaveBeenCalledWith(
      {},
      'book1',
      'showTOCThumbnails',
      true,
      true,
      false,
    );
  });
});
