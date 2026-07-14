import { BookDoc } from '@/libs/document';
import { FoliateView } from '@/types/view';
import { getCFIFromXPointer } from '@/utils/xcfi';
import { KoSyncProgress } from '@/services/sync/KOSyncClient';

/**
 * True when a KOSync `progress` string is a CREngine XPointer — KOReader's
 * native position format, e.g. `/body/DocFragment[11]/body/div/p[3]/text().0`.
 *
 * Servers other than KOReader — notably Kavita's KOReader-compatible sync
 * endpoint — also emit `/body/DocFragment[...]` XPointers that Readest CAN
 * resolve positionally, but their `percentage` is computed from their own
 * pagination, not CREngine's. See {@link isReportedByKOReader}: the drift
 * correction in xcfi (`resolveSpineSectionIndex`) must only trust that
 * percentage as a CREngine↔foliate drift signal when the report actually
 * comes from KOReader.
 */
export const isXPointerProgress = (progress?: string): boolean =>
  !!progress && progress.startsWith('/body');

/**
 * Whether a KOSync progress report can be trusted to carry a CREngine-style
 * `percentage` (i.e. computed from KOReader/CREngine's own pagination).
 *
 * This matters for {@link resolveRemoteLocalFraction}: it forwards `percentage`
 * into xcfi's `resolveSpineSectionIndex` as an anchor to correct CREngine's
 * DocFragment↔spine-section drift (Bug A). That correction assumes `percentage`
 * and the XPointer's `DocFragment[N]` both originate from the same CREngine
 * pagination. Servers that merely imitate the CREngine XPointer format (e.g.
 * Kavita) compute `percentage` from their OWN pagination, which routinely
 * disagrees with foliate-js's byte-size-based section table — feeding it into
 * the drift correction re-anchors to the wrong chapter instead of the correct
 * one the XPointer's nominal DocFragment already pointed to (#5109).
 *
 * KOReader itself doesn't self-identify in the KOSync protocol, so absence of
 * a contradicting `device` string is treated as "trust it" (the common case).
 * Only a `device` we can positively attribute to a non-KOReader implementation
 * disables the anchor.
 */
export const isReportedByKOReader = (remote: KoSyncProgress): boolean => {
  const device = remote.device?.toLowerCase() ?? '';
  const knownNonKOReaderSources = ['kavita', 'komga', 'stump', 'calibre-web'];
  return !knownNonKOReaderSources.some((source) => device.includes(source));
};

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
    // DocFragment drift (Bug A) when picking the target spine section — but
    // only when the report actually comes from KOReader (#5109): a look-alike
    // server's percentage isn't computed from CREngine's pagination and must
    // not be used to override the XPointer's own nominal section.
    const driftAnchorPercentage = isReportedByKOReader(remote) ? remote.percentage : undefined;
    const cfi = await getCFIFromXPointer(
      remote.progress!,
      content?.doc,
      content?.index,
      bookDoc,
      driftAnchorPercentage,
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
