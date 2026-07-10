import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * Redesign guard for issue #4831 (theme switcher hit targets & spacing).
 *
 * The three theme-mode toggles used to be tiny `btn-circle btn-sm` icons
 * separated by `gap-4`, so on mobile they were both hard to hit and easy to
 * mis-hit. They are now a segmented control: an ARIA `radiogroup` of three
 * adjacent `radio` segments, each with a comfortable tap target and no dead
 * space between them.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/atmosphereStore', () => ({
  useAtmosphereStore: () => ({
    spinDirection: null,
    shaking: false,
    toggle: vi.fn(),
    toggleWithShake: vi.fn(),
    deactivate: vi.fn(),
  }),
}));

import ThemeModeSelector from '@/components/settings/color/ThemeModeSelector';

afterEach(() => cleanup());

describe('ThemeModeSelector segmented control', () => {
  it('renders the three modes as a radiogroup of radio segments', () => {
    render(<ThemeModeSelector themeMode='light' onThemeModeChange={() => {}} />);

    expect(screen.getByRole('radiogroup')).not.toBeNull();
    const segments = screen.getAllByRole('radio');
    expect(segments).toHaveLength(3);
  });

  it('marks the active segment via aria-checked', () => {
    render(<ThemeModeSelector themeMode='dark' onThemeModeChange={() => {}} />);

    expect(screen.getByRole('radio', { name: 'Dark Mode' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Light Mode' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Auto Mode' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('switches mode when an inactive segment is clicked', () => {
    const onThemeModeChange = vi.fn();
    render(<ThemeModeSelector themeMode='light' onThemeModeChange={onThemeModeChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Auto Mode' }));
    expect(onThemeModeChange).toHaveBeenCalledWith('auto');
  });

  it('gives each segment a mobile-friendly tap target, not a tiny circle icon', () => {
    render(<ThemeModeSelector themeMode='auto' onThemeModeChange={() => {}} />);

    for (const segment of screen.getAllByRole('radio')) {
      expect(segment.className).toContain('min-w-[2.75rem]');
      expect(segment.className).toContain('h-9');
      expect(segment.className).not.toContain('btn-circle');
      expect(segment.className).not.toContain('btn-sm');
    }
  });

  it('marks the active segment for e-ink with a solid fill, not a nested border', () => {
    render(<ThemeModeSelector themeMode='light' onThemeModeChange={() => {}} />);

    // The track carries the outer e-ink border...
    expect(screen.getByRole('radiogroup').className).toContain('eink-bordered');
    // ...and the active thumb inverts (solid base-content fill) rather than
    // adding a second border that would nest inside the track's outline.
    const active = screen.getByRole('radio', { name: 'Light Mode' });
    expect(active.className).toContain('eink-inverted');
    expect(active.className).not.toContain('eink-bordered');
  });
});
