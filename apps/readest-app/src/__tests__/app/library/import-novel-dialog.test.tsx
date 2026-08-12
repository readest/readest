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

  it('downloads on Import and hands the file to onImport', async () => {
    const { onClose, onImport } = setup();
    await goToPreview();
    fireEvent.click(screen.getByText('Import'));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(book.file));
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
