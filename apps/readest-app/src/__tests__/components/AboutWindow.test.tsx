// @vitest-environment happy-dom
/**
 * AboutWindow — the version label doubles as a copy-to-clipboard control.
 *
 * On mobile there is no way to select the version string to paste it into a
 * bug report (issue #5285), so tapping the label copies it. The label must
 * keep its plain-text look: no button chrome, same classes as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const {
  mockWriteTextToClipboard,
  mockDispatch,
  mockIsTauriAppPlatform,
  mockInvoke,
  mockCheckForAppUpdates,
} = vi.hoisted(() => ({
  mockWriteTextToClipboard: vi.fn(async () => true),
  mockDispatch: vi.fn(),
  mockIsTauriAppPlatform: vi.fn(() => false),
  mockInvoke: vi.fn(),
  mockCheckForAppUpdates: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, params?: Record<string, unknown>) =>
    params ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? '')) : s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasUpdater: true } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { updateChannel: 'stable' } }),
}));

vi.mock('@/helpers/updater', () => ({
  checkForAppUpdates: mockCheckForAppUpdates,
  checkAppReleaseNotes: vi.fn(),
}));

vi.mock('@/services/constants', () => ({
  CHECK_UPDATE_TIMEOUT_MS: 15_000,
  UPDATE_ERROR_DISPLAY_MS: 5_000,
}));

vi.mock('@/utils/ua', () => ({
  parseWebViewInfo: () => 'Chrome 148',
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => mockIsTauriAppPlatform(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/utils/version', () => ({
  getAppVersion: () => '0.11.20',
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: mockWriteTextToClipboard,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mockDispatch, on: vi.fn(), off: vi.fn() },
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

vi.mock('@/components/SupportLinks', () => ({ default: () => null }));
vi.mock('@/components/LegalLinks', () => ({ default: () => null }));
vi.mock('@/components/Link', () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div>
      <button type='button' onClick={onClose}>
        Close dialog
      </button>
      {children}
    </div>
  ),
}));

import { AboutWindow, setAboutDialogVisible } from '@/components/AboutWindow';

const openDialog = async () => {
  render(
    <>
      <div id='about_window' />
      <AboutWindow />
    </>,
  );
  setAboutDialogVisible(true);
  return screen.findByText(/Version 0\.11\.20/);
};

describe('AboutWindow version label', () => {
  beforeEach(() => {
    mockWriteTextToClipboard.mockClear();
    mockDispatch.mockClear();
    mockIsTauriAppPlatform.mockReturnValue(false);
    mockInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('copies the version and webview info when clicked', async () => {
    const label = await openDialog();

    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith('Readest 0.11.20 (Chrome 148)');
  });

  it('upgrades the label with the native webview version when available', async () => {
    mockIsTauriAppPlatform.mockReturnValue(true);
    mockInvoke.mockResolvedValue({ engine: 'WebView2', version: '152.0.4191.66' });
    await openDialog();

    const label = await screen.findByText(/WebView2 152\.0\.4191\.66/);
    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith(
      'Readest 0.11.20 (WebView2 152.0.4191.66)',
    );
  });

  it('keeps the UA-derived label when the native query fails', async () => {
    mockIsTauriAppPlatform.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('not allowed'));
    await openDialog();

    const label = await screen.findByText(/Chrome 148/);
    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith('Readest 0.11.20 (Chrome 148)');
  });

  it('shows a toast confirming the copy', async () => {
    const label = await openDialog();

    fireEvent.click(label);

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ message: 'Copied to clipboard' }),
      ),
    );
  });

  it('keeps the plain-text look of the label', async () => {
    const label = await openDialog();

    // Same typography classes as the non-clickable label it replaces, and no
    // daisyUI button chrome that would change how it renders.
    expect(label.className).toContain('text-neutral-content');
    expect(label.className).toContain('text-center');
    expect(label.className).toContain('text-sm');
    expect(label.className).not.toContain('btn');
  });

  it('exposes the label as an accessible control', async () => {
    const label = await openDialog();

    expect(label.tagName).toBe('BUTTON');
    expect(label.getAttribute('title')).toBe('Copy');
  });
});

describe('AboutWindow check update error auto-revert', () => {
  beforeEach(() => {
    mockCheckForAppUpdates.mockReset();
    mockCheckForAppUpdates.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('shows the error briefly and then restores the Check Update button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockCheckForAppUpdates.mockRejectedValueOnce(new Error('offline'));
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Check Update' }));

    // The failure surfaces as the red error text, replacing the button…
    expect(await screen.findByText('Error checking for updates')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check Update' })).toBeNull();

    // …and after the display window the button comes back, so the dialog
    // never dead-ends and the reader can retry without closing it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText('Error checking for updates')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check Update' })).toBeTruthy();
  });

  it('ignores a check that was abandoned by closing the dialog', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockCheckForAppUpdates.mockImplementation(() => new Promise(() => {}));
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Check Update' }));
    expect(await screen.findByText('Checking for updates...')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      setAboutDialogVisible(true);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Check Update' }));
    expect(await screen.findByText('Checking for updates...')).toBeTruthy();

    // The abandoned check's deadline passes while the new check still runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText('Checking for updates...')).toBeTruthy();
    expect(screen.queryByText('Error checking for updates')).toBeNull();

    // The new check's own deadline still reports.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText('Error checking for updates')).toBeTruthy();
  });

  it('turns a hung check into the error state after the deadline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A connected-but-stalled response never settles (connectTimeout only
    // bounds the connect phase); the deadline must rescue the dialog.
    mockCheckForAppUpdates.mockImplementationOnce(() => new Promise(() => {}));
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Check Update' }));
    expect(await screen.findByText('Checking for updates...')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('Error checking for updates')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText('Error checking for updates')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check Update' })).toBeTruthy();
  });
});
