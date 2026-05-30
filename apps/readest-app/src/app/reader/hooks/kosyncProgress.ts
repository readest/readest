import { BookDoc } from '@/libs/document';
import { FoliateView } from '@/types/view';
import { getCFIFromXPointer } from '@/utils/xcfi';
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

/**
 * Resolves a remote KOReader position to a 0–1 progress fraction expressed in
 * the LOCAL book's pagination terms.
 *
 * KOReader and Readest paginate differently, so the server-reported
 * `percentage` is not directly comparable to Readest's own progress. When the
 * remote position is a CREngine XPointer we convert it to a local CFI and ask
 * the view for the equivalent fraction, giving an apples-to-apples value.
 * Returns `undefined` when the position can't be resolved locally (non-XPointer
 * progress, conversion failure, or an unknown CFI) so callers can fall back to
 * the server-reported percentage.
 */
export const getRemoteLocalFraction = async (
  remote: KoSyncProgress,
  view: FoliateView,
  bookDoc: BookDoc,
): Promise<number | undefined> => {
  if (!isXPointerProgress(remote.progress)) return undefined;
  try {
    // Resolve against the XPointer's own spine section; the converter loads the
    // correct off-screen document when it differs from the primary view.
    const content = view.renderer.getContents().find((x) => x.index === view.renderer.primaryIndex);
    const cfi = await getCFIFromXPointer(remote.progress!, content?.doc, content?.index, bookDoc);
    const progress = await view.getCFIProgress(cfi);
    return progress?.fraction;
  } catch (error) {
    console.error('Failed to resolve remote progress to a local fraction', error);
    return undefined;
  }
};
