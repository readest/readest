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

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
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
  DOWNLOAD_STALL_TIMEOUT_MS: 15_000,
  UPDATE_ERROR_DISPLAY_MS: 5_000,
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
import { installPackage, verifyUpdateSignature } from '@/utils/bridge';

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
  vi.mocked(verifyUpdateSignature).mockReset();
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

// The useTranslation mock above returns the raw i18n template, so progress
// lines match on a prefix rather than the interpolated "0 MB" figures.
describe('UpdaterContent — download stall watchdog', () => {
  const NIGHTLY_UPDATE = {
    endpoint: 'https://example.com/nightly.json',
    version: '0.11.20',
    platformKey: 'windows-x86_64',
    url: 'https://example.com/readest.exe',
    signature: 'signature',
  };
  type NightlyEvent =
    | { event: 'progress'; contentLength?: number; downloaded: number }
    | { event: 'finished' };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('fails a stalled download and restores the button after the display window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Connected but stalled before the first byte: no Started, no Progress,
    // progress frozen at 0/0 MB — exactly the case connectTimeout never covers.
    // The native transfer never settles (worst case on the desktop plugin
    // paths, which have no native timeout at all).
    mockInstallNightlyUpdate.mockImplementation(() => new Promise<void>(() => {}));

    render(<UpdaterContent latestVersion='0.11.20' nightlyUpdate={NIGHTLY_UPDATE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    expect(await screen.findByText(/Downloading/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();
    expect(screen.queryByText(/Downloading/)).toBeNull();
    expect(screen.getByRole('button', { name: 'DOWNLOAD & INSTALL' }).className).toContain(
      'btn-disabled',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText('Failed to download and install update')).toBeNull();
    expect(screen.getByRole('button', { name: 'DOWNLOAD & INSTALL' }).className).not.toContain(
      'btn-disabled',
    );
  });

  it('recovers from a stall and lets a retry actually start a new transfer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockInstallNightlyUpdate.mockImplementation(() => new Promise<void>(() => {}));

    render(<UpdaterContent latestVersion='0.11.20' nightlyUpdate={NIGHTLY_UPDATE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    expect(await screen.findByText(/Downloading/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText('Failed to download and install update')).toBeNull();
    expect(screen.getByRole('button', { name: 'DOWNLOAD & INSTALL' }).className).not.toContain(
      'btn-disabled',
    );

    // The retry must actually start a new transfer, not just look clickable:
    // the attempt slot has to be free again after the stall was reported.
    mockInstallNightlyUpdate.mockImplementation(() => new Promise<void>(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/Downloading/)).toBeTruthy();
  });

  it('fails a mid-transfer stall and ignores stragglers from the abandoned transfer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let onProgress: ((event: NightlyEvent) => void) | null = null;
    mockInstallNightlyUpdate.mockImplementation(
      (_endpoint: string, callback?: (event: NightlyEvent) => void) => {
        onProgress = callback ?? null;
        callback?.({ event: 'progress', contentLength: 10_000_000, downloaded: 500 });
        return new Promise<void>(() => {});
      },
    );

    render(<UpdaterContent latestVersion='0.11.20' nightlyUpdate={NIGHTLY_UPDATE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    expect(await screen.findByText(/Downloading/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();

    // A late chunk from the transfer that was declared failed must not
    // resurrect the progress UI or re-arm the watchdog.
    await act(async () => {
      onProgress?.({ event: 'progress', contentLength: 10_000_000, downloaded: 900 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText(/Downloading/)).toBeNull();
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText('Failed to download and install update')).toBeNull();
    expect(screen.getByRole('button', { name: 'DOWNLOAD & INSTALL' }).className).not.toContain(
      'btn-disabled',
    );
  });

  it('skips the installer when a stalled Android download resolves after the failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockOS = 'android';
    // The zombie download resolves late (network recovered after the watchdog
    // already reported the failure); the orchestration must skip the installer.
    let resolveDownload: ((value: Record<string, string>) => void) | null = null;
    vi.mocked(tauriDownload).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve as typeof resolveDownload;
        }),
    );
    vi.mocked(window.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        version: '0.11.20',
        platforms: { 'android-arm64': { url: 'https://example.com/update.apk' } },
      }),
    } as Response);

    render(<UpdaterContent latestVersion='0.11.20' />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    expect(await screen.findByText(/Downloading/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();

    // The abandoned download finally completes; no installer may pop.
    await act(async () => {
      resolveDownload?.({});
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(installPackage).not.toHaveBeenCalled();
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();
  });

  it('skips verify/install when a stalled nightly download resolves after the failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The nightly custom flow's Android branch — the same installPackage call
    // this fork's own Android nightly builds take: the zombie download
    // resolves late, after the watchdog already reported failure.
    let resolveDownload: ((value: Record<string, string>) => void) | null = null;
    vi.mocked(tauriDownload).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve as typeof resolveDownload;
        }),
    );

    render(
      <UpdaterContent
        latestVersion='0.11.20'
        nightlyUpdate={{
          endpoint: 'https://example.com/nightly.json',
          version: '0.11.20',
          platformKey: 'android-arm64',
          url: 'https://example.com/readest_arm64.apk',
          signature: 'signature',
        }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));
    expect(await screen.findByText(/Downloading/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();

    // The abandoned download finally completes; verify/install must be skipped.
    await act(async () => {
      resolveDownload?.({});
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(verifyUpdateSignature).not.toHaveBeenCalled();
    expect(installPackage).not.toHaveBeenCalled();
    expect(screen.getByText('Failed to download and install update')).toBeTruthy();
  });

  it('installs a nightly download that completes normally (positive path)', async () => {
    mockOS = 'android';
    // Guards the generation check against silently going always-stale (e.g.
    // `attempt` captured at render time instead of at call time): the
    // negative tests cannot tell, because "never install" is exactly what
    // they assert. These are the assertions that must stay true.
    vi.mocked(tauriDownload).mockResolvedValueOnce({});
    vi.mocked(verifyUpdateSignature).mockResolvedValueOnce(true);
    vi.mocked(installPackage).mockResolvedValueOnce({ success: true });

    render(
      <UpdaterContent
        latestVersion='0.11.20'
        nightlyUpdate={{
          endpoint: 'https://example.com/nightly.json',
          version: '0.11.20',
          platformKey: 'android-arm64',
          url: 'https://example.com/readest_arm64.apk',
          signature: 'signature',
        }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    await waitFor(() => expect(verifyUpdateSignature).toHaveBeenCalledOnce());
    expect(installPackage).toHaveBeenCalledOnce();
  });

  it('keeps a healthy-but-slow download running without tripping the watchdog', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockInstallNightlyUpdate.mockImplementation(
      (_endpoint: string, callback?: (event: NightlyEvent) => void) => {
        let downloaded = 0;
        const interval = setInterval(() => {
          downloaded += 100;
          callback?.({ event: 'progress', contentLength: 10_000_000, downloaded });
        }, 5_000);
        void interval;
        return new Promise<void>(() => {});
      },
    );

    render(<UpdaterContent latestVersion='0.11.20' nightlyUpdate={NIGHTLY_UPDATE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    // 45s at a 5s tick: every gap stays under the 15s window, so the
    // watchdog must never fire even though the transfer crawls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(screen.queryByText('Failed to download and install update')).toBeNull();
    expect(screen.getByText(/Downloading/)).toBeTruthy();
  });
});
