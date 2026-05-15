import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import {
  MdFolder,
  MdInsertDriveFile,
  MdRefresh,
  MdArrowBack,
  MdVisibility,
  MdVisibilityOff,
  MdCloudSync,
  MdDownload,
  MdCheck,
} from 'react-icons/md';
import {
  BsBook,
  BsFiletypePdf,
  BsFiletypeTxt,
  BsFiletypeMd,
  BsFiletypeXml,
  BsFiletypePng,
  BsFiletypeJpg,
  BsFiletypeJson,
  BsFiletypeOtf,
  BsFiletypeTtf,
  BsFiletypeWoff,
} from 'react-icons/bs';
import { LuBookImage } from 'react-icons/lu';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import { ingestFile } from '@/services/ingestService';
import {
  buildBasicAuthHeader,
  buildRequestUrl,
  checkConnection,
  listDirectory,
  normalizeRootPath,
  WebDAVEntry,
  WebDAVRequestError,
} from '@/services/webdav/WebDAVClient';
import { syncLibrary } from '@/services/webdav/WebDAVSync';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { EXTS } from '@/libs/document';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SectionTitle,
  SettingLabel,
  SettingsRow,
  SettingsSwitchRow,
  SettingsSelect,
} from '../primitives';

interface WebDAVFormProps {
  onBack: () => void;
}

/**
 * WebDAV integration form. Two modes share the same panel:
 *
 * - Configuration: editable URL/username/password/root + Connect button.
 *   Lives in local state until Connect succeeds — only then do we persist
 *   the credentials via `saveSettings`. Failures surface via toast.
 *
 * - Browse: once configured, we render the contents of the root path the
 *   user picked. Sub-folders can be entered, and a breadcrumb / back-button
 *   lets the user navigate back to the saved root. Disconnect clears the
 *   stored config and returns to the configuration view.
 */
const WebDAVForm: React.FC<WebDAVFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();
  const { user } = useAuth();

  const stored = settings.webdav;
  // Show the browse view only when an active connection is configured. We
  // rely on `enabled` (set by Connect, cleared by Disconnect) rather than
  // looking at serverUrl/username, so Disconnect always returns the user to
  // the configuration form even if we keep their previous URL pre-filled.
  const isConfigured = !!stored?.enabled && !!stored?.serverUrl;

  // Editable form state — initialised from saved settings so re-entering the
  // sub-page after a previous configure preserves what the user typed.
  const [url, setUrl] = useState(stored?.serverUrl || '');
  const [username, setUsername] = useState(stored?.username || '');
  const [password, setPassword] = useState(stored?.password || '');
  const [rootPath, setRootPath] = useState(stored?.rootPath || '/');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Library-wide Sync now state — surfaces a progress hint while we walk
  // through the bookshelf and disables the button to prevent re-entry.
  const [syncProgressLabel, setSyncProgressLabel] = useState<string | null>(null);

  // Browse-mode state. `currentPath` may differ from the stored rootPath
  // once the user drills into sub-folders.
  const [currentPath, setCurrentPath] = useState<string>(stored?.rootPath || '/');
  const [entries, setEntries] = useState<WebDAVEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Increments on Refresh — used purely as an effect dependency so the
  // listing reloads even when `currentPath` hasn't changed.
  const [reloadTick, setReloadTick] = useState(0);
  // Per-entry download status keyed by remote path. Resets when the user
  // navigates or refreshes — within a session, a successful download is
  // marked "done" so the button stops inviting a redundant re-tap.
  // `importBook`'s hash dedupe protects us if the user does click again,
  // but a quiet visual cue is friendlier than a no-op.
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, 'downloading' | 'done' | 'error'>
  >({});

  const savedRoot = useMemo(() => normalizeRootPath(stored?.rootPath || '/'), [stored?.rootPath]);

  // When we transition into browse-mode (right after Connect, or when the
  // user re-opens the page already configured), pull the listing.
  useEffect(() => {
    if (!isConfigured) return;
    setCurrentPath((prev) => prev || savedRoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured]);

  useEffect(() => {
    if (!isConfigured || !currentPath) return;
    let cancelled = false;
    // Reset per-entry download status whenever we (re)load a directory:
    // stale "done" badges from a previous folder would otherwise confuse
    // users who navigate back to that folder.
    setDownloadStatus({});
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const list = await listDirectory(
          {
            serverUrl: stored.serverUrl,
            username: stored.username,
            password: stored.password,
          },
          currentPath,
        );
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) {
          setEntries([]);
          setLoadError((e as Error).message || _('Failed to load directory'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isConfigured,
    currentPath,
    reloadTick,
    stored?.serverUrl,
    stored?.username,
    stored?.password,
  ]);

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
    const newSettings = {
      ...settings,
      webdav: {
        enabled: true,
        serverUrl: url.trim(),
        username,
        password,
        rootPath: normalizedRoot,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setCurrentPath(normalizedRoot);
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
    // Reset browse-mode bookkeeping so re-entering Connect doesn't briefly
    // flash a stale 401 error or the previous directory listing.
    setEntries([]);
    setLoadError(null);
    setIsLoading(false);
    // Keep the password pre-filled (masked) so the user can reconnect with
    // a single click — they can still toggle visibility via the eye icon.
    setShowPassword(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  const handleEntryClick = (entry: WebDAVEntry) => {
    if (entry.isDirectory) setCurrentPath(entry.path);
  };

  // —— Sync sub-toggles & manual triggers ——
  // The toggles persist via saveSettings synchronously (debouncing isn't
  // worth the extra state — users tap each toggle at most once per session).
  const persistWebdav = async (patch: Partial<typeof stored>) => {
    const next = { ...settings, webdav: { ...settings.webdav, ...patch } };
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
   * Manual "Sync now" — push every book in the local library up to the
   * remote in a single sequential pass. We don't pull here; the per-book
   * Reader hook handles incoming changes when the user opens a book.
   *
   * Why sequential: shared WebDAV servers (NextCloud, Synology, …) are
   * not happy with parallel PUTs from one user, and a steady linear
   * walk gives us a usable progress indicator. The whole thing runs
   * off-thread relative to the UI by virtue of being async — we just
   * surface a status string and disable the button.
   */
  const handleSyncNow = async () => {
    if (syncProgressLabel) return; // already running
    if (!stored?.enabled || !stored.serverUrl) return;

    // Load library from disk if not loaded yet
    const { libraryLoaded, library } = useLibraryStore.getState();
    const appService = await envConfig.getAppService();

    let currentLibrary = library ?? [];
    if (!libraryLoaded && appService) {
      currentLibrary = await appService.loadLibraryBooks();
    }

    const eligibleBooks = currentLibrary.filter((b) => !b.deletedAt);

    // Lazily ensure a deviceId so the first cross-device sync attributes
    // its rows correctly. The same field is also touched by the Reader
    // hook on first push; doing it here too keeps the Sync now path
    // self-sufficient when the user has never opened a book yet.
    let deviceId = stored.deviceId;
    if (!deviceId) {
      deviceId = uuidv4();
      await persistWebdav({ deviceId });
    }

    setSyncProgressLabel(_('Syncing 0 / {{total}}', { total: eligibleBooks.length }));

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
            // the bookshelf renders a placeholder when coverImageUrl is
            // empty.
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
          setSyncProgressLabel(
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
    } catch (e) {
      const message =
        e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED'
          ? _('WebDAV authentication failed. Reconnect in Settings.')
          : _('Sync failed: {{error}}', { error: (e as Error).message ?? String(e) });
      eventDispatcher.dispatch('toast', { type: 'error', message });
    } finally {
      setSyncProgressLabel(null);
    }
  };

  const handleNavigateUp = () => {
    if (currentPath === savedRoot) return;
    const trimmed = currentPath.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    const parent = idx <= 0 ? '/' : trimmed.slice(0, idx);
    // Don't escape above the saved root — the integration is scoped to it.
    if (!parent.startsWith(savedRoot)) {
      setCurrentPath(savedRoot);
    } else {
      setCurrentPath(parent);
    }
  };

  const handleRefresh = () => {
    setReloadTick((n) => n + 1);
  };

  /**
   * Download a single remote file into the local library.
   *
   * Mirrors the OPDS auto-download path: stream the bytes to a Cache
   * file via `tauriDownload` (avoids the WebView<->Tauri IPC binder
   * limit that kills mid-write transfers on Android), then hand the
   * file to {@link ingestFile} — the channel-agnostic importer used
   * by every capture path (local folder import, Send-to-Readest,
   * inbox drainer). It extracts metadata, writes the cover, computes
   * the content hash (so re-downloading the same book is a deduped
   * no-op), and produces a Book entry; honouring the user's autoUpload
   * setting means a logged-in user with autoUpload on will see the
   * downloaded book pushed to the readest cloud too — same behaviour
   * as dragging the file in by hand.
   *
   * Web/desktop builds without `tauriDownload` aren't expected to
   * exercise this path — the Settings page is gated to Tauri platforms.
   * If a web build ever reaches here, we surface a clear toast instead
   * of silently doing nothing.
   */
  const handleDownloadEntry = async (entry: WebDAVEntry) => {
    if (entry.isDirectory) return;
    if (!isSupportedBookExt(entry.name)) return;
    if (downloadStatus[entry.path] === 'downloading' || downloadStatus[entry.path] === 'done') {
      return;
    }
    if (!isTauriAppPlatform()) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('File download is only supported on the desktop and mobile apps.'),
      });
      return;
    }
    const appService = await envConfig.getAppService();
    if (!appService) return;

    setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'downloading' }));
    try {
      // Stream into Cache under a unique filename so a parallel download
      // (or a re-tap before the previous one finished) doesn't clobber
      // the in-flight bytes. We don't bother with sanitisation here —
      // the suffix dominates collision probability.
      const safeName = entry.name.replaceAll(/[/\\:*?"<>|]/g, '_').slice(0, 200) || 'download';
      const cacheName = `webdav-${Date.now()}-${safeName}`;
      const dst = await appService.resolveFilePath(cacheName, 'Cache');
      const url = buildRequestUrl(stored.serverUrl, entry.path);
      const headers = {
        Authorization: buildBasicAuthHeader(stored.username, stored.password),
      };
      await tauriDownload(url, dst, undefined, headers);

      // Run import against a fresh library snapshot — the user may have
      // imported books elsewhere since this page mounted. ingestFile
      // delegates to importBook which mutates the array in place; we
      // must persist + push it back into the store afterwards for the
      // bookshelf to reflect the new entry.
      const { library: storeLibrary, libraryLoaded, setLibrary } = useLibraryStore.getState();
      const library = libraryLoaded ? [...storeLibrary] : await appService.loadLibraryBooks();
      const imported = await ingestFile(
        { file: dst, books: library },
        { appService, settings, isLoggedIn: !!user },
      );
      // Best-effort cleanup of the cache file. ingestFile -> importBook
      // copies the bytes into the per-hash Books folder, so this temp
      // is no longer needed regardless of success/failure.
      try {
        await appService.deleteFile(dst, 'None');
      } catch {
        // Cache deletion is non-critical — leave it for the OS to GC.
      }
      if (!imported) {
        throw new Error('Import returned null');
      }
      await appService.saveLibraryBooks(library);
      setLibrary(library);

      setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'done' }));
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Downloaded "{{title}}" to your library.', {
          title: imported.title || entry.name,
        }),
      });
    } catch (e) {
      console.warn('WebDAV download failed', entry.path, e);
      setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'error' }));
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to download "{{name}}": {{error}}', {
          name: entry.name,
          error: (e as Error).message ?? String(e),
        }),
      });
    }
  };

  const description: string = isConfigured
    ? _('Browsing {{path}} on {{server}}', {
        path: savedRoot,
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
          {/* Sync controls — sub-category toggles, conflict strategy, and
              a manual "Sync now" button. Mirrors the layout used by
              KOSyncForm so users get a consistent surface. */}
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
                disabled={!!syncProgressLabel}
                className={clsx(
                  'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
                  syncProgressLabel && 'opacity-60',
                )}
                title={_('Sync now')}
                aria-label={_('Sync now')}
              >
                {syncProgressLabel ? (
                  <span className='loading loading-spinner loading-xs' />
                ) : (
                  <MdCloudSync className='h-4 w-4' />
                )}
                {_('Sync now')}
              </button>
            </SettingsRow>
          </BoxedList>

          <div className='flex items-center justify-between gap-3 px-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <button
                type='button'
                onClick={handleNavigateUp}
                disabled={currentPath === savedRoot}
                className={clsx(
                  'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
                  currentPath === savedRoot && 'opacity-40',
                )}
                title={_('Up')}
                aria-label={_('Up')}
              >
                <MdArrowBack className='h-4 w-4' />
              </button>
              <span className='truncate text-sm' title={currentPath}>
                {currentPath}
              </span>
            </div>
            <button
              type='button'
              onClick={handleRefresh}
              className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
              title={_('Refresh')}
              aria-label={_('Refresh')}
            >
              <MdRefresh className='h-4 w-4' />
            </button>
          </div>

          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            {isLoading ? (
              <div className='flex min-h-32 items-center justify-center py-8'>
                <span className='loading loading-spinner loading-md' />
              </div>
            ) : loadError ? (
              <div className='text-error px-4 py-6 text-center text-sm'>{loadError}</div>
            ) : entries.length === 0 ? (
              <div className='text-base-content/60 px-4 py-6 text-center text-sm'>
                {_('Empty directory')}
              </div>
            ) : (
              <ul className='divide-base-200 divide-y'>
                {entries.map((entry) => {
                  const FileIcon = entry.isDirectory ? MdFolder : getEntryIcon(entry.name);
                  const canDownload = !entry.isDirectory && isSupportedBookExt(entry.name);
                  const dlState = downloadStatus[entry.path];
                  // The whole row is interactive only for directories; for
                  // files, only the trailing download button (when shown)
                  // is clickable. We use a div+role=button on the row so
                  // the inner download button isn't nested inside another
                  // <button> (invalid HTML, click bubbling).
                  const rowClickable = entry.isDirectory;
                  return (
                    <li key={entry.path}>
                      <div
                        role={rowClickable ? 'button' : undefined}
                        tabIndex={rowClickable ? 0 : -1}
                        onClick={rowClickable ? () => handleEntryClick(entry) : undefined}
                        onKeyDown={
                          rowClickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleEntryClick(entry);
                                }
                              }
                            : undefined
                        }
                        className={clsx(
                          'group flex w-full items-center gap-3 px-4 py-3 text-left',
                          'transition-colors duration-150',
                          rowClickable ? 'hover:bg-base-200/60 cursor-pointer' : 'cursor-default',
                        )}
                      >
                        <span
                          className={clsx(
                            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded',
                            'bg-base-200 text-base-content/70',
                          )}
                        >
                          <FileIcon className='h-4 w-4' />
                        </span>
                        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                          {/* line-clamp-none cancels SettingLabel's default
                              line-clamp-2 so long file names wrap freely;
                              break-all + whitespace-normal handle hyphenless
                              unicode names that don't have a wrap opportunity. */}
                          <SettingLabel className='line-clamp-none whitespace-normal break-all'>
                            {entry.name}
                          </SettingLabel>
                          {/* Secondary metadata line. Files show size +
                              mtime; directories only show mtime (most
                              servers don't report aggregated child sizes
                              on a collection). The whole line is gated
                              on at least one field being available so we
                              don't render an empty span. */}
                          {((!entry.isDirectory && typeof entry.size === 'number') ||
                            entry.lastModified) && (
                            <span className='text-base-content/60 flex flex-wrap gap-x-2 text-[0.75em]'>
                              {!entry.isDirectory && typeof entry.size === 'number' && (
                                <span>{formatSize(entry.size)}</span>
                              )}
                              {entry.lastModified && (
                                <span title={entry.lastModified}>
                                  {formatLastModified(entry.lastModified)}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {canDownload && (
                          <button
                            type='button'
                            onClick={(e) => {
                              // Stop propagation defensively — the parent
                              // div is non-clickable for files today, but
                              // keeps us safe if that ever changes.
                              e.stopPropagation();
                              handleDownloadEntry(entry);
                            }}
                            disabled={dlState === 'downloading' || dlState === 'done'}
                            className={clsx(
                              'btn btn-ghost btn-sm h-8 min-h-8 flex-shrink-0 px-2',
                              (dlState === 'downloading' || dlState === 'done') && 'opacity-60',
                            )}
                            title={
                              dlState === 'done'
                                ? _('Already downloaded in this session')
                                : dlState === 'downloading'
                                  ? _('Downloading…')
                                  : _('Download to library')
                            }
                            aria-label={
                              dlState === 'done'
                                ? _('Already downloaded in this session')
                                : dlState === 'downloading'
                                  ? _('Downloading…')
                                  : _('Download to library')
                            }
                          >
                            {dlState === 'downloading' ? (
                              <span className='loading loading-spinner loading-xs' />
                            ) : dlState === 'done' ? (
                              <MdCheck className='h-4 w-4' />
                            ) : (
                              <MdDownload className='h-4 w-4' />
                            )}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

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

const formatSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted =
    unit === 0 ? value.toFixed(0) : value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${formatted} ${units[unit]}`;
};

/**
 * Render the WebDAV-supplied last-modified timestamp in a compact, locale-
 * aware form for the secondary line under each file. Servers usually emit
 * RFC 1123 ("Wed, 02 Oct 2002 13:00:00 GMT") via `getlastmodified`, but a
 * handful return ISO-8601 — `Date` parses both. If the value can't be
 * understood we return an empty string so the row simply omits the field
 * rather than rendering "Invalid Date".
 *
 * The full timestamp is exposed as a `title` on the wrapping span so power
 * users can hover for the precise time without us spending pixels on it.
 */
const formatLastModified = (raw: string): string => {
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    // Some embedded WebViews (older Android) reject options bags with
    // both date and time fields — fall back to the default formatter
    // rather than showing nothing.
    return new Date(ts).toLocaleString();
  }
};

/**
 * True when the filename's extension matches one of the reader-supported
 * book formats declared in `libs/document.ts`. Used to gate the per-entry
 * download button: only files we can actually open get the affordance, so
 * the user doesn't waste a tap pulling down something the library can't
 * import (font files, README.txt, hidden dotfiles, …).
 *
 * Keep aligned with `EXTS` — adding a new format there should automatically
 * light up the download button for that extension.
 */
const SUPPORTED_BOOK_EXTS = new Set<string>(Object.values(EXTS).map((e) => e.toLowerCase()));

const isSupportedBookExt = (filename: string): boolean => {
  const m = filename.match(/\.([^.]+)$/);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  return !!ext && SUPPORTED_BOOK_EXTS.has(ext);
};

/**
 * Pick a per-file icon based on the entry's extension. Reader-recognised
 * formats get a specific icon (`BsFiletypePdf`, `BsFiletypeTxt`,
 * `BsFiletypeMd` are pixel-perfect matches; EPUB / MOBI / AZW / FB2 fall
 * back to the generic `BsBook`; CBZ uses the comic-friendly `LuBookImage`),
 * everything else stays on the neutral `MdInsertDriveFile`. Cover images
 * and the library/config JSON files that live next to each book also get
 * their own icons so the readest-managed subtree is self-explanatory.
 *
 * Keep in sync with `EXTS` in `libs/document.ts` when a new format is added.
 */
const getEntryIcon = (filename: string): React.ComponentType<{ className?: string }> => {
  const m = filename.match(/\.([^.]+)$/);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  switch (ext) {
    case 'pdf':
      return BsFiletypePdf;
    case 'txt':
      return BsFiletypeTxt;
    case 'md':
      return BsFiletypeMd;
    case 'fb2':
    case 'fbz':
      return BsFiletypeXml;
    case 'cbz':
      return LuBookImage;
    case 'epub':
    case 'mobi':
    case 'azw':
    case 'azw3':
      return BsBook;
    case 'png':
      return BsFiletypePng;
    case 'jpg':
    case 'jpeg':
      return BsFiletypeJpg;
    case 'json':
      return BsFiletypeJson;
    case 'xml':
      return BsFiletypeXml;
    case 'otf':
      return BsFiletypeOtf;
    case 'ttf':
      return BsFiletypeTtf;
    case 'woff':
    case 'woff2':
      return BsFiletypeWoff;
    default:
      return MdInsertDriveFile;
  }
};

export default WebDAVForm;
