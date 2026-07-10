import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import {
  ProofreadRulesManager,
  setProofreadRulesVisibility,
} from '@/app/reader/components/ProofreadRules';
import BookMenu from '@/app/reader/components/sidebar/BookMenu';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useProofreadStore } from '@/store/proofreadStore';
import { eventDispatcher } from '@/utils/event';
import { ProofreadRule } from '@/types/book';

// ------------------------------
// NEXT.JS ROUTER MOCK
// ------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: () => null,
    toString: () => '',
  }),
}));

// ------------------------------
// TRANSLATION MOCK
// ------------------------------
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/services/translators/cache', () => ({
  initCache: vi.fn(),
  loadCacheFromDB: vi.fn(),
  pruneCache: vi.fn(),
}));

// ------------------------------
// ENV PROVIDER WRAPPER
// ------------------------------
// mock environment module so EnvProvider uses fake values
vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...(typeof actual === 'object' && actual !== null ? actual : {}), // keep all real exports (e.g., isTauriAppPlatform)

    default: {
      ...(typeof actual === 'object' &&
      actual !== null &&
      'default' in actual &&
      typeof actual.default === 'object' &&
      actual.default !== null
        ? actual.default
        : {}), // keep all real default fields
      API_BASE: 'http://localhost',
      ENABLE_TRANSLATOR: false,
      // EnvProvider's mount effect calls appService.loadSettings() to seed
      // replica sync. Stubbing with loadSettings returning {} (no
      // replicaDeviceId) makes init early-exit cleanly. Returning null
      // would crash on `service.loadSettings()` and spam stderr.
      getAppService: vi.fn().mockResolvedValue({
        loadSettings: vi.fn().mockResolvedValue({}),
      }),
    },
  };
});

import { EnvProvider } from '@/context/EnvContext';
import { AuthProvider } from '@/context/AuthContext';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <EnvProvider>
      <AuthProvider>{ui}</AuthProvider>
    </EnvProvider>,
  );
}

describe('ProofreadRulesManager', () => {
  beforeEach(() => {
    // Reset stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: DEFAULT_SYSTEM_SETTINGS,
    });
    (useReaderStore.setState as unknown as (state: unknown) => void)({ viewStates: {} });
    useSidebarStore.setState({ sideBarBookKey: null });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({ booksData: {} });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders book and library (global) proofreading rules from stores', async () => {
    // Arrange: populate stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: {
          proofreadRules: [
            {
              id: 'g1',
              scope: 'library',
              pattern: 'foo',
              replacement: 'bar',
              enabled: true,
              isRegex: false,
              caseSensitive: true,
              order: 1,
              wholeWord: true,
            },
            {
              id: 'g2',
              scope: 'library',
              pattern: 'hello',
              replacement: 'world',
              enabled: true,
              isRegex: false,
              caseSensitive: true,
              order: 2,
              wholeWord: true,
            },
          ],
        },
      },
    });

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            proofreadRules: [],
          },
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Act: render and open dialog
    renderWithProviders(<ProofreadRulesManager />);
    // wait a tick so the component's effect attaches the event listener
    await Promise.resolve();
    // open via helper which dispatches the custom event
    setProofreadRulesVisibility(true);

    // Assert
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    // Library (global) rules
    expect(screen.getByText('foo')).toBeTruthy();
    expect(screen.getByText("'bar'")).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText("'world'")).toBeTruthy();
  });

  it('renders selection rules separately from book/library rules', async () => {
    // Arrange: populate stores with a selection rule persisted in book config
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: { proofreadRules: [] },
      },
    });

    const selectionRule: ProofreadRule = {
      id: 's1',
      scope: 'selection',
      pattern: 'only-once',
      replacement: 'single-hit',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
      cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
      sectionHref: 'chapter1.html',
    };

    const bookRule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'book-wide',
      replacement: 'book-hit',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 2,
      wholeWord: true,
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            proofreadRules: [selectionRule, bookRule],
          },
        },
      },
    });

    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: {
            viewSettings: {
              proofreadRules: [selectionRule, bookRule],
            },
          },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Act: render and open dialog
    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    // Assert
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    // Single Instance Rules section
    expect(screen.getByText('Selected Text Rules')).toBeTruthy();
    expect(screen.getByText('only-once')).toBeTruthy();
    expect(screen.getByText("'single-hit'")).toBeTruthy();

    // Book section should still show book-wide rule
    expect(screen.getByText('book-wide')).toBeTruthy();
    expect(screen.getByText("'book-hit'")).toBeTruthy();
  });

  it('hides tombstoned (deleted) book rules from the list', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });

    const liveRule: ProofreadRule = {
      id: 'live',
      scope: 'book',
      pattern: 'visible-pattern',
      replacement: 'kept',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };
    const deletedRule: ProofreadRule = {
      id: 'dead',
      scope: 'book',
      pattern: 'deleted-pattern',
      replacement: 'gone',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 2,
      wholeWord: true,
      updatedAt: 5,
      deletedAt: 10,
    };
    const rules = [liveRule, deletedRule];

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: rules } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: rules } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    await screen.findByRole('dialog');
    expect(screen.getByText('visible-pattern')).toBeTruthy();
    expect(screen.queryByText('deleted-pattern')).toBeNull();
  });

  it('keeps a disabled book rule visible so it can be re-enabled', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });

    const disabledRule: ProofreadRule = {
      id: 'd1',
      scope: 'book',
      pattern: 'disabled-pattern',
      replacement: 'x',
      enabled: false,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: [disabledRule] } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: [disabledRule] } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    await screen.findByRole('dialog');
    expect(screen.getByText('disabled-pattern')).toBeTruthy();
  });

  it('toggles a rule on/off via its switch', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });

    const rule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'toggle-me',
      replacement: 'x',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: [rule] } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: [rule] } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    const toggleSpy = vi
      .spyOn(useProofreadStore.getState(), 'toggleRule')
      .mockResolvedValue(undefined);
    const recreateSpy = vi
      .spyOn(useReaderStore.getState(), 'recreateViewer')
      .mockResolvedValue(undefined as never);

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);
    await screen.findByRole('dialog');

    const row = screen.getByText('toggle-me').closest('li');
    const toggle = within(row!).getByLabelText('Disable rule');
    fireEvent.click(toggle);

    await new Promise((r) => setTimeout(r, 0));

    expect(toggleSpy).toHaveBeenCalledWith(expect.anything(), 'book1', 'b1');
    expect(recreateSpy).toHaveBeenCalled();
  });

  it('edits a book rule Find pattern and saves via updateRule', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });

    const rule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'old-find',
      replacement: 'r',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: [rule] } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: [rule] } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    const updateSpy = vi
      .spyOn(useProofreadStore.getState(), 'updateRule')
      .mockResolvedValue(undefined);
    vi.spyOn(useReaderStore.getState(), 'recreateViewer').mockResolvedValue(undefined as never);

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);
    await screen.findByRole('dialog');

    const row = screen.getByText('old-find').closest('li');
    fireEvent.click(within(row!).getByLabelText('Edit'));

    const findInput = screen.getByDisplayValue('old-find') as HTMLInputElement;
    expect(findInput.disabled).toBe(false);
    fireEvent.change(findInput, { target: { value: 'new-find' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await new Promise((r) => setTimeout(r, 0));

    expect(updateSpy).toHaveBeenCalledWith(
      expect.anything(),
      'book1',
      'b1',
      expect.objectContaining({ pattern: 'new-find' }),
    );
  });

  it('keeps Find read-only when editing a selection rule', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });

    const sel: ProofreadRule = {
      id: 's1',
      scope: 'selection',
      pattern: 'sel-text',
      replacement: 'r',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
      cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
      sectionHref: 'chapter1.html',
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: [sel] } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: [sel] } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);
    await screen.findByRole('dialog');

    const row = screen.getByText('sel-text').closest('li');
    fireEvent.click(within(row!).getByLabelText('Edit'));

    const findInput = screen.getByDisplayValue('sel-text') as HTMLInputElement;
    expect(findInput.disabled).toBe(true);
  });

  it('warns and does not save when the edited regex is invalid', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });

    const rule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'valid',
      replacement: 'r',
      enabled: true,
      isRegex: true,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: [rule] } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: [rule] } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    const updateSpy = vi
      .spyOn(useProofreadStore.getState(), 'updateRule')
      .mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);
    await screen.findByRole('dialog');

    const row = screen.getByText('valid').closest('li');
    fireEvent.click(within(row!).getByLabelText('Edit'));

    const findInput = screen.getByDisplayValue('valid') as HTMLInputElement;
    fireEvent.change(findInput, { target: { value: '(' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await new Promise((r) => setTimeout(r, 0));

    expect(updateSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'warning' }));
  });

  it('renders a drag handle for each reorderable rule', async () => {
    const selectionRule: ProofreadRule = {
      id: 's1',
      scope: 'selection',
      pattern: 'only-once',
      replacement: 'single-hit',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
      cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
      sectionHref: 'chapter1.html',
    };
    const bookRule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'book-wide',
      replacement: 'book-hit',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 2,
      wholeWord: true,
    };

    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: { ...DEFAULT_SYSTEM_SETTINGS, globalViewSettings: { proofreadRules: [] } },
    });
    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: { book1: { viewSettings: { proofreadRules: [selectionRule, bookRule] } } },
    });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: { viewSettings: { proofreadRules: [selectionRule, bookRule] } },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);
    await screen.findByRole('dialog');

    const handles = screen.getAllByLabelText('Drag to reorder');
    expect(handles.length).toBe(2);
  });

  it('displays correct scope labels for different rule types', async () => {
    const selectionRule: ProofreadRule = {
      id: 's1',
      scope: 'selection',
      pattern: 'select-text',
      replacement: 'replaced',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
      cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
      sectionHref: 'chapter1.html',
    };

    const bookRule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'book-pattern',
      replacement: 'book-replaced',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 2,
      wholeWord: true,
    };

    const libraryRule: ProofreadRule = {
      id: 'l1',
      scope: 'library',
      pattern: 'library-pattern',
      replacement: 'library-replaced',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 3,
      wholeWord: true,
    };

    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: {
          proofreadRules: [libraryRule],
        },
      },
    });

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            proofreadRules: [selectionRule, bookRule],
          },
        },
      },
    });

    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: {
            viewSettings: {
              proofreadRules: [selectionRule, bookRule],
            },
          },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    const selectionRuleElement = screen.getByText('select-text').closest('li');
    expect(within(selectionRuleElement!).getByText(/Selection/)).toBeTruthy();

    const bookRuleElement = screen.getByText('book-pattern').closest('li');
    expect(within(bookRuleElement!).getByText(/Book/)).toBeTruthy();

    const libraryRuleElement = screen.getByText('library-pattern').closest('li');
    expect(within(libraryRuleElement!).getByText(/Library/)).toBeTruthy();
  });

  it('shows case sensitivity status for each rule', async () => {
    const caseSensitiveRule: ProofreadRule = {
      id: 'cs1',
      scope: 'book',
      pattern: 'case-sensitive',
      replacement: 'CS-REPLACED',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };

    const caseInsensitiveRule: ProofreadRule = {
      id: 'ci1',
      scope: 'book',
      pattern: 'case-insensitive',
      replacement: 'CI-REPLACED',
      enabled: true,
      isRegex: false,
      caseSensitive: false,
      order: 2,
      wholeWord: true,
    };

    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: { proofreadRules: [] },
      },
    });

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            proofreadRules: [caseSensitiveRule, caseInsensitiveRule],
          },
        },
      },
    });

    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: {
            viewSettings: {
              proofreadRules: [caseSensitiveRule, caseInsensitiveRule],
            },
          },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    const csRuleElement = screen.getByText('case-sensitive').closest('li');
    expect(within(csRuleElement!).getByText(/Case sensitive:/)).toBeTruthy();
    expect(within(csRuleElement!).getAllByText(/Yes/)).toBeTruthy();

    const ciRuleElement = screen.getByText('case-insensitive').closest('li');
    expect(within(ciRuleElement!).getByText(/Case sensitive:/)).toBeTruthy();
    expect(within(ciRuleElement!).getAllByText(/No/)).toBeTruthy();
  });

  it('opens when BookMenu item is clicked (integration)', async () => {
    // Arrange stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: { proofreadRules: [] },
      },
    });
    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: { viewSettings: { proofreadRules: [] } },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Render both menu and window
    renderWithProviders(
      <div>
        <BookMenu />
        <ProofreadRulesManager />
      </div>,
    );

    // wait a tick so effects attach
    await Promise.resolve();

    // Click the menu item
    const menuItem = screen.getByRole('menuitem', { name: 'Proofread' });
    fireEvent.click(menuItem);

    // The dialog should open
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('Proofread Replacement Rules')).toBeTruthy();
  });

  it('shows empty state messages when no rules exist', async () => {
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: { proofreadRules: [] },
      },
    });

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            proofreadRules: [],
          },
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    // Check for empty state messages
    expect(screen.getByText('No selected text replacement rules')).toBeTruthy();
    expect(screen.getByText('No book-level replacement rules')).toBeTruthy();
  });

  describe('Add Rule form', () => {
    const openManagerForAdd = async () => {
      (useSettingsStore.setState as unknown as (state: unknown) => void)({
        settings: {
          ...DEFAULT_SYSTEM_SETTINGS,
          globalViewSettings: { proofreadRules: [] },
        },
      });
      (useReaderStore.setState as unknown as (state: unknown) => void)({
        viewStates: { book1: { viewSettings: { proofreadRules: [] } } },
      });
      useSidebarStore.setState({ sideBarBookKey: 'book1' });

      const addRuleSpy = vi
        .spyOn(useProofreadStore.getState(), 'addRule')
        .mockResolvedValue({} as ProofreadRule);
      const recreateSpy = vi
        .spyOn(useReaderStore.getState(), 'recreateViewer')
        .mockResolvedValue(undefined as never);

      renderWithProviders(<ProofreadRulesManager />);
      await Promise.resolve();
      setProofreadRulesVisibility(true);
      await screen.findByRole('dialog');

      return { addRuleSpy, recreateSpy };
    };

    it('creates a book-scoped rule from typed pattern + replacement', async () => {
      const { addRuleSpy } = await openManagerForAdd();

      fireEvent.change(screen.getByPlaceholderText('Find...'), { target: { value: 'colour' } });
      fireEvent.change(screen.getByPlaceholderText('Replace with...'), {
        target: { value: 'color' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));

      await new Promise((r) => setTimeout(r, 0));

      expect(addRuleSpy).toHaveBeenCalledWith(
        expect.anything(),
        'book1',
        expect.objectContaining({
          scope: 'book',
          pattern: 'colour',
          replacement: 'color',
          isRegex: false,
        }),
      );
    });

    it('creates a regex rule when the Regex toggle is on', async () => {
      const { addRuleSpy } = await openManagerForAdd();

      fireEvent.change(screen.getByPlaceholderText('Find...'), { target: { value: '\\d+' } });
      fireEvent.change(screen.getByPlaceholderText('Replace with...'), {
        target: { value: '#' },
      });
      const regexLabel = screen.getByText('Regex:');
      const regexCheckbox = regexLabel
        .closest('label')!
        .querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(regexCheckbox);

      fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));

      await new Promise((r) => setTimeout(r, 0));

      expect(addRuleSpy).toHaveBeenCalledWith(
        expect.anything(),
        'book1',
        expect.objectContaining({ pattern: '\\d+', isRegex: true }),
      );
    });

    it('disables the Add Rule button until a find pattern is entered', async () => {
      const { addRuleSpy } = await openManagerForAdd();
      const button = screen.getByRole('button', { name: 'Add Rule' }) as HTMLButtonElement;

      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      await new Promise((r) => setTimeout(r, 0));
      expect(addRuleSpy).not.toHaveBeenCalled();

      fireEvent.change(screen.getByPlaceholderText('Find...'), { target: { value: 'colour' } });
      expect(button.disabled).toBe(false);
    });

    it('warns and does not add when the regex is invalid', async () => {
      const { addRuleSpy } = await openManagerForAdd();
      const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

      fireEvent.change(screen.getByPlaceholderText('Find...'), { target: { value: '(' } });
      const regexLabel = screen.getByText('Regex:');
      const regexCheckbox = regexLabel
        .closest('label')!
        .querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(regexCheckbox);
      fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));

      await new Promise((r) => setTimeout(r, 0));

      expect(addRuleSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ type: 'warning' }),
      );
    });
  });

  it('merges book and library rules correctly in book section', async () => {
    const libraryRule: ProofreadRule = {
      id: 'l1',
      scope: 'library',
      pattern: 'library-wide',
      replacement: 'LIBRARY',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      wholeWord: true,
    };

    const bookRule: ProofreadRule = {
      id: 'b1',
      scope: 'book',
      pattern: 'book-specific',
      replacement: 'BOOK',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 2,
      wholeWord: true,
    };

    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        globalViewSettings: {
          proofreadRules: [libraryRule],
        },
      },
    });

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            proofreadRules: [bookRule],
          },
        },
      },
    });

    (useBookDataStore.setState as unknown as (state: unknown) => void)({
      booksData: {
        book1: {
          id: 'book1',
          book: null,
          file: null,
          config: {
            viewSettings: {
              proofreadRules: [bookRule],
            },
          },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    renderWithProviders(<ProofreadRulesManager />);
    await Promise.resolve();
    setProofreadRulesVisibility(true);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    // Both library and book rules should appear in the Book Specific Rules section
    expect(screen.getByText('library-wide')).toBeTruthy();
    expect(screen.getByText('book-specific')).toBeTruthy();

    // But they should both be under Book Specific Rules section
    const bookSection = screen.getByText('Book Specific Rules').parentElement;
    expect(within(bookSection!).getByText('library-wide')).toBeTruthy();
    expect(within(bookSection!).getByText('book-specific')).toBeTruthy();
  });
});
