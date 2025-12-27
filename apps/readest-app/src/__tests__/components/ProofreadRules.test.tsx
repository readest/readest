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
      getAppService: vi.fn().mockResolvedValue(null),
    },
  };
});

import { EnvProvider } from '@/context/EnvContext';

function renderWithProviders(ui: React.ReactNode) {
  return render(<EnvProvider>{ui}</EnvProvider>);
}

describe('ProofreadRulesManager', () => {
  beforeEach(() => {
    // Reset stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: { proofreadRules: [] },
        kosync: {
          enabled: false,
        },
      },
    });
    (useReaderStore.setState as unknown as (state: unknown) => void)({ viewStates: {} });
    useSidebarStore.setState({ sideBarBookKey: null });
    (useBookDataStore.setState as unknown as (state: unknown) => void)({ booksData: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders book and library (global) proofreading rules from stores', async () => {
    // Arrange: populate stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
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
        kosync: { enabled: false },
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
    expect(screen.getByText('bar')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('world')).toBeTruthy();
  });

  it('renders selection rules separately from book/library rules', async () => {
    // Arrange: populate stores with a selection rule persisted in book config
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: { proofreadRules: [] },
        kosync: { enabled: false },
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
    expect(screen.getByText('single-hit')).toBeTruthy();

    // Book section should still show book-wide rule
    expect(screen.getByText('book-wide')).toBeTruthy();
    expect(screen.getByText('book-hit')).toBeTruthy();
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
        globalViewSettings: {
          proofreadRules: [libraryRule],
        },
        kosync: { enabled: false },
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
        globalViewSettings: { proofreadRules: [] },
        kosync: { enabled: false },
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
    expect(within(csRuleElement!).getByText(/Yes/)).toBeTruthy();

    const ciRuleElement = screen.getByText('case-insensitive').closest('li');
    expect(within(ciRuleElement!).getByText(/Case sensitive:/)).toBeTruthy();
    expect(within(ciRuleElement!).getByText(/No/)).toBeTruthy();
  });

  it('opens when BookMenu item is clicked (integration)', async () => {
    // Arrange stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: { proofreadRules: [] },
        kosync: { enabled: false },
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
        globalViewSettings: { proofreadRules: [] },
        kosync: { enabled: false },
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
        globalViewSettings: {
          proofreadRules: [libraryRule],
        },
        kosync: { enabled: false },
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
