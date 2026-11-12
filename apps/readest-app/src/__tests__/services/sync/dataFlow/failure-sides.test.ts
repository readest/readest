// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordLibraryPass, recordLibraryPassFailure } from '@/services/sync/file/runLibrarySync';
import type { SyncLibraryResult } from '@/services/sync/file/engine';
import { getConnectorSyncStatus, readFlowState } from '@/services/sync/dataFlow/log';

const pass = (patch: Partial<SyncLibraryResult>) =>
  ({
    booksSynced: 0,
    failures: 0,
    failedBooks: [],
    indexPushFailed: false,
    ...patch,
  }) as SyncLibraryResult;

const status = (direction: 'pull' | 'push') =>
  getConnectorSyncStatus(readFlowState(), 'webdav', direction).status;

describe('library pass failures land on the side that broke', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('files a book that failed to download under the source', () => {
    recordLibraryPass(
      'webdav',
      pass({
        failedBooks: [{ hash: 'h1', title: 'Dune', phase: 'download', reason: 'HTTP 500' }],
      }),
    );

    expect(status('pull')).toBe('failed');
    expect(status('push')).toBe('ok');
  });

  it('files a book that failed to upload under the destination', () => {
    recordLibraryPass(
      'webdav',
      pass({
        failedBooks: [{ hash: 'h1', title: 'Dune', phase: 'upload-file', reason: 'HTTP 507' }],
      }),
    );

    expect(status('pull')).toBe('ok');
    expect(status('push')).toBe('failed');
  });

  it('flags both sides of a pass that stopped partway, since either could have broken', () => {
    recordLibraryPassFailure('webdav', 'Could not read the library index');

    expect(status('pull')).toBe('failed');
    expect(status('push')).toBe('failed');
  });
});
