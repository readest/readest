'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MdChevronLeft,
  MdChevronRight,
  MdClose,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
} from 'react-icons/md';
import {
  IoAdd,
  IoRemove,
  IoSettingsSharp,
  IoVolumeHigh,
  IoVolumeMediumOutline,
} from 'react-icons/io5';
import { ViewSettings } from '@/types/book';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import {
  getParagraphButtonDirections,
  PARAGRAPH_FONT_SCALE_OPTIONS,
} from '@/utils/paragraphPresentation';

const INITIAL_SHOW_DURATION = 2500;
const HIDE_DELAY = 2000;
const TRIGGER_ZONE_HEIGHT = 100;

interface ParagraphBarProps {
  bookKey: string;
  currentIndex: number;
  totalParagraphs: number;
  isLoading?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** True when a TTS session is engaged (playing/paused) — drives the audio glyph. */
  ttsActive?: boolean;
  /** Toggle read-along: start TTS from the focused paragraph, or stop it. */
  onToggleTtsAudio?: () => void;
  /** Index into PARAGRAPH_FONT_SCALE_OPTIONS for the display settings (#5246). */
  fontScaleIndex: number;
  onFontScaleIndexChange: (index: number) => void;
  viewSettings?: ViewSettings;
  gridInsets: Insets;
}

// Same glyph button as the TTS mini player's transport, plus the disabled state
// paragraph navigation needs while a section re-extracts.
const BAR_BUTTON = 'shrink-0 rounded-full p-1 transition-colors not-eink:hover:bg-base-content/10';

const ParagraphBar: React.FC<ParagraphBarProps> = ({
  bookKey,
  currentIndex,
  totalParagraphs,
  isLoading,
  onPrev,
  onNext,
  onClose,
  ttsActive = false,
  onToggleTtsAudio,
  fontScaleIndex,
  onFontScaleIndexChange,
  viewSettings,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey } = useReaderStore();
  // Mirrors the TTS mini player: 26px transport glyphs, a 20px close.
  const iconSize20 = useResponsiveSize(20);
  const iconSize26 = useResponsiveSize(26);
  const buttonDirections = getParagraphButtonDirections(viewSettings);

  const [isBarVisible, setIsBarVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInTriggerZoneRef = useRef(false);
  const isMountedRef = useRef(true);
  // Ref mirror so the hide timer sees the live value without re-arming.
  const showSettingsRef = useRef(showSettings);
  showSettingsRef.current = showSettings;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const startHideTimer = useCallback(
    (delay: number = HIDE_DELAY) => {
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        // Never auto-hide while the display settings panel is open — hiding
        // would take the panel (and its stepper) away mid-interaction (#5246).
        if (isMountedRef.current && !isInTriggerZoneRef.current && !showSettingsRef.current) {
          setIsBarVisible(false);
        }
      }, delay);
    },
    [clearHideTimer],
  );

  const showBar = useCallback(
    (autoHide: boolean = true) => {
      setIsBarVisible(true);
      if (autoHide && !isInTriggerZoneRef.current) {
        startHideTimer();
      } else {
        clearHideTimer();
      }
    },
    [startHideTimer, clearHideTimer],
  );

  const checkTriggerZone = useCallback(
    (clientY: number) => {
      const viewportHeight = window.innerHeight;
      const isInZone = clientY >= viewportHeight - TRIGGER_ZONE_HEIGHT;

      if (isInZone !== isInTriggerZoneRef.current) {
        isInTriggerZoneRef.current = isInZone;

        if (isInZone) {
          showBar(false);
        } else {
          startHideTimer();
        }
      }
    },
    [showBar, startHideTimer],
  );

  useEffect(() => {
    isMountedRef.current = true;
    startHideTimer(INITIAL_SHOW_DURATION);

    return () => {
      isMountedRef.current = false;
      clearHideTimer();
    };
  }, [startHideTimer, clearHideTimer]);

  useEffect(() => {
    let rafId: number | null = null;
    let lastMoveTime = 0;
    const throttleMs = 50;

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastMoveTime < throttleMs) return;
      lastMoveTime = now;

      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        checkTriggerZone(e.clientY);

        if (!isInTriggerZoneRef.current) {
          showBar(true);
        }
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [checkTriggerZone, showBar]);

  useEffect(() => {
    // Touch taps in the overlay's neutral zones ask the bar to reappear so the
    // exit button stays reachable after it has auto-hidden.
    const handleShowControls = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKey) {
        showBar();
      }
    };
    eventDispatcher.on('paragraph-show-controls', handleShowControls);
    return () => eventDispatcher.off('paragraph-show-controls', handleShowControls);
  }, [bookKey, showBar]);

  const toggleSettings = useCallback(() => {
    setShowSettings((prev) => {
      const next = !prev;
      if (next) {
        clearHideTimer();
      } else {
        startHideTimer();
      }
      return next;
    });
  }, [clearHideTimer, startHideTimer]);

  const isHiddenByHover = hoveredBookKey === bookKey;
  const isVisible = isBarVisible && !isHiddenByHover;
  const fontScale = PARAGRAPH_FONT_SCALE_OPTIONS[fontScaleIndex] ?? 1;
  const progress =
    totalParagraphs > 0 ? Math.round(((currentIndex + 1) / totalParagraphs) * 100) : 0;
  const PrevIcon =
    buttonDirections.prev === 'up'
      ? MdKeyboardArrowUp
      : buttonDirections.prev === 'right'
        ? MdChevronRight
        : MdChevronLeft;
  const NextIcon =
    buttonDirections.next === 'down'
      ? MdKeyboardArrowDown
      : buttonDirections.next === 'left'
        ? MdChevronLeft
        : MdChevronRight;

  return (
    <div
      className={clsx(
        // `fixed` (not `absolute`) so the bar centers on the viewport like the
        // overlay paragraph; `absolute` centered it on the gridcell, which is
        // pushed off-center when the sidebar is pinned (#4474).
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2',
        // Plain fade, like the reader's other transient chrome — the slide,
        // scale, and blur it used to animate read as a different app (#5275).
        'transition-opacity duration-300 ease-out',
        isVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{
        paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
      }}
      onMouseEnter={() => {
        isInTriggerZoneRef.current = true;
        showBar(false);
      }}
      onMouseLeave={() => {
        isInTriggerZoneRef.current = false;
        startHideTimer();
      }}
    >
      {/* Display settings (#5246) — same chrome as the bar card, floating just
          above it. Font size here is a scale on the reader's own font size, so
          the paragraph can be larger than the book text on big screens. */}
      {showSettings && (
        <div
          className={clsx(
            'absolute bottom-full left-1/2 mb-2 -translate-x-1/2',
            'not-eink:bg-base-300 eink-bordered rounded-2xl shadow-lg',
            'text-base-content flex items-center gap-1 whitespace-nowrap px-4 py-2 text-sm',
          )}
        >
          <span className='text-base-content/60 me-1 font-medium'>{_('Font Size')}</span>
          <button
            type='button'
            onClick={() => onFontScaleIndexChange(fontScaleIndex - 1)}
            disabled={fontScaleIndex <= 0}
            className={clsx(BAR_BUTTON, fontScaleIndex <= 0 && 'pointer-events-none opacity-50')}
            title={_('Decrease font size')}
            aria-label={_('Decrease font size')}
          >
            <IoRemove size={iconSize20} />
          </button>
          <span className='min-w-12 text-center font-medium tabular-nums'>
            {Math.round(fontScale * 100)}%
          </span>
          <button
            type='button'
            onClick={() => onFontScaleIndexChange(fontScaleIndex + 1)}
            disabled={fontScaleIndex >= PARAGRAPH_FONT_SCALE_OPTIONS.length - 1}
            className={clsx(
              BAR_BUTTON,
              fontScaleIndex >= PARAGRAPH_FONT_SCALE_OPTIONS.length - 1 &&
                'pointer-events-none opacity-50',
            )}
            title={_('Increase font size')}
            aria-label={_('Increase font size')}
          >
            <IoAdd size={iconSize20} />
          </button>
        </div>
      )}

      {/* Same card as the TTS mini player: solid base-300 surface, 2xl radius,
          soft shadow, 56px row. No backdrop blur, no hairline border. */}
      <div
        className={clsx(
          'not-eink:bg-base-300 eink-bordered rounded-2xl shadow-lg',
          'text-base-content flex h-14 items-center gap-1 px-2',
        )}
      >
        <button
          type='button'
          onClick={onPrev}
          disabled={isLoading}
          className={clsx(BAR_BUTTON, isLoading && 'pointer-events-none opacity-50')}
          title={_('Previous Paragraph')}
          aria-label={_('Previous Paragraph')}
        >
          <PrevIcon size={iconSize26} />
        </button>

        <div className='flex min-w-[6rem] items-center justify-center px-1'>
          {isLoading ? (
            <div className='flex items-center gap-2'>
              <span className='loading loading-dots loading-sm text-base-content/60' />
              <span className='text-base-content/60 text-sm'>{_('Loading')}</span>
            </div>
          ) : (
            <span className='flex items-baseline gap-1 text-sm tabular-nums'>
              <span>
                {currentIndex + 1} / {totalParagraphs}
              </span>
              <span className='text-base-content/60'>· {progress}%</span>
            </span>
          )}
        </div>

        <button
          type='button'
          onClick={onNext}
          disabled={isLoading}
          className={clsx(BAR_BUTTON, isLoading && 'pointer-events-none opacity-50')}
          title={_('Next Paragraph')}
          aria-label={_('Next Paragraph')}
        >
          <NextIcon size={iconSize26} />
        </button>

        {onToggleTtsAudio && (
          // Audio (TTS) toggle — starts read-along from the focused paragraph,
          // or stops it when engaged (#3235). Active state uses a filled glyph +
          // eink-bordered surface so it reads in e-ink without relying on color.
          <button
            type='button'
            onClick={onToggleTtsAudio}
            disabled={isLoading}
            className={clsx(
              BAR_BUTTON,
              ttsActive && 'text-primary eink-bordered not-eink:bg-base-200',
              isLoading && 'pointer-events-none opacity-50',
            )}
            title={ttsActive ? _('Pause audio') : _('Play audio')}
            aria-label={ttsActive ? _('Pause audio') : _('Play audio')}
          >
            {ttsActive ? (
              <IoVolumeHigh size={iconSize26} aria-hidden='true' />
            ) : (
              <IoVolumeMediumOutline size={iconSize26} aria-hidden='true' />
            )}
          </button>
        )}

        <button
          type='button'
          onClick={toggleSettings}
          className={clsx(BAR_BUTTON, showSettings && 'eink-bordered not-eink:bg-base-200')}
          title={_('Settings')}
          aria-label={_('Settings')}
        >
          <IoSettingsSharp size={iconSize20} />
        </button>

        <button
          type='button'
          onClick={onClose}
          disabled={isLoading}
          className={clsx(
            BAR_BUTTON,
            'text-base-content/70 ms-0.5',
            isLoading && 'pointer-events-none opacity-50',
          )}
          title={_('Exit Paragraph Mode')}
          aria-label={_('Exit Paragraph Mode')}
        >
          <MdClose size={iconSize20} />
        </button>
      </div>
    </div>
  );
};

export default ParagraphBar;
