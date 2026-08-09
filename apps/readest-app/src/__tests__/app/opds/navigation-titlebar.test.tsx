import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Navigation } from '@/app/opds/components/Navigation';

const startDragging = vi.fn().mockResolvedValue(undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindowBar: true, isMobile: false } }),
}));

vi.mock('@/context/DropdownContext', () => ({
  useDropdownContext: () => null,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: { isEink: false } } }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging,
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  }),
}));

const renderNavigation = () =>
  render(
    <Navigation
      onGoStart={vi.fn()}
      onSearch={vi.fn()}
      canGoBack={false}
      canGoForward={false}
      hasSearch={true}
    />,
  );

const mouseDown = async (element: Element) => {
  await act(async () => {
    fireEvent.mouseDown(element, { buttons: 1, detail: 1 });
    await Promise.resolve();
  });
};

describe('OPDS Navigation title bar dragging (issue #5584)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('drags the window when the OPDS header chrome is pressed', async () => {
    renderNavigation();

    await mouseDown(screen.getByRole('banner'));

    expect(startDragging).toHaveBeenCalledOnce();
  });

  it('does not drag the window when the search field is pressed', async () => {
    renderNavigation();

    await mouseDown(screen.getByPlaceholderText('Search in OPDS Catalog...'));

    expect(startDragging).not.toHaveBeenCalled();
  });
});
