import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BookNote } from '@/types/book';

/**
 * Issue #5785: the note cards in the annotation bubble popup used to drop the
 * note in as a bare text node, so newlines collapsed and Markdown syntax showed
 * verbatim, while the sidebar rendered the same note through Marked. The popup
 * must go through the same note parser as the sidebar so both previews agree.
 */

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false }, envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ viewSettings: {} }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn(), getViewsById: () => [] }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ setSideBarVisible: vi.fn() }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import AnnotationNotes from '@/app/reader/components/annotator/AnnotationNotes';

dayjs.extend(relativeTime);

afterEach(() => {
  cleanup();
});

const renderNote = (note: string, isVertical = false) => {
  const item: BookNote = {
    id: 'n1',
    type: 'annotation',
    cfi: 'epubcfi(/6/2!/4/1:0)',
    note,
    text: 'Gryphon',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return render(
    <AnnotationNotes
      bookKey='test'
      isVertical={isVertical}
      notes={[item]}
      toolsVisible={false}
      triangleDir='up'
      popupWidth={240}
      popupHeight={120}
      onDismiss={() => {}}
    />,
  );
};

describe('AnnotationNotes markdown rendering', () => {
  it('renders headings and lists as HTML instead of raw markdown text', () => {
    const { container } = renderNote('# Note Title\n\n- first point\n- second point');

    const card = container.querySelector('.popup-container') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe('Note Title');
    expect(card.querySelectorAll('li')).toHaveLength(2);
    expect(card.textContent).not.toContain('# Note Title');
    expect(card.textContent).not.toContain('- first point');
  });

  it('keeps paragraphs separate instead of collapsing them into one line', () => {
    const { container } = renderNote('first paragraph\n\nsecond paragraph');

    const paragraphs = container.querySelectorAll('.popup-container p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.textContent).toBe('first paragraph');
    expect(paragraphs[1]?.textContent).toBe('second paragraph');
  });

  it('renders inline math the same way the sidebar does', () => {
    // `word\n$x$` only parses as math with the sidebar's nonStandard KaTeX
    // option, so this proves the popup shares that parser config.
    const { container } = renderNote('energy\n$E=mc^2$');

    expect(container.querySelector('.popup-container math')).not.toBeNull();
  });

  it('still renders markdown in vertical writing mode', () => {
    const { container } = renderNote('# Vertical\n\n- a\n- b', true);

    const card = container.querySelector('.popup-container') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe('Vertical');
    expect(card.querySelectorAll('li')).toHaveLength(2);
  });
});
