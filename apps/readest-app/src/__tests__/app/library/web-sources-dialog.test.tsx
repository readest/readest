import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const { openMock, saveSettingsMock, setSettingsMock, navigateMock, settingsState } = vi.hoisted(
  () => ({
    openMock: vi.fn(),
    saveSettingsMock: vi.fn(),
    setSettingsMock: vi.fn(),
    navigateMock: vi.fn(),
    settingsState: {
      settings: { webSources: [] as Array<{ id: string; name: string; url: string }> },
    },
  }),
);

vi.mock('@/services/webBrowser/webBrowser', () => ({ openWebBrowser: openMock }));
vi.mock('@/services/webBrowser/webBrowserOptions', () => ({
  getWebBrowserOptions: () => ({ labels: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isEink: false } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/nav', () => ({ navigateToReader: navigateMock }));
vi.mock('@/store/settingsStore', () => {
  const getState = () => ({
    settings: settingsState.settings,
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
  });
  const useSettingsStore = (selector: (s: ReturnType<typeof getState>) => unknown) =>
    selector(getState());
  useSettingsStore.getState = getState;
  return { useSettingsStore };
});
vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label={title}>
        {children}
      </div>
    ) : null,
}));

import WebSourcesDialog from '@/app/library/components/WebSourcesDialog';

afterEach(() => cleanup());

beforeEach(() => {
  openMock.mockReset().mockResolvedValue({});
  saveSettingsMock.mockReset();
  setSettingsMock.mockReset();
  navigateMock.mockReset();
  settingsState.settings = { webSources: [] };
});

describe('WebSourcesDialog', () => {
  it('adds a source and persists it through the settings store', async () => {
    render(<WebSourcesDialog isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('https://calibre.example.com'), {
      target: { value: 'calibre.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());
    expect(settingsState.settings.webSources).toEqual([
      expect.objectContaining({ name: 'calibre.example.com', url: 'https://calibre.example.com/' }),
    ]);
  });

  it('shows an error for an invalid url and does not save', async () => {
    render(<WebSourcesDialog isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('https://calibre.example.com'), {
      target: { value: 'ftp://nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    expect(await screen.findByText('Please enter a valid http(s) URL')).toBeTruthy();
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it('opens a saved source in the in-app browser and navigates to an opened book', async () => {
    settingsState.settings = {
      webSources: [{ id: '1', name: 'Calibre', url: 'https://calibre.example.com/' }],
    };
    openMock.mockResolvedValue({ openBookHash: 'h1' });
    const onClose = vi.fn();
    render(<WebSourcesDialog isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Calibre/ }));
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith('https://calibre.example.com/', expect.anything()),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(expect.anything(), ['h1']));
    expect(onClose).toHaveBeenCalled();
  });

  it('removes a saved source', async () => {
    settingsState.settings = {
      webSources: [{ id: '1', name: 'Calibre', url: 'https://calibre.example.com/' }],
    };
    render(<WebSourcesDialog isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());
    expect(settingsState.settings.webSources).toEqual([]);
  });
});
