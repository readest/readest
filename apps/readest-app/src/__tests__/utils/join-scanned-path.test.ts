import { describe, it, expect } from 'vitest';

import { joinScannedPath } from '@/utils/path';
import { normalizeFilePathForIndex } from '@/services/bookService';

/**
 * Issue #5494: the watched-folder scan joined every scanned relative path back
 * to its folder root with the async Tauri `join()` — one IPC round-trip per
 * file, ~1200 per window focus on a Calibre-style 400-book folder, all queued
 * on the same main thread the recursive scan was already blocking. The join is
 * pure string work: the scan returns host-separator relative paths and the
 * root comes from the folder picker in native form. `joinScannedPath` pins
 * that equivalence.
 */
describe('joinScannedPath', () => {
  it('joins posix roots with forward slashes', () => {
    expect(joinScannedPath('/lib/watched', 'SciFi/dune.epub')).toBe('/lib/watched/SciFi/dune.epub');
    expect(joinScannedPath('/lib/watched', 'loose.epub')).toBe('/lib/watched/loose.epub');
  });

  it('joins windows roots with backslashes', () => {
    expect(joinScannedPath('C:\\Books', 'SciFi\\dune.epub')).toBe('C:\\Books\\SciFi\\dune.epub');
  });

  it('does not double up separators when the root has a trailing one', () => {
    expect(joinScannedPath('/lib/watched/', 'dune.epub')).toBe('/lib/watched/dune.epub');
    expect(joinScannedPath('C:\\Books\\', 'dune.epub')).toBe('C:\\Books\\dune.epub');
  });

  it('produces the same byFilePath index key as a native-join path', () => {
    // Membership against `collectKnownSourcePaths` is what keeps the scan from
    // re-importing on every focus — the cheap join must key identically to the
    // `filePath` values stored by earlier native-join imports.
    const stored = normalizeFilePathForIndex('C:\\Books\\SciFi\\dune.epub', 'windows');
    const scanned = normalizeFilePathForIndex(
      joinScannedPath('C:\\Books', 'SciFi\\dune.epub'),
      'windows',
    );
    expect(scanned).toBe(stored);
  });
});
