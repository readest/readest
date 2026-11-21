// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';

const h = vi.hoisted(() => ({ aiEnabled: false }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: h.aiEnabled } } }),
}));

beforeEach(() => {
  h.aiEnabled = false;
});

afterEach(cleanup);

describe('NotebookTabNavigation design regression', () => {
  const tabNames = () => screen.getAllByRole('button').map((tab) => tab.getAttribute('aria-label'));

  // The Dictionary tab keeps the latest lookup beside the notes (#7730), so the
  // footer always has two tabs to switch between.
  it('shows the Notes and Dictionary tabs when AI is disabled', () => {
    render(<NotebookTabNavigation activeTab='notes' onTabChange={vi.fn()} />);

    expect(tabNames()).toEqual(['Notes', 'Dictionary']);
  });

  it('shows the Notes, AI and Dictionary tabs when AI is enabled', () => {
    h.aiEnabled = true;
    render(<NotebookTabNavigation activeTab='notes' onTabChange={vi.fn()} />);

    expect(tabNames()).toEqual(['Notes', 'AI', 'Dictionary']);
  });

  // The active tab is shown by its background alone; screen readers need the
  // state too.
  it('marks only the active tab as pressed', () => {
    render(<NotebookTabNavigation activeTab='dictionary' onTabChange={vi.fn()} />);

    const pressed = screen
      .getAllByRole('button')
      .map((tab) => [tab.getAttribute('aria-label'), tab.getAttribute('aria-pressed')]);
    expect(pressed).toEqual([
      ['Notes', 'false'],
      ['Dictionary', 'true'],
    ]);
  });

  it('switches to the Dictionary tab', () => {
    const onTabChange = vi.fn();
    render(<NotebookTabNavigation activeTab='notes' onTabChange={onTabChange} />);

    screen.getByRole('button', { name: 'Dictionary' }).click();

    expect(onTabChange).toHaveBeenCalledWith('dictionary');
  });
});
