import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Navigation } from '@/app/opds/components/Navigation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindowBar: false, isMobile: false } }),
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
  isTauriAppPlatform: () => false,
  needsPointerWindowControls: () => false,
}));

afterEach(cleanup);

describe('OPDS Navigation header layout', () => {
  // The back/forward cluster and the Home button are siblings in the leading
  // slot. Without `flex` on that slot, `justify-start`/`gap-*` are inert and the
  // two stack vertically, overflowing the 48px header and clipping the arrows.
  it('lays the back/forward cluster and Home out in one row', () => {
    render(
      <Navigation
        onGoStart={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onSearch={vi.fn()}
        canGoBack={true}
        canGoForward={true}
        hasSearch={true}
      />,
    );

    const home = screen.getByTitle('Home');
    const leading = home.parentElement!;

    expect(leading.className).toMatch(/\bflex\b/);
    expect(leading.className).toMatch(/\bitems-center\b/);
  });
});
