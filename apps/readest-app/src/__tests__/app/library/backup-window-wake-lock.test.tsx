import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const lastWakeLockRequest = () => mocks.useScreenWakeLock.mock.lastCall?.[0];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BackupWindow screen wake lock (#6291)', () => {
  it('holds the wake lock only while a backup is running', async () => {
    let finishBackup!: (saved: boolean) => void;
    mocks.saveBackupFile.mockReturnValue(new Promise((resolve) => (finishBackup = resolve)));

    render(<BackupWindow onPullLibrary={vi.fn()} />);
    await act(async () => {
      setBackupDialogVisible(true);
    });
    expect(lastWakeLockRequest()).toBe(false);

    fireEvent.click(await screen.findByRole('button', { name: 'Backup Library' }));
    await waitFor(() => expect(lastWakeLockRequest()).toBe(true));
    expect(mocks.useScreenWakeLock).toHaveBeenLastCalledWith(
      true,
      appService.hasWindow,
      appService.isIOSApp,
    );

    await act(async () => {
      finishBackup(true);
    });
    expect(lastWakeLockRequest()).toBe(false);
  });

  it('holds the wake lock only while a restore is running', async () => {
    let finishRestore!: (result: { booksAdded: number; booksUpdated: number }) => void;
    mocks.selectFiles.mockResolvedValue({ files: [{ path: '/backup.zip' }] });
    mocks.restoreFromBackupZip.mockReturnValue(new Promise((resolve) => (finishRestore = resolve)));

    render(<BackupWindow onPullLibrary={vi.fn()} />);
    await act(async () => {
      setBackupDialogVisible(true);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Library' }));
    await waitFor(() => expect(lastWakeLockRequest()).toBe(true));

    await act(async () => {
      finishRestore({ booksAdded: 0, booksUpdated: 0 });
    });
    expect(lastWakeLockRequest()).toBe(false);
  });
});
