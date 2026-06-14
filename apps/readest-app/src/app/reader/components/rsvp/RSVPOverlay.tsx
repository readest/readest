'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { Insets } from '@/types/misc';
import { RsvpState, RSVPController } from '@/services/rsvp';
import { containsCJK } from '@/services/rsvp/utils';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { TOCItem } from '@/libs/document';
import {
  IoClose,
  IoPlay,
  IoPause,
  IoPlaySkipBack,
  IoPlaySkipForward,
  IoCaretBack,
  IoCaretForward,
  IoRemove,
  IoAdd,
  IoChevronDown,
  IoSettingsSharp,
  IoSearch,
  IoVolumeHigh,
  IoVolumeMediumOutline,
  IoLockClosed,
} from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { getPopupPosition, Position } from '@/utils/sel';
import { Overlay } from '@/components/Overlay';
import DictionarySheet from '@/app/reader/components/annotator/DictionarySheet';
import DictionaryPopup from '@/app/reader/components/annotator/DictionaryPopup';
import TTSFollowIndicator, { TtsSyncStatus } from '@/app/reader/components/tts/TTSFollowIndicator';

interface FlatChapter {
  label: string;
  href: string;
  level: number;
}

interface ContextWordProps {
  text: string;
  wordIndex: number;
  isCurrent: boolean;
  currentRef?: React.Ref<HTMLSpanElement>;
  orpColor?: string;
}

const ContextWord = React.memo(function ContextWord({
  text,
  wordIndex,
  isCurrent,
  currentRef,
  orpColor,
}: ContextWordProps) {
  return (
    <span
      ref={currentRef}
      data-rsvp-word-button=''
      data-rsvp-word-index={wordIndex}
      role={isCurrent ? undefined : 'button'}
      tabIndex={isCurrent ? undefined : 0}
      className={isCurrent ? undefined : 'cursor-pointer opacity-70 hover:opacity-100'}
      style={isCurrent && orpColor ? { color: orpColor } : undefined}
    >
      {text}{' '}
    </span>
  );
});

// Display settings
const FONT_SIZE_OPTIONS = [1.25, 1.5, 1.875, 2.25, 3, 3.75, 4.25, 5, 6, 8];
const DEFAULT_FONT_SIZE_INDEX = 4;
const ORP_COLOR_OPTIONS = ['', '#EF4444', '#3B82F6', '#22C55E', '#F97316', '#A855F7'];
const STORAGE_KEY_FONT_SIZE = 'readest_rsvp_fontsize';
const STORAGE_KEY_ORP_COLOR = 'readest_rsvp_orp_color';
const STORAGE_KEY_CONTEXT = 'readest_rsvp_context';
const STORAGE_KEY_HIGHLIGHT_WORD = 'readest_rsvp_cjk_highlight_word';

// Context panel windowing — long sections (e.g. AZW3 chapters with 40k+ words)
// would otherwise render tens of thousands of <span> elements and freeze the UI
// for many seconds on each section load.
const CONTEXT_CHUNK_SIZE = 50;
const CONTEXT_WINDOW_BEFORE = 200;
const CONTEXT_WINDOW_AFTER = 1000;

// TTS rate options for the overlay's rate picker (decision 6) — mirrors the
// 0.5–3.0 range the TTS panel slider clamps to, in 0.25 steps.
const TTS_RATE_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];

// Dictionary lookup popup sizing (mirrors the reader's Annotator popup).
const DICT_POPUP_PADDING = 10;
const DICT_POPUP_MAX_WIDTH = 480;
const DICT_POPUP_MAX_HEIGHT = 360;

interface RSVPOverlayProps {
  gridInsets: Insets;
  controller: RSVPController;
  chapters: TOCItem[];
  currentChapterHref: string | null;
  /**
   * Resolved CSS font-family for the displayed word, mirroring the reader's
   * font face/family settings. When undefined, the word keeps the monospace
   * fallback. See getBaseFontFamily in utils/style.
   */
  fontFamily?: string;
  /** Book language, used to pick dictionary providers for context lookups. */
  lang?: string;
  /** Derived TTS-sync status driving the "following audio" indicator (#3235). */
  ttsSyncStatus?: TtsSyncStatus;
  /** True when following is paced by the estimator (non-Edge sentence sync). */
  estimated?: boolean;
  /** True when TTS audio is engaged (playing/paused) — drives the audio toggle. */
  ttsActive?: boolean;
  /** True when TTS is actively playing (vs paused) — drives the transport icon. */
  ttsPlaying?: boolean;
  /** Current TTS playback rate, shown selected in the rate picker (decision 6). */
  ttsRate?: number;
  /** Toggle TTS audio: start from the current word, or stop when engaged. */
  onToggleTtsAudio?: () => void;
  /** Pause/resume TTS — the transport play/pause maps here while read-along is on. */
  onToggleTtsPlay?: () => void;
  /** Set the TTS rate (one-shot) when the WPM control is TTS-driven. */
  onSetTtsRate?: (rate: number) => void;
  /** Re-engage following after a manual nav decoupled it (indicator action). */
  onResumeTtsFollow?: () => void;
  onClose: () => void;
  onChapterSelect: (href: string) => void;
  onRequestNextPage: () => void;
  /** Opens the dictionary management settings from the lookup header gear. */
  onManageDictionary?: () => void;
}

const RSVPOverlay: React.FC<RSVPOverlayProps> = ({
  gridInsets,
  controller,
  chapters,
  currentChapterHref,
  fontFamily,
  lang,
  ttsSyncStatus = 'idle',
  estimated = false,
  ttsActive = false,
  ttsPlaying = false,
  ttsRate = 1,
  onToggleTtsAudio,
  onToggleTtsPlay,
  onSetTtsRate,
  onResumeTtsFollow,
  onClose,
  onChapterSelect,
  onRequestNextPage,
  onManageDictionary,
}) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode: _isDarkMode } = useThemeStore();
  const isSettingsDialogOpen = useSettingsStore((s) => s.isSettingsDialogOpen);
  const [state, setState] = useState<RsvpState>(controller.currentState);
  const currentWord = controller.currentDisplayWord;
  // The transport (center) play/pause controls TTS while read-along is engaged,
  // otherwise RSVP's own timer (#3235). A ref keeps the latest closure so the
  // capture-phase keyboard/tap effects don't need it in their dep arrays.
  const transportToggleRef = useRef<() => void>(() => {});
  transportToggleRef.current = () => {
    if (ttsActive && onToggleTtsPlay) onToggleTtsPlay();
    else controller.togglePlayPause();
  };
  const transportPlaying = ttsActive ? ttsPlaying : state.playing;
  const [countdown, setCountdown] = useState<number | null>(controller.currentCountdown);
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);
  const [showWpmDropdown, setShowWpmDropdown] = useState(false);
  const [showRateDropdown, setShowRateDropdown] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_CONTEXT) === '1';
    } catch {
      return false;
    }
  });
  const [fontSizeIndex, setFontSizeIndex] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_FONT_SIZE);
      if (saved !== null) {
        const idx = parseInt(saved, 10);
        if (idx >= 0 && idx < FONT_SIZE_OPTIONS.length) return idx;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_FONT_SIZE_INDEX;
  });
  const [orpColorIndex, setOrpColorIndex] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ORP_COLOR);
      if (saved !== null) {
        const idx = parseInt(saved, 10);
        if (idx >= 0 && idx < ORP_COLOR_OPTIONS.length) return idx;
      }
    } catch {
      /* ignore */
    }
    return 0;
  });
  const [highlightWholeWord, setHighlightWholeWord] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_HIGHLIGHT_WORD) === '1';
    } catch {
      return false;
    }
  });
  const contextWordRef = useRef<HTMLSpanElement>(null);
  const contextPanelRef = useRef<HTMLDivElement>(null);
  // Dictionary lookup from a context-panel selection (#4475). `lookup` is the
  // pending selection (drives the "Look up" pill); `dict` holds the resolved
  // word + popup placement once the dictionary is open.
  const [lookup, setLookup] = useState<{
    text: string;
    range: Range;
    left: number;
    top: number;
  } | null>(null);
  const [dict, setDict] = useState<{
    word: string;
    position: Position;
    trianglePosition: Position;
  } | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const isDraggingProgressBar = useRef(false);
  const wasPlayingBeforeDrag = useRef(false);
  const [isProgressBarDragging, setIsProgressBarDragging] = useState(false);
  const SWIPE_THRESHOLD = 50;
  const TAP_THRESHOLD = 10;

  // Flatten chapters for dropdown
  const flatChapters = useMemo(() => {
    const flatten = (items: TOCItem[], level = 0): FlatChapter[] => {
      const result: FlatChapter[] = [];
      for (const item of items) {
        result.push({ label: item.label || '', href: item.href || '', level });
        if (item.subitems?.length) {
          result.push(...flatten(item.subitems, level + 1));
        }
      }
      return result;
    };
    return flatten(chapters);
  }, [chapters]);

  // Subscribe to controller events
  useEffect(() => {
    const handleStateChange = (e: Event) => {
      const newState = (e as CustomEvent<RsvpState>).detail;
      setState(newState);
    };

    const handleCountdownChange = (e: Event) => {
      setCountdown((e as CustomEvent<number | null>).detail);
    };

    const handleRequestNextPage = () => {
      onRequestNextPage();
    };

    controller.addEventListener('rsvp-state-change', handleStateChange);
    controller.addEventListener('rsvp-countdown-change', handleCountdownChange);
    controller.addEventListener('rsvp-request-next-page', handleRequestNextPage);

    return () => {
      controller.removeEventListener('rsvp-state-change', handleStateChange);
      controller.removeEventListener('rsvp-countdown-change', handleCountdownChange);
      controller.removeEventListener('rsvp-request-next-page', handleRequestNextPage);
    };
  }, [controller, onRequestNextPage]);

  // Keyboard shortcuts - use capture phase to intercept before native elements
  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!state.active) return;
      // While the dictionary is open it owns the keyboard (e.g. Escape closes
      // the dictionary, not the whole RSVP session).
      if (dict) return;
      // Dictionary management (settings dialog) opens OVER RSVP; let it own the
      // keyboard so its inputs accept space and Escape closes it, not RSVP.
      if (isSettingsDialogOpen) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          event.stopPropagation();
          transportToggleRef.current();
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          onClose();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) {
            controller.skipBackward(15);
          } else {
            controller.decreaseSpeed();
          }
          break;
        case 'ArrowRight':
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) {
            controller.skipForward(15);
          } else {
            controller.increaseSpeed();
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          controller.increaseSpeed();
          break;
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          controller.decreaseSpeed();
          break;
        case '.':
          event.preventDefault();
          event.stopPropagation();
          controller.nextWord();
          break;
        case ',':
          event.preventDefault();
          event.stopPropagation();
          controller.prevWord();
          break;
      }
    };

    // Use capture phase to handle events before they reach dropdown/select elements
    document.addEventListener('keydown', handleKeyboard, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyboard, { capture: true });
  }, [state.active, controller, onClose, dict, isSettingsDialogOpen]);

  const effectiveChapterHref = currentChapterHref;

  // Word display helpers
  const wordBefore = currentWord ? currentWord.text.substring(0, currentWord.orpIndex) : '';
  const orpChar = currentWord ? currentWord.text.charAt(currentWord.orpIndex) : '';
  const wordAfter = currentWord ? currentWord.text.substring(currentWord.orpIndex + 1) : '';
  const isCJKWord = currentWord ? containsCJK(currentWord.text) : false;
  const wordLetterSpacing = undefined;
  const wordSideOffset = isCJKWord ? '0.45em' : '0.3em';

  // Time remaining calculation
  const getTimeRemaining = useCallback((): string | null => {
    if (!state || state.words.length === 0) return null;
    const wordsLeft = state.words.length - state.currentIndex;
    const minutesLeft = wordsLeft / state.wpm;

    if (minutesLeft < 1) {
      const seconds = Math.ceil(minutesLeft * 60);
      return `${seconds}s`;
    } else if (minutesLeft < 60) {
      const mins = Math.floor(minutesLeft);
      const secs = Math.round((minutesLeft - mins) * 60);
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
      const hours = Math.floor(minutesLeft / 60);
      const mins = Math.round(minutesLeft % 60);
      return `${hours}h ${mins}m`;
    }
  }, [state]);

  // Auto-scroll: keep highlighted word in view. Suppressed while the user is
  // selecting text or has the dictionary open, so the panel does not yank the
  // selection out from under them (#4475).
  useEffect(() => {
    if (contextCollapsed || lookup || dict) return;
    contextWordRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [state.currentIndex, contextCollapsed, lookup, dict]);

  useEffect(() => {
    if (!showChapterDropdown) return;
    const raf = requestAnimationFrame(() => {
      const container = chapterDropdownRef.current;
      if (!container) return;
      const activeItem = container.querySelector<HTMLElement>('[data-active="true"]');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'center' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [showChapterDropdown]);

  const toggleContext = useCallback(() => {
    setContextCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_CONTEXT, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const updateFontSize = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZE_OPTIONS.length - 1, idx));
    setFontSizeIndex(clamped);
    try {
      localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  const updateOrpColor = useCallback((idx: number) => {
    setOrpColorIndex(idx);
    try {
      localStorage.setItem(STORAGE_KEY_ORP_COLOR, String(idx));
    } catch {
      /* ignore */
    }
  }, []);

  const updateHighlightWholeWord = useCallback((value: boolean) => {
    setHighlightWholeWord(value);
    try {
      localStorage.setItem(STORAGE_KEY_HIGHLIGHT_WORD, value ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  // Chapter helpers
  const getCurrentChapterLabel = useCallback((): string => {
    if (!effectiveChapterHref) return _('Select Chapter');
    const exactMatch = flatChapters.find((c) => c.href === effectiveChapterHref);
    if (exactMatch) return exactMatch.label;
    const normalizedCurrent = effectiveChapterHref.split('#')[0]?.replace(/^\//, '') || '';
    const chapter = flatChapters.find((c) => {
      const normalizedHref = c.href.split('#')[0]?.replace(/^\//, '') || '';
      return normalizedHref === normalizedCurrent;
    });
    return chapter?.label || _('Select Chapter');
  }, [_, effectiveChapterHref, flatChapters]);

  const isChapterActive = useCallback(
    (href: string): boolean => {
      if (!effectiveChapterHref) return false;
      if (href === effectiveChapterHref) return true;
      const normalizedCurrent = effectiveChapterHref.split('#')[0]?.replace(/^\//, '') || '';
      const normalizedHref = href.split('#')[0]?.replace(/^\//, '') || '';
      return normalizedHref === normalizedCurrent;
    },
    [effectiveChapterHref],
  );

  // Touch handlers
  const handleTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    touchStartTime.current = Date.now();
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (event.changedTouches.length !== 1) return;

    // Touches starting on the header or footer controls (progress bar, buttons,
    // dropdowns) own their own gestures — never let a horizontal drag here be
    // hijacked as a speed-change swipe, or a tap as a region tap.
    const target = event.target as HTMLElement;
    if (target.closest('.rsvp-controls') || target.closest('.rsvp-header')) {
      return;
    }

    const touch = event.changedTouches[0]!;
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;
    const duration = Date.now() - touchStartTime.current;

    if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX > 0) {
        controller.decreaseSpeed();
      } else {
        controller.increaseSpeed();
      }
      return;
    }

    if (Math.abs(deltaX) < TAP_THRESHOLD && Math.abs(deltaY) < TAP_THRESHOLD && duration < 300) {
      const screenWidth = window.innerWidth;
      const tapX = touch.clientX;

      if (tapX < screenWidth * 0.25) {
        controller.skipBackward(15);
      } else if (tapX > screenWidth * 0.75) {
        controller.skipForward(15);
      } else {
        transportToggleRef.current();
      }
    }
  };

  const handleWordClick = useCallback(
    (wordIndex: number) => {
      const wasPlaying = state.playing;
      if (wasPlaying) controller.pause();
      controller.seekToIndex(wordIndex);
      if (wasPlaying) setTimeout(() => controller.resume(), 50);
    },
    [state.playing, controller],
  );

  const handleContextClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // A drag that selects text also ends in a click; don't seek then, so the
      // user can select words for dictionary lookup (#4475).
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-rsvp-word-index]');
      if (!target) return;
      if (target.getAttribute('role') !== 'button') return;
      const idx = parseInt(target.getAttribute('data-rsvp-word-index') || '', 10);
      if (Number.isNaN(idx)) return;
      handleWordClick(idx);
    },
    [handleWordClick],
  );

  // Detect a selection inside the context panel and surface a "Look up" pill.
  const handleContextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setLookup(null);
      return;
    }
    const text = selection.toString().trim();
    const anchor = selection.anchorNode;
    if (!text || !anchor || !contextPanelRef.current?.contains(anchor)) {
      setLookup(null);
      return;
    }
    // Clone the range so the placement survives the selection being collapsed
    // when the user taps the "Look up" pill.
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 8, Math.max(8, rect.left + rect.width / 2));
    setLookup({ text, range, left, top: rect.top });
  }, []);

  const openLookup = useCallback(() => {
    if (!lookup) return;
    if (state.playing) controller.pause();

    // Anchor the popup to the selection: prefer below it, flip above when the
    // lower half of the screen is too short. The whole-window rect keeps the
    // popup clamped on-screen (the overlay root sits at the viewport origin).
    const rect = lookup.range.getBoundingClientRect();
    const windowRect = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    const popupWidth = Math.min(DICT_POPUP_MAX_WIDTH, window.innerWidth - 2 * DICT_POPUP_PADDING);
    const popupHeight = Math.min(
      DICT_POPUP_MAX_HEIGHT,
      window.innerHeight - 2 * DICT_POPUP_PADDING,
    );
    const dir: Position['dir'] =
      window.innerHeight - rect.bottom > popupHeight + DICT_POPUP_PADDING ? 'down' : 'up';
    const trianglePosition: Position = {
      point: { x: rect.left + rect.width / 2, y: dir === 'down' ? rect.bottom + 6 : rect.top - 12 },
      dir,
    };
    const position = getPopupPosition(
      trianglePosition,
      windowRect,
      popupWidth,
      popupHeight,
      DICT_POPUP_PADDING,
    );

    setDict({ word: lookup.text, position, trianglePosition });
    setLookup(null);
  }, [lookup, state.playing, controller]);

  const closeLookup = useCallback(() => {
    setDict(null);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, []);

  const handleContextKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-rsvp-word-index]');
      if (!target) return;
      if (target.getAttribute('role') !== 'button') return;
      const idx = parseInt(target.getAttribute('data-rsvp-word-index') || '', 10);
      if (Number.isNaN(idx)) return;
      event.preventDefault();
      handleWordClick(idx);
    },
    [handleWordClick],
  );

  const contextWindow = useMemo(() => {
    const len = state.words.length;
    if (len === 0) return { start: 0, end: 0 };
    const chunkStart = Math.floor(state.currentIndex / CONTEXT_CHUNK_SIZE) * CONTEXT_CHUNK_SIZE;
    const start = Math.max(0, chunkStart - CONTEXT_WINDOW_BEFORE);
    const end = Math.min(len, chunkStart + CONTEXT_CHUNK_SIZE + CONTEXT_WINDOW_AFTER);
    return { start, end };
  }, [state.currentIndex, state.words.length]);

  const hasMoreBefore = contextWindow.start > 0;
  const hasMoreAfter = contextWindow.end < state.words.length;

  const getProgressBarPercentage = (clientX: number, target: HTMLElement): number => {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * 100;
  };

  const handleProgressBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    isDraggingProgressBar.current = true;
    setIsProgressBarDragging(true);
    wasPlayingBeforeDrag.current = state.playing;
    if (state.playing) controller.pause();
    controller.seekToPosition(getProgressBarPercentage(event.clientX, event.currentTarget));
  };

  const handleProgressBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingProgressBar.current) return;
    controller.seekToPosition(getProgressBarPercentage(event.clientX, event.currentTarget));
  };

  const handleProgressBarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingProgressBar.current) return;
    isDraggingProgressBar.current = false;
    setIsProgressBarDragging(false);
    // pointercancel can fire after the browser has already released the
    // capture itself (e.g. multitouch, app backgrounding), so calling
    // releasePointerCapture unconditionally would throw NotFoundError.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasPlayingBeforeDrag.current) setTimeout(() => controller.resume(), 50);
  };

  const handleChapterSelect = (href: string) => {
    setShowChapterDropdown(false);
    controller.pause();
    onChapterSelect(href);
  };

  if (!state.active) return null;

  // Use theme colors directly from themeCode (bg, fg, primary are already resolved from palette)
  const bgColor = themeCode.bg;
  const fgColor = themeCode.fg;
  const accentColor = themeCode.primary;
  const effectiveOrpColor = ORP_COLOR_OPTIONS[orpColorIndex] || accentColor;
  const currentFontSize =
    FONT_SIZE_OPTIONS[fontSizeIndex] ?? FONT_SIZE_OPTIONS[DEFAULT_FONT_SIZE_INDEX]!;

  // The WPM timer doesn't drive pacing while RSVP follows TTS — the voice does.
  // Replace the WPM control with an "Audio pace" affordance that opens a TTS
  // rate picker instead (decision 6, #3235).
  // 'paused' keeps the WPM "Audio pace" lock too, so pausing doesn't shift layout.
  const ttsDriven =
    ttsSyncStatus === 'following' || ttsSyncStatus === 'syncing' || ttsSyncStatus === 'paused';

  return (
    <div
      data-testid='rsvp-overlay'
      aria-label={_('Speed Reading')}
      className='fixed inset-0 z-[10000] flex select-none flex-col'
      style={{
        paddingTop: `${gridInsets.top}px`,
        paddingBottom: `${gridInsets.bottom * 0.33}px`,
        backgroundColor: bgColor,
        color: fgColor,
        backdropFilter: 'none',
        // @ts-expect-error CSS custom properties
        '--rsvp-accent': accentColor,
        '--rsvp-fg': fgColor,
        '--rsvp-bg': bgColor,
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Header ── */}
      <div className='rsvp-header flex shrink-0 items-center gap-2 px-3 py-2 md:gap-3 md:px-5 md:py-3'>
        <button
          aria-label={_('Close Speed Reading')}
          title={_('Close')}
          className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-gray-500/20'
          onClick={onClose}
        >
          <IoClose className='h-5 w-5' />
        </button>

        {/* Chapter selector */}
        <div className='relative min-w-0 flex-1'>
          <button
            className='flex w-full items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-3 py-1.5 text-sm transition-colors hover:bg-gray-500/20'
            onClick={() => setShowChapterDropdown(!showChapterDropdown)}
          >
            <span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left'>
              {getCurrentChapterLabel()}
            </span>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.5'
              className='h-3.5 w-3.5 shrink-0 opacity-50'
            >
              <path d='M6 9l6 6 6-6' />
            </svg>
          </button>
          {showChapterDropdown && (
            <>
              <Overlay onDismiss={() => setShowChapterDropdown(false)} />
              <div
                ref={chapterDropdownRef}
                className='absolute left-0 right-0 top-full z-[100] mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-gray-500/20 px-2 shadow-2xl'
                style={{ backgroundColor: bgColor }}
              >
                {flatChapters.map((chapter, idx) => (
                  <button
                    key={`${chapter.href}-${idx}`}
                    data-active={isChapterActive(chapter.href) ? 'true' : undefined}
                    className={clsx(
                      'block w-full rounded-md border-none bg-transparent px-4 py-2.5 text-left text-sm transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-gray-500/15',
                      isChapterActive(chapter.href) &&
                        'bg-[color-mix(in_srgb,var(--rsvp-accent)_15%,transparent)] font-semibold',
                    )}
                    style={{ paddingLeft: `${1 + chapter.level * 0.875}rem` }}
                    onClick={() => handleChapterSelect(chapter.href)}
                  >
                    {chapter.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* WPM selector — while RSVP follows TTS the timer no longer paces, so it
            becomes an "Audio pace" affordance that opens a TTS rate picker
            instead (decision 6). aria-disabled (not hard-disabled) keeps it
            focusable as a hint; the lock glyph + border reads in e-ink without
            relying on opacity. */}
        <div className='relative shrink-0'>
          {ttsDriven ? (
            <button
              className='eink-bordered flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-3 py-1.5 text-sm transition-colors hover:bg-gray-500/20'
              onClick={() => setShowRateDropdown(!showRateDropdown)}
              aria-disabled='true'
              aria-label={_('Audio pace')}
              title={_('Speed follows audio')}
            >
              <IoLockClosed className='h-3.5 w-3.5 shrink-0 opacity-70' aria-hidden='true' />
              <span className='font-medium'>{_('Audio pace')}</span>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2.5'
                className='ms-0.5 h-3 w-3 shrink-0 opacity-50'
              >
                <path d='M6 9l6 6 6-6' />
              </svg>
            </button>
          ) : (
            <button
              className='flex items-center gap-1 rounded-full border border-gray-500/20 bg-gray-500/10 px-3 py-1.5 text-sm tabular-nums transition-colors hover:bg-gray-500/20'
              onClick={() => setShowWpmDropdown(!showWpmDropdown)}
              aria-label={_('Select reading speed')}
              title={_('Select reading speed')}
            >
              <span className='font-semibold'>{state.wpm}</span>
              <span className='ms-0.5 text-xs opacity-50'>WPM</span>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2.5'
                className='ms-0.5 h-3 w-3 shrink-0 opacity-50'
              >
                <path d='M6 9l6 6 6-6' />
              </svg>
            </button>
          )}
          {showWpmDropdown && !ttsDriven && (
            <>
              <Overlay onDismiss={() => setShowWpmDropdown(false)} />
              <div
                className='absolute end-0 top-full z-[100] mt-1.5 max-h-64 min-w-[7rem] overflow-y-auto rounded-2xl border border-gray-500/20 shadow-2xl'
                style={{ backgroundColor: bgColor }}
              >
                {controller.getWpmOptions().map((wpm) => (
                  <button
                    key={wpm}
                    className={clsx(
                      'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-md border-none bg-transparent px-4 py-1.5 text-sm tabular-nums transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-gray-500/15',
                      state.wpm === wpm &&
                        'bg-[color-mix(in_srgb,var(--rsvp-accent)_15%,transparent)] font-semibold',
                    )}
                    onClick={() => {
                      controller.setWpm(wpm);
                      setShowWpmDropdown(false);
                    }}
                  >
                    <span>{wpm}</span>
                    <span className='text-xs opacity-40'>WPM</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {showRateDropdown && ttsDriven && (
            <>
              <Overlay onDismiss={() => setShowRateDropdown(false)} />
              <div
                className='absolute end-0 top-full z-[100] mt-1.5 max-h-64 min-w-[7rem] overflow-y-auto rounded-2xl border border-gray-500/20 shadow-2xl'
                style={{ backgroundColor: bgColor }}
              >
                {TTS_RATE_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    className={clsx(
                      'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-md border-none bg-transparent px-4 py-1.5 text-sm tabular-nums transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-gray-500/15',
                      Math.abs(ttsRate - rate) < 0.001 &&
                        'bg-[color-mix(in_srgb,var(--rsvp-accent)_15%,transparent)] font-semibold',
                    )}
                    onClick={() => {
                      onSetTtsRate?.(rate);
                      setShowRateDropdown(false);
                    }}
                  >
                    <span>{rate.toFixed(2)}×</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* TTS "following audio" status row — slim, below the header and above the
          context panel (never inside the transport row). Uses the 'plain' variant
          to match the overlay's own theme-painted surface. idle/unsupported
          collapse to nothing. */}
      {(ttsSyncStatus === 'following' ||
        ttsSyncStatus === 'syncing' ||
        ttsSyncStatus === 'decoupled' ||
        ttsSyncStatus === 'paused') && (
        <div className='flex shrink-0 justify-center px-3 pb-1 md:px-4'>
          <TTSFollowIndicator
            status={ttsSyncStatus}
            estimated={estimated}
            onResume={onResumeTtsFollow}
            variant='plain'
          />
        </div>
      )}

      {/* Context panel (always visible, collapsible) */}
      <div className='mx-3 overflow-hidden rounded-lg border border-gray-500/20 bg-gray-500/10 md:mx-4 md:rounded-xl'>
        <button
          className='flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-80 md:px-4 md:py-3'
          onClick={toggleContext}
          aria-expanded={!contextCollapsed}
          aria-label={contextCollapsed ? _('Show context') : _('Hide context')}
        >
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            className='md:h-4 md:w-4'
          >
            <path d='M4 6h16M4 12h16M4 18h10' />
          </svg>
          <span className='flex-1 text-left'>{_('Context')}</span>
          <IoChevronDown
            className={clsx(
              'h-3.5 w-3.5 transition-transform duration-200',
              !contextCollapsed && 'rotate-180',
            )}
          />
        </button>
        {!contextCollapsed && (
          <div
            className='max-h-[20vh] overflow-y-auto px-3 pb-3 md:px-4 md:pb-4'
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div
              ref={contextPanelRef}
              data-testid='rsvp-context-panel'
              className='select-text text-left text-base leading-relaxed md:text-lg'
              onClick={handleContextClick}
              onKeyDown={handleContextKeyDown}
              onMouseUp={handleContextSelection}
              onTouchEnd={handleContextSelection}
            >
              {hasMoreBefore && <span className='opacity-30'>… </span>}
              {state.words.slice(contextWindow.start, contextWindow.end).map((w, i) => {
                const wordIndex = contextWindow.start + i;
                const isCurrent = wordIndex === state.currentIndex;
                return (
                  <ContextWord
                    key={wordIndex}
                    text={w.text}
                    wordIndex={wordIndex}
                    isCurrent={isCurrent}
                    currentRef={isCurrent ? contextWordRef : undefined}
                    orpColor={isCurrent ? effectiveOrpColor : undefined}
                  />
                );
              })}
              {hasMoreAfter && <span className='opacity-30'>…</span>}
            </div>
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className='flex flex-1 flex-col items-center justify-center p-4 md:p-6'>
        <div className='flex h-full w-full flex-col items-center justify-center'>
          <div className='flex h-full w-full flex-col items-center'>
            {/* Top guide line */}
            <div className='w-px flex-1 bg-current opacity-30' />

            {/* Word section */}
            <div className='flex flex-col items-center justify-center'>
              {/* Countdown */}
              {countdown !== null && (
                <div className='mb-2 flex items-center justify-center'>
                  <span
                    className='animate-pulse text-5xl font-bold sm:text-6xl md:text-7xl'
                    style={{ color: accentColor }}
                  >
                    {countdown}
                  </span>
                </div>
              )}

              {/* Word display */}
              <div
                className={clsx(
                  'rsvp-word relative flex min-h-16 w-full items-center justify-center whitespace-nowrap px-2 py-2 font-medium leading-none tracking-wide sm:min-h-20 sm:px-4 sm:py-4',
                  // Fall back to a fixed-width font only when the reader has no
                  // configured font face/family to apply.
                  !fontFamily && 'font-mono',
                )}
                style={{
                  fontSize: `${currentFontSize}rem`,
                  letterSpacing: wordLetterSpacing,
                  fontFamily,
                }}
              >
                {currentWord ? (
                  isCJKWord && highlightWholeWord ? (
                    // Whole-word mode: center the full CJK word and color every
                    // character, instead of anchoring a single focus character.
                    <span
                      className='rsvp-word-whole relative z-10 font-bold'
                      style={{ color: effectiveOrpColor }}
                    >
                      {currentWord.text}
                    </span>
                  ) : (
                    <>
                      <span
                        className='rsvp-word-before absolute text-right opacity-60'
                        style={{ right: `calc(50% + ${wordSideOffset})` }}
                      >
                        {wordBefore}
                      </span>
                      <span
                        className='rsvp-word-orp relative z-10 font-bold'
                        style={{ color: effectiveOrpColor }}
                      >
                        {orpChar}
                      </span>
                      <span
                        className='rsvp-word-after absolute text-left opacity-60'
                        style={{ left: `calc(50% + ${wordSideOffset})` }}
                      >
                        {wordAfter}
                      </span>
                    </>
                  )
                ) : (
                  <span className='italic opacity-30'>{_('Ready')}</span>
                )}
              </div>
            </div>

            {/* Bottom guide line */}
            <div className='w-px flex-1 bg-current opacity-30' />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className='rsvp-controls shrink-0 px-3 pb-6 pt-3 md:px-4 md:pb-8 md:pt-4'>
        {/* Progress section */}
        <div className='mb-3 flex flex-col gap-1.5 md:mb-4 md:gap-2'>
          <div className='flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between'>
            <span className='font-semibold uppercase tracking-wide opacity-70'>
              {_('Chapter Progress')}
            </span>
            <span className='tabular-nums opacity-60'>
              {(state.currentIndex + 1).toLocaleString()} / {state.words.length.toLocaleString()}{' '}
              {_('words')}
              {getTimeRemaining() && (
                <span className='opacity-80'>
                  {' '}
                  · {_('{{time}} left', { time: getTimeRemaining() })}
                </span>
              )}
            </span>
          </div>
          <div
            role='slider'
            tabIndex={0}
            aria-label={_('Reading progress')}
            aria-valuenow={Math.round(state.progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            className='relative h-2 cursor-pointer overflow-visible rounded bg-gray-500/30'
            // touch-action: none keeps mobile browsers from claiming the
            // gesture for scroll/pan, which would fire pointercancel and
            // break the drag-to-seek pointer capture mid-gesture.
            style={{ touchAction: 'none' }}
            onPointerDown={handleProgressBarPointerDown}
            onPointerMove={handleProgressBarPointerMove}
            onPointerUp={handleProgressBarPointerUp}
            onPointerCancel={handleProgressBarPointerUp}
            onKeyDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowLeft') controller.skipBackward();
              else if (e.key === 'ArrowRight') controller.skipForward();
            }}
            title={_('Drag to seek')}
          >
            <div
              className={`absolute left-0 top-0 h-full rounded ${isProgressBarDragging ? '' : 'transition-[width] duration-100'}`}
              style={{ width: `${state.progress}%`, backgroundColor: accentColor }}
            />
            <div
              className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow ${isProgressBarDragging ? '' : 'transition-[left] duration-100'}`}
              style={{ left: `${state.progress}%`, backgroundColor: accentColor }}
            />
          </div>
        </div>

        {/* Playback controls — a single full-width flex row on mobile so the
            audio toggle (far left) and settings gear (far right) flank the
            centered transport in normal flow instead of overlapping it from an
            absolute corner; a centered cluster on md+ where there is room. */}
        <div className='flex items-center justify-between md:justify-center md:gap-2'>
          {/* Audio (TTS) read-along toggle — starts TTS from the displayed word,
              or stops it when engaged (decision 5, #3235). Far-left peer of the
              transport so the centered play button stays centered and nothing
              overlaps on mobile. Active state uses a filled glyph + eink-bordered
              surface so it reads in e-ink without relying on color. */}
          <button
            aria-label={ttsActive ? _('Pause audio') : _('Play audio')}
            className={clsx(
              'touch-target flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none transition-colors active:scale-95 md:h-9 md:w-9',
              ttsActive
                ? 'eink-bordered bg-[color-mix(in_srgb,var(--rsvp-accent)_18%,transparent)]'
                : 'bg-transparent hover:bg-gray-500/20',
            )}
            onClick={() => onToggleTtsAudio?.()}
            title={ttsActive ? _('Pause audio') : _('Play audio')}
          >
            {ttsActive ? (
              <IoVolumeHigh
                className='h-4 w-4 md:h-5 md:w-5'
                style={{ color: accentColor }}
                aria-hidden='true'
              />
            ) : (
              <IoVolumeMediumOutline className='h-4 w-4 md:h-5 md:w-5' aria-hidden='true' />
            )}
          </button>

          <button
            aria-label={_('Skip back 15 words')}
            className='flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full border-none bg-transparent px-1.5 py-1.5 transition-colors hover:bg-gray-500/20 active:scale-95 md:px-2'
            onClick={() => controller.skipBackward(15)}
            title={_('Back 15 words (Shift+Left)')}
          >
            <span className='text-xs font-semibold opacity-80'>15</span>
            <IoPlaySkipBack className='h-5 w-5 md:h-6 md:w-6' />
          </button>

          <button
            aria-label={_('Decrease speed')}
            className='flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-9 md:w-9'
            onClick={() => controller.decreaseSpeed()}
            title={_('Slower (Left/Down)')}
          >
            <IoRemove className='h-4 w-4 md:h-5 md:w-5' />
          </button>

          <button
            aria-label={_('Previous word')}
            className='flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-9 md:w-9'
            onClick={() => controller.prevWord()}
            title={_('Previous word (,)')}
          >
            <IoCaretBack className='h-4 w-4 md:h-5 md:w-5' />
          </button>

          <button
            aria-label={transportPlaying ? _('Pause') : _('Play')}
            className={clsx(
              'flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-gray-500/15 transition-colors hover:bg-gray-500/25 active:scale-95 md:h-16 md:w-16',
              transportPlaying ? '' : 'ps-1',
            )}
            onClick={() => transportToggleRef.current()}
            title={transportPlaying ? _('Pause (Space)') : _('Play (Space)')}
          >
            {transportPlaying ? (
              <IoPause className='h-7 w-7 md:h-8 md:w-8' />
            ) : (
              <IoPlay className='h-7 w-7 md:h-8 md:w-8' />
            )}
          </button>

          <button
            aria-label={_('Next word')}
            className='flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-9 md:w-9'
            onClick={() => controller.nextWord()}
            title={_('Next word (.)')}
          >
            <IoCaretForward className='h-4 w-4 md:h-5 md:w-5' />
          </button>

          <button
            aria-label={_('Increase speed')}
            className='flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-9 md:w-9'
            onClick={() => controller.increaseSpeed()}
            title={_('Faster (Right/Up)')}
          >
            <IoAdd className='h-4 w-4 md:h-5 md:w-5' />
          </button>

          <button
            aria-label={_('Skip forward 15 words')}
            className='flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full border-none bg-transparent px-1.5 py-1.5 transition-colors hover:bg-gray-500/20 active:scale-95 md:px-2'
            onClick={() => controller.skipForward(15)}
            title={_('Forward 15 words (Shift+Right)')}
          >
            <IoPlaySkipForward className='h-5 w-5 md:h-6 md:w-6' />
            <span className='text-xs font-semibold opacity-80'>15</span>
          </button>

          {/* Settings — far-right peer mirroring the audio toggle on the left,
              so both flank the centered transport in normal flow (decision 5,
              #3235) without an absolute cluster overlapping it on mobile. */}
          <button
            aria-label={_('Settings')}
            className={clsx(
              'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-9 md:w-9',
              showSettings && 'bg-gray-500/15',
            )}
            onClick={() => setShowSettings((prev) => !prev)}
            title={_('Settings')}
          >
            <IoSettingsSharp className='h-4 w-4 md:h-5 md:w-5' />
          </button>
        </div>

        {/* Settings row (collapsible) */}
        {showSettings && (
          <div className='mt-3 flex flex-wrap items-center justify-evenly gap-x-8 gap-y-4 text-xs md:justify-center'>
            {/* Punctuation pause */}
            <label className='flex cursor-pointer items-center gap-1.5 font-medium opacity-80'>
              <span className='mr-0.5 font-medium opacity-50'>{_('Punctuation Delay')}</span>
              <select
                className='cursor-pointer rounded border border-gray-500/30 bg-gray-500/20 px-1.5 py-1 text-xs font-medium transition-colors hover:border-gray-500/40 hover:bg-gray-500/30'
                style={{ color: 'inherit' }}
                value={state.punctuationPauseMs}
                onChange={(e) => controller.setPunctuationPause(parseInt(e.target.value, 10))}
              >
                {controller.getPunctuationPauseOptions().map((option) => (
                  <option key={option} value={option}>
                    {option}ms
                  </option>
                ))}
              </select>
            </label>

            {/* Pre-start countdown delay */}
            <label className='flex cursor-pointer items-center gap-1.5 font-medium opacity-80'>
              <span className='mr-0.5 font-medium opacity-50'>{_('Start Delay')}</span>
              <select
                data-testid='rsvp-start-delay-select'
                className='cursor-pointer rounded border border-gray-500/30 bg-gray-500/20 px-1.5 py-1 text-xs font-medium transition-colors hover:border-gray-500/40 hover:bg-gray-500/30'
                style={{ color: 'inherit' }}
                value={state.startDelaySeconds}
                onChange={(e) => controller.setStartDelay(parseInt(e.target.value, 10))}
              >
                {controller.getStartDelayOptions().map((option) => (
                  <option key={option} value={option}>
                    {option === 0 ? _('Off') : `${option}s`}
                  </option>
                ))}
              </select>
            </label>

            {/* Font size */}
            <div className='flex items-center gap-0.5'>
              <span className='mr-0.5 font-medium opacity-50'>{_('Font')}</span>
              <button
                aria-label={_('Decrease font size')}
                className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95'
                onClick={() => updateFontSize(fontSizeIndex - 1)}
                disabled={fontSizeIndex <= 0}
              >
                <IoRemove className='h-3 w-3' />
              </button>
              <span className='min-w-4 text-center font-medium tabular-nums'>
                {fontSizeIndex + 1}
              </span>
              <button
                aria-label={_('Increase font size')}
                className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95'
                onClick={() => updateFontSize(fontSizeIndex + 1)}
                disabled={fontSizeIndex >= FONT_SIZE_OPTIONS.length - 1}
              >
                <IoAdd className='h-3 w-3' />
              </button>
            </div>

            {/* Split hyphenated words */}
            <div className='config-item gap-2'>
              <span className='opacity-50'>{_('Split Hyphens')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={state.splitHyphens}
                onChange={(e) => controller.setSplitHyphens(e.target.checked)}
              />
            </div>

            {/* CJK character mode — split CJK text per-character */}
            {state.hasCJK && (
              <div className='config-item gap-2'>
                <span className='opacity-50'>{_('Character Mode')}</span>
                <input
                  type='checkbox'
                  data-testid='rsvp-char-mode-toggle'
                  className='toggle'
                  checked={state.cjkCharMode}
                  onChange={(e) => controller.setCjkCharMode(e.target.checked)}
                />
              </div>
            )}

            {/* CJK whole-word highlight — color and center the full word */}
            {state.hasCJK && (
              <div className='config-item gap-2'>
                <span className='opacity-50'>{_('Highlight Word')}</span>
                <input
                  type='checkbox'
                  data-testid='rsvp-highlight-word-toggle'
                  className='toggle'
                  checked={highlightWholeWord}
                  onChange={(e) => updateHighlightWholeWord(e.target.checked)}
                />
              </div>
            )}

            {/* ORP color */}
            <div className='flex items-center gap-1.5'>
              <span className='mr-0.5 font-medium opacity-50'>{_('Focus')}</span>
              {ORP_COLOR_OPTIONS.map((color, idx) => (
                <button
                  key={idx}
                  onClick={() => updateOrpColor(idx)}
                  className={clsx(
                    'h-6 min-h-6 w-6 min-w-6 rounded-full border-2 transition-transform',
                    orpColorIndex === idx
                      ? 'scale-110 border-current'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: color || accentColor }}
                  aria-label={idx === 0 ? _('Theme color') : `Color ${idx}`}
                  title={idx === 0 ? _('Theme color') : undefined}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dictionary lookup from a context selection (#4475) */}
      {lookup && (
        <button
          aria-label={_('Look up')}
          className='eink-bordered fixed z-[10001] flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold shadow-lg'
          style={{
            left: `${lookup.left}px`,
            top: `${lookup.top}px`,
            backgroundColor: accentColor,
            color: bgColor,
          }}
          onClick={openLookup}
        >
          <IoSearch className='h-4 w-4' />
          {_('Look up')}
        </button>
      )}
      {dict &&
        // Below `sm` (or short landscape) present a bottom sheet; otherwise an
        // anchored popup — mirroring the reader's selection dictionary.
        (window.innerWidth < 640 || window.innerHeight < 640 ? (
          <DictionarySheet
            word={dict.word}
            lang={lang}
            onDismiss={closeLookup}
            onManage={onManageDictionary}
          />
        ) : (
          // Transparent full-screen catcher so a click outside the popup
          // dismisses it (the popup container sits above it at z-50).
          <>
            <Overlay onDismiss={closeLookup} />
            <DictionaryPopup
              word={dict.word}
              lang={lang}
              position={dict.position}
              trianglePosition={dict.trianglePosition}
              popupWidth={Math.min(
                DICT_POPUP_MAX_WIDTH,
                window.innerWidth - 2 * DICT_POPUP_PADDING,
              )}
              popupHeight={Math.min(
                DICT_POPUP_MAX_HEIGHT,
                window.innerHeight - 2 * DICT_POPUP_PADDING,
              )}
              onDismiss={closeLookup}
              onManage={onManageDictionary}
            />
          </>
        ))}
    </div>
  );
};

export default RSVPOverlay;
