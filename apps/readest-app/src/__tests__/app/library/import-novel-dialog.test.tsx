import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ImportNovelDialog from '@/app/library/components/ImportNovelDialog';
import type { NovelToc } from '@/services/novel/chapterList';
import type { NovelBook, NovelDownloadOptions } from '@/services/novel/novelImport';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label={title}>
        {children}
      </div>
    ) : null,
}));

const fetchNovelTocMock = vi.fn();
const downloadNovelMock = vi.fn();
vi.mock('@/services/novel/novelImport', () => ({
  fetchNovelToc: (...args: unknown[]) => fetchNovelTocMock(...args),
  downloadNovel: (...args: unknown[]) => downloadNovelMock(...args),
  isNovelImportCancelled: (err: unknown) =>
    err instanceof DOMException && err.name === 'AbortError',
}));

const toc: NovelToc = {
  title: 'My Novel',
  author: 'Author X',
  coverUrl: null,
  weak: { title: false, author: false },
  chapters: Array.from({ length: 6 }, (_, i) => ({
    title: `Chapter ${i + 1}`,
    url: `https://n.example.org/c/${i + 1}`,
  })),
};

const book: NovelBook = {
  file: new File(['x'], 'My Novel.epub', { type: 'application/epub+zip' }),
  title: 'My Novel',
  author: 'Author X',
  chapterCount: 6,
  failures: 0,
};

const setup = () => {
  const onClose = vi.fn();
  const onImport = vi.fn(async () => {});
  const utils = render(<ImportNovelDialog isOpen onClose={onClose} onImport={onImport} />);
  return { ...utils, onClose, onImport };
};

const goToPreview = async () => {
  fireEvent.change(screen.getByPlaceholderText('https://example.com/novel'), {
    target: { value: 'https://n.example.org/toc' },
  });
  fireEvent.click(screen.getByText('Fetch Chapters'));
  await screen.findByText('My Novel');
};

beforeEach(() => {
  fetchNovelTocMock.mockResolvedValue(toc);
  downloadNovelMock.mockResolvedValue(book);
});

afterEach(() => {
  cleanup();
  fetchNovelTocMock.mockReset();
  downloadNovelMock.mockReset();
});

describe('ImportNovelDialog', () => {
  it('rejects a non-http URL without fetching', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('https://example.com/novel'), {
      target: { value: 'not-a-url' },
    });
    fireEvent.click(screen.getByText('Fetch Chapters'));
    expect(screen.getByText('Enter a URL starting with http:// or https://')).toBeTruthy();
    expect(fetchNovelTocMock).not.toHaveBeenCalled();
  });

  it('shows the detected novel in the preview phase', async () => {
    setup();
    await goToPreview();
    expect(fetchNovelTocMock).toHaveBeenCalledWith('https://n.example.org/toc');
    expect(screen.getByText('Author X')).toBeTruthy();
    expect(screen.getByText('6 chapters')).toBeTruthy();
    expect(screen.getByText('Chapter 1')).toBeTruthy();
    expect(screen.getByText('Chapter 6')).toBeTruthy();
  });

  it('selects every discovered chapter by default and toggles the whole list', async () => {
    setup();
    await goToPreview();

    const chapterCheckboxes = screen.getAllByRole('checkbox');
    expect(chapterCheckboxes).toHaveLength(6);
    expect(chapterCheckboxes.every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(screen.getByText('6 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(chapterCheckboxes.every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(chapterCheckboxes.every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(
      true,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Book title' }), {
      target: { value: '   ' },
    });
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('downloads only selected chapters under the chosen book title', async () => {
    setup();
    await goToPreview();

    const titleInput = screen.getByRole('textbox', { name: 'Book title' }) as HTMLInputElement;
    expect(titleInput.value).toBe('My Novel Chapters 1 - 6');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 1' }));
    expect(titleInput.value).toBe('My Novel Chapters 2 - 6');
    fireEvent.change(titleInput, { target: { value: 'My Novel Volume 2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 2' }));
    expect(titleInput.value).toBe('My Novel Volume 2');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(downloadNovelMock).toHaveBeenCalled());
    expect(downloadNovelMock).toHaveBeenCalledWith(
      {
        ...toc,
        title: 'My Novel Volume 2',
        chapters: toc.chapters.slice(2),
      },
      'https://n.example.org/toc',
      expect.objectContaining({
        identityKey: [
          'https://n.example.org/toc',
          ...toc.chapters.slice(2).map((chapter) => chapter.url),
        ].join('\n'),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('suggests titles for single and non-contiguous chapter selections', async () => {
    setup();
    await goToPreview();

    const titleInput = screen.getByRole('textbox', { name: 'Book title' }) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(titleInput.value).toBe('My Novel');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 2' }));
    expect(titleInput.value).toBe('My Novel Chapter 2');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 4' }));
    expect(titleInput.value).toBe('My Novel (2 chapters)');
  });

  it('sets download progress to the selected chapter count', async () => {
    downloadNovelMock.mockImplementation(() => new Promise(() => {}));
    setup();
    await goToPreview();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByText('Downloading chapters…');
    expect(screen.getByText('0 / 4')).toBeTruthy();
  });

  it('resets selection and title suggestions when reopened', async () => {
    const { onClose, onImport, rerender } = setup();
    await goToPreview();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Book title' }), {
      target: { value: 'Custom Volume' },
    });

    rerender(<ImportNovelDialog isOpen={false} onClose={onClose} onImport={onImport} />);
    rerender(<ImportNovelDialog isOpen onClose={onClose} onImport={onImport} />);
    await goToPreview();

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
    const titleInput = screen.getByRole('textbox', { name: 'Book title' }) as HTMLInputElement;
    expect(titleInput.value).toBe('My Novel Chapters 1 - 6');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter 1' }));
    expect(titleInput.value).toBe('My Novel Chapters 2 - 6');
  });

  it('downloads on Import and hands the file to onImport', async () => {
    const { onClose, onImport } = setup();
    await goToPreview();
    fireEvent.click(screen.getByText('Import'));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(book.file));
    expect(downloadNovelMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My Novel Chapters 1 - 6' }),
      'https://n.example.org/toc',
      expect.objectContaining({ identityKey: 'https://n.example.org/toc' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('returns to the preview when the download is cancelled', async () => {
    downloadNovelMock.mockImplementation(
      (_toc: NovelToc, _url: string, opts: NovelDownloadOptions) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          );
        }),
    );
    const { onClose, onImport } = setup();
    await goToPreview();
    fireEvent.click(screen.getByText('Import'));
    await screen.findByText('Downloading chapters…');
    fireEvent.click(screen.getByText('Cancel'));
    await screen.findByText('Import');
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open with an error when every chapter fails', async () => {
    downloadNovelMock.mockResolvedValue({ ...book, failures: 6 });
    const { onImport } = setup();
    await goToPreview();
    fireEvent.click(screen.getByText('Import'));
    await screen.findByText('No chapters could be downloaded.');
    expect(onImport).not.toHaveBeenCalled();
  });
});
