import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AudiobookPairingDialog from '@/app/reader/components/audiobook/AudiobookPairingDialog';
import type { BookDoc } from '@/libs/document';
import type { AudiobookChapter, PairedAudiobook } from '@/types/book';

const h = vi.hoisted(() => {
  const chapters: AudiobookChapter[] = Array.from({ length: 300 }, (_, index) => ({
    id: `audio-0:${index}`,
    fileId: 'audio-0',
    label: `Track ${index + 1}`,
    start: index * 60,
    end: (index + 1) * 60,
  }));
  const association: PairedAudiobook = {
    version: 1,
    files: [
      {
        id: 'audio-0',
        name: 'book.m4b',
        path: 'book-hash/audiobook/book.m4b',
        duration: chapters.length * 60,
      },
    ],
    chapters,
    mappings: chapters.map((chapter, index) => ({
      ebookChapterId: `chapter-${index + 1}.xhtml`,
      audioChapterId: chapter.id,
    })),
    createdAt: 1,
  };
  return {
    association,
    config: { audiobook: association as PairedAudiobook | undefined, updatedAt: 1 },
    book: { hash: 'book-hash', title: 'A Very Good Book', format: 'EPUB' },
  };
});

vi.mock('@/components/Dialog', () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div role='dialog' aria-label={title}>
      {children}
    </div>
  ),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, params?: Record<string, string | number>) =>
    Object.entries(params ?? {}).reduce(
      (result, [key, replacement]) => result.replace(`{{${key}}}`, String(replacement)),
      value,
    ),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null, envConfig: {} }),
}));

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({
      getConfig: () => h.config,
      getBookData: () => ({ book: h.book }),
      setConfig: vi.fn(),
      saveConfig: vi.fn(),
    }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getViewSettings: vi.fn(),
      setViewSettings: vi.fn(),
    }),
  },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

const bookDoc = {
  toc: Array.from({ length: 300 }, (_, index) => ({
    id: index,
    label: `Chapter ${index + 1}`,
    href: `chapter-${index + 1}.xhtml`,
    index,
  })),
} as unknown as BookDoc;

describe('AudiobookPairingDialog', () => {
  beforeEach(() => {
    h.config.audiobook = h.association;
  });

  it('identifies the ebook on the first pairing step', () => {
    h.config.audiobook = undefined;
    render(<AudiobookPairingDialog bookKey='book-hash-view' bookDoc={bookDoc} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Pair Audiobook' })).toBeTruthy();
    expect(screen.getByText(/Pair a local recording with “A Very Good Book”/)).toBeTruthy();
  });

  it('shows book context and mounts only one audio option list while editing a large mapping', () => {
    const { container } = render(
      <AudiobookPairingDialog bookKey='book-hash-view' bookDoc={bookDoc} onClose={vi.fn()} />,
    );

    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Manage Audiobook',
    );
    expect(container.textContent).toContain('A Very Good Book');
    const editButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Edit Mapping',
    );
    fireEvent.click(editButton!);

    expect(container.textContent).toContain('Review Chapter Mapping');
    expect(container.textContent).toContain('Save Changes');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);

    fireEvent.click(container.querySelector('button[aria-label="Audio for Chapter 1"]')!);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(301);
  });
});
