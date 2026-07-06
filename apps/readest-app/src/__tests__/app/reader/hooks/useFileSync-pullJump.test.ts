import { describe, expect, it } from 'vitest';
import { remoteProgressApplied } from '@/app/reader/hooks/useFileSync';

// Parity with the native cloud sync (useProgressSync): pulling a config whose
// merged reading position came from the remote must surface the same
// top-right "Reading Progress Synced" hint for WebDAV / Google Drive.
describe('remoteProgressApplied', () => {
  const local = 'epubcfi(/6/4!/4/2/2:0)';
  const remote = 'epubcfi(/6/8!/4/2/2:0)';

  it('is true when the merged location differs from the local one', () => {
    expect(remoteProgressApplied(local, remote)).toBe(true);
  });

  it('is true when this device had no position yet', () => {
    expect(remoteProgressApplied(undefined, remote)).toBe(true);
    expect(remoteProgressApplied(null, remote)).toBe(true);
  });

  it('is false when the merge kept the local position', () => {
    expect(remoteProgressApplied(local, local)).toBe(false);
  });

  it('is false when the pull produced no location', () => {
    expect(remoteProgressApplied(local, undefined)).toBe(false);
    expect(remoteProgressApplied(local, null)).toBe(false);
  });
});
