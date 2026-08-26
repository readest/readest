import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MigrateDataWindow,
  setMigrateDataDirDialogVisible,
} from '@/app/library/components/MigrateDataWindow';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const appService = {
  isAndroidApp: false,
  isDesktopApp: true,
  distChannel: 'github',
  resolveFilePath: vi.fn(async () => '/current/data/dir'),
  readDirectory: vi.fn(async () => []),
  selectDirectory: vi.fn(async () => '/new/data/dir'),
  createDir: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  deleteDir: vi.fn(async () => {}),
  setCustomRootDir: vi.fn(async () => {}),
};

const settings: Record<string, unknown> = {};
const setSettings = vi.fn();
const saveSettings = vi.fn(async () => {});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings, setSettings, saveSettings }),
}));

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: vi.fn(async () => '/docs'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@/utils/bridge', () => ({ getExternalSDCardPath: vi.fn(async () => ({ path: '' })) }));
vi.mock('@/utils/permission', () => ({ requestStoragePermission: vi.fn(async () => true) }));

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MigrateDataWindow e-ink button hierarchy', () => {
  it('uses btn-ghost (not btn-outline) for the Cancel button so it stays distinct from the primary CTA in e-ink', async () => {
    render(<MigrateDataWindow />);

    await act(async () => {
      setMigrateDataDirDialogVisible(true);
    });

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    const startButton = screen.getByRole('button', { name: 'Start Migration' });

    // The primary CTA keeps btn-primary, which e-ink inverts to a solid black fill.
    expect(startButton.className).toContain('btn-primary');

    // The Cancel button must NOT use btn-outline: in e-ink, btn-outline inverts
    // to the SAME solid black fill as btn-primary, leaving the two buttons
    // indistinguishable (see issue #4396). It must be a borderless ghost instead.
    expect(cancelButton.className).not.toContain('btn-outline');
    expect(cancelButton.className).toContain('btn-ghost');
  });
});

describe('MigrateDataWindow with an empty library', () => {
  it('still saves the new data location when there are no files to copy (#5876)', async () => {
    // Empty library: the current data directory has no files to migrate.
    appService.readDirectory.mockResolvedValue([]);

    render(<MigrateDataWindow />);

    await act(async () => {
      setMigrateDataDirDialogVisible(true);
    });

    await screen.findByText('/current/data/dir');

    const chooseFolderButton = screen.getByRole('button', { name: 'Choose New Folder' });
    await act(async () => {
      chooseFolderButton.click();
    });

    const startButton = await screen.findByRole('button', { name: 'Start Migration' });
    expect(startButton.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      startButton.click();
    });

    // Even with zero files to copy, the new location must still be persisted.
    expect(appService.setCustomRootDir).toHaveBeenCalledWith('/new/data/dir');
    expect(saveSettings).toHaveBeenCalled();
    expect(await screen.findByText('Migration completed successfully!')).toBeTruthy();
  });
});
