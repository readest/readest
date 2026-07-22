import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

const chapters: DownloadChapter[] = [
  { key: 'a', label: 'Chapter One', depth: 0, startSection: 0, endSection: 1 },
  { key: 'b', label: 'Chapter Two', depth: 0, startSection: 1, endSection: 2 },
  { key: 'c', label: 'Chapter Three', depth: 1, startSection: 2, endSection: 3 },
];

const makeDownloads = (overrides: Partial<UseTTSDownloadsResult> = {}): UseTTSDownloadsResult => ({
  supported: true,
  chapters,
  statuses: new Map(),
  cacheBytes: 0,
  download: { activeChapterKey: null, done: 0, total: 0 },
  downloadChapter: vi.fn().mockResolvedValue(undefined),
  downloadAll: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  statusOf: vi.fn().mockReturnValue('none'),
  refresh: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('TTSChaptersView', () => {
  afterEach(() => cleanup());

  test('lists every chapter with a download control', () => {
    render(
      <TTSChaptersView downloads={makeDownloads()} activeSectionIndex={null} isEink={false} />,
    );
    expect(screen.getByText('Chapter One')).toBeTruthy();
    expect(screen.getByText('Chapter Three')).toBeTruthy();
    expect(screen.getAllByLabelText('Download chapter')).toHaveLength(3);
  });

  test('tapping a chapter badge downloads that chapter', () => {
    const downloads = makeDownloads();
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    fireEvent.click(screen.getAllByLabelText('Download chapter')[1]!);
    expect(downloads.downloadChapter).toHaveBeenCalledWith(chapters[1]);
  });

  test('a complete chapter shows the downloaded state and disables its badge', () => {
    const downloads = makeDownloads({
      statusOf: vi
        .fn()
        .mockImplementation((c: DownloadChapter) => (c.key === 'a' ? 'complete' : 'none')),
    });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    const downloaded = screen.getByLabelText('Downloaded') as HTMLButtonElement;
    expect(downloaded.disabled).toBe(true);
  });

  test('the active chapter shows live progress and a stop control', () => {
    const downloads = makeDownloads({
      download: { activeChapterKey: 'b', done: 3, total: 10 },
    });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    expect(screen.getByText('Downloading 3/10')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Stop downloading'));
    expect(downloads.cancel).toHaveBeenCalled();
  });

  test('download all skips when every chapter is complete', () => {
    const downloads = makeDownloads({ statusOf: vi.fn().mockReturnValue('complete') });
    render(<TTSChaptersView downloads={downloads} activeSectionIndex={null} isEink={false} />);
    const button = screen.getByText('Download all') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('marks the currently playing chapter', () => {
    render(<TTSChaptersView downloads={makeDownloads()} activeSectionIndex={1} isEink={false} />);
    expect(screen.getByLabelText('Now playing')).toBeTruthy();
  });
});
