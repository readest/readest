// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: false } } }),
}));

afterEach(cleanup);

describe('Sidebar TabNavigation', () => {
  // The active tab is shown by its background alone; screen readers need the
  // state too.
  it('marks only the active tab as pressed', () => {
    render(<TabNavigation activeTab='annotations' onTabChange={vi.fn()} />);

    const pressed = screen
      .getAllByRole('button')
      .map((tab) => [tab.getAttribute('aria-label'), tab.getAttribute('aria-pressed')]);
    expect(pressed).toEqual([
      ['TOC', 'false'],
      ['Annotate', 'true'],
      ['Bookmark', 'false'],
    ]);
  });
});
