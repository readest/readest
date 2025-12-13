import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsDialog from '@/components/settings/SettingsDialog';
import { vi } from 'vitest';
import { EnvProvider } from '@/context/EnvContext';

// ---- Mock ResizeObserver (jsdom does not implement it) ----
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;

// ---- Settings store mock ----
vi.mock('@/store/settingsStore', () => {
  const mockSettingsState = {
    settings: {
      globalViewSettings: { replacementRules: [] },
      globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} },
      kosync: { enabled: false },
    },
    setSettingsDialogOpen: () => {},
    setFontPanelView: () => {},
    isSettingsGlobal: false,
    setSettings: () => {},
    saveSettings: () => {},
  };

  // create zustand-like function
  const useSettingsStoreMock = (() => mockSettingsState) as unknown as {
    (): typeof mockSettingsState;
    getState: () => typeof mockSettingsState;
    setState: (partial: Partial<typeof mockSettingsState>) => void;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };

  // attach zustand API
  useSettingsStoreMock.getState = () => mockSettingsState;
  useSettingsStoreMock.setState = (partial: Partial<typeof mockSettingsState>) => Object.assign(mockSettingsState, partial);
  useSettingsStoreMock.subscribe = () => () => {};
  useSettingsStoreMock.destroy = () => {};

  return {
    useSettingsStore: useSettingsStoreMock,
  };
});

// mock environment module so EnvProvider works
vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...(typeof actual === 'object' && actual !== null ? actual : {}), // keep ALL named exports including isTauriAppPlatform

    default: {
      ...(typeof actual === 'object' && actual !== null && 'default' in actual && typeof actual.default === 'object' && actual.default !== null ? actual.default : {}),
      API_BASE: 'http://localhost',
      ENABLE_TRANSLATOR: false,
      getAppService: vi.fn().mockResolvedValue(null),
    },

    // OPTIONAL: override isTauriAppPlatform if needed
    isTauriAppPlatform: vi.fn(() => false),
  };
});


describe('SettingsDialog Replacement tab', () => {
  it('shows Replacement panel when Replacement tab is clicked', async () => {
    render(<EnvProvider><SettingsDialog bookKey={''} /></EnvProvider>);

    // Find the Replacement tab button by accessible name
    const replacementButton = screen.getByRole('button', { name: /Text Replacements|Replacement/i });
    expect(replacementButton).toBeTruthy();

    // Click Replacement tab
    fireEvent.click(replacementButton);

    // Check that the panel heading appears
    const heading = await screen.findByRole('heading', { name: /replacement/i });
    expect(heading).toBeTruthy();
  });
});
