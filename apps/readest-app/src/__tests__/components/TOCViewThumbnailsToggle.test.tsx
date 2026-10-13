import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookDoc, TOCItem } from '@/libs/document';

let mockViewSettings: { isEink: boolean; showTOCThumbnails?: boolean };
let renderedRowCount: number | undefined;

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => undefined,
    getViewSettings: () => mockViewSettings,
    getProgress: () => null,
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: 'book1', isSideBarVisible: true }),
}));

vi.mock('@/services/nav', () => ({ findParentPath: () => [] }));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/utils/misc', () => ({ getContentMd5: (s: string) => s }));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));

vi.mock('@/app/reader/hooks/useTextTranslation', () => ({
  useTextTranslation: () => {},
}));

vi.mock('react-virtuoso', async () => {
  const ReactMod = await import('react');
  return {
    Virtuoso: ReactMod.forwardRef((props: { totalCount: number }, _ref: React.Ref<unknown>) => {
      renderedRowCount = props.totalCount;
      return null;
    }),
  };
});

vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: () => [vi.fn(), () => undefined],
}));

// eslint-disable-next-line import/first
import TOCView from '@/app/reader/components/sidebar/TOCView';

// A 6-page PDF without an outline: the TOC lists every page as a thumbnail.
const pdfDoc = {
  sections: Array.from({ length: 6 }, (_, i) => ({ id: i })),
  rendition: { layout: 'pre-paginated' },
  getPageThumbnail: vi.fn(),
} as unknown as BookDoc;
const noToc: TOCItem[] = [];

beforeEach(() => {
  mockViewSettings = { isEink: false };
  renderedRowCount = undefined;
});

afterEach(() => {
  cleanup();
});

describe('TOCView page thumbnails toggle', () => {
  it('shows page thumbnails by default', () => {
    render(<TOCView bookKey='book1' bookDoc={pdfDoc} toc={noToc} />);
    expect(renderedRowCount).toBeGreaterThan(0);
  });

  it('hides page thumbnails when showTOCThumbnails is off', () => {
    mockViewSettings = { isEink: false, showTOCThumbnails: false };
    render(<TOCView bookKey='book1' bookDoc={pdfDoc} toc={noToc} />);
    expect(renderedRowCount).toBe(0);
  });
});
