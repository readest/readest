import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibraryHeader from '@/app/library/components/LibraryHeader';

const startDragging = vi.fn().mockResolvedValue(undefined);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindowBar: true } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isIPhoneDuo: false,
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ currentBookshelf: [] }),
}));

// macOS: native traffic lights, so WindowButtons shows no buttons of its own.
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: true }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  needsPointerWindowControls: () => false,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging,
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/app/library/components/SettingsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/LibrarySearchOptionsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));

const renderHeader = (isSelectMode: boolean) =>
  render(
    <LibraryHeader
      isSelectMode={isSelectMode}
      isSelectAll={false}
      onPullLibrary={vi.fn()}
      onImportBooksFromFiles={vi.fn()}
      onOpenCatalogManager={vi.fn()}
      onOpenFeeds={vi.fn()}
      onToggleSelectMode={vi.fn()}
      onSelectAll={vi.fn()}
      onDeselectAll={vi.fn()}
      searchQuery=''
      searchTarget='books'
      searchConfig={{} as never}
      onSearchConfigChange={vi.fn()}
      onSearchQueryChange={vi.fn()}
      onSearchTargetChange={vi.fn()}
    />,
  );

const pressHeader = async (header: Element) => {
  await act(async () => {
    fireEvent.mouseDown(header, { buttons: 1, detail: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('LibraryHeader window drag (#6917)', () => {
  afterEach(() => {
    cleanup();
    startDragging.mockClear();
  });

  it('drags the window from the header outside select mode', async () => {
    const { container } = renderHeader(false);
    await pressHeader(container.querySelector('.titlebar')!);

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it('keeps dragging the window from the header in select mode', async () => {
    const { container } = renderHeader(true);
    await pressHeader(container.querySelector('.titlebar')!);

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it('keeps dragging after switching into select mode', async () => {
    const { container, rerender } = renderHeader(false);
    rerender(
      <LibraryHeader
        isSelectMode
        isSelectAll={false}
        onPullLibrary={vi.fn()}
        onImportBooksFromFiles={vi.fn()}
        onOpenCatalogManager={vi.fn()}
        onOpenFeeds={vi.fn()}
        onToggleSelectMode={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        searchQuery=''
        searchTarget='books'
        searchConfig={{} as never}
        onSearchConfigChange={vi.fn()}
        onSearchQueryChange={vi.fn()}
        onSearchTargetChange={vi.fn()}
      />,
    );
    await pressHeader(container.querySelector('.titlebar')!);

    expect(startDragging).toHaveBeenCalledTimes(1);
  });
});
