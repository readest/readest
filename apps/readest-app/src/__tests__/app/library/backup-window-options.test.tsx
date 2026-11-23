// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useScreenWakeLock: vi.fn(),
  saveBackupFile: vi.fn(),
  restoreFromBackupZip: vi.fn(),
  selectFiles: vi.fn(),
}));

vi.mock('@/hooks/useScreenWakeLock', () => ({ useScreenWakeLock: mocks.useScreenWakeLock }));
vi.mock('@/services/backupService', () => ({
  saveBackupFile: mocks.saveBackupFile,
  restoreFromBackupZip: mocks.restoreFromBackupZip,
}));
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: mocks.selectFiles }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ setLibrary: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const appService = {
  isMobile: true,
  hasWindow: false,
  isIOSApp: false,
  openFile: vi.fn(async () => new File([], 'backup.zip')),
  loadLibraryBooks: vi.fn(async () => []),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig: {} }),
}));

// Preserve the dialog id so the component's getElementById event wiring works.
vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    id,
    title,
    children,
  }: {
    id?: string;
    title?: string;
    children: React.ReactNode;
  }) => (
    <div id={id} role='dialog' aria-label={title}>
      {children}
    </div>
  ),
}));

import { BackupWindow, setBackupDialogVisible } from '@/app/library/components/BackupWindow';

/**
 * #7752: the backup can leave out the library or the settings. Both are
 * included by default, credentials are not, and credentials only apply to
 * the settings.
 */

const open = async () => {
  render(<BackupWindow onPullLibrary={vi.fn()} />);
  await act(async () => {
    setBackupDialogVisible(true);
  });
};

const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const CREDENTIALS =
  'Include account credentials (sync tokens, passwords). The backup file is not encrypted.';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Half past midnight is still the day before in UTC: the unit tests run in
// Asia/Tokyo (vitest.config.mts).
const localNov23 = new Date(2026, 10, 23, 0, 30);

describe('BackupWindow backup file name', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the backup by the local date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localNov23);
    mocks.saveBackupFile.mockResolvedValue(true);
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));
    });
    expect(mocks.saveBackupFile.mock.lastCall?.[1]).toBe('readest-backup-2026-11-23.zip');
  });
});

describe('BackupWindow backup options (#7752)', () => {
  it('backs up the library and settings without credentials by default', async () => {
    mocks.saveBackupFile.mockResolvedValue(true);
    await open();
    expect(checkbox('Library').checked).toBe(true);
    expect(checkbox('Settings').checked).toBe(true);
    expect(checkbox(CREDENTIALS).checked).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));
    });
    expect(mocks.saveBackupFile.mock.lastCall?.[2]).toEqual({
      includeLibrary: true,
      includeSettings: true,
      includeCredentials: false,
    });
  });

  it('drops credentials along with the settings', async () => {
    mocks.saveBackupFile.mockResolvedValue(true);
    await open();
    fireEvent.click(checkbox(CREDENTIALS));
    fireEvent.click(checkbox('Settings'));
    expect(checkbox(CREDENTIALS).disabled).toBe(true);
    expect(checkbox(CREDENTIALS).checked).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));
    });
    expect(mocks.saveBackupFile.mock.lastCall?.[2]).toEqual({
      includeLibrary: true,
      includeSettings: false,
      includeCredentials: false,
    });
  });

  it('cannot back up with nothing selected', async () => {
    await open();
    fireEvent.click(checkbox('Library'));
    fireEvent.click(checkbox('Settings'));
    expect(screen.getByRole('button', { name: 'Create Backup' })).toHaveProperty('disabled', true);
  });

  it('reports a settings-only restore without book counts', async () => {
    mocks.selectFiles.mockResolvedValue({ files: [{ path: '/backup.zip' }] });
    mocks.restoreFromBackupZip.mockResolvedValue({
      booksAdded: 0,
      booksUpdated: 0,
      libraryRestored: false,
      settingsRestored: true,
    });
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Backup' }));
    });
    expect(await screen.findByText('Settings have been restored.')).toBeTruthy();
    expect(screen.queryByText(/books added/)).toBeNull();
  });
});
