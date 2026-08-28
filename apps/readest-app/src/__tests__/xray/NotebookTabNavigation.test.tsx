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
    mocks.settings.aiSettings.reedy.enabled = true;
  });

  it('leaves a saved X-Ray tab when the current platform cannot render it', async () => {
    const onTabChange = vi.fn();

    render(<NotebookTabNavigation activeTab='xray' onTabChange={onTabChange} />);

    expect(screen.queryByRole('button', { name: 'X-Ray' })).toBeNull();
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('ai'));
  });

  it('moves focus and selection through the grouped controls with arrow keys', async () => {
    mocks.appService.appPlatform = 'tauri';
    const onTabChange = vi.fn();
    render(<NotebookTabNavigation activeTab='notes' onTabChange={onTabChange} />);
    const notes = screen.getByRole('button', { name: 'Notes' });

    notes.focus();
    fireEvent.keyDown(notes, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('ai');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI' })),
    );
  });

  it('falls back from a saved X-Ray tab when Reedy is disabled', async () => {
    mocks.appService.appPlatform = 'tauri';
    mocks.settings.aiSettings.reedy.enabled = false;
    const onTabChange = vi.fn();

    render(<NotebookTabNavigation activeTab='xray' onTabChange={onTabChange} />);

    expect(screen.queryByRole('button', { name: 'X-Ray' })).toBeNull();
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('ai'));
  });
});
