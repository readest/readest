import { useCallback, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { applyLiveMarker, clearLiveMarker } from '@/utils/liveMarker';

interface UseAudiobookSyncProps {
  bookKey: string;
}

export interface AudiobookMarkerInput {
  cfi: string;
  sectionIndex?: number;
  sectionHref?: string;
  label?: string;
  progress?: number; // 0..1, playback position within this sync entry
}

const RELOCATION_DEBOUNCE_MS = 800;

/**
 * Applies an audiobook sync marker.  Accepts the sync entry's CFI and
 * optional `sectionIndex` so relocation can be triggered proactively when
 * the entry belongs to a section different from the current view, even if
 * the CFI resolution hasn't caught up yet.
 *
 * Returns `true` when relocation was triggered — the caller should keep the
 * entry "un-consumed" so the marker can be re-applied on the next timeupdate
 * after the target section loads.
 */
export const useAudiobookSync = ({ bookKey }: UseAudiobookSyncProps) => {
  const { getView, getViews, getViewSettings } = useReaderStore();
  const lastRelocationRef = useRef<{ time: number; sectionIndex: number } | null>(null);

  /**
   * Resolve the active Foliate view for this audiobook. Tries:
   * 1. Exact key lookup (getView)
   * 2. Single-view fallback (only one book open)
   * 3. Hash-prefix match from stored view states
   */
  const resolveView = useCallback(() => {
    const view = getView(bookKey);
    if (view) return view;

    const allViews = getViews();
    if (allViews.length === 1) return allViews[0]!;

    const hash = bookKey.split('-')[0]!;
    const state = useReaderStore.getState();
    for (const [key, vs] of Object.entries(state.viewStates)) {
      if (vs.view && key.split('-')[0] === hash) return vs.view;
    }

    // Diagnostic: log available keys
    const availableKeys = Object.entries(state.viewStates)
      .filter(([, vs]) => vs.view)
      .map(([k]) => k);
    console.warn('[AudiobookSync] Could not resolve view', {
      bookKey,
      hash,
      availableKeys,
      totalViews: allViews.length,
    });
    return null;
  }, [bookKey, getView, getViews]);

  const applyAudiobookMarker = useCallback(
    (input: AudiobookMarkerInput): boolean => {
      const { cfi, sectionIndex, sectionHref, label, progress } = input;
      const view = resolveView();
      const viewSettings = getViewSettings(bookKey);
      if (!view || !viewSettings) {
        console.warn(
          '[AudiobookSync] Phase 0 FAIL — no view or viewSettings — entry NOT consumed',
          {
            hasView: !!view,
            hasViewSettings: !!viewSettings,
            bookKey,
          },
        );
        return true; // don't consume — retry on next timeupdate
      }

      const currentSectionIndex = view.renderer.primaryIndex;
      const currentSection = view.book.sections[currentSectionIndex];

      console.log('[AudiobookSync] Phase 0 — marker input', {
        cfi: cfi?.slice(0, 60) || '(empty)',
        inputSectionIndex: sectionIndex,
        inputSectionHref: sectionHref?.slice(-40),
        currentSection: currentSectionIndex,
        currentSectionHref: currentSection?.href?.slice(-40),
        totalSections: view.book.sections.length,
      });

      // Phase 1 — proactive relocation via stable section href or sectionIndex
      if ((sectionHref || sectionIndex !== undefined) && sectionIndex !== currentSectionIndex) {
        // Prefer the stable href from the sync entry directly
        const targetHref = sectionHref;

        if (targetHref) {
          console.log('[AudiobookSync] Phase 1 — relocating via sectionHref', {
            targetHref: targetHref.slice(-40),
            currentSection: currentSectionIndex,
          });
          const now = Date.now();
          const prev = lastRelocationRef.current;
          if (
            !prev ||
            prev.sectionIndex !== sectionIndex ||
            now - prev.time >= RELOCATION_DEBOUNCE_MS
          ) {
            lastRelocationRef.current = { time: now, sectionIndex: sectionIndex ?? -1 };
            try {
              view.goTo(targetHref);
              console.info(
                `[AudiobookSync] Phase 1 — relocated via href ${currentSectionIndex} → ${targetHref.slice(-30)}`,
              );
            } catch {
              console.warn('[AudiobookSync] Phase 1 — goTo(href) threw', {
                targetHref: targetHref.slice(-40),
              });
            }
          } else {
            console.log('[AudiobookSync] Phase 1 — relocation debounced', {
              sectionIndex,
              msSinceLast: prev ? now - prev.time : null,
            });
          }
          return true; // relocated or pending — don't consume entry
        }

        // Fallback: resolve href from sectionIndex
        if (sectionIndex !== undefined) {
          const section = view.book.sections[sectionIndex];
          if (section?.href) {
            console.log('[AudiobookSync] Phase 1 — relocating via sectionIndex fallback', {
              sectionIndex,
              sectionHref: section.href.slice(-40),
              currentSection: currentSectionIndex,
            });
            const now = Date.now();
            const prev = lastRelocationRef.current;
            if (
              !prev ||
              prev.sectionIndex !== sectionIndex ||
              now - prev.time >= RELOCATION_DEBOUNCE_MS
            ) {
              lastRelocationRef.current = { time: now, sectionIndex };
              try {
                view.goTo(section.href);
                console.info(
                  `[AudiobookSync] Phase 1 — relocated via index ${currentSectionIndex} → ${sectionIndex}`,
                );
              } catch {
                console.warn('[AudiobookSync] Phase 1 — goTo(href) threw', {
                  href: section.href?.slice(-40),
                });
              }
            }
            return true; // relocated or pending — don't consume entry
          }

          // sectionIndex exists but section has no href —
          // fall through to Phase 3 so the marker can still be applied
          // in the current section if the CFI resolves there.
          console.warn(
            '[AudiobookSync] Phase 1 — section has no href, falling through to Phase 3',
            {
              sectionIndex,
              sectionId: section?.id,
              sectionLinear: section?.linear,
              totalSections: view.book.sections.length,
            },
          );
        }
      }

      // Phase 2 — gap-fill / relocation-only entry: no CFI to highlight
      if (!cfi) {
        console.log('[AudiobookSync] Phase 2 — no CFI, waiting for real entry');
        return true;
      }

      // Phase 3 — same section, real entry: apply the visible marker
      // Use a warm gold that reads clearly on dark Citadel / GOT pages,
      // instead of the generic TTS gray (#808080) which is invisible at
      // the overlayer's default 30 % opacity.
      const audiobookHighlightOptions = {
        style: viewSettings.ttsHighlightOptions?.style ?? 'highlight',
        color: '#d2aa62',
      };
      console.log('[AudiobookSync] Phase 3 — applying live marker', {
        cfi: cfi.slice(0, 60),
        highlightStyle: audiobookHighlightOptions.style,
        highlightColor: audiobookHighlightOptions.color,
        hasLabel: !!label,
        labelPreview: label?.slice(0, 40),
      });
      const result = applyLiveMarker(
        view,
        cfi,
        audiobookHighlightOptions,
        {
          showHeader: viewSettings.showHeader,
          showFooter: viewSettings.showFooter,
          showBarsOnScroll: viewSettings.showBarsOnScroll,
          scrollingOverlap: viewSettings.scrollingOverlap,
        },
        label,
        progress,
      );

      console.log('[AudiobookSync] Phase 3 — applyLiveMarker result', {
        status: result.status,
        reason: 'reason' in result ? result.reason : undefined,
        cfiSectionIndex: 'cfiSectionIndex' in result ? result.cfiSectionIndex : undefined,
      });

      if (result.status === 'error') {
        console.warn('[AudiobookSync] Phase 3 ERROR — marker error', result.reason, {
          cfi: cfi.slice(0, 60),
          sectionIndex,
          currentSection: currentSectionIndex,
        });
        return false; // consume — retrying won't help
      }

      // Phase 4 — CFI-based relocation (fallback when sectionIndex is missing)
      if (result.status === 'wrong-section') {
        console.log('[AudiobookSync] Phase 4 — CFI belongs to different section, relocating', {
          cfiSection: result.cfiSectionIndex,
          currentSection: currentSectionIndex,
        });
        const now = Date.now();
        const prev = lastRelocationRef.current;
        if (
          !prev ||
          prev.sectionIndex !== result.cfiSectionIndex ||
          now - prev.time >= RELOCATION_DEBOUNCE_MS
        ) {
          const targetSection = view.book.sections[result.cfiSectionIndex];
          if (targetSection?.href) {
            lastRelocationRef.current = { time: now, sectionIndex: result.cfiSectionIndex };
            try {
              view.goTo(targetSection.href);
              console.info(
                `[AudiobookSync] Phase 4 — CFI relocation ${currentSectionIndex} → ${result.cfiSectionIndex}`,
              );
            } catch {
              console.warn('[AudiobookSync] Phase 4 — goTo threw', {
                href: targetSection.href?.slice(-40),
              });
            }
            return true; // relocated — don't consume entry
          }
          console.warn('[AudiobookSync] Phase 4 FAIL — target section has no href', {
            cfiSectionIndex: result.cfiSectionIndex,
            sectionId: targetSection?.id,
          });
          return false; // consume — retrying won't help
        }
        console.log('[AudiobookSync] Phase 4 — relocation debounced');
        return true; // relocated — don't consume entry
      }

      // marker applied successfully
      console.log('[AudiobookSync] Phase 3 — marker APPLIED successfully');
      return false; // consume entry — no retry needed
    },
    [bookKey, getViewSettings, resolveView],
  );

  const clearAudiobookMarker = useCallback(() => {
    const view = resolveView();
    if (!view) return;
    clearLiveMarker(view);
  }, [resolveView]);

  return { applyAudiobookMarker, clearAudiobookMarker };
};
