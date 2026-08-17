import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const originalScrollIntoView = Element.prototype.scrollIntoView;

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key) : key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/utils/book', () => ({
  formatBytes: (n: number) => `${n} B`,
}));

import TTSChaptersView from '@/app/reader/components/tts/TTSChaptersView';
import type { UseTTSDownloadsResult } from '@/app/reader/hooks/useTTSDownloads';
import type { DownloadChapter } from '@/services/tts/downloadChapters';
import type { TTSDownloadItem } from '@/store/ttsDownloadStore';

const chapters: DownloadChapter[] = [
  { key: 'a', label: 'Chapter One', depth: 0, startSection: 0, endSection: 1 },
  { key: 'b', label: 'Chapter Two', depth: 0, startSection: 1, endSection: 2 },
  { key: 'c', label: 'Chapter Three', depth: 1, startSection: 2, endSection: 3 },
];

const makeItem = (
  chapterKey: string,
  status: TTSDownloadItem['status'],
  done = 0,
  total = 10,
): TTSDownloadItem => ({
  id: `book:${chapterKey}`,
  bookHash: 'book',
  chapterKey,
  label: chapterKey,
  startSection: 0,
  endSection: 1,
  status,
  done,
  total,
  createdAt: 0,
  priority: 10,
});

const makeDownloads = (overrides: Partial<UseTTSDownloadsResult> = {}): UseTTSDownloadsResult => ({
  supported: true,
  chapters,
  statuses: new Map(),
  cacheBytes: 0,
  clearing: false,
  items: [],
  itemFor: () => undefined,
  downloadChapter: vi.fn(),
  downloadAll: vi.fn().mockResolvedValue(undefined),
  cancelChapter: vi.fn(),
  cancelAll: vi.fn(),
  clearDownloads: vi.fn().mockResolvedValue(undefined),
  statusOf: vi.fn().mockReturnValue('none'),
  refresh: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const withItems = (items: TTSDownloadItem[]) => ({
  items,
  itemFor: (chapter: DownloadChapter) => items.find((i) => i.chapterKey === chapter.key),
});

describe('TTSChaptersView', () => {
  afterEach(() => {
    cleanup();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  test('lists every chapter with a download control', () => {
    render(
      <TTSChaptersView downloads={makeDownloads()} activeSectionIndex={null} isEink={false} />,
    );
    expect(screen.getByText('Chapter One')).toBeTruthy();
    expect(screen.getByText('Chapter Three')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Download chapter:/)).toHaveLength(3);
  });

  test('tapping a chapter badge downloads that chapter', () => {
    const downloads = makeDownloads();
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    fireEvent.click(screen.getByLabelText('Download chapter: Chapter Two'));
    expect(downloads.downloadChapter).toHaveBeenCalledWith(chapters[1]);
  });

  test('a complete chapter shows the downloaded state and disables its badge', () => {
    const downloads = makeDownloads({
      statusOf: vi
        .fn()
        .mockImplementation((c: DownloadChapter) => (c.key === 'a' ? 'complete' : 'none')),
    });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    const downloaded = screen.getByLabelText('Downloaded: Chapter One') as HTMLButtonElement;
    expect(downloaded.disabled).toBe(true);
  });

  test('the active chapter shows live progress and a stop control', () => {
    const downloads = makeDownloads(withItems([makeItem('b', 'in_progress', 3, 10)]));
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    expect(screen.getByText('Downloading 3/10')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Stop downloading: Chapter Two'));
    expect(downloads.cancelChapter).toHaveBeenCalledWith(chapters[1]);
  });

  test('a queued chapter shows the waiting badge and taps to leave the queue', () => {
    const downloads = makeDownloads(withItems([makeItem('b', 'pending')]));
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    expect(screen.getByText('Waiting…')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove from queue: Chapter Two'));
    expect(downloads.cancelChapter).toHaveBeenCalledWith(chapters[1]);
  });

  test('a failed chapter shows its failure and taps to retry', () => {
    const downloads = makeDownloads(withItems([makeItem('b', 'failed')]));
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    expect(screen.getByText('Download failed')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Resume download: Chapter Two'));
    expect(downloads.downloadChapter).toHaveBeenCalledWith(chapters[1]);
  });

  test('download all skips when every chapter is complete', () => {
    const downloads = makeDownloads({ statusOf: vi.fn().mockReturnValue('complete') });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    const button = screen.getByText('Download all') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('clear downloads removes all explicitly downloaded chapters at once', () => {
    const downloads = makeDownloads({
      statuses: new Map([
        [0, { total: 1, recorded: 1, packed: true, pinned: true, active: false }],
      ]),
      statusOf: vi
        .fn()
        .mockImplementation((chapter: DownloadChapter) =>
          chapter.key === 'a' ? 'complete' : 'none',
        ),
    });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);

    fireEvent.click(screen.getByText('Clear all'));
    expect(downloads.clearDownloads).toHaveBeenCalledTimes(1);
  });

  test('Cancel all replaces Download all while anything is queued', () => {
    const downloads = makeDownloads(withItems([makeItem('b', 'pending'), makeItem('c', 'failed')]));
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    fireEvent.click(screen.getByText('Cancel all (2)'));
    expect(downloads.cancelAll).toHaveBeenCalled();
    expect(screen.queryByText('Download all')).toBeNull();
  });

  test('chapter and batch actions keep a touch-sized hit target', () => {
    const downloads = makeDownloads(withItems([makeItem('b', 'pending')]));
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);

    expect(screen.getByLabelText('Remove from queue: Chapter Two').className).toContain(
      'touch-target',
    );
    expect(screen.getAllByLabelText(/^Download chapter:/)[0]!.className).toContain('touch-target');
    expect(screen.getByText('Cancel all (1)').className).toContain('touch-target');
  });

  test('disables download actions while Clear all is settling', () => {
    const downloads = makeDownloads({
      clearing: true,
      statuses: new Map([
        [0, { total: 1, recorded: 1, packed: true, pinned: true, active: false }],
      ]),
      statusOf: vi
        .fn()
        .mockImplementation((chapter: DownloadChapter) =>
          chapter.key === 'a' ? 'complete' : 'none',
        ),
    });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);

    expect((screen.getByText('Clear all') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Download all') as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText('Download chapter: Chapter Two') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test('keeps Clear all available for an orphaned active pin', () => {
    const downloads = makeDownloads({
      statuses: new Map([
        [0, { total: 0, recorded: 0, packed: false, pinned: false, active: true }],
      ]),
    });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    expect(screen.getByText('Clear all')).toBeTruthy();
  });

  test('marks the currently playing chapter', () => {
    render(<TTSChaptersView downloads={makeDownloads()} activeSectionIndex={1} isEink={false} />);
    expect(screen.getByLabelText('Now playing')).toBeTruthy();
  });

  test('scrolls instantly to the playing chapter on open', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<TTSChaptersView downloads={makeDownloads()} activeSectionIndex={1} isEink={false} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });

  test('does not scroll when no chapter is playing', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <TTSChaptersView downloads={makeDownloads()} activeSectionIndex={null} isEink={false} />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
