import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { BookNote } from '@/types/book';

dayjs.extend(relativeTime);

const h = vi.hoisted(() => ({
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
    setConfig: vi.fn(),
    saveConfig: h.saveConfig,
    updateBooknotes: h.updateBooknotes,
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn(), getViewsById: () => [] }),
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

import AnnotationNotes from '@/app/reader/components/annotator/AnnotationNotes';

const makeBooknote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/2!/4/1:0)',
  note: 'note text',
  text: 'highlighted',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const renderNotes = (notes: BookNote[]) => {
  h.booknotes = notes;
  return render(
    <AnnotationNotes
      bookKey='test'
      isVertical={false}
      notes={notes}
      toolsVisible={false}
      triangleDir='up'
      popupWidth={240}
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

describe('AnnotationNotes', () => {
  it('renders notes most-recently-updated first, regardless of input order', () => {
    const older = makeBooknote({ id: 'older', note: 'older note', updatedAt: 1000 });
    const newer = makeBooknote({ id: 'newer', note: 'newer note', updatedAt: 2000 });

    const { container } = renderNotes([older, newer]);

    const cardTexts = Array.from(container.querySelectorAll('.popup-container')).map(
      (card) => card.textContent,
    );
    expect(cardTexts[0]).toContain('newer note');
    expect(cardTexts[1]).toContain('older note');
  });

  it('entering edit mode on one note does not affect a sibling note in the same popup', () => {
    const first = makeBooknote({ id: 'first', note: 'first note', updatedAt: 2000 });
    const second = makeBooknote({ id: 'second', note: 'second note', updatedAt: 1000 });

    renderNotes([first, second]);

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    expect(editButtons).toHaveLength(2);
    fireEvent.click(editButtons[0]!);

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textbox.value).toBe('first note');
    screen.getByText('second note');
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });
});
