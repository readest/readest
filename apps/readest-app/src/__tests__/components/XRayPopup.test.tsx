import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import XRayPopup from '@/app/reader/components/annotator/XRayPopup';

const h = vi.hoisted(() => ({
  isBookIndexed: vi.fn(async () => false),
  lookupTerm: vi.fn(() => new Promise(() => {})),
  notebookState: { isNotebookVisible: false, notebookActiveTab: 'notes' },
  sidebarState: { sideBarBookKey: 'another-book-view' },
}));

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: {
        enabled: true,
        provider: 'ai-gateway',
        aiGatewayApiKey: 'test-key',
      },
    },
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: (
    selector: (state: {
      setNotebookVisible: (visible: boolean) => void;
      setNotebookActiveTab: (tab: string) => void;
    }) => unknown,
  ) =>
    selector({
      setNotebookVisible: (visible) => {
        h.notebookState.isNotebookVisible = visible;
      },
      setNotebookActiveTab: (tab) => {
        h.notebookState.notebookActiveTab = tab;
      },
    }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: (
    selector: (state: { setSideBarBookKey: (bookKey: string) => void }) => unknown,
  ) =>
    selector({
      setSideBarBookKey: (bookKey) => {
        h.sidebarState.sideBarBookKey = bookKey;
      },
    }),
}));

vi.mock('@/services/ai/xrayService', () => ({
  lookupTerm: h.lookupTerm,
}));

vi.mock('@/services/ai/ragService', () => ({
  isBookIndexed: h.isBookIndexed,
}));

vi.mock('@/services/constants', () => ({
  DEFAULT_BOOK_SEARCH_CONFIG: {},
}));

beforeEach(() => {
  h.isBookIndexed.mockClear();
  h.lookupTerm.mockClear();
  h.notebookState.isNotebookVisible = false;
  h.notebookState.notebookActiveTab = 'notes';
  h.sidebarState.sideBarBookKey = 'another-book-view';
});

afterEach(() => cleanup());

describe('XRayPopup', () => {
  test('opens the AI notebook when the book needs indexing', async () => {
    const onDismiss = vi.fn();
    render(
      <XRayPopup
        term='Ada'
        bookKey='book-hash-view'
        maxPageIncluded={1}
        position={{ point: { x: 0, y: 0 } }}
        trianglePosition={{ point: { x: 0, y: 0 } }}
        popupWidth={320}
        popupHeight={240}
        onDismiss={onDismiss}
      />,
    );

    const button = await screen.findByRole('button', { name: 'AI' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(h.notebookState.isNotebookVisible).toBe(true);
      expect(h.notebookState.notebookActiveTab).toBe('ai');
      expect(h.sidebarState.sideBarBookKey).toBe('book-hash-view');
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
