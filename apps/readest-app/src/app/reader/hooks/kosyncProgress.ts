import { KoSyncProgress } from '@/services/sync/KOSyncClient';

/**
 * True when a KOSync `progress` string is a CREngine XPointer — KOReader's
 * native position format, e.g. `/body/DocFragment[11]/body/div/p[3]/text().0`.
 *
 * Servers other than KOReader — notably Kavita's KOReader-compatible sync
 * endpoint — report `progress` in formats Readest cannot resolve to a CFI.
 * For those, callers should fall back to the percentage (getRemoteFraction).
 */
export const isXPointerProgress = (progress?: string): boolean =>
  !!progress && progress.startsWith('/body');

/**
 * Remote reading completion as a 0–1 fraction suitable for
 * `view.goToFraction`, or `undefined` when the server reported no usable
 * percentage (missing, non-finite, or out of range).
 */
export const getRemoteFraction = (remote: KoSyncProgress): number | undefined => {
  const { percentage } = remote;
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage <= 0) {
    return undefined;
  }
  return Math.min(percentage, 1);
};
