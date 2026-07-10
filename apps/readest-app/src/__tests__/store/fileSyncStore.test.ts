import { beforeEach, describe, expect, test } from 'vitest';
import { useFileSyncStore } from '@/store/fileSyncStore';

const reset = () =>
  useFileSyncStore.setState({ byKind: {}, activeKind: null, lastErrorByKind: {} });

describe('fileSyncStore', () => {
  beforeEach(reset);

  test('beginSync acquires the mutex and marks the backend syncing', () => {
    const { beginSync } = useFileSyncStore.getState();
    expect(beginSync('webdav', 'Syncing 0 / 3')).toBe(true);
    const s = useFileSyncStore.getState();
    expect(s.activeKind).toBe('webdav');
    expect(s.byKind.webdav?.isSyncing).toBe(true);
    expect(s.byKind.webdav?.progressLabel).toBe('Syncing 0 / 3');
  });

  test('a second backend cannot begin while another holds the lock', () => {
    const { beginSync } = useFileSyncStore.getState();
    expect(beginSync('webdav', 'a')).toBe(true);
    // Drive must not start a library sync while WebDAV is mid-run.
    expect(beginSync('gdrive', 'b')).toBe(false);
    expect(useFileSyncStore.getState().byKind.gdrive).toBeUndefined();
    expect(useFileSyncStore.getState().activeKind).toBe('webdav');
  });

  test('endSync releases the lock and resets that backend to idle', () => {
    const { beginSync, endSync } = useFileSyncStore.getState();
    beginSync('webdav', 'a');
    endSync('webdav');
    const s = useFileSyncStore.getState();
    expect(s.activeKind).toBeNull();
    expect(s.byKind.webdav?.isSyncing).toBe(false);
    // Lock is free again for any backend.
    expect(s.beginSync('gdrive', 'c')).toBe(true);
    expect(useFileSyncStore.getState().activeKind).toBe('gdrive');
  });

  test('updateProgress sets the label + detail for the active backend', () => {
    const { beginSync, updateProgress } = useFileSyncStore.getState();
    beginSync('webdav', 'start');
    updateProgress('webdav', 'Uploading 2 / 3', 'Project Hail Mary');
    const p = useFileSyncStore.getState().byKind.webdav;
    expect(p?.progressLabel).toBe('Uploading 2 / 3');
    expect(p?.progressDetail).toBe('Project Hail Mary');
  });

  test('lastError is recorded per backend and survives endSync until cleared', () => {
    const { beginSync, setLastError, endSync } = useFileSyncStore.getState();
    beginSync('webdav', 'a');
    setLastError('webdav', 'AUTH_FAILED: 401');
    endSync('webdav');
    // The health surface reads this after the run finished.
    expect(useFileSyncStore.getState().lastErrorByKind.webdav).toBe('AUTH_FAILED: 401');
    expect(useFileSyncStore.getState().lastErrorByKind.gdrive).toBeUndefined();
    // A later successful run clears it.
    setLastError('webdav', null);
    expect(useFileSyncStore.getState().lastErrorByKind.webdav).toBeNull();
  });
});
