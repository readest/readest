import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoverSearchDialog from '@/components/metadata/CoverSearchDialog';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

const { openBrowser, saveSettings, appService, openExternalUrl } = vi.hoisted(() => ({
  openBrowser: vi.fn(),
  saveSettings: vi.fn(),
  appService: { appPlatform: 'tauri' },
  openExternalUrl: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, options?: { name: string }) =>
    text.replace('{{name}}', options?.name ?? ''),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/services/webBrowser/webBrowser', () => ({ openWebBrowser: openBrowser }));
vi.mock('@/services/webBrowser/webBrowserOptions', () => ({
  getWebBrowserOptions: () => ({ labels: {} }),
}));
vi.mock('@/services/environment', () => ({}));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/utils/open', () => ({ openExternalUrl }));

beforeEach(() => {
  vi.clearAllMocks();
  openBrowser.mockResolvedValue({});
  appService.appPlatform = 'tauri';
  saveSettings.mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: {} as SystemSettings, saveSettings });
});
afterEach(cleanup);

const show = () =>
  render(
    <CoverSearchDialog title='雪 & Sea' author='An Author' onSelect={vi.fn()} onClose={vi.fn()} />,
  );

describe('cover search dialog', () => {
  it('launches each built-in image engine with the book title and author', async () => {
    show();
    expect(screen.queryByRole('textbox', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    for (const name of ['Google', 'Bing', 'DuckDuckGo', 'Add Search Engine']) {
      expect(screen.getByRole('button', { name }).querySelector('svg')).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    await waitFor(() => expect(openBrowser).toHaveBeenCalled());
    expect(new URL(openBrowser.mock.calls[0]![0]).searchParams.get('q')).toBe('雪 & Sea An Author');
    fireEvent.click(screen.getByRole('button', { name: 'Bing' }));
    await waitFor(() => expect(openBrowser).toHaveBeenCalledTimes(2));
    expect(new URL(openBrowser.mock.calls[1]![0]).hostname).toBe('www.bing.com');
    fireEvent.click(screen.getByRole('button', { name: 'DuckDuckGo' }));
    await waitFor(() => expect(openBrowser).toHaveBeenCalledTimes(3));
    const duckduckgo = new URL(openBrowser.mock.calls[2]![0]);
    expect(duckduckgo.hostname).toBe('duckduckgo.com');
    expect(duckduckgo.searchParams.get('q')).toBe('雪 & Sea An Author');
    expect(duckduckgo.searchParams.get('ia')).toBe('images');
  });

  it('offers search engines without a pasted image URL action', () => {
    show();
    expect(screen.queryByRole('textbox', { name: 'Image URL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use Image' })).toBeNull();
  });

  it('persists a custom engine, uses it, and removes it', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add Search Engine' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'My Images' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'URL Template' }), {
      target: { value: 'https://example.com/images?q=%WORD%' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings.coverSearchEngines?.[0]?.name).toBe('My Images');
    fireEvent.click(screen.getByRole('button', { name: 'My Images' }));
    await waitFor(() => expect(openBrowser).toHaveBeenCalled());
    expect(new URL(openBrowser.mock.calls[0]![0]).hostname).toBe('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Remove My Images' }));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.coverSearchEngines).toEqual([]),
    );
  });

  it('returns a selected native image to the editor before closing', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    openBrowser.mockResolvedValue({
      image: { url: 'https://example.com/cover.jpg', pageUrl: 'https://example.com/book' },
    });
    render(
      <CoverSearchDialog title='Book' author='Author' onSelect={onSelect} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    await screen.findByRole('button', { name: 'Use this cover' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use this cover' }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        'https://example.com/cover.jpg',
        'https://example.com/book',
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(openBrowser.mock.calls[0]![1]).toMatchObject({ selectImage: true });
  });

  it('discards a browser selection without fetching when confirmation is cancelled', async () => {
    const onSelect = vi.fn();
    openBrowser.mockResolvedValue({
      image: { url: 'https://example.com/cover.jpg', pageUrl: 'https://example.com/book' },
    });
    render(<CoverSearchDialog title='Book' author='' onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bing' }));
    await screen.findByRole('button', { name: 'Use this cover' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Use this cover' })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the picker open after a failed image fetch so the user can retry', async () => {
    const onClose = vi.fn();
    openBrowser.mockResolvedValue({
      image: { url: 'https://example.com/cover.jpg', pageUrl: 'https://example.com/book' },
    });
    render(
      <CoverSearchDialog
        title='Book'
        author=''
        onSelect={vi.fn().mockRejectedValue(new Error('fetch failed'))}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use this cover' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load'));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Bing' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('opens web searches externally without invoking a native browser', () => {
    appService.appPlatform = 'web';
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Bing' }));
    expect(openExternalUrl).toHaveBeenCalledOnce();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('rejects templates without a query placeholder before saving', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add Search Engine' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Images' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'URL Template' }), {
      target: { value: 'https://example.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toContain('%WORD%');
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
