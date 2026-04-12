import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Mock zustand stores before importing the component
vi.mock('@/store/atmosphereStore', () => ({
  useAtmosphereStore: vi.fn(),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

import AtmosphereOverlay from '@/components/AtmosphereOverlay';
import { useAtmosphereStore } from '@/store/atmosphereStore';
import { useThemeStore } from '@/store/themeStore';

afterEach(cleanup);

const setupStores = (active: boolean) => {
  vi.mocked(useAtmosphereStore).mockImplementation((selector: unknown) =>
    (selector as (s: { active: boolean }) => unknown)({ active }),
  );
  vi.mocked(useThemeStore).mockImplementation((selector: unknown) =>
    (selector as (s: { isDarkMode: boolean }) => unknown)({ isDarkMode: false }),
  );
};

describe('AtmosphereOverlay', () => {
  it('does not render <video> element when inactive', () => {
    setupStores(false);
    const { container } = render(<AtmosphereOverlay />);
    const video = container.querySelector('video');
    expect(video).toBeNull();
  });

  it('renders <video> element when active', () => {
    setupStores(true);
    const { container } = render(<AtmosphereOverlay />);
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
  });
});
