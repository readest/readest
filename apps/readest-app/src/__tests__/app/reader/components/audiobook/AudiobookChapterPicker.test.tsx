import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AudiobookChapterPicker from '@/app/reader/components/audiobook/AudiobookChapterPicker';
import type { AudiobookChapter } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, params?: Record<string, string>) =>
    Object.entries(params ?? {}).reduce(
      (result, [key, replacement]) => result.replace(`{{${key}}}`, replacement),
      value,
    ),
}));

const chapters: AudiobookChapter[] = Array.from({ length: 300 }, (_, index) => ({
  id: `audio-0:${index}`,
  fileId: 'audio-0',
  label: `Track ${index + 1}`,
  start: index * 60,
  end: (index + 1) * 60,
}));

describe('AudiobookChapterPicker', () => {
  it('renders one searchable audio list instead of duplicating it for every ebook row', () => {
    const onSelect = vi.fn();
    const onPreview = vi.fn();
    const { getAllByRole, getByRole, queryByRole } = render(
      <AudiobookChapterPicker
        chapters={chapters}
        value='audio-0:0'
        onSelect={onSelect}
        onPreview={onPreview}
        previewingId={null}
        onClose={vi.fn()}
      />,
    );

    expect(getAllByRole('option')).toHaveLength(301);
    fireEvent.change(getByRole('searchbox', { name: 'Search audio chapters' }), {
      target: { value: 'Track 299' },
    });

    expect(getAllByRole('option')).toHaveLength(2);
    expect(queryByRole('option', { name: /Track 1 ·/ })).toBeNull();
    fireEvent.click(getByRole('option', { name: /Track 299 ·/ }));
    expect(onSelect).toHaveBeenCalledWith('audio-0:298');

    fireEvent.click(getByRole('button', { name: 'Preview Track 299' }));
    expect(onPreview).toHaveBeenCalledWith(chapters[298]);
  });
});
