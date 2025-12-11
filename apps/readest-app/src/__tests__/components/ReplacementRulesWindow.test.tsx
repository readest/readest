import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import { ReplacementRulesWindow, setReplacementRulesWindowVisible } from '@/app/reader/components/ReplacementRulesWindow';
import BookMenu from '@/app/reader/components/sidebar/BookMenu';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';

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
      ...(typeof actual === 'object' && actual !== null && 'default' in actual && typeof actual.default === 'object' && actual.default !== null ? actual.default : {}), // keep all real default fields
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


describe('ReplacementRulesWindow', () => {
  beforeEach(() => {
    // Reset stores
    useSettingsStore.setState({
        settings: {
            globalViewSettings: { replacementRules: [] },
            kosync: {
                enabled: false,
            },
        } as unknown as Parameters<typeof useSettingsStore.setState>[0],
    });
    useReaderStore.setState({ viewStates: {} as unknown as Parameters<typeof useReaderStore.setState>[0] });
    useSidebarStore.setState({ sideBarBookKey: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders book and global replacement rules from stores', async () => {
    // Arrange: populate stores
    useSettingsStore.setState({
      settings: {
        globalViewSettings: {
          replacementRules: [
            { id: 'g1', pattern: 'foo', replacement: 'bar', enabled: true, isRegex: false, order: 1 },
          ],
          kosync: { enabled: false },
        },
      } as unknown as Parameters<typeof useSettingsStore.setState>[0],
    });

    useReaderStore.setState({
      viewStates: {
        book1: {
          viewSettings: {
            replacementRules: [
              { id: 'b1', pattern: 'hello', replacement: 'world', enabled: false, isRegex: false, order: 2 },
            ],
          },
        },
      } as unknown as Parameters<typeof useReaderStore.setState>[0],
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
    // Book rule
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('world')).toBeTruthy();
    // Global rule
    expect(screen.getByText('foo')).toBeTruthy();
    expect(screen.getByText('bar')).toBeTruthy();
  });

  it('opens when BookMenu item is clicked (integration)', async () => {
    // Arrange stores
    useSettingsStore.setState({
      settings: {
        globalViewSettings: { replacementRules: [] },
        kosync: { enabled: false },
      } as unknown as Parameters<typeof useSettingsStore.setState>[0],
    });
    useReaderStore.setState({
      viewStates: {
        book1: { viewSettings: { replacementRules: [] } },
      } as unknown as Parameters<typeof useReaderStore.setState>[0],
    });
    useSidebarStore.setState({ sideBarBookKey: 'book1' });

    // Render both menu and window
    renderWithProviders(
      <div>
        <BookMenu />
        <ReplacementRulesWindow />
      </div>
    );

    // wait a tick so effects attach
    await Promise.resolve();

    // Click the menu item
    const menuItem = screen.getByRole('menuitem', { name: 'Replacement Rules' });
    fireEvent.click(menuItem);

    // The dialog should open
    const dialog = await screen.findByRole('dialog');

    expect(
    within(dialog).getByText('Replacement Rules')
    ).toBeTruthy();
  });
});
