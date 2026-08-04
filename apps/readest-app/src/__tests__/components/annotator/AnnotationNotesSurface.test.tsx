import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

/**
 * The note cards shown when tapping an annotation are `.popup-container`s, so
 * they should wear the same chrome as every other popup (Popup.tsx): a
 * `base-300` surface that flips to `base-100` on dark themes, `base-content`
 * text, and a hairline border.
 *
 * They used to hardcode `bg-gray-600` + `text-white` instead, which left a dark
 * slate card hanging off the popup's tan `base-300` triangle on light themes,
 * and forced `eink:` overrides on every text node to stay legible.
 */

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false }, envConfig: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => ({ viewSettings: {} }), setConfig: vi.fn() }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn() }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ setSideBarVisible: vi.fn() }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

import AnnotationNotes from '@/app/reader/components/annotator/AnnotationNotes';

dayjs.extend(relativeTime);

afterEach(() => {
  cleanup();
});

const renderNotes = () =>
  render(
    <AnnotationNotes
      bookKey='test'
      isVertical={false}
      notes={[
        {
          id: 'n1',
          type: 'annotation',
          cfi: 'epubcfi(/6/2!/4/1:0)',
          note: 'Gryphon',
          text: 'Gryphon',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]}
      toolsVisible={false}
      triangleDir='up'
      popupWidth={240}
      popupHeight={120}
      onDismiss={() => {}}
    />,
  );

describe('AnnotationNotes popup surface', () => {
  it('paints the note card with the shared popup surface, not a hardcoded gray', () => {
    const { container } = renderNotes();

    const card = container.querySelector('.popup-container') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.className).not.toMatch(/bg-gray-/);
    expect(card.className).toContain('bg-base-300');
    expect(card.className).toContain('theme-dark:bg-base-100');
  });

  it('uses base-content text so no eink-only color override is needed', () => {
    const { container } = renderNotes();

    expect(container.querySelector('[class*="text-white"]')).toBeNull();
  });
});
