import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BooknoteGroup } from '@/types/book';

const h = vi.hoisted(() => ({
  appService: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: h.appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => undefined }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => undefined }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div role='dialog' aria-label={title}>
      {children}
    </div>
  ),
}));

import ExportMarkdownDialog from '@/app/reader/components/annotator/ExportMarkdownDialog';

const booknoteGroups: Record<string, BooknoteGroup> = {
  'chapter.xhtml': {
    id: 0,
    href: 'chapter.xhtml',
    label: 'Chapter 1',
    booknotes: [
      {
        id: 'note-1',
        type: 'annotation',
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)',
        text: 'hello',
        note: '',
        style: 'highlight',
        color: 'yellow',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  },
};

const renderDialog = () => {
  const onExport = vi.fn();
  render(
    <ExportMarkdownDialog
      bookKey='book-1'
      isOpen
      bookHash='hash'
      bookTitle='Title'
      bookAuthor='Author'
      bookFormat='EPUB'
      booknoteGroups={booknoteGroups}
      onCancel={vi.fn()}
      onExport={onExport}
    />,
  );
  return onExport;
};

describe('ExportMarkdownDialog export actions', () => {
  beforeEach(() => {
    h.appService = {};
  });

  afterEach(() => {
    cleanup();
  });

  // macOS is the one platform with both a system share sheet and a native
  // Save panel. A single Export button that only opened the share sheet left
  // no way to write the file to disk (#6201).
  it('offers Save (to disk) and Share (share sheet) on macOS', () => {
    h.appService = { isMacOSApp: true };
    const onExport = renderDialog();

    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport.mock.calls[0]?.[2]).toMatchObject({
      share: false,
      sharePosition: { preferredEdge: 'bottom' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onExport).toHaveBeenCalledTimes(2);
    expect(onExport.mock.calls[1]?.[2]).toMatchObject({
      share: true,
      sharePosition: { preferredEdge: 'bottom' },
    });
  });

  it('keeps the single Export button that shares on other platforms', () => {
    h.appService = { isIOSApp: true };
    const onExport = renderDialog();

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport.mock.calls[0]?.[2]).toMatchObject({ share: true });
  });
});
