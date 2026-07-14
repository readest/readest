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
 * Outcome of resolving a remote KOReader position against the LOCAL book.
 *
 * The distinction between `unresolved` and `not-xpointer` is critical for
 * conflict detection (see {@link decideRemoteConflict}):
 *
 * - `resolved`     — the XPointer maps to a local position; `fraction` is an
 *                    apples-to-apples value comparable to Readest's progress.
 * - `unresolved`   — the progress IS a KOReader XPointer but couldn't be
 *                    converted to a local position (conversion threw, or the
 *                    CFI resolves to no local progress). This is common on iOS
 *                    (WKWebView) and is often a symptom of the DocFragment↔spine
 *                    drift (Bug A). It is NOT the same as "no conflict".
 * - `not-xpointer` — the server reported progress in a format Readest can't
 *                    resolve positionally (e.g. Kavita). The reported
 *                    percentage is the only comparable signal.
 */
export type RemoteFractionResolution =
  | { status: 'resolved'; fraction: number }
  | { status: 'unresolved' }
  | { status: 'not-xpointer' };

/**
 * Resolves a remote KOReader position to a 0–1 progress fraction expressed in
 * the LOCAL book's pagination terms, reporting WHY it couldn't when it fails.
 *
 * KOReader and Readest paginate differently, so the server-reported
 * `percentage` is not directly comparable to Readest's own progress. When the
 * remote position is a CREngine XPointer we convert it to a local CFI and ask
 * the view for the equivalent fraction, giving an apples-to-apples value.
 *
 * Callers must treat `unresolved` differently from `not-xpointer`: a KOReader
 * XPointer that failed to resolve must never be assumed to match the local
 * position just because the (incomparable) percentages happen to line up.
 */
export const resolveRemoteLocalFraction = async (
  remote: KoSyncProgress,
  view: FoliateView,
  bookDoc: BookDoc,
): Promise<RemoteFractionResolution> => {
  if (!isXPointerProgress(remote.progress)) return { status: 'not-xpointer' };
  try {
    // Resolve against the XPointer's own spine section; the converter loads the
    // correct off-screen document when it differs from the primary view.
    const content = view.renderer.getContents().find((x) => x.index === view.renderer.primaryIndex);
    // Pass the server-reported percentage so xcfi can correct CREngine↔foliate
    // DocFragment drift (Bug A) when picking the target spine section.
    const cfi = await getCFIFromXPointer(
      remote.progress!,
      content?.doc,
      content?.index,
      bookDoc,
      remote.percentage,
    );
    const progress = await view.getCFIProgress(cfi);
    const fraction = progress?.fraction;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
      return { status: 'unresolved' };
    }
    return { status: 'resolved', fraction };
  } catch (error) {
    console.error('Failed to resolve remote progress to a local fraction', error);
    return { status: 'unresolved' };
  }
};

/**
 * Backwards-compatible helper: the local fraction, or `undefined` when the
 * remote position couldn't be resolved for any reason. Prefer
 * {@link resolveRemoteLocalFraction} when the failure reason matters.
 */
export const getRemoteLocalFraction = async (
  remote: KoSyncProgress,
  view: FoliateView,
  bookDoc: BookDoc,
): Promise<number | undefined> => {
  const resolution = await resolveRemoteLocalFraction(remote, view, bookDoc);
  return resolution.status === 'resolved' ? resolution.fraction : undefined;
};

/** Decision on whether a remote position conflicts with the local one. */
export interface RemoteConflictDecision {
  /** Whether to surface the conflict prompt (and hold off auto-push). */
  showConflictDetails: boolean;
  /** The 0–1 value used for the remote side of the comparison/preview. */
  comparePercentage: number;
}

/**
 * Decides whether a remote reflowable position conflicts with the local one.
 *
 * The core fix for #5065: an `unresolved` KOReader XPointer must NEVER be
 * assimilated to "no conflict" by comparing KOReader's percentage (from its own
 * CREngine pagination) against Readest's. Those percentages are not comparable,
 * so a coincidental match previously suppressed the prompt entirely — the
 * remote position was never applied and auto-push then clobbered it with the
 * stale local position. Failure to resolve ≠ absence of conflict: we surface
 * the prompt so the user decides and the reader stays in a conflict state,
 * which blocks the auto-push that would otherwise overwrite the remote side.
 */
export const decideRemoteConflict = (
  resolution: RemoteFractionResolution,
  localPercentage: number,
  remotePercentage: number,
  threshold: number,
): RemoteConflictDecision => {
  switch (resolution.status) {
    case 'resolved':
      // Apples-to-apples: both sides are expressed in Readest's pagination.
      return {
        showConflictDetails: Math.abs(localPercentage - resolution.fraction) > threshold,
        comparePercentage: resolution.fraction,
      };
    case 'unresolved':
      // Can't compare a KOReader XPointer's percentage to Readest's — treat as
      // a conflict so the position is never silently dropped or overwritten.
      return { showConflictDetails: true, comparePercentage: remotePercentage };
    case 'not-xpointer':
      // Non-KOReader server (e.g. Kavita): the percentage is the only
      // comparable signal we have, so compare against it directly.
      return {
        showConflictDetails: Math.abs(localPercentage - remotePercentage) > threshold,
        comparePercentage: remotePercentage,
      };
  }
};
