import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';

const h = vi.hoisted(() => ({ aiEnabled: false, hasInk: false }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: h.aiEnabled } } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () =>
      h.hasInk ? { handwriting: { version: 1, pages: { 'pdf:0': {} } } } : undefined,
  }),
}));

beforeEach(() => {
  h.aiEnabled = false;
  h.hasInk = false;
});

afterEach(cleanup);

describe('NotebookTabNavigation design regression', () => {
  it('does not reserve an empty footer when AI is disabled', () => {
    const { container } = render(
      <NotebookTabNavigation bookKey='k' activeTab='notes' onTabChange={vi.fn()} />,
    );

    expect(container.querySelector('.bottom-tab')).toBeNull();
  });

  it('shows the Notes and AI tabs when AI is enabled', () => {
    h.aiEnabled = true;
    render(<NotebookTabNavigation bookKey='k' activeTab='notes' onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI' })).toBeTruthy();
  });

  it('hides the ink tab when the book has no handwriting', () => {
    h.aiEnabled = true;
    h.hasInk = false;
    render(<NotebookTabNavigation bookKey='k' activeTab='notes' onTabChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Handwriting' })).toBeNull();
  });

  it('shows the ink tab once the book has handwriting', () => {
    h.aiEnabled = true;
    h.hasInk = true;
    render(<NotebookTabNavigation bookKey='k' activeTab='notes' onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Handwriting' })).toBeTruthy();
  });

  it('shows Notes alongside ink even with AI disabled, so ink is reachable', () => {
    h.aiEnabled = false;
    h.hasInk = true;
    render(<NotebookTabNavigation bookKey='k' activeTab='notes' onTabChange={vi.fn()} />);

    // Ink is only useful if the reader can get to it; Notes keeps the bar from
    // being a single-button footer.
    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Handwriting' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();
  });
});
