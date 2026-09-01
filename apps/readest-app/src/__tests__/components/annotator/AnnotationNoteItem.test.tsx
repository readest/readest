import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { BookNote } from '@/types/book';

dayjs.extend(relativeTime);

const h = vi.hoisted(() => ({
  view: { addAnnotation: vi.fn() },
  setConfig: vi.fn(),
  setHoveredBookKey: vi.fn(),
  setSideBarVisible: vi.fn(),
  saveConfig: vi.fn(),
  booknotes: [] as BookNote[],
  updateBooknotes: vi.fn((_key: string, booknotes: BookNote[]) => {
    h.booknotes = booknotes;
    return { booknotes: h.booknotes };
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false }, envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ viewSettings: {}, booknotes: h.booknotes }),
    setConfig: h.setConfig,
    saveConfig: h.saveConfig,
    updateBooknotes: h.updateBooknotes,
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    setHoveredBookKey: h.setHoveredBookKey,
    getViewsById: () => [h.view],
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ setSideBarVisible: h.setSideBarVisible }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import AnnotationNoteItem from '@/app/reader/components/annotator/AnnotationNoteItem';

const makeBooknote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/2!/4/1:0)',
  note: 'Gryphon',
  text: 'Gryphon',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const onEdit = vi.fn();

const renderItem = (note: BookNote = makeBooknote()) => {
  h.booknotes = [note];
  return render(
    <AnnotationNoteItem
      bookKey='test'
      note={note}
      onEdit={onEdit}
      isVertical={false}
      popupHeight={120}
      onDismiss={() => {}}
    />,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AnnotationNoteItem', () => {
  it('shows the note text with an edit icon that is not hover-gated', () => {
    renderItem();

    screen.getByText('Gryphon');
    const editButton = screen.getByRole('button', { name: 'Edit' });
    expect(editButton.className).not.toMatch(/opacity-0|group-hover/);
  });

  it('clicking the note body opens the sidebar annotations tab', () => {
    renderItem();

    fireEvent.click(screen.getByText('Gryphon'));

    expect(h.setSideBarVisible).toHaveBeenCalledWith(true);
  });

  it('hands the note to the shared editor instead of editing in place', () => {
    const note = makeBooknote();
    renderItem(note);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onEdit).toHaveBeenCalledWith(note);
    // The card stays as it is: the editor is the popup's job now, and the
    // sidebar must not open underneath it.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(h.setSideBarVisible).not.toHaveBeenCalled();
  });
});
