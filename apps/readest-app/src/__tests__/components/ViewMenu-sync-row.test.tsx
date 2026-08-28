import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #5910: the reader's sync row was Readest-Cloud-only. A user syncing through
 * WebDAV / iCloud / Drive / S3 alone was told "Never synced" (or, with no
 * account, "Sign in to Sync"), and — worse — tapping the row did nothing at
 * all, because it dispatched only `sync-book-progress`, which `useFileSync` and
 * `useKOSync` do not listen for.
 */

const mockNavigateToLogin = vi.fn();
const mockDispatch = vi.fn();

let mockSyncStatus = {
  providers: [{ kind: 'webdav', name: 'WebDAV', lastSyncedAt: 1, syncing: false, failed: false }],
  syncing: false,
  failed: false,
  lastSyncedAt: 1,
  needsSignIn: false,
  label: 'Synced 2 minutes ago',
};

const mockBookData = {
  isFixedLayout: false,
  bookDoc: {
    dir: undefined as string | undefined,
    rendition: { layout: 'reflowable' },
    sections: [{ pageSpread: '' }],
  },
};

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasAmbientLightSensor: false } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'auto', isDarkMode: false, setThemeMode: vi.fn() }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ book: {}, renderer: { setAttribute: vi.fn() } }),
    getViewSettings: () => ({
      scrolled: false,
      scrolledDirection: 'vertical',
      webtoonMode: false,
      paragraphMode: { enabled: false },
      zoomLevel: 100,
      contrast: 100,
      zoomMode: 'fit-page',
      spreadMode: 'auto',
      keepCoverSpread: true,
      invertImgColorInDark: false,
      applyThemeToPDF: false,
      vertical: false,
      writingMode: 'auto',
    }),
    getViewState: () => ({}),
    getProgress: () => null,
    setViewSettings: vi.fn(),
    recreateViewer: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => ({}), getBookData: () => mockBookData }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setSettingsDialogOpen: vi.fn(),
    setSettingsDialogBookKey: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/hooks/useCloudSyncStatus', () => ({
  useCloudSyncStatus: () => mockSyncStatus,
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/services/constants', () => ({
  MAX_ZOOM_LEVEL: 200,
  MIN_ZOOM_LEVEL: 50,
  ZOOM_STEP: 10,
  MAX_CONTRAST: 200,
  MIN_CONTRAST: 50,
  CONTRAST_STEP: 10,
}));
vi.mock('@/utils/style', () => ({ getStyles: vi.fn() }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: (...a: unknown[]) => mockNavigateToLogin(...a) }));
vi.mock('@/utils/webtoon', () => ({ getScrollGapAttr: vi.fn() }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: vi.fn() }));
vi.mock('@/utils/config', () => ({ getMaxInlineSize: () => 720 }));
vi.mock('@/utils/ambientLight', () => ({ nextThemeMode: (mode: string) => mode }));
vi.mock('@/utils/window', () => ({ tauriHandleToggleFullScreen: vi.fn() }));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: (...a: unknown[]) => mockDispatch(...a), on: vi.fn(), off: vi.fn() },
}));

const ViewMenu = (await import('@/app/reader/components/ViewMenu')).default;

describe('ViewMenu sync row (issue #5910)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncStatus = {
      providers: [
        { kind: 'webdav', name: 'WebDAV', lastSyncedAt: 1, syncing: false, failed: false },
      ],
      syncing: false,
      failed: false,
      lastSyncedAt: 1,
      needsSignIn: false,
      label: 'Synced 2 minutes ago',
    };
  });

  afterEach(() => cleanup());

  it('shows the third-party status instead of "Never synced" with no account', () => {
    render(<ViewMenu bookKey='book-1' />);

    expect(screen.getByText('Synced 2 minutes ago')).toBeTruthy();
    expect(screen.queryByText('Never synced')).toBeNull();
    expect(screen.queryByText('Sign in to Sync')).toBeNull();
    // ...and names the provider whose status this is.
    expect(screen.getByText('Synced via {{provider}}')).toBeTruthy();
  });

  it('syncs every selected provider on tap, not just Readest Cloud', () => {
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByText('Synced 2 minutes ago'));

    const events = mockDispatch.mock.calls.map((call) => call[0]);
    expect(events).toContain('sync-book-progress');
    expect(events).toContain('push-file-sync');
    expect(events).toContain('pull-file-sync');
    expect(events).toContain('flush-kosync');
    expect(mockNavigateToLogin).not.toHaveBeenCalled();
  });

  it('still routes to login when Readest Cloud is the only provider', () => {
    mockSyncStatus = {
      providers: [
        { kind: 'readest', name: 'Readest Cloud', lastSyncedAt: 0, syncing: false, failed: false },
      ],
      syncing: false,
      failed: false,
      lastSyncedAt: 0,
      needsSignIn: true,
      label: 'Sign in to Sync',
    };

    render(<ViewMenu bookKey='book-1' />);
    fireEvent.click(screen.getByText('Sign in to Sync'));

    expect(mockNavigateToLogin).toHaveBeenCalled();
    expect(mockDispatch.mock.calls.map((call) => call[0])).not.toContain('push-file-sync');
    // A lone Readest Cloud provider is not worth naming — the row means what it
    // always meant.
    expect(screen.queryByText('Synced via {{provider}}')).toBeNull();
  });

  it('names a count when several providers are selected', () => {
    mockSyncStatus = {
      providers: [
        { kind: 'readest', name: 'Readest Cloud', lastSyncedAt: 5, syncing: false, failed: false },
        { kind: 'webdav', name: 'WebDAV', lastSyncedAt: 9, syncing: false, failed: false },
      ],
      syncing: false,
      failed: false,
      lastSyncedAt: 9,
      needsSignIn: false,
      label: 'Synced 1 minute ago',
    };

    render(<ViewMenu bookKey='book-1' />);
    expect(screen.getByText('Synced via {{count}} providers')).toBeTruthy();
  });
});
