import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import {
  MdFolder,
  MdInsertDriveFile,
  MdRefresh,
  MdArrowBack,
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
} from '@/services/webdav/WebDAVClient';
import { EXTS } from '@/libs/document';
import { WebDAVSettings } from '@/types/settings';
import { SettingLabel } from '../primitives';

/**
 * Live browser for the WebDAV root that the user connected to.
 *
 * Self-contained: owns the current path, the directory listing, the
 * per-entry download status and the navigation handlers. The parent
 * only supplies the configured `settings` (server URL, credentials,
 * stored rootPath) and a translation function. The pane intentionally
 * doesn't know how the user got here or how they leave — disconnect
 * is the parent's job because it has to flip a top-level setting.
 *
 * Browser pane was extracted from WebDAVForm to keep the surface
 * legible. The form file previously hosted three concerns (config
 * form, sync controls, file browser) that didn't share much state.
 */
export interface WebDAVBrowsePaneProps {
  settings: WebDAVSettings;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const WebDAVBrowsePane: React.FC<WebDAVBrowsePaneProps> = ({ settings, t }) => {
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { settings: globalSettings } = useSettingsStore();

  // The saved root is the authoritative "you can't navigate above me"
  // limit. Memoise so we don't recompute on every keystroke.
  const savedRoot = useMemo(() => normalizeRootPath(settings.rootPath || '/'), [settings.rootPath]);

  // `currentPath` may differ from `savedRoot` once the user drills into
  // sub-folders. Seeded from saved root so the first render after
  // mounting (or after the parent flips into browse-mode) already has
  // a directory to load.
  const [currentPath, setCurrentPath] = useState<string>(savedRoot);
  const [entries, setEntries] = useState<WebDAVEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Increments on Refresh — used purely as an effect dependency so the
  // listing reloads even when `currentPath` hasn't changed.
  const [reloadTick, setReloadTick] = useState(0);
  // Per-entry download status keyed by remote path. Resets when the
  // user navigates or refreshes — within a session, a successful
  // download is marked "done" so the button stops inviting a redundant
  // re-tap. `ingestFile`'s hash dedupe protects us if the user does
  // click again, but a quiet visual cue is friendlier than a no-op.
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, 'downloading' | 'done' | 'error'>
  >({});

  // Reload the directory listing whenever the path, credentials or the
  // refresh tick change. Each load is guarded by a `cancelled` flag so
  // a stale response from a previous folder can't overwrite the active
  // one — the user can navigate faster than the network round-trip.
  useEffect(() => {
    if (!currentPath) return;
    let cancelled = false;
    // Reset per-entry download status whenever we (re)load a directory:
    // stale "done" badges from a previous folder would otherwise
    // confuse users who navigate back to that folder.
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
   * Download a single remote file into the local library.
   *
   * Mirrors the OPDS auto-download path: stream the bytes to a Cache
   * file via `tauriDownload` (avoids the WebView<->Tauri IPC binder
   * limit that kills mid-write transfers on Android), then hand the
   * file to {@link ingestFile} — the channel-agnostic importer used by
   * every capture path (local folder import, Send-to-Readest, inbox
   * drainer). It extracts metadata, writes the cover, computes the
   * content hash (so re-downloading the same book is a deduped no-op),
   * and produces a Book entry; honouring the user's autoUpload setting
   * means a logged-in user with autoUpload on will see the downloaded
   * book pushed to the readest cloud too — same behaviour as dragging
   * the file in by hand.
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
        message: t('File download is only supported on the desktop and mobile apps.'),
      });
      return;
    }
    const appService = await envConfig.getAppService();
    if (!appService) return;

    setDownloadStatus((prev) => ({ ...prev, [entry.path]: 'downloading' }));
    try {
      // Stream into Cache under a unique filename so a parallel
      // download (or a re-tap before the previous one finished)
      // doesn't clobber the in-flight bytes. We don't bother with
      // sanitisation here — the suffix dominates collision probability.
      const safeName = entry.name.replaceAll(/[/\\:*?"<>|]/g, '_').slice(0, 200) || 'download';
      const cacheName = `webdav-${Date.now()}-${safeName}`;
      const dst = await appService.resolveFilePath(cacheName, 'Cache');
      const url = buildRequestUrl(settings.serverUrl, entry.path);
      const headers = {
        Authorization: buildBasicAuthHeader(settings.username, settings.password),
      };
      await tauriDownload(url, dst, undefined, headers);

      // Run import against a fresh library snapshot — the user may
      // have imported books elsewhere since this page mounted.
      // ingestFile delegates to importBook which mutates the array in
      // place; we must persist + push it back into the store
      // afterwards for the bookshelf to reflect the new entry.
      const { library: storeLibrary, libraryLoaded, setLibrary } = useLibraryStore.getState();
      const library = libraryLoaded ? [...storeLibrary] : await appService.loadLibraryBooks();
      const imported = await ingestFile(
        { file: dst, books: library },
        { appService, settings: globalSettings, isLoggedIn: !!user },
      );
      // Best-effort cleanup of the cache file. ingestFile → importBook
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
            disabled={currentPath === savedRoot}
            className={clsx(
              'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
              currentPath === savedRoot && 'opacity-40',
            )}
            title={t('Up')}
            aria-label={t('Up')}
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
          title={t('Refresh')}
          aria-label={t('Refresh')}
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
            {t('Empty directory')}
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
                      {/* line-clamp-none cancels SettingLabel's
                          default line-clamp-2 so long file names wrap
                          freely; break-all + whitespace-normal handle
                          hyphenless unicode names that don't have a
                          wrap opportunity. */}
                      <SettingLabel className='line-clamp-none whitespace-normal break-all'>
                        {entry.name}
                      </SettingLabel>
                      {/* Secondary metadata line. Files show size +
                          mtime; directories only show mtime (most
                          servers don't report aggregated child sizes
                          on a collection). The whole line is gated on
                          at least one field being available so we
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
      </div>
    </>
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
 * Render the WebDAV-supplied last-modified timestamp in a compact,
 * locale-aware form for the secondary line under each file. Servers
 * usually emit RFC 1123 ("Wed, 02 Oct 2002 13:00:00 GMT") via
 * `getlastmodified`, but a handful return ISO-8601 — `Date` parses
 * both. If the value can't be understood we return an empty string so
 * the row simply omits the field rather than rendering "Invalid Date".
 *
 * The full timestamp is exposed as a `title` on the wrapping span so
 * power users can hover for the precise time without us spending
 * pixels on it.
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
 * True when the filename's extension matches one of the reader-
 * supported book formats declared in `libs/document.ts`. Used to gate
 * the per-entry download button: only files we can actually open get
 * the affordance, so the user doesn't waste a tap pulling down
 * something the library can't import (font files, README.txt, hidden
 * dotfiles, …).
 *
 * Keep aligned with `EXTS` — adding a new format there should
 * automatically light up the download button for that extension.
 */
const SUPPORTED_BOOK_EXTS = new Set<string>(Object.values(EXTS).map((e) => e.toLowerCase()));

const isSupportedBookExt = (filename: string): boolean => {
  const m = filename.match(/\.([^.]+)$/);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  return !!ext && SUPPORTED_BOOK_EXTS.has(ext);
};

/**
 * Pick a per-file icon based on the entry's extension. Reader-
 * recognised formats get a specific icon (`BsFiletypePdf`,
 * `BsFiletypeTxt`, `BsFiletypeMd` are pixel-perfect matches; EPUB /
 * MOBI / AZW / FB2 fall back to the generic `BsBook`; CBZ uses the
 * comic-friendly `LuBookImage`), everything else stays on the neutral
 * `MdInsertDriveFile`. Cover images and the library/config JSON files
 * that live next to each book also get their own icons so the
 * readest-managed subtree is self-explanatory.
 *
 * Keep in sync with `EXTS` in `libs/document.ts` when a new format is
 * added.
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

export default WebDAVBrowsePane;
