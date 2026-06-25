import clsx from 'clsx';
import React, { useState } from 'react';
import { MdVisibility, MdVisibilityOff, MdCloudSync } from 'react-icons/md';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useWebDAVSyncStore } from '@/store/webdavSyncStore';
import { eventDispatcher } from '@/utils/event';
import {
  checkConnection,
  normalizeRootPath,
  WebDAVConnectResult,
} from '@/services/sync/providers/webdav/client';
import { type TranslationFunc } from '@/hooks/useTranslation';
import { createWebDAVProvider } from '@/services/sync/providers/webdav/WebDAVProvider';
import { buildWebDAVConnectSettings } from '@/services/sync/providers/webdav/connectSettings';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError } from '@/services/sync/file/provider';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SectionTitle,
  SettingsRow,
  SettingsSwitchRow,
  SettingsSelect,
} from '../primitives';
import WebDAVBrowsePane from './WebDAVBrowsePane';

interface WebDAVFormProps {
  onBack: () => void;
}

/**
 * Translate a connection-probe failure into a user-facing string.
 *
 * Each branch must be a literal `_('...')` call so the i18next-scanner
 * picks the keys up — that's why this is a switch on `result.code`
 * rather than the previous `_(result.message || 'Connection error')`
 * pattern, which the scanner couldn't see into.
 */
const formatConnectError = (_: TranslationFunc, result: WebDAVConnectResult): string => {
  switch (result.code) {
    case 'SERVER_URL_REQUIRED':
      return _('Server URL is required');
    case 'AUTH_FAILED':
      return _('Authentication failed');
    case 'ROOT_NOT_FOUND':
      return _('Root directory not found');
    case 'UNEXPECTED_STATUS':
      return _('Unexpected server response (status {{status}})', {
        status: result.status ?? 0,
      });
    case 'NETWORK':
    default:
      return _('Network error');
  }
};

/**
 * Translate a sync-time error into a user-facing string. WebDAVRequestError
 * carries a `code` that lets us map to a specific message without ever
 * showing the raw English `e.message` to the user.
 */
const formatSyncError = (_: TranslationFunc, e: unknown): string => {
  if (e instanceof FileSyncError) {
    switch (e.code) {
      case 'AUTH_FAILED':
        return _('WebDAV authentication failed. Reconnect in Settings.');
      case 'NOT_FOUND':
        return _('Remote resource not found');
      case 'NETWORK':
        return _('Network error');
    }
    if (typeof e.status === 'number') {
      return _('Sync failed (status {{status}})', { status: e.status });
    }
  }
  return _('Sync failed.');
};

/**
 * WebDAV integration form. Two modes share the same panel:
 *
 * - Configuration: editable URL/username/password/root + Connect button.
 *   Lives in local state until Connect succeeds — only then do we
 *   persist the credentials via `saveSettings`. Failures surface via
 *   toast.
 *
 * - Connected: renders the per-page sync controls (sub-toggles, Sync
 *   now, sync-history) plus the {@link WebDAVBrowsePane} for the
 *   stored root, and a Disconnect button. The browse pane is its own
 *   component to keep this file legible — see its docstring.
 */
const WebDAVForm: React.FC<WebDAVFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.webdav;
  // Show the browse view only when an active connection is configured.
  // We rely on `enabled` (set by Connect, cleared by Disconnect) rather
  // than looking at serverUrl/username so Disconnect always returns the
  // user to the configuration form even if we keep their previous URL
  // pre-filled.
  const isConfigured = !!stored?.enabled && !!stored?.serverUrl;

  // Editable form state — initialised from saved settings so re-entering
  // the sub-page after a previous configure preserves what the user
  // typed.
  const [url, setUrl] = useState(stored?.serverUrl || '');
  const [username, setUsername] = useState(stored?.username || '');
  const [password, setPassword] = useState(stored?.password || '');
  const [rootPath, setRootPath] = useState(stored?.rootPath || '/');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Library-wide Sync now state — stored in a process-local zustand
  // store rather than component state so the run survives navigation
  // events that would otherwise unmount us (drilling back to the
  // Integrations list, closing the SettingsDialog and reopening it).
  // Without this hoist, the user would see the button re-enable, no
  // progress affordance, and could trigger a second concurrent
  // syncLibrary while the first was still in flight against the
  // server. See `webdavSyncStore.ts` for the design rationale.
  const isSyncing = useWebDAVSyncStore((s) => s.isSyncing);
  const syncProgressLabel = useWebDAVSyncStore((s) => s.progressLabel);
  const syncProgressDetail = useWebDAVSyncStore((s) => s.progressDetail);
  const beginSync = useWebDAVSyncStore((s) => s.beginSync);
  const updateProgress = useWebDAVSyncStore((s) => s.updateProgress);
  const endSync = useWebDAVSyncStore((s) => s.endSync);

  const handleConnect = async () => {
    if (!url || !username) return;
    setIsConnecting(true);
    const normalizedRoot = normalizeRootPath(rootPath);
    const result = await checkConnection({ serverUrl: url, username, password }, normalizedRoot);
    if (!result.success) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${_('Failed to connect')}: ${formatConnectError(_, result)}`,
      });
      setIsConnecting(false);
      return;
    }
    // Spread previous webdav state so a reconnect preserves bookkeeping
    // fields earned by prior use — deviceId, syncBooks, strategy,
    // syncProgress, syncNotes, lastSyncedAt. Rotating deviceId on
    // reconnect would make this device look new to the cross-device
    // clobber check in `RemoteBookConfig.writerDeviceId`.
    const newSettings = {
      ...settings,
      webdav: buildWebDAVConnectSettings(settings.webdav, {
        serverUrl: url,
        username,
        password,
        rootPath: normalizedRoot,
      }),
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setIsConnecting(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      webdav: {
        ...settings.webdav,
        enabled: false,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    // Keep the password pre-filled (masked) so the user can reconnect
    // with a single click — they can still toggle visibility via the
    // eye icon.
    setShowPassword(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  // —— Sync sub-toggles & manual triggers ——
  // The toggles persist via saveSettings synchronously (debouncing
  // isn't worth the extra state — users tap each toggle at most once
  // per session).
  //
  // IMPORTANT: read latest settings from the store (NOT the closure
  // variable) when computing `next`. Several persistWebdav calls can
  // land back-to-back — e.g. `handleSyncNow` writes `deviceId` up front
  // and `lastSyncedAt` when it finishes, and the user may flip a toggle
  // in between. The closure's `settings` was captured before those
  // writes, so a closure-based merge would rebuild the webdav object
  // from a stale snapshot and clobber a freshly-written field. Use
  // `useSettingsStore.getState()` so each call merges into whatever's
  // currently committed.
  const persistWebdav = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, webdav: { ...latest.webdav, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  // Reading progress and annotations are always synced when WebDAV is
  // enabled — anyone bothering to set up cloud sync wants those. Only
  // book files stay opt-in because they're bandwidth/storage heavy.
  const handleToggleSyncBooks = () => persistWebdav({ syncBooks: !(stored?.syncBooks ?? false) });
  const handleToggleFullSync = () => persistWebdav({ fullSync: !(stored?.fullSync ?? false) });
  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await persistWebdav({ strategy: e.target.value as typeof stored.strategy });
  };

  /**
   * Manual "Sync now" — reconcile the local library with the remote over a
   * bounded-concurrency pool. By default this is incremental: only books whose
   * local copy differs from the shared library.json index are processed
   * (`book.updatedAt` is the per-book change marker). The "Full Sync" toggle
   * re-checks every book. The engine pulls peers' changes and pushes ours; the
   * per-book Reader hook still handles live changes as the user reads.
   *
   * Concurrency is capped (engine default 4) so shared WebDAV servers
   * (NextCloud, Synology, …) aren't hammered while still hiding per-request
   * latency. The run is async relative to the UI — we surface a status string
   * and disable the button.
   */
  const handleSyncNow = async () => {
    // Re-entrancy gate must read the live store, not the closure: a
    // second click after we re-mount could otherwise see the captured
    // `isSyncing` from this render rather than the up-to-date one.
    if (useWebDAVSyncStore.getState().isSyncing) return;
    if (!stored?.enabled || !stored.serverUrl) return;

    // Load library from disk if not loaded yet
    const { libraryLoaded, library } = useLibraryStore.getState();
    const appService = await envConfig.getAppService();

    let currentLibrary = library ?? [];
    if (!libraryLoaded && appService) {
      currentLibrary = await appService.loadLibraryBooks();
      // Hydrate the store before syncing. The engine's addBookToLibrary /
      // updateBookMetadata merge against the in-memory library; if it were
      // still empty here, a downloaded book or a metadata update would persist
      // as the *entire* library and clobber what's on disk. setLibrary also
      // flips libraryLoaded so the per-book store calls see a loaded store.
      useLibraryStore.getState().setLibrary(currentLibrary);
    }

    const eligibleBooks = currentLibrary.filter((b) => !b.deletedAt);

    // Lazily ensure a deviceId so the first cross-device sync
    // attributes its rows correctly. The same field is also touched by
    // the Reader hook on first push; doing it here too keeps the Sync
    // now path self-sufficient when the user has never opened a book
    // yet.
    let deviceId = stored.deviceId;
    if (!deviceId) {
      deviceId = uuidv4();
      await persistWebdav({ deviceId });
    }

    beginSync(_('Syncing {{n}} / {{total}}', { n: 0, total: eligibleBooks.length }));

    try {
      // The provider owns the WebDAV URL + auth + streaming transport; the
      // shared local-store bridge owns all on-disk book/cover/config I/O
      // (including the in-place vs hash-copy path resolution and the Tauri
      // streaming fast path). This form no longer knows any WebDAV specifics.
      const provider = createWebDAVProvider(stored);
      const store = createAppLocalStore({ appService, settings, envConfig });
      const engine = new FileSyncEngine(provider, store);
      const result = await engine.syncLibrary(eligibleBooks, {
        strategy: stored.strategy === 'prompt' ? 'silent' : stored.strategy,
        syncBooks: stored.syncBooks ?? false,
        fullSync: stored.fullSync ?? false,
        deviceId: deviceId as string,
        onProgress: ({ book, index, total, action }) => {
          const actionStr = action === 'downloading' ? _('Downloading') : _('Uploading');
          updateProgress(
            _('{{action}} {{n}} / {{total}}', { action: actionStr, n: index + 1, total }),
            book.title || book.hash.slice(0, 8),
          );
        },
      });

      await persistWebdav({ lastSyncedAt: Date.now() });
      // Keep the toast as simple as the native cloud sync: a single-line
      // "{{count}} book(s) synced" info message. Failures still surface as a
      // warning so a partial sync isn't reported as a clean success.
      if (result.failures > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Sync finished with {{failed}} failure(s). {{ok}} ok.', {
            failed: result.failures,
            ok: Math.max(0, result.totalBooks - result.failures),
          }),
        });
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('{{count}} book(s) synced', { count: result.booksSynced }),
        });
      }
    } catch (e) {
      const message = formatSyncError(_, e);
      eventDispatcher.dispatch('toast', { type: 'error', message });
    } finally {
      endSync();
    }
  };

  const description: string = isConfigured
    ? _('Browsing {{path}} on {{server}}', {
        path: normalizeRootPath(stored.rootPath || '/'),
        server: stored.serverUrl,
      })
    : _('Connect to a WebDAV server to browse your remote files.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('WebDAV')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          {/* Sync controls — sub-category toggles, conflict strategy,
              and a manual "Sync now" button. Mirrors the layout used
              by KOSyncForm so users get a consistent surface. */}
          <BoxedList>
            <SettingsSwitchRow
              label={_('Upload Book Files')}
              description={_('Uploads book files to your other devices.')}
              checked={stored.syncBooks ?? false}
              onChange={handleToggleSyncBooks}
            />
            <SettingsSwitchRow
              label={_('Full Sync')}
              description={_('Re-check every book instead of only changed ones.')}
              checked={stored.fullSync ?? false}
              onChange={handleToggleFullSync}
            />
            <SettingsRow label={_('Sync Strategy')}>
              <SettingsSelect
                value={stored.strategy ?? 'silent'}
                onChange={handleStrategyChange}
                ariaLabel={_('Sync Strategy')}
                options={[
                  { value: 'silent', label: _('Send and receive') },
                  { value: 'send', label: _('Send changes only') },
                  { value: 'receive', label: _('Receive changes only') },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label={
                syncProgressLabel
                  ? syncProgressLabel
                  : stored.lastSyncedAt
                    ? _('Last synced {{when}}', {
                        when: new Date(stored.lastSyncedAt).toLocaleString(),
                      })
                    : _('Never synced')
              }
              description={
                syncProgressDetail ? (
                  <span className='line-clamp-1'>{syncProgressDetail}</span>
                ) : undefined
              }
            >
              <button
                type='button'
                onClick={handleSyncNow}
                disabled={isSyncing}
                className={clsx(
                  'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
                  isSyncing && 'opacity-60',
                )}
                title={_('Sync now')}
                aria-label={_('Sync now')}
              >
                {isSyncing ? (
                  <span className='loading loading-spinner loading-xs' />
                ) : (
                  <MdCloudSync className='h-4 w-4' />
                )}
                {_('Sync now')}
              </button>
            </SettingsRow>
          </BoxedList>

          <WebDAVBrowsePane settings={stored} />

          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleDisconnect}
              className={clsx(
                'eink-bordered',
                'h-10 rounded-lg px-4 text-sm font-medium',
                'text-error hover:bg-error/10',
                'transition-colors duration-150',
                'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
              )}
            >
              {_('Disconnect')}
            </button>
          </div>
        </div>
      ) : (
        <div className='space-y-5'>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              handleConnect();
            }}
          >
            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='webdav-server-url' className='block'>
                {_('Server URL')}
              </SectionTitle>
              <input
                id='webdav-server-url'
                type='text'
                placeholder='https://dav.example.com'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='webdav-username' className='block'>
                {_('Username')}
              </SectionTitle>
              <input
                id='webdav-username'
                type='text'
                placeholder={_('Your Username')}
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete='username'
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='webdav-password' className='block'>
                {_('Password')}
              </SectionTitle>
              <div className='relative'>
                <input
                  id='webdav-password'
                  type={showPassword ? 'text' : 'password'}
                  placeholder={_('Your Password')}
                  className='input input-bordered eink-bordered h-11 w-full pe-11 text-sm focus:outline-none'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete='current-password'
                />
                <button
                  type='button'
                  onClick={() => setShowPassword((v) => !v)}
                  className={clsx(
                    'absolute end-2 top-1/2 -translate-y-1/2',
                    'flex h-8 w-8 items-center justify-center rounded',
                    'text-base-content/60 hover:text-base-content',
                    'hover:bg-base-200/60 transition-colors duration-150',
                    'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                  )}
                  aria-label={showPassword ? _('Hide password') : _('Show password')}
                  title={showPassword ? _('Hide password') : _('Show password')}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <MdVisibilityOff className='h-4 w-4' />
                  ) : (
                    <MdVisibility className='h-4 w-4' />
                  )}
                </button>
              </div>
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='webdav-root' className='block'>
                {_('Root Directory')}
              </SectionTitle>
              <input
                id='webdav-root'
                type='text'
                placeholder='/'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
              />
            </div>

            <div className='flex justify-end pt-1'>
              <button
                type='submit'
                disabled={isConnecting || !url || !username}
                className={clsx(
                  'btn btn-primary',
                  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                  'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
                  isConnecting && 'opacity-60',
                )}
              >
                {isConnecting ? (
                  <span className='loading loading-spinner loading-sm' />
                ) : (
                  _('Connect')
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default WebDAVForm;
