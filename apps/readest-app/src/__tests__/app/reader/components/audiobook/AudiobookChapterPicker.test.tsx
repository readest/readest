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
    const { container, getByRole } = render(
      <AudiobookChapterPicker
        chapters={chapters}
        value='audio-0:0'
        onSelect={onSelect}
        onPreview={onPreview}
        previewingId={null}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('[role="option"]')).toHaveLength(301);
    fireEvent.change(getByRole('searchbox', { name: 'Search audio chapters' }), {
      target: { value: 'Track 299' },
    });

    const filteredOptions = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(filteredOptions).toHaveLength(2);
    expect(container.textContent).not.toContain('Track 1 ·');
    fireEvent.click(filteredOptions[1]!);
    expect(onSelect).toHaveBeenCalledWith('audio-0:298');

    fireEvent.click(container.querySelector('button[aria-label="Preview Track 299"]')!);
    expect(onPreview).toHaveBeenCalledWith(chapters[298]);
  });
});
