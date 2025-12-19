import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import {
  ReplacementRulesWindow,
  setReplacementRulesWindowVisible,
} from '@/app/reader/components/ReplacementRulesWindow';
import BookMenu from '@/app/reader/components/sidebar/BookMenu';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { ReplacementRule } from '@/types/book';

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

describe.skip('ReplacementRulesWindow', () => {
  beforeEach(() => {
    // Reset stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: { replacementRules: [] },
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

  it('renders book and global replacement rules from stores', async () => {
    // Arrange: populate stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: {
          replacementRules: [
            {
              id: 'g1',
              pattern: 'foo',
              replacement: 'bar',
              enabled: true,
              isRegex: false,
              caseSensitive: true,
              order: 1,
            },
            {
              id: 'b1',
              pattern: 'hello',
              replacement: 'world',
              enabled: true,
              isRegex: false,
              caseSensitive: true,
              order: 2,
            },
          ],
          kosync: { enabled: false },
        },
      },
    });

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            replacementRules: [],
          },
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Act: render and open dialog
    renderWithProviders(<ReplacementRulesWindow />);
    // wait a tick so the component's effect attaches the event listener
    await Promise.resolve();
    // open via helper which dispatches the custom event
    setReplacementRulesWindowVisible(true);

    // Assert
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    // Global rules
    expect(screen.getByText('foo')).toBeTruthy();
    expect(screen.getByText('bar')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('world')).toBeTruthy();
  });

  it('renders single-instance rules separately from book/global rules', async () => {
    // Arrange: populate stores with a single rule persisted in book config
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: { replacementRules: [] },
        kosync: { enabled: false },
      },
    });

    const singleRule: ReplacementRule = {
      id: 's1',
      pattern: 'only-once',
      replacement: 'single-hit',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 1,
      singleInstance: true,
    };

    const bookRule: ReplacementRule = {
      id: 'b1',
      pattern: 'book-wide',
      replacement: 'book-hit',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      order: 2,
    };

    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: {
          viewSettings: {
            replacementRules: [singleRule, bookRule],
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
              replacementRules: [singleRule, bookRule],
            },
          },
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });

    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Act: render and open dialog
    renderWithProviders(<ReplacementRulesWindow />);
    await Promise.resolve();
    setReplacementRulesWindowVisible(true);

    // Assert
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    // Single-instance section
    expect(screen.getByText('Single Instance Rules')).toBeTruthy();
    expect(screen.getByText('only-once')).toBeTruthy();
    expect(screen.getByText('single-hit')).toBeTruthy();

    // Book section should still show book-wide rule
    expect(screen.getByText('book-wide')).toBeTruthy();
    expect(screen.getByText('book-hit')).toBeTruthy();
  });

  it('opens when BookMenu item is clicked (integration)', async () => {
    // Arrange stores
    (useSettingsStore.setState as unknown as (state: unknown) => void)({
      settings: {
        globalViewSettings: { replacementRules: [] },
        kosync: { enabled: false },
      },
    });
    (useReaderStore.setState as unknown as (state: unknown) => void)({
      viewStates: {
        book1: { viewSettings: { replacementRules: [] } },
      },
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Render both menu and window
    renderWithProviders(
      <div>
        <BookMenu />
        <ReplacementRulesWindow />
      </div>,
    );

    // wait a tick so effects attach
    await Promise.resolve();

    // Click the menu item
    const menuItem = screen.getByRole('menuitem', { name: 'Replacement Rules' });
    fireEvent.click(menuItem);

    // The dialog should open
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('Replacement Rules')).toBeTruthy();
  });
});
