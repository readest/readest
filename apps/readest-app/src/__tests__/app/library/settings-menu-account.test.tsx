// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsMenu from '@/app/library/components/SettingsMenu';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  navigateToProfile: vi.fn(),
  handleLogout: vi.fn(),
  quotas: [
    { name: 'Storage', tooltip: '10% used', used: 10, total: 100, unit: 'MB' },
    { name: 'Translation', tooltip: '5% used', used: 5, total: 100, unit: 'K' },
  ],
  setIsDropdownOpen: vi.fn(),
}));

vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => mocks.router }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useUserActions', () => ({
  useUserActions: () => ({ handleLogout: mocks.handleLogout }),
}));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free', quotas: mocks.quotas }),
}));
vi.mock('@/hooks/useCloudSyncStatus', () => ({
  useCloudSyncStatus: () => ({
    label: 'Sync Now',
    providers: [],
    syncing: false,
    failed: false,
    needsSignIn: false,
  }),
}));
vi.mock('@/hooks/useTransferQueue', () => ({
  useTransferQueue: () => ({
    stats: { active: 0, pending: 0, failed: 0 },
    hasActiveTransfers: false,
    setIsTransferQueueOpen: vi.fn(),
  }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'reader@example.test', user_metadata: {} },
  }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasWindow: false } }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'light', setThemeMode: vi.fn() }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ isSyncing: false, setLibrary: vi.fn() }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { cloudSyncProvider: 'google-drive', pinCodeEnabled: false },
    setSettingsDialogOpen: vi.fn(),
  }),
}));
vi.mock('@/store/appLockStore', () => ({
  useAppLockStore: () => ({ openDialog: vi.fn() }),
}));
vi.mock('@/utils/nav', () => ({
  navigateToLogin: vi.fn(),
  navigateToProfile: mocks.navigateToProfile,
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => true,
}));
vi.mock('@/services/biometric', () => ({
  getBiometricStatus: vi.fn(),
  getBiometryLabelKey: vi.fn(),
  isBiometricSupported: () => false,
}));
vi.mock('@/utils/window', () => ({
  canToggleFullScreen: () => false,
  tauriHandleSetAlwaysOnTop: vi.fn(),
  toggleFullScreen: vi.fn(),
}));
vi.mock('@/utils/permission', () => ({ requestStoragePermission: vi.fn() }));
vi.mock('@/utils/bridge', () => ({ selectDirectory: vi.fn() }));
vi.mock('@/utils/ambientLight', () => ({ nextThemeMode: () => 'dark' }));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));
vi.mock('@/components/stats/ReadingStatsDialog', () => ({
  setReadingStatsDialogVisible: vi.fn(),
}));
vi.mock('@/components/vocabulary/VocabularyDialog', () => ({
  setVocabularyDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/BackupWindow', () => ({ setBackupDialogVisible: vi.fn() }));
vi.mock('@/app/library/components/CacheManagerWindow', () => ({
  setCacheManagerDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/MigrateDataWindow', () => ({
  setMigrateDataDirDialogVisible: vi.fn(),
}));
vi.mock('@/components/AboutWindow', () => ({ setAboutDialogVisible: vi.fn() }));
vi.mock('@/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@/components/Quota', () => ({
  default: ({ quotas }: { quotas: Array<{ name: string }> }) => (
    <span>{quotas.map((q) => q.name).join(',')}</span>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens each Account menu entry on the account page', () => {
  render(<SettingsMenu onPullLibrary={vi.fn()} setIsDropdownOpen={mocks.setIsDropdownOpen} />);

  expect(screen.getByText('Logged in')).toBeTruthy();
  expect(screen.getByText('Account')).toBeTruthy();
  expect(screen.getByText('Sync Settings')).toBeTruthy();
  expect(screen.queryByText('Shared Links')).toBeNull();
  expect(
    screen.getAllByText(/^(Account|Sign Out|Sync Settings)$/).map((el) => el.textContent),
  ).toEqual(['Account', 'Sign Out', 'Sync Settings']);

  // The Storage and Translation quota rows open the account page.
  fireEvent.click(screen.getByText('Storage,Translation'));
  expect(mocks.navigateToProfile).toHaveBeenLastCalledWith(mocks.router);
  mocks.navigateToProfile.mockClear();

  fireEvent.click(screen.getByText('Account'));
  expect(mocks.navigateToProfile).toHaveBeenLastCalledWith(mocks.router);

  fireEvent.click(screen.getByText('Sync Settings'));
  expect(mocks.navigateToProfile).toHaveBeenLastCalledWith(mocks.router, 'sync');

  fireEvent.click(screen.getByText('Sign Out'));
  expect(mocks.handleLogout).toHaveBeenCalledTimes(1);
});

it('drops Data Sync from Advanced Settings, now Sync Settings under Account', () => {
  render(<SettingsMenu onPullLibrary={vi.fn()} setIsDropdownOpen={mocks.setIsDropdownOpen} />);

  expect(screen.getByText('Advanced Settings')).toBeTruthy();
  expect(screen.queryByText('Data Sync')).toBeNull();
});
