import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import {
  MdFolder,
  MdFolderOff,
  MdRefresh,
  MdArrowBack,
  MdDownload,
  MdCheck,
  MdDeleteSweep,
  MdClose,
} from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import { ingestFile } from '@/services/ingestService';
import {
  buildBasicAuthHeader,
  buildRequestUrl,
  listDirectory,
  normalizeRootPath,
  WebDAVEntry,
  WebDAVRequestError,
} from '@/services/webdav/WebDAVClient';
import { buildBasePath, WEBDAV_BOOKS_DIR } from '@/services/webdav/WebDAVPaths';
import { deleteRemoteBookDir } from '@/services/webdav/WebDAVSync';
import { v4 as uuidv4 } from 'uuid';
import { WebDAVSettings, WebDAVSyncLogEntry, WebDAVSyncLogFailure } from '@/types/settings';
import { Book } from '@/types/book';
import { SettingLabel } from '../primitives';
import {
  formatLastModified,
  formatShortHash,
  formatSize,
  getEntryIcon,
  isSupportedBookExt,
} from './webdavBrowseUtils';

/**
 * Live browser for the WebDAV root the user connected to.
 *
 * Owns its own current path, listing and per-entry download status;
 * the parent supplies `settings` and `t`. Doubles as the GC surface
 * for remote orphans via cleanup mode.
 */
export interface WebDAVBrowsePaneProps {
  settings: WebDAVSettings;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Persist a cleanup run into the parent's sync log when supplied. */
  onAppendSyncLogEntry?: (entry: WebDAVSyncLogEntry) => Promise<void> | void;
}

const WebDAVBrowsePane: React.FC<WebDAVBrowsePaneProps> = ({
  settings,
  t,
  onAppendSyncLogEntry,
}) => {
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { settings: globalSettings } = useSettingsStore();

  // The saved root is the authoritative "you can't navigate above me"
  // limit. Memoise so we don't recompute on every keystroke.
  const savedRoot = useMemo(() => normalizeRootPath(settings.rootPath || '/'), [settings.rootPath]);

  // Absolute path of the per-book hash directories. When the user has
  // drilled into this exact path, each row's `entry.name` is a content
  // hash and we can swap in the human-readable book title from the
  // local library (see `bookByHash` below). Computed once per
  // rootPath; `buildBasePath` already drops trailing slashes so this
  // can be string-compared against `currentPath` without further
  // normalisation.
  const booksDirPath = useMemo(
    () => `${buildBasePath(settings.rootPath || '/')}/${WEBDAV_BOOKS_DIR}`,
    [settings.rootPath],
  );

  // `currentPath` may differ from `savedRoot` once the user drills
  // into sub-folders. Seeded from saved root so the first render
  // already has a directory to load.
  const [currentPath, setCurrentPath] = useState<string>(savedRoot);
  const [entries, setEntries] = useState<WebDAVEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Increments on Refresh; an effect dependency that forces a reload. */
  const [reloadTick, setReloadTick] = useState(0);
  /**
   * Per-entry download status keyed by remote path. Resets when the
   * user navigates or refreshes; "done" stops a redundant re-tap.
   */
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, 'downloading' | 'done' | 'error'>
  >({});

  // —— Cleanup mode ——
  // GC surface for remote orphans (per-hash dirs whose local Book
  // has `deletedAt` set). When on, the listing is pinned to
  // `Readest/books/`, filtered down to those orphan rows, and the
  // footer carries a batch Delete from server action.
  const [cleanupMode, setCleanupMode] = useState(false);
  /** Selected rows, keyed by `entry.path` (already the React list key). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** True during an in-flight batch delete; gates concurrent triggers. */
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEnterCleanup = () => {
    // Snap to the books dir even if the user clicks Cleanup while
    // browsing some unrelated subfolder.
    if (currentPath !== booksDirPath) setCurrentPath(booksDirPath);
    setSelected(new Set());
    setCleanupMode(true);
  };
  const handleExitCleanup = () => {
    setCleanupMode(false);
    setSelected(new Set());
  };
  const toggleRowSelected = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Hash → Book index built from the live library. Includes
  // soft-deleted books on purpose: a remote dir whose local
  // counterpart is `deletedAt` is still that book — showing its
  // title lets the user identify what's still on the server.
  // Subscribing (rather than reading via getState) means imports
  // and downloads done elsewhere reflect here without a Refresh.
  const library = useLibraryStore((s) => s.library);
  const bookByHash = useMemo(() => {
    const map = new Map<string, Book>();
    for (const b of library ?? []) {
      if (b?.hash) map.set(b.hash, b);
    }
    return map;
  }, [library]);

  /** Per-hash directory of a book the user has soft-deleted locally. */
  const isEntryLocallyDeleted = (entry: WebDAVEntry): boolean => {
    if (!entry.isDirectory) return false;
    if (currentPath !== booksDirPath) return false;
    return !!bookByHash.get(entry.name)?.deletedAt;
  };

  // Cleanup mode shows only the orphan rows; the toolbar uses the
  // count too, so materialise the filter once here.
  const displayedEntries = useMemo(
    () => (cleanupMode ? entries.filter(isEntryLocallyDeleted) : entries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, cleanupMode, bookByHash, currentPath, booksDirPath],
  );

  /**
   * Sequentially DELETE the selected per-hash directories from the
   * server. The local library is intentionally not touched —
   * `Book.deletedAt` is the tombstone that propagates the deletion
   * across sync clients, so clearing it would resurrect the book.
   * Errors are aggregated; AUTH_FAILED short-circuits the loop.
   */
  const handleDelete = async () => {
    if (selected.size === 0 || isDeleting) return;

    // Resolve selections before any async work so a re-render of
    // `displayedEntries` can't shift indices mid-loop.
    const targets: Array<{ path: string; hash: string; title: string }> = [];
    for (const e of displayedEntries) {
      if (!selected.has(e.path)) continue;
      const matched = bookByHash.get(e.name);
      targets.push({
        path: e.path,
        hash: e.name,
        title: matched?.title || e.name,
      });
    }
    if (targets.length === 0) return;

    // appService.ask, not window.confirm — the latter is a no-op /
    // async on Tauri's WebView and would let DELETE start before the
    // user could see the dialog.
    const appService = await envConfig.getAppService();
    if (!appService) return;
    const confirmed = await appService.ask(
      t(
        'Delete {{n}} book(s) from the WebDAV server?\n\nThis only removes the remote files; your local library is unaffected. The deletion cannot be undone — the bytes on the server will be permanently gone.',
        { n: targets.length },
      ),
    );
    if (!confirmed) return;

    const startedAt = Date.now();
    let succeeded = 0;
    const failed: Array<{ hash: string; title: string; reason: string }> = [];
    let authFailed = false;

    setIsDeleting(true);
    try {
      for (let i = 0; i < targets.length; i++) {
        const t0 = targets[i]!;
        try {
          const res = await deleteRemoteBookDir(settings, t0.hash);
          if (res.ok) {
            succeeded++;
            // Splice on success so the listing itself is the progress
            // indicator: rows visibly disappear one by one.
            setEntries((prev) => prev.filter((e) => e.path !== t0.path));
            setSelected((prev) => {
              if (!prev.has(t0.path)) return prev;
              const next = new Set(prev);
              next.delete(t0.path);
              return next;
            });
          } else {
            failed.push({
              hash: t0.hash,
              title: t0.title,
              reason: res.reason ?? 'Unknown error',
            });
          }
        } catch (e) {
          if (e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED') {
            // Every remaining target would fail identically; stop
            // and surface a single re-auth toast.
            authFailed = true;
            break;
          }
          failed.push({
            hash: t0.hash,
            title: t0.title,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      setIsDeleting(false);
    }

    // No post-batch PROPFIND: the per-item splice already keeps the
    // listing in lock-step with the server, and a redundant reload
    // would briefly swap in the loading spinner — visible jump.

    // One source of truth for the toast and the log entry.
    let toastType: 'info' | 'warning' | 'error';
    let message: string;
    let status: 'success' | 'partial' | 'failure';
    let errorMessage: string | undefined;
    if (authFailed) {
      toastType = 'error';
      status = 'failure';
      message = t('WebDAV authentication failed. Reconnect in Settings.');
      errorMessage = message;
    } else if (failed.length === 0) {
      toastType = 'info';
      status = 'success';
      message = t('Deleted {{n}} book(s) from server.', { n: succeeded });
    } else if (succeeded > 0) {
      toastType = 'warning';
      status = 'partial';
      message = t('Deleted {{ok}} of {{total}}; {{n}} failed (e.g. "{{first}}").', {
        ok: succeeded,
        total: targets.length,
        n: failed.length,
        first: failed[0]!.title,
      });
    } else {
      toastType = 'warning';
      status = 'failure';
      message = t('Failed to delete {{n}} book(s) (e.g. "{{first}}").', {
        n: failed.length,
        first: failed[0]!.title,
      });
    }

    if (failed.length > 0) {
      console.warn('[webdav cleanup] delete failures', failed);
    }
    eventDispatcher.dispatch('toast', { type: toastType, message });

    // Persist into the shared sync log so cleanup runs are auditable
    // alongside Sync now. The 'cleanup' kind tag drives the panel's
    // badge and summary line; sync-only counters stay zero and the
    // panel's zero-suppress filter hides them.
    if (onAppendSyncLogEntry) {
      const failedBooks: WebDAVSyncLogFailure[] | undefined =
        failed.length > 0
          ? failed.map((f) => ({ hash: f.hash, title: f.title, reason: f.reason }))
          : undefined;
      const entry: WebDAVSyncLogEntry = {
        id: uuidv4(),
        startedAt,
        finishedAt: Date.now(),
        kind: 'cleanup',
        status,
        trigger: 'manual',
        totalBooks: targets.length,
        booksDownloaded: 0,
        filesUploaded: 0,
        filesAlreadyInSync: 0,
        configsUploaded: 0,
        configsDownloaded: 0,
        coversUploaded: 0,
        booksDeleted: succeeded,
        failures: failed.length,
        summary: message,
        errorMessage,
        failedBooks,
      };
      // Fire-and-forget: a log-write failure shouldn't surface as a
      // second toast right after the cleanup result, the user has
      // already seen the outcome they care about.
      void Promise.resolve(onAppendSyncLogEntry(entry)).catch((e) =>
        console.warn('WD cleanup: failed to append sync log entry', e),
      );
    }
  };

  // Drop stale paths from the selection whenever displayedEntries
  // shrinks (Refresh, post-Delete splice etc.) so the action button
  // can't act on phantom rows.
  useEffect(() => {
    if (!cleanupMode) return;
    setSelected((prev) => {
      const live = new Set(displayedEntries.map((e) => e.path));
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (live.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [cleanupMode, displayedEntries]);

  // Reload the listing whenever path / credentials / tick change.
  // The `cancelled` flag prevents a stale PROPFIND response from
  // overwriting the active folder (the user can navigate faster
  // than the round-trip).
  useEffect(() => {
    if (!currentPath) return;
    let cancelled = false;
    // Reset per-entry download status on every (re)load so stale
    // "done" badges don't carry across folders.
    setDownloadStatus({});
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const list = await listDirectory(
          {
            serverUrl: settings.serverUrl,
            username: settings.username,
            password: settings.password,
          },
          currentPath,
        );
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) {
          setEntries([]);
          setLoadError((e as Error).message || t('Failed to load directory'));
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
  }, [currentPath, reloadTick, settings.serverUrl, settings.username, settings.password]);

  const handleEntryClick = (entry: WebDAVEntry) => {
    if (entry.isDirectory) setCurrentPath(entry.path);
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
   * Download a single remote file and ingest it into the library.
   * Streams via tauriDownload to avoid the WebView IPC limit on
   * Android, then delegates to ingestFile for hash dedupe + Book
   * record creation. Web/desktop builds without tauriDownload
   * surface a toast (Settings is gated to Tauri platforms).
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
        message: t('File download is only supported on the desktop and mobile apps.'),
      });
      return;
    }
    const appService = await envConfig.getAppService();
    if (!appService) return;

    setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'downloading' }));
    try {
      // Cache filename is timestamped so concurrent downloads / re-taps
      // can't clobber each other's in-flight bytes.
      const safeName = entry.name.replaceAll(/[/\\:*?"<>|]/g, '_').slice(0, 200) || 'download';
      const cacheName = `webdav-${Date.now()}-${safeName}`;
      const dst = await appService.resolveFilePath(cacheName, 'Cache');
      const url = buildRequestUrl(settings.serverUrl, entry.path);
      const headers = {
        Authorization: buildBasicAuthHeader(settings.username, settings.password),
      };
      await tauriDownload(url, dst, undefined, headers);

      // Fresh library snapshot — ingestFile mutates `library` in
      // place via importBook, so we persist and push back to the
      // store afterwards.
      const { library: storeLibrary, libraryLoaded, setLibrary } = useLibraryStore.getState();
      const library = libraryLoaded ? [...storeLibrary] : await appService.loadLibraryBooks();
      const imported = await ingestFile(
        { file: dst, books: library },
        { appService, settings: globalSettings, isLoggedIn: !!user },
      );
      // ingestFile copies the bytes into Books/<hash>/, the cache
      // copy is now redundant. Best-effort delete; OS GC catches it
      // if this fails.
      try {
        await appService.deleteFile(dst, 'None');
      } catch {
        // Cache deletion is non-critical.
      }
      if (!imported) {
        throw new Error('Import returned null');
      }
      await appService.saveLibraryBooks(library);
      setLibrary(library);

      setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'done' }));
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: t('Downloaded "{{title}}" to your library.', {
          title: imported.title || entry.name,
        }),
      });
    } catch (e) {
      console.warn('WebDAV download failed', entry.path, e);
      setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'error' }));
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: t('Failed to download "{{name}}": {{error}}', {
          name: entry.name,
          error: (e as Error).message ?? String(e),
        }),
      });
    }
  };

  return (
    <>
      <div className='flex items-center justify-between gap-3 px-1'>
        <div className='flex min-w-0 items-center gap-2'>
          <button
            type='button'
            onClick={handleNavigateUp}
            // Lock in cleanup mode so users use the explicit close button.
            disabled={currentPath === savedRoot || cleanupMode}
            className={clsx(
              'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
              (currentPath === savedRoot || cleanupMode) && 'opacity-40',
            )}
            title={t('Up')}
            aria-label={t('Up')}
          >
            <MdArrowBack className='h-4 w-4' />
          </button>
          <span className='truncate text-sm' title={currentPath}>
            {cleanupMode
              ? t('Cleanup · {{count}} book(s)', { count: displayedEntries.length })
              : currentPath}
          </span>
        </div>
        <div className='flex items-center'>
          {cleanupMode ? (
            <button
              type='button'
              onClick={handleExitCleanup}
              // Locked during an in-flight batch so the user can't
              // unmount the progress affordance mid-delete.
              disabled={isDeleting}
              className={clsx('btn btn-ghost btn-sm h-8 min-h-8 px-2', isDeleting && 'opacity-40')}
              title={t('Exit cleanup')}
              aria-label={t('Exit cleanup')}
            >
              <MdClose className='h-4 w-4' />
            </button>
          ) : (
            <button
              type='button'
              onClick={handleEnterCleanup}
              className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
              title={t('Cleanup')}
              aria-label={t('Cleanup')}
            >
              <MdDeleteSweep className='h-4 w-4' />
            </button>
          )}
          <button
            type='button'
            onClick={handleRefresh}
            // Refresh during a delete would race with the per-item splice.
            disabled={isDeleting}
            className={clsx('btn btn-ghost btn-sm h-8 min-h-8 px-2', isDeleting && 'opacity-40')}
            title={t('Refresh')}
            aria-label={t('Refresh')}
          >
            <MdRefresh className='h-4 w-4' />
          </button>
        </div>
      </div>

      <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
        {isLoading ? (
          <div className='flex min-h-32 items-center justify-center py-8'>
            <span className='loading loading-spinner loading-md' />
          </div>
        ) : loadError ? (
          <div className='text-error px-4 py-6 text-center text-sm'>{loadError}</div>
        ) : displayedEntries.length === 0 ? (
          <div className='text-base-content/60 px-4 py-6 text-center text-sm'>
            {cleanupMode ? t('All clear · no books') : t('Empty directory')}
          </div>
        ) : (
          <ul className='divide-base-200 divide-y'>
            {/* Per-hash subdirectories under Readest/books resolve
                to the local library's title; rows whose hash isn't
                in the library fall back to the raw hash + mtime. */}
            {displayedEntries.map((entry) => {
              const canDownload = !entry.isDirectory && isSupportedBookExt(entry.name);
              const dlState = downloadStatus[entry.path];
              // Title decoration only kicks in inside Readest/books
              // so unrelated directories elsewhere can't be mistaken
              // for content hashes.
              const matchedBook =
                entry.isDirectory && currentPath === booksDirPath
                  ? bookByHash.get(entry.name)
                  : undefined;
              // A matched book with `deletedAt` is a remote orphan:
              // present on server, marked deleted locally. Surface it
              // with MdFolderOff so the cleanup pass can spot it.
              const isLocallyDeleted = !!matchedBook?.deletedAt;
              const FolderGlyph = isLocallyDeleted ? MdFolderOff : MdFolder;
              const FileIcon = entry.isDirectory ? FolderGlyph : getEntryIcon(entry.name);
              // Files are inert (only the trailing download button
              // is interactive); directories accept enter/click to
              // navigate (or toggle in cleanup mode).
              const rowClickable = entry.isDirectory;
              const rowTitle = isLocallyDeleted
                ? t('Deleted locally · still on server')
                : undefined;
              return (
                <li key={entry.path}>
                  <div
                    role={rowClickable ? 'button' : undefined}
                    tabIndex={rowClickable ? 0 : -1}
                    title={rowTitle}
                    onClick={
                      // In cleanup mode the row click toggles
                      // selection — navigating into the dir would
                      // break the GC scope.
                      cleanupMode
                        ? () => toggleRowSelected(entry.path)
                        : rowClickable
                          ? () => handleEntryClick(entry)
                          : undefined
                    }
                    onKeyDown={
                      rowClickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (cleanupMode) toggleRowSelected(entry.path);
                              else handleEntryClick(entry);
                            }
                          }
                        : undefined
                    }
                    className={clsx(
                      'group flex w-full items-center gap-3 px-4 py-3 text-left',
                      'transition-colors duration-150',
                      rowClickable ? 'hover:bg-base-200/60 cursor-pointer' : 'cursor-default',
                      // Selected-row tint, kept subtle so the action
                      // buttons in the footer carry the semantic colour.
                      cleanupMode && selected.has(entry.path) && 'bg-base-200/80',
                    )}
                  >
                    {cleanupMode ? (
                      // Checkbox replaces the icon: every visible
                      // row in cleanup is by definition deleted, so
                      // showing MdFolderOff for all of them is noise.
                      <span className='flex h-8 w-8 flex-shrink-0 items-center justify-center'>
                        <input
                          type='checkbox'
                          className='checkbox checkbox-sm'
                          checked={selected.has(entry.path)}
                          // Stop the checkbox's own click from
                          // bubbling into a row-level double-toggle.
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleRowSelected(entry.path)}
                          aria-label={t('Select')}
                        />
                      </span>
                    ) : (
                      <span
                        className={clsx(
                          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded',
                          'bg-base-200 text-base-content/70',
                        )}
                      >
                        <FileIcon className='h-4 w-4' />
                      </span>
                    )}
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      {/* Primary line: matched books show their
                          title, everything else shows the raw name.
                          line-clamp-none + break-all let unicode-only
                          names wrap. */}
                      <SettingLabel
                        className={clsx(
                          'line-clamp-none whitespace-normal break-all',
                          // Dimmed title is the platform-independent
                          // sibling of the MdFolderOff icon (touch
                          // platforms can't see the hover tooltip).
                          isLocallyDeleted && 'text-base-content/60',
                        )}
                        // Hover-show the full hash for matched books,
                        // but yield the slot to the row-level
                        // "Deleted locally" tooltip when applicable
                        // (browsers pick the innermost `title`).
                        title={matchedBook && !isLocallyDeleted ? entry.name : undefined}
                      >
                        {matchedBook ? matchedBook.title || entry.name : entry.name}
                      </SettingLabel>
                      {/* Metadata line: short hash (when matched) +
                          file size + last-modified. Whole line is
                          gated on at least one field being present
                          so directories don't render an empty span. */}
                      {(matchedBook ||
                        (!entry.isDirectory && typeof entry.size === 'number') ||
                        entry.lastModified) && (
                        <span className='text-base-content/60 flex flex-wrap gap-x-2 text-[0.75em]'>
                          {matchedBook && (
                            <span title={entry.name} className='font-mono'>
                              {formatShortHash(entry.name)}
                            </span>
                          )}
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
                            ? t('Already downloaded in this session')
                            : dlState === 'downloading'
                              ? t('Downloading…')
                              : t('Download to library')
                        }
                        aria-label={
                          dlState === 'done'
                            ? t('Already downloaded in this session')
                            : dlState === 'downloading'
                              ? t('Downloading…')
                              : t('Download to library')
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
        {/* Cleanup-mode batch footer. Lives inside the card so it
            belongs visually to the listing it operates on, outside
            the loading/error branches so the user can always cancel.
            Buttons are dimmed-but-present when selection is empty,
            avoiding layout shifts as checkboxes toggle. */}
        {cleanupMode && (
          <div className='border-base-200 bg-base-100/70 flex flex-col gap-2 border-t px-4 py-3'>
            {/* Top row: scope. */}
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => {
                  // Toggle: clear if everything's selected, else select all.
                  const allSelected =
                    displayedEntries.length > 0 && selected.size === displayedEntries.length;
                  setSelected(
                    allSelected ? new Set() : new Set(displayedEntries.map((e) => e.path)),
                  );
                }}
                disabled={displayedEntries.length === 0 || isDeleting}
                className={clsx(
                  'btn btn-ghost btn-xs flex-shrink-0',
                  (displayedEntries.length === 0 || isDeleting) && 'opacity-40',
                )}
              >
                {displayedEntries.length > 0 && selected.size === displayedEntries.length
                  ? t('Deselect all')
                  : t('Select all')}
              </button>
              <span className='text-base-content/60 truncate text-xs'>
                {t('{{n}} selected', { n: selected.size })}
              </span>
            </div>
            {/* Bottom row: action. The per-entry download button
                provides recovery (ingestFile clears deletedAt on
                re-import), so cleanup needs no Restore counterpart. */}
            <div className='flex items-center justify-end gap-2'>
              <button
                type='button'
                onClick={handleDelete}
                disabled={selected.size === 0 || isDeleting}
                className={clsx(
                  'btn btn-error btn-sm flex-shrink-0 gap-1',
                  (selected.size === 0 || isDeleting) && 'opacity-60',
                )}
              >
                {/* Always-rendered spinner span keeps the button
                    width stable; `invisible` hides the pixels when
                    idle without yielding the layout slot. */}
                <span
                  className={clsx('loading loading-spinner loading-xs', !isDeleting && 'invisible')}
                />
                {t('Delete from server')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default WebDAVBrowsePane;
