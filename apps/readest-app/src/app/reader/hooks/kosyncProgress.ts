import * as CFI from 'foliate-js/epubcfi.js';
import { BookDoc } from '@/libs/document';
import { FoliateView } from '@/types/view';
import { getCFIFromXPointer } from '@/utils/xcfi';
import { KoSyncProgress } from '@/services/sync/KOSyncClient';

/**
 * True when a KOSync `progress` string is a CREngine XPointer — KOReader's
 * native position format, e.g. `/body/DocFragment[11]/body/div/p[3]/text().0`.
 *
 * Servers other than KOReader — notably Kavita's KOReader-compatible sync
 * endpoint — also emit `/body/DocFragment[...]` XPointers, and Readest resolves
 * every one of them the same way: through the XPointer's own `DocFragment[N]`.
 * A server's `percentage` never picks the section (see `getCFIFromXPointer`),
 * so no server sniffing is needed here.
 *
 * crengine reads FB2 natively, so an FB2 book's XPointer starts at its
 * FictionBook root instead: `/FictionBook/body[1]/section[3]/p[9]/text().322`,
 * and a MOBI book's at its HTML root: `/html/body/body/div[8]/p[152]/text().596`.
 * Newer crengine writes `[1]` on every first step, so the roots can also read
 * `/body[1]`, `/FictionBook[1]` and `/html[1]`.
 */
export const isXPointerProgress = (progress?: string): boolean =>
  !!progress &&
  ['/body', '/FictionBook', '/html/', '/html[1]/'].some((root) => progress.startsWith(root));

/** True when a remote position is an EPUB CFI, as Grimmory's own reader writes. */
export const isCfiProgress = (progress?: string): boolean =>
  !!progress && progress.startsWith('epubcfi(');

/**
 * True when a remote CFI starts on the page this device shows (`pageCfi` is
 * the visible range). Its fraction would sit a page before the page-end
 * percentage, so it is compared by position instead.
 */
export const isCfiOnPage = (cfi: string, pageCfi: string): boolean => {
  try {
    const start = CFI.collapse(cfi);
    return (
      CFI.compare(start, CFI.collapse(pageCfi)) >= 0 &&
      CFI.compare(start, CFI.collapse(pageCfi, true)) <= 0
    );
  } catch {
    return false;
  }
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
 * The 1-based page a remote fixed-layout position names. KOReader sends the
 * page number as `progress`; Grimmory sends only a percentage for progress
 * made in its own PDF reader (page / total), so the page comes from that.
 */
export const getRemotePage = (remote: KoSyncProgress, totalPages: number): number | undefined => {
  const page = parseInt(remote.progress ?? '', 10);
  if (!isNaN(page)) return page;
  const fraction = getRemoteFraction(remote);
  if (fraction === undefined || totalPages <= 0) return undefined;
  return Math.max(1, Math.round(fraction * totalPages));
};

/**
 * The total page count a remote fixed-layout position implies.
 *
 * KOReader reports `percentage = page / total` (1-based), but Kavita's
 * KOReader-compatible endpoint reports `percentage = (page - 1) / total`
 * (0-based, #7503): reading a Kavita report with the KOReader formula
 * doubles the total (2 / 0.09090909 = 22 for an 11-page PDF). Both readings
 * are tried and the one consistent with the local copy's total wins. With
 * no local total to check against, or when neither reading matches it, the
 * KOReader reading stands — it is the long-standing behaviour for every
 * other server. Returns `undefined` when the percentage is unusable.
 */
export const getRemoteTotalPages = (
  remotePage: number,
  remotePercentage: number,
  localTotalPages: number,
): number | undefined => {
  if (!Number.isFinite(remotePercentage) || remotePercentage <= 0) return undefined;
  const fromOneBased = Math.round(remotePage / remotePercentage);
  if (localTotalPages <= 0) return fromOneBased;
  const fromZeroBased = Math.round((remotePage - 1) / remotePercentage);
  return Math.abs(fromZeroBased - localTotalPages) < Math.abs(fromOneBased - localTotalPages)
    ? fromZeroBased
    : fromOneBased;
};

/**
 * Outcome of resolving a remote KOReader position against the LOCAL book.
 *
 * The distinction between `unresolved` and `not-xpointer` is critical for
 * conflict detection (see {@link decideRemoteConflict}):
 *
 * - `resolved`     — the XPointer maps to a local position; `fraction` is an
 *                    apples-to-apples value comparable to Readest's progress.
 * - `unresolved`   — the progress IS a KOReader XPointer (or a CFI) but couldn't be
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
  const isCfi = isCfiProgress(remote.progress);
  if (!isCfi && !isXPointerProgress(remote.progress)) return { status: 'not-xpointer' };
  try {
    // Resolve against the XPointer's own spine section; the converter loads the
    // correct off-screen document when it differs from the primary view.
    const content = view.renderer.getContents().find((x) => x.index === view.renderer.primaryIndex);
    const cfi = isCfi
      ? remote.progress!
      : await getCFIFromXPointer(remote.progress!, content?.doc, content?.index, bookDoc);
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
