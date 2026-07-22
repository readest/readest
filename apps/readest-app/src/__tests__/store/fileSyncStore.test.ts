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

describe('fileSyncStore pass mutex', () => {
  beforeEach(reset);

  test('switchSync hands the lock to the next backend without releasing it', () => {
    const store = useFileSyncStore.getState();
    expect(store.beginSync('webdav', 'Syncing…')).toBe(true);

    useFileSyncStore.getState().switchSync('gdrive', 'Syncing…');

    const s = useFileSyncStore.getState();
    expect(s.activeKind).toBe('gdrive');
    expect(s.byKind.gdrive?.isSyncing).toBe(true);
    // The finished backend goes idle, but the lock was never free.
    expect(s.byKind.webdav?.isSyncing).toBe(false);
    // An auto-sync trying to start mid-pass is still refused.
    expect(useFileSyncStore.getState().beginSync('s3', 'Syncing…')).toBe(false);
  });

  test('endSync after a switch releases the lock', () => {
    useFileSyncStore.getState().beginSync('webdav', 'Syncing…');
    useFileSyncStore.getState().switchSync('gdrive', 'Syncing…');
    useFileSyncStore.getState().endSync('gdrive');

    expect(useFileSyncStore.getState().activeKind).toBeNull();
    expect(useFileSyncStore.getState().beginSync('s3', 'Syncing…')).toBe(true);
  });

  test('switchSync with lock free is a no-op and does not acquire the lock', () => {
    const store = useFileSyncStore.getState();
    // Call switchSync when activeKind is null (lock is free).
    store.switchSync('gdrive', 'Syncing…');

    const s = useFileSyncStore.getState();
    // Lock must remain free.
    expect(s.activeKind).toBeNull();
    // No byKind entry should have been created for gdrive.
    expect(s.byKind.gdrive).toBeUndefined();
    // A subsequent beginSync must succeed, proving the lock was never taken.
    expect(store.beginSync('gdrive', 'Syncing…')).toBe(true);
    // After beginSync, the lock should be acquired.
    expect(useFileSyncStore.getState().activeKind).toBe('gdrive');
  });
});
