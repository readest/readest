import clsx from 'clsx';
import React, { useState } from 'react';
import { MdVisibility, MdVisibilityOff, MdCloudSync } from 'react-icons/md';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useWebDAVSyncStore } from '@/store/webdavSyncStore';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload, tauriUpload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import {
  buildBasicAuthHeader,
  buildRequestUrl,
  checkConnection,
  normalizeRootPath,
  WebDAVRequestError,
} from '@/services/webdav/WebDAVClient';
import { syncLibrary } from '@/services/webdav/WebDAVSync';
import { buildWebDAVConnectSettings } from '@/services/webdav/webdavConnectSettings';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import {
  WEBDAV_SYNC_LOG_LIMIT,
  WebDAVSyncLogEntry,
  WebDAVSyncLogFailure,
  WebDAVSyncLogStatus,
} from '@/types/settings';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SectionTitle,
  SettingsRow,
  SettingsSwitchRow,
  SettingsSelect,
} from '../primitives';
import SyncHistoryPanel from './SyncHistoryPanel';
import WebDAVBrowsePane from './WebDAVBrowsePane';

interface WebDAVFormProps {
  onBack: () => void;
}

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
        message: `${_('Failed to connect')}: ${_(result.message || 'Connection error')}`,
      });
      setIsConnecting(false);
      return;
    }
    // Spread previous webdav state so a reconnect preserves bookkeeping
    // fields earned by prior use — deviceId, syncBooks, strategy,
    // syncProgress, syncNotes, lastSyncedAt, syncLog. Rotating deviceId
    // on reconnect would make this device look new to the cross-device
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
  // variable) when computing `next`. `handleSyncNow` issues two
  // back-to-back persistWebdav calls — first `lastSyncedAt`, then
  // `syncLog`. The closure's `settings` was captured before either
  // write landed, so a closure-based merge would clobber the freshly-
  // written `lastSyncedAt` when the second call rebuilds the webdav
  // object from the stale snapshot. Symptom: the "Last synced" label
  // stays pinned to the previous value while the Sync History row
  // shows the up-to-date timestamp. Use `useSettingsStore.getState()`
  // so each call merges into whatever's currently committed.
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
  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await persistWebdav({ strategy: e.target.value as typeof stored.strategy });
  };

  /**
   * Append a diagnostic entry to the bounded sync history.
   *
   * We deliberately re-read settings from the store at write time
   * (rather than closing over `stored`) so concurrent updates — e.g.
   * the user flips the syncBooks toggle while a Sync now is in flight
   * — don't clobber each other. The 10-entry cap matches
   * `WEBDAV_SYNC_LOG_LIMIT` and trims oldest-first; we keep the
   * persisted JSON small so settings.json round-trips on every app
   * start stay cheap.
   */
  const appendSyncLogEntry = async (entry: WebDAVSyncLogEntry) => {
    const current = useSettingsStore.getState().settings.webdav?.syncLog ?? [];
    // Newest first — UI renders in array order, so unshift keeps the
    // freshest run at the top without reversing on every render.
    const next = [entry, ...current].slice(0, WEBDAV_SYNC_LOG_LIMIT);
    await persistWebdav({ syncLog: next });
  };

  const handleClearSyncLog = async () => {
    await persistWebdav({ syncLog: [] });
  };

  /**
   * Manual "Sync now" — push every book in the local library up to the
   * remote in a single sequential pass. We don't pull here; the per-
   * book Reader hook handles incoming changes when the user opens a
   * book.
   *
   * Why sequential: shared WebDAV servers (NextCloud, Synology, …) are
   * not happy with parallel PUTs from one user, and a steady linear
   * walk gives us a usable progress indicator. The whole thing runs
   * off-thread relative to the UI by virtue of being async — we just
   * surface a status string and disable the button.
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

    beginSync(_('Syncing 0 / {{total}}', { total: eligibleBooks.length }));

    // Captured before the run begins so we can attribute startedAt
    // accurately even when the run fails in the catch block (the
    // pre-flight library load can take a moment on slow disks).
    const startedAt = Date.now();

    try {
      const result = await syncLibrary(stored, eligibleBooks, {
        strategy: stored.strategy === 'prompt' ? 'silent' : stored.strategy,
        syncBooks: stored.syncBooks ?? false,
        deviceId: deviceId as string,
        loadConfig: (book) =>
          appService ? appService.loadBookConfig(book, settings) : Promise.resolve(null),
        loadBookFile: async (book) => {
          if (!appService) return null;
          const fp = getLocalBookFilename(book);
          if (!(await appService.exists(fp, 'Books'))) return null;
          const file = await appService.openFile(fp, 'Books');
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        },
        // Tauri-only: stream the book file straight from disk to the
        // WebDAV server via Rust-side `upload_file`, never letting the
        // bytes land in the JS heap. Without this, syncing a library
        // with multiple multi-hundred-megabyte PDFs accumulates
        // ArrayBuffers that V8 can't free fast enough between
        // sequential `pushBookFile` calls — the renderer eventually
        // hits its heap ceiling and the WebView crashes mid-sync,
        // surfacing as a blank white screen on desktop and as a
        // binder-OOM kill on Android. The metadata-only fast path
        // (open file just to read `.size`) keeps the HEAD short-
        // circuit working the same way the buffered path does.
        loadBookFileStreaming: isTauriAppPlatform()
          ? async (book) => {
              if (!appService) return null;
              const fp = getLocalBookFilename(book);
              if (!(await appService.exists(fp, 'Books'))) return null;
              const file = await appService.openFile(fp, 'Books');
              const size = file.size;
              // openFile returns a File-like handle; close eagerly when
              // the platform exposes it so the Tauri side can re-open
              // the path for the streamed PUT without holding two FDs.
              const closable = file as { close?: () => Promise<void> };
              if (closable.close) await closable.close();
              const dst = await appService.resolveFilePath(fp, 'Books');
              return {
                size,
                upload: async (remoteUrl, headers) => {
                  try {
                    // tauriUpload's TS type says Map, but its Tauri
                    // command on the Rust side accepts a JSON object →
                    // HashMap<String, String>. The internal `headers ??
                    // {}` default already proves a plain object works,
                    // so cast and pass the headers object directly
                    // rather than building a Map (which Tauri's IPC
                    // serialiser handles less consistently).
                    await tauriUpload(
                      remoteUrl,
                      dst,
                      'PUT',
                      undefined,
                      headers as unknown as Map<string, string>,
                    );
                    return true;
                  } catch (e) {
                    console.warn('WD library sync: tauriUpload failed', book.hash, e);
                    return false;
                  }
                },
              };
            }
          : undefined,
        loadBookCover: async (book) => {
          // Covers are best-effort — books without one (TXT/MD without
          // metadata, custom imports without art) just return null and
          // syncLibrary skips them silently.
          if (!appService) return null;
          const fp = getCoverFilename(book);
          if (!(await appService.exists(fp, 'Books'))) return null;
          const file = await appService.openFile(fp, 'Books');
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        },
        saveBookFile: async (book, bytes) => {
          if (!appService) return;
          const fp = getLocalBookFilename(book);
          await appService.writeFile(fp, 'Books', bytes);
        },
        // Tauri-only: stream the book straight to disk via the Rust
        // side instead of slurping it into a JS ArrayBuffer first. The
        // WebView<->Tauri IPC bridge cannot handle multi-megabyte
        // buffers on Android (the renderer is binder-killed mid-write),
        // so for any non-trivial epub/pdf this is the *only* path that
        // works reliably on mobile.
        downloadBookFile: isTauriAppPlatform()
          ? async (book, remotePath) => {
              if (!appService) return false;
              const url = buildRequestUrl(stored.serverUrl, remotePath);
              const headers = {
                Authorization: buildBasicAuthHeader(stored.username, stored.password),
              };
              // The Rust downloader writes the file verbatim and does
              // NOT create parent dirs — make sure the per-hash folder
              // under Books exists before kicking off the stream.
              try {
                if (!(await appService.exists(book.hash, 'Books'))) {
                  await appService.createDir(book.hash, 'Books', true);
                }
              } catch (e) {
                console.warn('WD library sync: mkdir failed', book.hash, e);
              }
              const dst = await appService.resolveFilePath(getLocalBookFilename(book), 'Books');
              try {
                await tauriDownload(url, dst, undefined, headers);
                return true;
              } catch (e) {
                console.warn('WD library sync: tauriDownload failed', book.hash, e);
                return false;
              }
            }
          : undefined,
        saveBookCover: async (book, bytes) => {
          if (!appService) return;
          const fp = getCoverFilename(book);
          await appService.writeFile(fp, 'Books', bytes);
        },
        saveBookConfig: async (book, config) => {
          if (!appService) return;
          await appService.saveBookConfig(book, config, settings);
        },
        addBookToLibrary: async (book) => {
          if (!appService) return;
          try {
            book.coverImageUrl = await appService.generateCoverImageUrl(book);
          } catch (e) {
            // Missing or broken cover shouldn't block adding the book —
            // the bookshelf renders a placeholder when coverImageUrl
            // is empty.
            console.warn('WD library sync: cover URL generation failed', book.hash, e);
            book.coverImageUrl = null;
          }
          book.syncedAt = Date.now();
          book.downloadedAt = Date.now();
          if (!book.metaHash) book.metaHash = book.hash;
          const { library, setLibrary } = useLibraryStore.getState();
          // Avoid duplicates if the user runs Sync now twice quickly.
          if (library.find((b) => b.hash === book.hash)) return;
          const newLibrary = [...library, book];
          await appService.saveLibraryBooks(newLibrary);
          // Update the store last so subscribers re-render against a
          // library that's already persisted on disk.
          setLibrary(newLibrary);
        },
        onProgress: ({ book, index, total, action }) => {
          const actionStr = action === 'downloading' ? _('Downloading') : _('Uploading');
          updateProgress(
            _('{{action}} {{n}} / {{total}} — {{title}}', {
              action: actionStr,
              n: index + 1,
              total,
              title: book.title || book.hash.slice(0, 8),
            }),
          );
        },
      });

      await persistWebdav({ lastSyncedAt: Date.now() });
      // Build a compact, accurate summary. Downloads happen regardless
      // of the `syncBooks` toggle, so they're always part of the toast;
      // the upload counters are only included when there was anything
      // to push (otherwise they'd just be a wall of zeros).
      const parts: string[] = [];
      if (result.booksDownloaded > 0) {
        parts.push(_('downloaded {{n}} book(s)', { n: result.booksDownloaded }));
      }
      if (result.configsDownloaded > 0) {
        parts.push(_('pulled {{n}} progress entr(ies)', { n: result.configsDownloaded }));
      }
      if (result.configsUploaded > 0) {
        parts.push(_('pushed {{n}} config(s)', { n: result.configsUploaded }));
      }
      if (stored.syncBooks && result.filesUploaded > 0) {
        parts.push(_('uploaded {{n}} new file(s)', { n: result.filesUploaded }));
      }
      // Build the toast in two pieces so we can render the details on
      // their own lines on mobile. The Toast component truncates
      // single-line `info` messages (max-width + `truncate`), which
      // chops the long detail string on small screens. Two ways out:
      //   1. Use `success` type, which renders multi-line and shows a
      //      dismiss button — picked when there's actionable detail.
      //   2. Stick with `info` for the short "everything up to date"
      //      string, which always fits in one line anyway.
      // The detail bullets are joined with `\n` because Toast's
      // renderer (Toast.tsx) already splits on newlines into <br>s.
      let toastType: 'info' | 'success' | 'warning' = 'info';
      let summary: string;
      if (result.failures > 0) {
        toastType = 'warning';
        summary = _('Sync finished with {{failed}} failure(s). {{ok}} ok.', {
          failed: result.failures,
          ok: Math.max(0, result.totalBooks - result.failures),
        });
        if (parts.length > 0) {
          summary += '\n' + parts.map((p) => `• ${p}`).join('\n');
        }
      } else if (parts.length > 0) {
        toastType = 'success';
        const heading = _('Sync complete');
        summary = `${heading}\n${parts.map((p) => `• ${p}`).join('\n')}`;
      } else {
        summary = _('Everything is already up to date.');
      }
      eventDispatcher.dispatch('toast', {
        type: toastType,
        message: summary,
      });
      // Append a diagnostic entry to the persistent sync log. Status
      // mirrors the toast classification: warning toast → 'partial'
      // (some failures, some ok); info/success toast → 'success'. We
      // also collapse the per-book failure phase + reason into the
      // shape the UI expects (no internal type leakage into settings).
      const status: WebDAVSyncLogStatus = result.failures > 0 ? 'partial' : 'success';
      const failedBooks: WebDAVSyncLogFailure[] | undefined =
        result.failedBooks.length > 0
          ? result.failedBooks.map((f) => ({
              hash: f.hash,
              title: f.title,
              reason: `[${f.phase}] ${f.reason}`,
            }))
          : undefined;
      const entry: WebDAVSyncLogEntry = {
        id: uuidv4(),
        startedAt,
        finishedAt: Date.now(),
        status,
        trigger: 'manual',
        totalBooks: result.totalBooks,
        booksDownloaded: result.booksDownloaded,
        filesUploaded: result.filesUploaded,
        filesAlreadyInSync: result.filesAlreadyInSync,
        configsUploaded: result.configsUploaded,
        configsDownloaded: result.configsDownloaded,
        coversUploaded: result.coversUploaded,
        failures: result.failures,
        summary,
        failedBooks,
      };
      await appendSyncLogEntry(entry);
    } catch (e) {
      const message =
        e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED'
          ? _('WebDAV authentication failed. Reconnect in Settings.')
          : _('Sync failed: {{error}}', { error: (e as Error).message ?? String(e) });
      eventDispatcher.dispatch('toast', { type: 'error', message });
      // Persist a "failure" entry so the user can show what went wrong
      // without rummaging through the dev console. We don't have a
      // SyncLibraryResult to draw counters from (the run aborted
      // before returning), so all the count fields stay zero except
      // totalBooks for context.
      const entry: WebDAVSyncLogEntry = {
        id: uuidv4(),
        startedAt,
        finishedAt: Date.now(),
        status: 'failure',
        trigger: 'manual',
        totalBooks: eligibleBooks.length,
        booksDownloaded: 0,
        filesUploaded: 0,
        filesAlreadyInSync: 0,
        configsUploaded: 0,
        configsDownloaded: 0,
        coversUploaded: 0,
        failures: 0,
        summary: message,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
      await appendSyncLogEntry(entry);
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
              description={_(
                'This toggle only controls ' +
                  'whether this device contributes the books. ' +
                  'Reading progress and annotations are always synced both ways, and books ' +
                  'already on the server are always downloaded.',
              )}
              checked={stored.syncBooks ?? false}
              onChange={handleToggleSyncBooks}
            />
            <SettingsRow label={_('Sync Strategy')}>
              <SettingsSelect
                value={stored.strategy ?? 'silent'}
                onChange={handleStrategyChange}
                ariaLabel={_('Sync Strategy')}
                options={[
                  { value: 'silent', label: _('Always use latest') },
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

          {/* Sync history panel — diagnostic surface for users to
              screenshot when reporting issues. Collapsed by default to
              keep the page compact; opens to show the most-recent ten
              runs with full counters and per-book failures. We render
              even when the log is empty so users can find where it
              lives before their first run. */}
          <SyncHistoryPanel entries={stored.syncLog ?? []} onClear={handleClearSyncLog} t={_} />

          <WebDAVBrowsePane settings={stored} t={_} onAppendSyncLogEntry={appendSyncLogEntry} />

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
