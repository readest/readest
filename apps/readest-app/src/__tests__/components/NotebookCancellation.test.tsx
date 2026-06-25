import { render, act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotebookStore } from '@/store/notebookStore';
import { BookNote } from '@/types/book';

// ---------- Shared mutable test state ----------
let mockConfig: { booknotes: BookNote[] };
// biome-ignore lint/suspicious/noExplicitAny: mock
let mockView: any;
// biome-ignore lint/suspicious/noExplicitAny: mock
let mockViews: any[];
const mockSaveConfig = vi.fn();
const mockUpdateBooknotes = vi.fn((_key, notes) => ({ booknotes: notes }));

// ---------- Mocks ----------
vi.mock('@/utils/supabase', () => ({
  supabaseClient: {},
  supabaseAnonKey: 'mock-anon-key',
  supabaseUrl: 'https://mock-supabase.co',
}));

vi.mock('@/store/bookDataStore', () => {
  return {
    useBookDataStore: () => ({
      getConfig: () => mockConfig,
      saveConfig: mockSaveConfig,
      updateBooknotes: mockUpdateBooknotes,
      getBookData: () => ({ bookDoc: { metadata: { language: 'en' } } }),
    }),
  };
});

vi.mock('@/store/readerStore', () => {
  return {
    useReaderStore: () => ({
      getView: () => mockView,
      getProgress: () => ({ page: 1 }),
      getViewSettings: () => ({}),
      getViewsById: () => mockViews,
    }),
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    () => ({
      settings: {
        globalReadSettings: {
          notebookWidth: '300px',
          isNotebookPinned: true,
        },
      },
    }),
    {
      getState: () => ({
        settings: {
          globalReadSettings: {
            notebookWidth: '300px',
            isNotebookPinned: true,
          },
        },
      }),
    },
  ),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({}),
  // biome-ignore lint/suspicious/noExplicitAny: mock
  EnvProvider: ({ children }: any) => children,
}));

vi.mock('@/app/reader/components/notebook/NoteEditor', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock
  default: ({ onSave, onCancel }: any) => (
    <div>
      <button data-testid='save-btn' onClick={() => onSave({ cfi: 'test-cfi' }, 'Note text')}>
        Save
      </button>
      <button data-testid='cancel-btn' onClick={() => onCancel?.()}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock('@/app/reader/components/notebook/Header', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock
  default: ({ handleClose }: any) => (
    <div>
      <button data-testid='close-btn' onClick={handleClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock('@/app/reader/components/notebook/TabNavigation', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/sidebar/BooknoteItem', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/EmptyState', () => ({
  default: () => null,
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setActiveBooknoteType: vi.fn(),
    setBooknoteResults: vi.fn(),
    sideBarBookKey: 'book-1',
  }),
}));

// Mock useSwipeToDismiss
vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 0 },
    handleVerticalDragStart: vi.fn(),
  }),
}));

// Mock useShortcuts
vi.mock('@/hooks/useShortcuts', () => ({
  default: vi.fn(),
}));

import Notebook from '@/app/reader/components/notebook/Notebook';

beforeEach(() => {
  vi.clearAllMocks();
  mockView = {
    getCFI: vi.fn(() => 'test-cfi'),
    addAnnotation: vi.fn(),
  };
  mockViews = [mockView];
  mockConfig = {
    booknotes: [
      {
        id: '1',
        type: 'annotation',
        cfi: 'test-cfi',
        note: '',
        text: 'Selected text',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  };

  useNotebookStore.setState({
    notebookWidth: '300px',
    isNotebookVisible: true,
    isNotebookPinned: false,
    notebookActiveTab: 'notes',
    notebookNewAnnotation: {
      key: 'sel-1',
      text: 'Selected text',
      page: 1,
      // biome-ignore lint/suspicious/noExplicitAny: mock
      range: {} as any,
      index: 0,
      cfi: 'test-cfi',
    },
    notebookEditAnnotation: null,
    notebookAnnotationDrafts: {},
  });
});

afterEach(() => {
  cleanup();
});

describe('Notebook cancellation', () => {
  it('deletes empty highlight when NoteEditor onCancel is invoked', () => {
    render(<Notebook />);

    const cancelBtn = screen.getByTestId('cancel-btn');
    act(() => {
      cancelBtn.click();
    });

    // It should mark the highlight as deleted
    const deletedNote = mockConfig.booknotes.find((a) => a.cfi === 'test-cfi');
    expect(deletedNote).toBeDefined();
    expect(deletedNote?.deletedAt).toBeGreaterThan(0);
    expect(mockUpdateBooknotes).toHaveBeenCalled();
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('deletes empty highlight when header close button is clicked', () => {
    render(<Notebook />);

    const closeBtn = screen.getByTestId('close-btn');
    act(() => {
      closeBtn.click();
    });

    const deletedNote = mockConfig.booknotes.find((a) => a.cfi === 'test-cfi');
    expect(deletedNote?.deletedAt).toBeGreaterThan(0);
  });

  it('does not delete highlight if it has a non-empty note', () => {
    mockConfig.booknotes[0]!.note = 'Existing note content';
    render(<Notebook />);

    const cancelBtn = screen.getByTestId('cancel-btn');
    act(() => {
      cancelBtn.click();
    });

    const deletedNote = mockConfig.booknotes.find((a) => a.cfi === 'test-cfi');
    expect(deletedNote?.deletedAt).toBeUndefined();
  });

  it('cleans up empty highlight on unmount', () => {
    const { unmount } = render(<Notebook />);

    act(() => {
      unmount();
    });

    const deletedNote = mockConfig.booknotes.find((a) => a.cfi === 'test-cfi');
    expect(deletedNote?.deletedAt).toBeGreaterThan(0);
  });
});
