'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdAdd, MdClose, MdPause, MdPlayArrow, MdRemove } from 'react-icons/md';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { MAX_AUTO_SCROLL_SPEED, MIN_AUTO_SCROLL_SPEED } from '@/services/constants';

const INITIAL_SHOW_DURATION = 2500;
const HIDE_DELAY = 2000;

interface AutoScrollControlProps {
  bookKey: string;
  paused: boolean;
  speed: number;
  onTogglePause: () => void;
  onAdjustSpeed: (dir: 1 | -1) => void;
  onStop: () => void;
  gridInsets: Insets;
}

// The Auto Scroll session pill (#4998): speed −/+ around the current
// percentage, pause/resume, and exit. Fades away while scrolling so the mode
// stays immersive; any mouse movement or pausing (tap on the page) brings it
// back. Same floating-pill chassis as ParagraphBar.
const AutoScrollControl: React.FC<AutoScrollControlProps> = ({
  bookKey,
  paused,
  speed,
  onTogglePause,
  onAdjustSpeed,
  onStop,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey } = useReaderStore();
  const iconSize = useResponsiveSize(18);

  const [isBarVisible, setIsBarVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

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
        if (!isHoveredRef.current && !pausedRef.current) {
          setIsBarVisible(false);
        }
      }, delay);
    },
    [clearHideTimer],
  );

  useEffect(() => {
    if (paused) {
      clearHideTimer();
      setIsBarVisible(true);
    } else {
      startHideTimer(INITIAL_SHOW_DURATION);
    }
    return clearHideTimer;
  }, [paused, startHideTimer, clearHideTimer]);

  useEffect(() => {
    let lastMoveTime = 0;
    const handleMouseMove = () => {
      const now = Date.now();
      if (now - lastMoveTime < 100) return;
      lastMoveTime = now;
      setIsBarVisible(true);
      startHideTimer();
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [startHideTimer]);

  const isVisible = isBarVisible && hoveredBookKey !== bookKey;

  const buttonClass = clsx(
    'flex items-center justify-center rounded-full p-1.5',
    'transition-all duration-200 ease-out',
    'not-eink:hover:bg-base-200 active:scale-90',
  );

  return (
    <div
      className={clsx(
        // `absolute` so the pill centers on the book's grid cell rather than
        // the viewport: with a pinned sidebar (or a split view) the reading
        // column is off the window center and the pill must stay under the
        // text it controls.
        'absolute bottom-6 left-1/2 z-50 -translate-x-1/2',
        'transition-[opacity,filter,transform] duration-200 ease-out',
        isVisible
          ? 'pointer-events-auto translate-y-0 scale-100 opacity-100 blur-0'
          : 'pointer-events-none translate-y-4 scale-90 opacity-0 blur-sm',
      )}
      style={{
        paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
      }}
      onMouseEnter={() => {
        isHoveredRef.current = true;
        clearHideTimer();
        setIsBarVisible(true);
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        startHideTimer();
      }}
    >
      <div
        className={clsx(
          'text-base-content flex items-center gap-1 rounded-full px-3 py-1.5',
          'not-eink:bg-base-300 eink-bordered',
          'not-eink:border-base-content/10 not-eink:border',
          'shadow-sm backdrop-blur-md',
        )}
      >
        <button
          onClick={() => onAdjustSpeed(-1)}
          disabled={speed <= MIN_AUTO_SCROLL_SPEED}
          className={clsx(buttonClass, speed <= MIN_AUTO_SCROLL_SPEED && 'opacity-30')}
          title={_('Slower')}
          aria-label={_('Slower')}
        >
          <MdRemove size={iconSize} />
        </button>

        <div className='flex min-w-[3.5rem] items-center justify-center'>
          <span className='text-sm font-medium tabular-nums'>{speed}%</span>
        </div>

        <button
          onClick={() => onAdjustSpeed(1)}
          disabled={speed >= MAX_AUTO_SCROLL_SPEED}
          className={clsx(buttonClass, speed >= MAX_AUTO_SCROLL_SPEED && 'opacity-30')}
          title={_('Faster')}
          aria-label={_('Faster')}
        >
          <MdAdd size={iconSize} />
        </button>

        <div className='bg-base-content/10 mx-1 h-4 w-px' />

        <button
          onClick={onTogglePause}
          className={buttonClass}
          title={paused ? _('Play') : _('Pause')}
          aria-label={paused ? _('Play') : _('Pause')}
        >
          {paused ? <MdPlayArrow size={iconSize} /> : <MdPause size={iconSize} />}
        </button>

        <div className='bg-base-content/10 mx-1 h-4 w-px' />

        <button
          onClick={onStop}
          className={buttonClass}
          title={_('Exit Auto Scroll')}
          aria-label={_('Exit Auto Scroll')}
        >
          <MdClose size={iconSize} />
        </button>
      </div>
    </div>
  );
};

export default AutoScrollControl;
