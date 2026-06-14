'use client';

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import {
  RSVPController,
  RsvpStartChoice,
  RsvpStopPosition,
  buildRsvpExitConfigUpdate,
} from '@/services/rsvp';
import { eventDispatcher } from '@/utils/event';
import { getBaseFontFamily } from '@/utils/style';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote, PageInfo } from '@/types/book';
import { TOCItem } from '@/libs/document';
import { Insets } from '@/types/misc';
import { initJieba } from '@/utils/jieba';
import RSVPOverlay from './RSVPOverlay';
import RSVPStartDialog from './RSVPStartDialog';

interface RSVPControlProps {
  bookKey: string;
  gridInsets: Insets;
}

// Imperative handle so the later TTS-sync indicator slice (and tests) can read
// the derived sync status without RSVPControl having a sibling to surface it to.
export interface RSVPControlHandle {
  ttsSyncStatus: TtsSyncStatus;
}

// ─── TTS-sync decision logic (slice 5, #3235) ──────────────────────────
// RSVP follows the spoken position while TTS plays (TTS is the clock). The
// pure decision below maps an incoming tts-position event to the action the
// component should take, so the stale-sequence / decouple / section-stash
// rules can be unit-tested without mounting the heavy component.

export interface RsvpTtsPositionDetail {
  bookKey?: string;
  cfi?: string;
  kind?: 'word' | 'sentence';
  sectionIndex?: number;
  sequence?: number;
}

// Derived sync state surfaced to RSVPOverlay for the later indicator slice.
//   idle        — RSVP not following TTS (not playing / not engaged)
//   following   — engaged and mapping the spoken position
//   syncing     — a cross-section re-extract is pending
//   decoupled   — a manual RSVP nav dropped following while TTS still plays
//   unsupported — fixed-layout book; TTS sync can never engage (D7)
export type TtsSyncStatus = 'idle' | 'following' | 'syncing' | 'decoupled' | 'unsupported';

export interface RsvpTtsPendingSync {
  cfi: string;
  sequence: number;
  sectionIndex: number;
}

export interface RsvpTtsSyncState {
  // Whether RSVP is currently following TTS. A manual RSVP nav decouples
  // (sets false); the next 'playing' re-engages.
  following: boolean;
  // Monotonic guard: drop tts-position with sequence <= this.
  lastSequenceSeen: number;
  // The section RSVP currently has extracted words for.
  currentSectionIndex: number;
  // Latest sync stashed during a pending section re-extract.
  pendingSync?: RsvpTtsPendingSync;
}

export interface RsvpTtsPositionDecision {
  // sync           → Edge word-level: controller.syncToCfi(cfi)
  // drive-estimator→ non-Edge sentence: controller.driveEstimatedFromCfi(cfi)
  // reextract      → different section: trigger re-extract, apply stash after
  // ignore         → drop (wrong book / stale seq / decoupled / malformed /
  //                  fixed-layout where sync is unsupported, decision D7)
  action: 'sync' | 'drive-estimator' | 'reextract' | 'ignore';
  cfi?: string;
  nextState: RsvpTtsSyncState;
}

export interface RsvpTtsDecisionOptions {
  // Fixed-layout books can't host the synthetic word stream RSVP sync drives,
  // so TTS sync is unsupported (decision D7). When set, every position is
  // dropped without mapping or advancing state.
  unsupported?: boolean;
}

export const decideRsvpTtsPosition = (
  state: RsvpTtsSyncState,
  detail: RsvpTtsPositionDetail,
  bookKey: string,
  options: RsvpTtsDecisionOptions = {},
): RsvpTtsPositionDecision => {
  const ignore = (next: RsvpTtsSyncState = state): RsvpTtsPositionDecision => ({
    action: 'ignore',
    nextState: next,
  });

  // D7: never engage on fixed-layout. Checked first so state is left untouched.
  if (options.unsupported) return ignore();
  if (detail.bookKey !== bookKey) return ignore();
  if (!state.following) return ignore();
  if (typeof detail.cfi !== 'string' || typeof detail.sectionIndex !== 'number') return ignore();

  const sequence = detail.sequence ?? -Infinity;
  if (sequence <= state.lastSequenceSeen) return ignore();

  // Different section: don't map. Stash the latest sync + bump the sequence,
  // and let the caller trigger RSVP's re-extract for the new section; the stash
  // is applied once re-extract completes and the sequence is still current.
  if (detail.sectionIndex !== state.currentSectionIndex) {
    return {
      action: 'reextract',
      nextState: {
        ...state,
        lastSequenceSeen: sequence,
        pendingSync: { cfi: detail.cfi, sequence, sectionIndex: detail.sectionIndex },
      },
    };
  }

  return {
    action: detail.kind === 'sentence' ? 'drive-estimator' : 'sync',
    cfi: detail.cfi,
    nextState: { ...state, lastSequenceSeen: sequence },
  };
};

// Helper to expand a range to include the full sentence
const expandRangeToSentence = (range: Range, doc: Document): Range => {
  const sentenceRange = doc.createRange();

  // Get the text content around the range
  const container = range.commonAncestorContainer;
  const parentElement =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);

  if (!parentElement) return range;

  // Get the full text of the parent paragraph/element
  const fullText = parentElement.textContent || '';
  const rangeText = range.toString();

  // Find the position of our word in the parent text
  const wordStart = fullText.indexOf(rangeText);
  if (wordStart === -1) return range;

  // Find sentence boundaries (. ! ? or start/end of text)
  const sentenceEnders = /[.!?]/g;
  let sentenceStart = 0;
  let sentenceEnd = fullText.length;

  // Find the sentence start (look backwards for sentence ender)
  for (let i = wordStart - 1; i >= 0; i--) {
    if (sentenceEnders.test(fullText[i]!)) {
      sentenceStart = i + 1;
      // Skip any whitespace after the sentence ender
      while (sentenceStart < fullText.length && /\s/.test(fullText[sentenceStart]!)) {
        sentenceStart++;
      }
      break;
    }
  }

  // Find the sentence end (look forward for sentence ender)
  for (let i = wordStart; i < fullText.length; i++) {
    if (sentenceEnders.test(fullText[i]!)) {
      sentenceEnd = i + 1;
      break;
    }
  }

  // Create a tree walker to find the text nodes
  const walker = doc.createTreeWalker(parentElement, NodeFilter.SHOW_TEXT, null);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const nodeLength = node.textContent?.length || 0;

    if (!startNode && currentOffset + nodeLength > sentenceStart) {
      startNode = node;
      startOffset = sentenceStart - currentOffset;
    }

    if (currentOffset + nodeLength >= sentenceEnd) {
      endNode = node;
      endOffset = sentenceEnd - currentOffset;
      break;
    }

    currentOffset += nodeLength;
  }

  if (startNode && endNode) {
    try {
      sentenceRange.setStart(startNode, Math.max(0, startOffset));
      sentenceRange.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length || 0));
      return sentenceRange;
    } catch {
      return range;
    }
  }

  return range;
};

const RSVPControl = forwardRef<RSVPControlHandle, RSVPControlProps>(function RSVPControl(
  { bookKey, gridInsets },
  ref,
) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((s) => s.settings);
  const setSettingsDialogOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const setSettingsDialogBookKey = useSettingsStore((s) => s.setSettingsDialogBookKey);
  const setActiveSettingsItemId = useSettingsStore((s) => s.setActiveSettingsItemId);
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getConfig = useBookDataStore((s) => s.getConfig);
  const setConfig = useBookDataStore((s) => s.setConfig);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  const { themeCode } = useThemeStore();

  const [isActive, setIsActive] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [startChoice, setStartChoice] = useState<RsvpStartChoice | null>(null);
  // Derived TTS-sync status for the overlay indicator (slice 8b, #3235).
  const [ttsSyncStatus, setTtsSyncStatus] = useState<TtsSyncStatus>('idle');

  useImperativeHandle(ref, () => ({ ttsSyncStatus }), [ttsSyncStatus]);
  const controllerRef = useRef<RSVPController | null>(null);
  const tempHighlightRef = useRef<BookNote | null>(null);
  // renderer.primaryIndex reverts after navigation (paginator #detectPrimaryView),
  // so track RSVP's actual section and chapter href in stable refs instead.
  const rsvpSectionRef = useRef<number>(-1);
  const rsvpChapterHrefRef = useRef<string | null>(null);

  // TTS-sync follower state (slice 5, #3235). Mutated by the tts-position /
  // tts-playback-state handlers and the manual-nav decouple listener.
  const syncStateRef = useRef<RsvpTtsSyncState>({
    following: false,
    lastSequenceSeen: -Infinity,
    currentSectionIndex: -1,
  });

  // Helper to remove any existing RSVP highlight
  const removeRsvpHighlight = useCallback(() => {
    const view = getView(bookKey);
    if (tempHighlightRef.current && view) {
      try {
        view.addAnnotation(tempHighlightRef.current, true);
      } catch {
        // Ignore errors when removing
      }
    }
    tempHighlightRef.current = null;
  }, [bookKey, getView]);

  // Clean up controller and highlight on unmount
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        // Use stop() instead of shutdown() to preserve saved position across sessions
        // shutdown() clears localStorage which loses the user's reading progress
        controllerRef.current.stop();
        controllerRef.current = null;
      }
      // Remove any existing RSVP highlight when component unmounts
      removeRsvpHighlight();
      rsvpSectionRef.current = -1;
      rsvpChapterHrefRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for RSVP start events
  useEffect(() => {
    const handleRSVPStart = (event: CustomEvent) => {
      const { bookKey: rsvpBookKey, selectionText } = event.detail;
      if (bookKey !== rsvpBookKey) return;
      handleStart(selectionText);
    };

    const handleRSVPStop = (event: CustomEvent) => {
      const { bookKey: rsvpBookKey } = event.detail;
      if (bookKey !== rsvpBookKey) return;
      handleClose();
    };

    eventDispatcher.on('rsvp-start', handleRSVPStart);
    eventDispatcher.on('rsvp-stop', handleRSVPStop);

    return () => {
      eventDispatcher.off('rsvp-start', handleRSVPStart);
      eventDispatcher.off('rsvp-stop', handleRSVPStop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Drop TTS following on a user-initiated manual RSVP nav (skip/seek/word-step;
  // chapter-jump decouples in handleChapterSelect). Stays decoupled until the
  // next 'playing' re-engages.
  const decoupleFromTts = useCallback(() => {
    const sync = syncStateRef.current;
    if (!sync.following) return;
    sync.following = false;
    sync.pendingSync = undefined;
    const controller = controllerRef.current;
    controller?.stopEstimator();
    controller?.setExternallyDriven(false);
  }, []);

  // Re-extract for the section TTS just drove the view into, then apply the
  // stashed sync once the view settles on the target section and the stash is
  // still the latest. Reuses the controller's section-load path
  // (loadNextPageContent) — the same re-extract the rsvp-request-next-page flow
  // uses — instead of navigating the view (TTS already navigated it).
  const reextractForTtsSection = useCallback(() => {
    const view = getView(bookKey);
    const controller = controllerRef.current;
    if (!view || !controller) return;

    const targetSection = syncStateRef.current.pendingSync?.sectionIndex;
    if (targetSection === undefined) return;

    let cleanup: ReturnType<typeof setTimeout> | null = null;
    const applyPending = () => {
      rsvpSectionRef.current = view.renderer.primaryIndex;
      syncStateRef.current.currentSectionIndex = view.renderer.primaryIndex;
      const progress = getProgress(bookKey);
      if (progress?.location) controller.setCurrentCfi(progress.location);
      controller.loadNextPageContent();

      // Apply the stash only if it's still the latest position and its section
      // matches what we just extracted (a newer event may have superseded it).
      const pending = syncStateRef.current.pendingSync;
      if (
        pending &&
        pending.sequence === syncStateRef.current.lastSequenceSeen &&
        pending.sectionIndex === view.renderer.primaryIndex
      ) {
        if (syncStateRef.current.pendingSync?.cfi) {
          controller.syncToCfi(pending.cfi);
        }
        syncStateRef.current.pendingSync = undefined;
      }
    };

    // If the view is already on the target section, re-extract immediately;
    // otherwise wait for TTS's own page-follow relocate to land there.
    if (view.renderer.primaryIndex === targetSection) {
      applyPending();
      return;
    }

    const onRelocate = () => {
      if (view.renderer.primaryIndex !== targetSection) return; // keep waiting
      view.removeEventListener('relocate', onRelocate);
      if (cleanup) clearTimeout(cleanup);
      applyPending();
    };
    view.addEventListener('relocate', onRelocate);
    cleanup = setTimeout(() => view.removeEventListener('relocate', onRelocate), 5000);
  }, [bookKey, getProgress, getView]);

  // TTS-sync follower (slice 5, #3235). While an RSVP session is active, follow
  // the spoken position; TTS is the clock. Filtered to this bookKey, decoupled
  // by manual nav, re-engaged on the next 'playing'.
  // Fixed-layout books can't host the synthetic word stream sync drives, so
  // sync is unsupported there (decision D7): playing never engages and
  // positions are dropped. The derived ttsSyncStatus feeds the overlay
  // indicator (slice 8b).
  useEffect(() => {
    if (!isActive) return;
    const controller = controllerRef.current;
    if (!controller) return;

    const isFixedLayout = !!getBookData(bookKey)?.isFixedLayout;
    let isPlaying = false;

    const refreshSyncStatus = () => {
      if (isFixedLayout) {
        setTtsSyncStatus('unsupported');
        return;
      }
      const sync = syncStateRef.current;
      if (!isPlaying) {
        setTtsSyncStatus('idle');
      } else if (!sync.following) {
        // Manual nav decoupled following while TTS still plays.
        setTtsSyncStatus('decoupled');
      } else if (sync.pendingSync) {
        // Cross-section re-extract in flight.
        setTtsSyncStatus('syncing');
      } else {
        setTtsSyncStatus('following');
      }
    };
    refreshSyncStatus();

    const handlePlaybackState = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; state?: string } | undefined;
      if (detail?.bookKey !== bookKey) return;
      const sync = syncStateRef.current;
      if (detail.state === 'playing') {
        isPlaying = true;
        // D7: never engage following on fixed-layout.
        if (!isFixedLayout) {
          // (Re-)engage following from the current section.
          sync.following = true;
          sync.currentSectionIndex =
            rsvpSectionRef.current >= 0
              ? rsvpSectionRef.current
              : (getView(bookKey)?.renderer.primaryIndex ?? -1);
          controller.setExternallyDriven(true);
        }
      } else if (detail.state === 'paused' || detail.state === 'stopped') {
        isPlaying = false;
        sync.following = false;
        sync.pendingSync = undefined;
        controller.stopEstimator();
        controller.setExternallyDriven(false);
      }
      refreshSyncStatus();
    };

    const handlePosition = (event: CustomEvent) => {
      const detail = event.detail as RsvpTtsPositionDetail | undefined;
      if (!detail) return;
      const decision = decideRsvpTtsPosition(syncStateRef.current, detail, bookKey, {
        unsupported: isFixedLayout,
      });
      syncStateRef.current = decision.nextState;

      switch (decision.action) {
        case 'sync':
          if (decision.cfi) controller.syncToCfi(decision.cfi);
          break;
        case 'drive-estimator': {
          if (!decision.cfi) break;
          const viewSettings = getViewSettings(bookKey);
          const wpm = RSVPController.estimatedWpmFromRate(viewSettings?.ttsRate ?? 1);
          controller.driveEstimatedFromCfi(decision.cfi, wpm);
          break;
        }
        case 'reextract':
          reextractForTtsSection();
          break;
        case 'ignore':
        default:
          break;
      }
      refreshSyncStatus();
    };

    const handleManualNav = () => {
      decoupleFromTts();
      refreshSyncStatus();
    };

    eventDispatcher.on('tts-playback-state', handlePlaybackState);
    eventDispatcher.on('tts-position', handlePosition);
    controller.addEventListener('rsvp-manual-nav', handleManualNav);

    return () => {
      eventDispatcher.off('tts-playback-state', handlePlaybackState);
      eventDispatcher.off('tts-position', handlePosition);
      controller.removeEventListener('rsvp-manual-nav', handleManualNav);
      // Leaving sync: restore the controller's own pacing.
      syncStateRef.current.following = false;
      syncStateRef.current.pendingSync = undefined;
      controller.stopEstimator();
      controller.setExternallyDriven(false);
      setTtsSyncStatus('idle');
    };
  }, [
    isActive,
    bookKey,
    getBookData,
    getView,
    getViewSettings,
    decoupleFromTts,
    reextractForTtsSection,
  ]);

  const handleStart = useCallback(
    (selectionText?: string) => {
      // RSVP can be started from the menu or the keyboard shortcut (#4473);
      // ignore a repeat trigger while a session is already active so it does
      // not re-open the start dialog over the running overlay.
      if (controllerRef.current?.currentState.active) return;

      const view = getView(bookKey);
      const bookData = getBookData(bookKey);
      const progress = getProgress(bookKey);

      if (!view || !bookData || !bookData.book) {
        eventDispatcher.dispatch('toast', {
          message: _('Unable to start RSVP'),
          type: 'error',
        });
        return;
      }

      // Remove any existing RSVP highlight when starting new session
      removeRsvpHighlight();

      // Check if format is supported (not PDF)
      if (bookData.book.format === 'PDF') {
        eventDispatcher.dispatch('toast', {
          message: _('RSVP not supported for PDF'),
          type: 'warning',
        });
        return;
      }

      const primaryLanguage = bookData.book.primaryLanguage;

      // Create controller if not exists
      if (!controllerRef.current) {
        controllerRef.current = new RSVPController(view, bookKey, primaryLanguage);
        rsvpSectionRef.current = view.renderer.primaryIndex;
        rsvpChapterHrefRef.current = progress?.sectionHref ?? null;
      } else {
        controllerRef.current.setPrimaryLanguage(primaryLanguage);
      }

      const controller = controllerRef.current;

      // For Chinese books, preload jieba-wasm so that the synchronous word
      // extractor can use it. Done before requestStart() so the loader has
      // the dialog's interaction time to fetch ~3.8MB of WASM.
      if (primaryLanguage?.toLowerCase().startsWith('zh')) {
        initJieba().catch((e) => {
          console.warn('Failed to initialize jieba-wasm; falling back to Intl.Segmenter:', e);
        });
      }

      // Seed localStorage from cloud-synced BookConfig so a fresh cross-device
      // rsvpPosition can override a stale local entry. seedPosition guards against
      // a corrupt synced pair (rsvpPosition.cfi in a different chapter than location).
      const config = getConfig(bookKey);
      const configPos = config?.rsvpPosition;
      if (configPos) {
        controller.seedPosition(configPos, config?.location ?? progress?.location ?? null);
      }

      // Set current CFI for position tracking
      if (progress?.location) {
        controller.setCurrentCfi(progress.location);
      }

      // Handle start choice event
      const handleStartChoice = (e: Event) => {
        const choice = (e as CustomEvent<RsvpStartChoice>).detail;
        setStartChoice(choice);

        // If there's a saved position or selection, show dialog for user to choose
        if (choice.hasSavedPosition || choice.hasSelection) {
          setShowStartDialog(true);
        } else {
          // No saved position or selection - start from current page position
          controller.startFromCurrentPosition();
          setIsActive(true);
        }
      };

      controller.addEventListener('rsvp-start-choice', handleStartChoice);
      controller.requestStart(selectionText);

      // Clean up listener after handling
      setTimeout(() => {
        controller.removeEventListener('rsvp-start-choice', handleStartChoice);
      }, 100);
    },
    [_, bookKey, getBookData, getConfig, getProgress, getView, removeRsvpHighlight],
  );

  const handleStartDialogSelect = useCallback(
    (option: 'beginning' | 'saved' | 'current' | 'selection') => {
      setShowStartDialog(false);
      const controller = controllerRef.current;
      const view = getView(bookKey);
      if (!controller) return;

      // Handler for when we need to navigate to a different section for resume
      const handleNavigateToResume = (e: Event) => {
        const { cfi } = (e as CustomEvent<{ cfi: string }>).detail;
        controller.removeEventListener('rsvp-navigate-to-resume', handleNavigateToResume);

        if (view && cfi) {
          // Navigate to the saved position's section
          view.goTo(cfi);

          // Wait for navigation, then start RSVP — start() handles word extraction
          // and position recovery from storage directly, so loadNextPageContent()
          // must not be called here (it would clear the saved position first)
          setTimeout(() => {
            const progress = getProgress(bookKey);
            if (progress?.location) {
              controller.setCurrentCfi(progress.location);
            }
            controller.start();
            setIsActive(true);
          }, 500);
        }
      };

      switch (option) {
        case 'beginning':
          controller.startFromBeginning();
          setIsActive(true);
          break;
        case 'saved':
          // Listen for navigation event in case saved position is in different section
          controller.addEventListener('rsvp-navigate-to-resume', handleNavigateToResume);
          controller.startFromSavedPosition();
          // If startFromSavedPosition started directly (same section), setIsActive
          // If it emitted navigate event, the handler above will setIsActive after navigation
          if (!controller.currentState.active) {
            // Navigation event was emitted, don't set active yet
          } else {
            setIsActive(true);
          }
          // Clean up listener after a timeout if not used
          setTimeout(() => {
            controller.removeEventListener('rsvp-navigate-to-resume', handleNavigateToResume);
          }, 1000);
          break;
        case 'current': {
          // Refresh the CFI in case user scrolled since dialog opened
          const currentProgress = getProgress(bookKey);
          if (currentProgress?.location) {
            controller.setCurrentCfi(currentProgress.location);
          }
          controller.startFromCurrentPosition();
          setIsActive(true);
          break;
        }
        case 'selection':
          if (startChoice?.selectionText) {
            controller.startFromSelection(startChoice.selectionText);
          }
          setIsActive(true);
          break;
      }
    },
    [bookKey, getProgress, getView, startChoice],
  );

  const handleClose = useCallback(() => {
    const controller = controllerRef.current;
    const view = getView(bookKey);

    if (controller && view) {
      // Listen for the stop event to get the position
      const handleRsvpStop = (e: Event) => {
        const stopPosition = (e as CustomEvent<RsvpStopPosition | null>).detail;

        if (stopPosition && stopPosition.cfi) {
          try {
            // Navigate to the word's CFI position
            view.goTo(stopPosition.cfi);

            // Try to create a sentence highlight using the stored Range
            if (typeof stopPosition.docIndex === 'number' && stopPosition.range) {
              // Check if the original range is still valid
              let rangeIsValid = false;
              try {
                const rangeText = stopPosition.range.toString();
                rangeIsValid = rangeText === stopPosition.text;
              } catch {
                rangeIsValid = false;
              }

              if (rangeIsValid) {
                // Get the document from the renderer
                const contents = view.renderer.getContents?.();
                const content = contents?.find((c) => c.index === stopPosition.docIndex);
                const doc = content?.doc;

                if (doc) {
                  // Expand the range to include the full sentence
                  const sentenceRange = expandRangeToSentence(stopPosition.range, doc);
                  const sentenceCfi = view.getCFI(stopPosition.docIndex, sentenceRange);
                  const sentenceText = sentenceRange.toString();

                  if (sentenceCfi) {
                    // Remove any previous RSVP highlight
                    removeRsvpHighlight();

                    // Create a persistent highlight for the sentence
                    const highlight: BookNote = {
                      id: `rsvp-temp-${Date.now()}`,
                      type: 'annotation',
                      cfi: sentenceCfi,
                      text: sentenceText,
                      style: 'underline',
                      color: themeCode.primary,
                      note: '',
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    };

                    tempHighlightRef.current = highlight;
                    view.addAnnotation(highlight);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Failed to sync RSVP position:', err);
          }
        }
      };

      controller.addEventListener('rsvp-stop', handleRsvpStop);
      controller.stop();
      controller.removeEventListener('rsvp-stop', handleRsvpStop);
    } else if (controller) {
      controller.stop();
    }

    // Persist RSVP position to BookConfig so it syncs to the cloud. Pin
    // `location` to the RSVP word's CFI so the next normal-mode load resumes
    // here instead of at a section boundary that a mid-RSVP relocate left
    // behind in the auto-saved config.
    const rsvpPosition = controller?.getStoredPosition();
    if (rsvpPosition) {
      const config = getConfig(bookKey);
      if (config) {
        const update = buildRsvpExitConfigUpdate(rsvpPosition);
        setConfig(bookKey, update);
        saveConfig(envConfig, bookKey, { ...config, ...update }, settings);
      }
    }

    setIsActive(false);
    setShowStartDialog(false);
  }, [
    bookKey,
    envConfig,
    getConfig,
    getView,
    removeRsvpHighlight,
    saveConfig,
    setConfig,
    settings,
    themeCode.primary,
  ]);

  const handleChapterSelect = useCallback(
    (href: string) => {
      const view = getView(bookKey);
      if (!view) return;

      // A chapter jump is a user-initiated nav: decouple from TTS following.
      decoupleFromTts();

      const onRelocate = (e: Event) => {
        view.removeEventListener('relocate', onRelocate);
        const detail = (e as CustomEvent).detail as { section?: PageInfo; tocItem?: TOCItem };
        rsvpSectionRef.current = detail.section?.current ?? view.renderer.primaryIndex;
        rsvpChapterHrefRef.current = detail.tocItem?.href ?? null;
        const controller = controllerRef.current;
        if (controller) {
          const progress = getProgress(bookKey);
          if (progress?.location) {
            controller.setCurrentCfi(progress.location);
          }
          controller.loadNextPageContent();
        }
      };
      view.addEventListener('relocate', onRelocate);
      view.goTo(href);
    },
    [bookKey, getProgress, getView, decoupleFromTts],
  );

  const handleRequestNextPage = useCallback(async () => {
    const view = getView(bookKey);
    if (!view) return;

    removeRsvpHighlight();

    if (view.renderer.atEnd) {
      controllerRef.current?.pause();
      return;
    }

    const indexBefore =
      rsvpSectionRef.current >= 0 ? rsvpSectionRef.current : view.renderer.primaryIndex;

    let cleanup: ReturnType<typeof setTimeout> | null = null;

    const onRelocate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: PageInfo; tocItem?: TOCItem };
      const newIndex = detail.section?.current ?? view.renderer.primaryIndex;

      if (newIndex === indexBefore) return; // revert relocate — keep waiting

      view.removeEventListener('relocate', onRelocate);
      if (cleanup) clearTimeout(cleanup);

      const controller = controllerRef.current;
      if (!controller) return;

      rsvpSectionRef.current = newIndex;
      rsvpChapterHrefRef.current = detail.tocItem?.href ?? null;

      const progress = getProgress(bookKey);
      if (progress?.location) {
        controller.setCurrentCfi(progress.location);
      }
      controller.loadNextPageContent();
    };

    view.addEventListener('relocate', onRelocate);
    cleanup = setTimeout(() => view.removeEventListener('relocate', onRelocate), 5000);
    // Navigate directly to rsvpSectionRef.current + 1 rather than calling nextSection(),
    // which uses renderer.primaryIndex internally. primaryIndex reverts to the previous
    // section after navigation (#detectPrimaryView), so nextSection() would re-navigate
    // to the already-current section and the onRelocate filter would discard the event.
    await view.renderer.goTo({ index: rsvpSectionRef.current + 1 });
  }, [bookKey, getProgress, getView, removeRsvpHighlight]);

  // Get current chapter info — reactive subscription so the RSVP overlay's
  // chapter pointer follows page turns. Reads from readerProgressStore.
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);
  const chapters = bookData?.bookDoc?.toc || [];
  const currentChapterHref = rsvpChapterHrefRef.current ?? progress?.sectionHref ?? null;

  // Mirror the reader's font face/family settings on the RSVP word. The overlay
  // renders in the top document where the configured (and custom) fonts are
  // already mounted, so the resolved family resolves the same typeface.
  const viewSettings = getViewSettings(bookKey);
  const fontFamily = viewSettings ? getBaseFontFamily(viewSettings) : undefined;

  // Book language drives dictionary provider selection for context lookups (#4475).
  const dictionaryLang = bookData?.bookDoc?.metadata?.language as string | undefined;
  const handleManageDictionary = useCallback(() => {
    setSettingsDialogBookKey(bookKey);
    setActiveSettingsItemId('settings.language.dictionaries.manage');
    setSettingsDialogOpen(true);
  }, [bookKey, setActiveSettingsItemId, setSettingsDialogBookKey, setSettingsDialogOpen]);

  // Use portal to render overlay at body level to avoid stacking context issues
  const portalContainer = typeof document !== 'undefined' ? document.body : null;

  return (
    <>
      {/* Start dialog - render via portal */}
      {showStartDialog &&
        startChoice &&
        portalContainer &&
        createPortal(
          <RSVPStartDialog
            startChoice={startChoice}
            onSelect={handleStartDialogSelect}
            onClose={() => setShowStartDialog(false)}
          />,
          portalContainer,
        )}

      {/* RSVP Overlay - render via portal */}
      {isActive &&
        controllerRef.current &&
        portalContainer &&
        createPortal(
          <RSVPOverlay
            gridInsets={gridInsets}
            controller={controllerRef.current}
            chapters={chapters}
            currentChapterHref={currentChapterHref}
            fontFamily={fontFamily}
            lang={dictionaryLang}
            onClose={handleClose}
            onChapterSelect={handleChapterSelect}
            onRequestNextPage={handleRequestNextPage}
            onManageDictionary={handleManageDictionary}
          />,
          portalContainer,
        )}
    </>
  );
});

export default RSVPControl;
