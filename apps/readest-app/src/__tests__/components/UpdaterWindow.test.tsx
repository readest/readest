// @vitest-environment happy-dom
/**
 * UpdaterContent — the "What's New in Readest" changelog.
 *
 * When the UI locale is non-English, the release notes are auto-translated in
 * place. These tests cover the "Show original" toggle that lets the reader flip
 * the auto-translated changelog back to the source English text (and back).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ProgressHandler } from '@/utils/transfer';

const { mockInstallNightlyUpdate } = vi.hoisted(() => ({
  mockInstallNightlyUpdate: vi.fn(),
}));

// ── Locale + translation controls ────────────────────────────────
let mockLocale = 'en';
let mockOS = 'macos';
let mockArch = 'aarch64';
const mockTranslate = vi.fn(async (input: string[]) => input.map((s) => `[zh] ${s}`));

vi.mock('@/utils/misc', () => ({
  getLocale: () => mockLocale,
}));

// Fills {{placeholders}} the way the reader's i18next does, so a test can read
// an interpolated readout such as the download's byte count.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, vars?: Record<string, unknown>) =>
    vars ? s.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(vars[key])) : s,
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: mockTranslate,
    translator: null,
    translators: [],
    loading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      hasUpdater: true,
      isIOSApp: false,
      isMacOSApp: false,
      isAndroidApp: mockOS === 'android',
      resolveFilePath: async (name: string) => `/cache/${name}`,
    },
  }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

const mockAppVersion = '0.11.0';
vi.mock('@/utils/version', async () => {
  const actual = await vi.importActual<typeof import('@/utils/version')>('@/utils/version');
  return { ...actual, getAppVersion: () => mockAppVersion };
});

vi.mock('@/helpers/updater', async () => {
  const actual = await vi.importActual<typeof import('@/helpers/updater')>('@/helpers/updater');
  return {
    setLastShownReleaseNotesVersion: vi.fn(),
    getAndroidPlatformKey: actual.getAndroidPlatformKey,
  };
});

vi.mock('@/services/constants', () => ({
  READEST_UPDATER_FILE: 'https://example.com/latest.json',
  READEST_CHANGELOG_FILE: 'https://example.com/release-notes.json',
  READEST_UPDATER_PUBKEY: 'pk',
}));

// ── Tauri / heavy modules pulled in by UpdaterWindow's top-level imports ──
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => mockOS, arch: () => mockArch }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(), Update: class {} }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(), exit: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ desktopDir: vi.fn(), join: vi.fn() }));
vi.mock('@/utils/transfer', () => ({ tauriDownload: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  installPackage: vi.fn(),
  verifyUpdateSignature: vi.fn(),
  installNightlyUpdate: mockInstallNightlyUpdate,
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/Link', () => ({ default: () => null }));

import { UpdaterContent } from '@/components/UpdaterWindow';
import { tauriDownload } from '@/utils/transfer';
import { installPackage } from '@/utils/bridge';

const RELEASE_NOTES = {
  releases: {
    '0.11.18': { date: '2026-07-08', notes: ['First feature', 'Second feature'] },
  },
};

beforeEach(() => {
  mockLocale = 'en';
  mockOS = 'macos';
  mockArch = 'aarch64';
  vi.mocked(tauriDownload).mockReset();
  vi.mocked(installPackage).mockReset();
  mockTranslate.mockClear();
  mockInstallNightlyUpdate.mockReset();
  window.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => RELEASE_NOTES,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe('UpdaterContent — auto-translated changelog', () => {
  it('contains a stable Android download failure and does not install a partial APK', async () => {
    mockOS = 'android';
    const failure = new Error('Response stream interrupted');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(tauriDownload).mockRejectedValueOnce(failure);
    vi.mocked(window.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        version: '0.11.20',
        platforms: { 'android-arm64': { url: 'https://example.com/update.apk' } },
      }),
    } as Response);

    render(<UpdaterContent latestVersion='0.11.20' />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    expect(await screen.findByText('Failed to download and install update')).toBeTruthy();
    expect(tauriDownload).toHaveBeenCalledOnce();
    expect(installPackage).not.toHaveBeenCalled();
  });

  // The manifest as release.yml publishes it after the per-ABI split, including
  // the android-universal alias kept for pre-split clients.
  const SPLIT_MANIFEST = {
    version: '0.11.20',
    platforms: {
      'android-arm64': { url: 'https://example.com/Readest_0.11.20_arm64.apk' },
      'android-armv7': { url: 'https://example.com/Readest_0.11.20_armv7.apk' },
      'android-legacy': { url: 'https://example.com/Readest_0.11.20_legacy.apk' },
      'android-universal': { url: 'https://example.com/Readest_0.11.20_armv7.apk' },
    },
  };

  it.each([
    ['aarch64', 'arm64'],
    ['arm', 'armv7'],
    ['x86_64', 'legacy'],
    ['x86', 'legacy'],
  ])('on %s downloads the %s APK', async (arch, abi) => {
    mockOS = 'android';
    mockArch = arch;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(tauriDownload).mockRejectedValueOnce(new Error('stop'));
    vi.mocked(window.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => SPLIT_MANIFEST,
    } as Response);

    render(<UpdaterContent latestVersion='0.11.20' />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    await waitFor(() => expect(tauriDownload).toHaveBeenCalledOnce());
    expect(vi.mocked(tauriDownload).mock.calls[0]!.slice(0, 2)).toEqual([
      `https://example.com/Readest_0.11.20_${abi}.apk`,
      `/cache/Readest_0.11.20_${abi}.apk`,
    ]);
  });

  it('contains download failures and shows an updater error', async () => {
    const failure = 'Download request failed with status: 403 Forbidden';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInstallNightlyUpdate.mockRejectedValueOnce(failure);

    render(
      <UpdaterContent
        latestVersion='0.11.20'
        nightlyUpdate={{
          endpoint: 'https://example.com/nightly.json',
          version: '0.11.20',
          platformKey: 'windows-x86_64',
          url: 'https://example.com/readest.exe',
          signature: 'signature',
        }}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to download and install update')).toBeTruthy();
    });
    expect(consoleError).toHaveBeenCalledWith('Failed to download and install update:', failure);
  });

  it('keeps the update on screen after a failed download and lets the reader retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // download_file's read timeout ending a stalled transfer.
    mockInstallNightlyUpdate.mockRejectedValueOnce('error sending request: operation timed out');

    render(
      <UpdaterContent
        latestVersion='0.11.20'
        nightlyUpdate={{
          endpoint: 'https://example.com/nightly.json',
          version: '0.11.20',
          platformKey: 'windows-x86_64',
          url: 'https://example.com/readest.exe',
          signature: 'signature',
        }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    expect(await screen.findByText('Failed to download and install update')).toBeTruthy();
    expect(screen.getByText('A new version of Readest is available!')).toBeTruthy();
    expect(screen.queryByText(/Downloading/)).toBeNull();
    const button = screen.getByRole('button', { name: 'DOWNLOAD & INSTALL' });
    expect(button.className).not.toContain('btn-disabled');

    mockInstallNightlyUpdate.mockImplementationOnce(() => new Promise<void>(() => {}));
    fireEvent.click(button);
    await waitFor(() => expect(mockInstallNightlyUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Failed to download and install update')).toBeNull();
  });

  it('shows a "Show original" toggle that swaps the translation for the source English', async () => {
    mockLocale = 'zh-CN';
    render(<UpdaterContent checkUpdate={false} latestVersion='0.11.18' lastVersion='0.11.0' />);

    // The translated notes render by default (current behavior preserved).
    await waitFor(() => expect(screen.getByText('[zh] First feature')).toBeTruthy());
    expect(mockTranslate).toHaveBeenCalled();
    // The original English is hidden until the reader asks for it.
    expect(screen.queryByText('First feature')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Show original' });
    fireEvent.click(toggle);

    // Now the source English is shown, the translation is hidden, label flips.
    await waitFor(() => expect(screen.getByText('First feature')).toBeTruthy());
    expect(screen.queryByText('[zh] First feature')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show translation' })).toBeTruthy();
  });

  it('renders no toggle when the locale is English (nothing was translated)', async () => {
    mockLocale = 'en';
    render(<UpdaterContent checkUpdate={false} latestVersion='0.11.18' lastVersion='0.11.0' />);

    await waitFor(() => expect(screen.getByText('First feature')).toBeTruthy());
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull();
  });
});

describe('UpdaterContent — download readout', () => {
  const MB = 1024 * 1024;
  const NIGHTLY = {
    endpoint: 'https://example.com/nightly.json',
    version: '0.11.20',
    platformKey: 'android-arm64',
    url: 'https://example.com/readest.apk',
    signature: 'signature',
  };

  // Starts a download that stays in flight and hands back a function that
  // reports downloaded megabytes to it, the way tauriDownload does.
  const startDownload = async () => {
    let report!: ProgressHandler;
    vi.mocked(tauriDownload).mockImplementationOnce(
      (_url, _filePath, progressHandler) =>
        new Promise<Record<string, string>>(() => {
          report = progressHandler!;
        }),
    );
    render(<UpdaterContent latestVersion='0.11.20' nightlyUpdate={NIGHTLY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    await waitFor(() => {
      expect(vi.mocked(tauriDownload)).toHaveBeenCalledOnce();
      expect(document.querySelector('progress')).not.toBeNull();
    });
    return async (downloadedMb: number) => {
      await act(async () => {
        report({ progress: downloadedMb * MB, total: 100 * MB, transferSpeed: 0 });
      });
    };
  };
  const shownValue = () => document.querySelector('progress')!.getAttribute('value');

  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset['eink'];
  });

  it('on e-ink moves the bar and the byte count together, at most twice a second', async () => {
    document.documentElement.dataset['eink'] = 'true';
    const report = await startDownload();
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await report(10);
    now += 100;
    await report(20);
    // The first chunk shows at once; the one 100 ms later is held back.
    expect(shownValue()).toBe('10');
    expect(screen.getByText('Downloading 10 MB of 100 MB')).toBeTruthy();

    now += 400;
    await report(30);
    // 500 ms after the last shown value: the running total, not the last chunk.
    expect(shownValue()).toBe('30');
    expect(screen.getByText('Downloading 30 MB of 100 MB')).toBeTruthy();

    now += 499;
    await report(40);
    expect(shownValue()).toBe('30');

    now += 1;
    await report(50);
    expect(shownValue()).toBe('50');

    now += 1;
    await report(100);
    // The end of the download shows at once.
    expect(shownValue()).toBe('100');
    expect(screen.getByText('Download finished')).toBeTruthy();
  });

  it('off e-ink shows every chunk', async () => {
    const report = await startDownload();

    await report(10);
    await report(20);
    expect(shownValue()).toBe('20');
    expect(screen.getByText('Downloading 20 MB of 100 MB')).toBeTruthy();
  });
});
