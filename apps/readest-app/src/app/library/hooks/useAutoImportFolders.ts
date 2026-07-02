import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWindowActiveChanged } from '@/app/reader/hooks/useWindowActiveChanged';
import { debounce } from '@/utils/debounce';

/** Quiet window collapsing the near-simultaneous mount + focus/visibility triggers. */
const AUTO_IMPORT_DEBOUNCE_MS = 800;

export interface UseAutoImportFoldersOptions {
  /**
   * Master gate. When false the hook never scans. Compose it in the caller
   * from the setting toggle, folder count, library-loaded, and platform checks.
   */
  enabled: boolean;
  /** Absolute paths to re-scan (settings.externalLibraryFolders). */
  folders: string[];
  /** Scans the folders and imports any new books. Supplied by the library page. */
  scanAndImport: (folders: string[]) => Promise<void>;
}

/**
 * Re-scans the user's registered external library folders and imports newly
 * added books — on mount and whenever the app regains focus (desktop) or
 * becomes visible again (mobile). Local-folder counterpart of
 * {@link useLibraryFileSync}. Mount once on the library page. This hook only
 * decides *when* to run; the scan/dedup/import lives in `scanAndImport`.
 */
export const useAutoImportFolders = ({
  enabled,
  folders,
  scanAndImport,
}: UseAutoImportFoldersOptions) => {
  // Read the latest values at fire time so a toggle-off or folder-list change
  // between schedule and fire is honoured without rebuilding the debounced fn.
  const enabledRef = useRef(enabled);
  const foldersRef = useRef(folders);
  const scanRef = useRef(scanAndImport);
  const runningRef = useRef(false);
  useEffect(() => {
    enabledRef.current = enabled;
    foldersRef.current = folders;
    scanRef.current = scanAndImport;
  });

  const run = useCallback(async () => {
    if (!enabledRef.current || runningRef.current) return;
    const targets = foldersRef.current;
    if (targets.length === 0) return;
    runningRef.current = true;
    try {
      await scanRef.current(targets);
    } catch (e) {
      console.error('Auto-import folders: scan failed', e);
    } finally {
      runningRef.current = false;
    }
  }, []);

  const debouncedRun = useMemo(() => debounce(() => void run(), AUTO_IMPORT_DEBOUNCE_MS), [run]);

  // Fire on mount and whenever the gate opens or the folder set changes.
  const foldersKey = folders.join('\n');
  useEffect(() => {
    if (enabled && folders.length > 0) debouncedRun();
    return () => debouncedRun.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, foldersKey, debouncedRun]);

  // Fire when the app/window regains focus (desktop) or becomes visible (mobile).
  useWindowActiveChanged((isActive) => {
    if (isActive) debouncedRun();
  });
};
