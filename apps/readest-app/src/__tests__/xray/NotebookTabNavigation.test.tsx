import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';

const mocks = vi.hoisted(() => ({
  appService: { appPlatform: 'web' },
  settings: { aiSettings: { enabled: true, reedy: { enabled: true } } },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: mocks.settings }),
}));

describe('NotebookTabNavigation', () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.appService.appPlatform = 'web';
    mocks.settings.aiSettings.enabled = true;
    mocks.settings.aiSettings.reedy.enabled = true;
  });

  it('leaves a saved X-Ray tab when the current platform cannot render it', async () => {
    const onTabChange = vi.fn();

    render(
      <NotebookTabNavigation idPrefix='notebook' activeTab='xray' onTabChange={onTabChange} />,
    );

    expect(screen.queryByRole('tab', { name: 'X-Ray' })).toBeNull();
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('ai'));
  });

  it('moves focus and selection through the grouped controls with arrow keys', async () => {
    mocks.appService.appPlatform = 'tauri';
    const onTabChange = vi.fn();
    render(
      <NotebookTabNavigation idPrefix='notebook' activeTab='notes' onTabChange={onTabChange} />,
    );
    const notes = screen.getByRole('tab', { name: 'Notes', selected: true });
    expect(notes.tabIndex).toBe(0);
    expect(notes.getAttribute('aria-controls')).toBe('notebook-notes-panel');
    expect(screen.getByRole('tab', { name: 'AI' }).tabIndex).toBe(-1);

    notes.focus();
    const readerKeyDown = vi.fn();
    window.addEventListener('keydown', readerKeyDown);
    fireEvent.keyDown(notes, { key: 'ArrowRight' });
    window.removeEventListener('keydown', readerKeyDown);

    expect(readerKeyDown).not.toHaveBeenCalled();
    expect(onTabChange).toHaveBeenCalledWith('ai');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'AI' })),
    );
  });

  it('falls back from a saved X-Ray tab when Reedy is disabled', async () => {
    mocks.appService.appPlatform = 'tauri';
    mocks.settings.aiSettings.reedy.enabled = false;
    const onTabChange = vi.fn();

    render(
      <NotebookTabNavigation idPrefix='notebook' activeTab='xray' onTabChange={onTabChange} />,
    );

    expect(screen.queryByRole('tab', { name: 'X-Ray' })).toBeNull();
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('ai'));
  });

  it('returns to notes when AI is disabled', async () => {
    mocks.settings.aiSettings.enabled = false;
    const onTabChange = vi.fn();

    render(<NotebookTabNavigation idPrefix='notebook' activeTab='ai' onTabChange={onTabChange} />);

    expect(screen.queryByRole('tablist')).toBeNull();
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('notes'));
  });
});
