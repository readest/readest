'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdChevronLeft, MdChevronRight, MdClose } from 'react-icons/md';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';

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
  gridInsets: Insets;
}

const AnimatedNumber: React.FC<{ value: number | string }> = ({ value }) => (
  <span
    key={value}
    className='inline-block animate-[subtle-slide-up_0.2s_ease-out] text-sm font-medium tabular-nums'
  >
    {value}
  </span>
);

const ParagraphBar: React.FC<ParagraphBarProps> = ({
  bookKey,
  currentIndex,
  totalParagraphs,
  isLoading,
  onPrev,
  onNext,
  onClose,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey } = useReaderStore();
  const iconSize = useResponsiveSize(18);

  const [isBarVisible, setIsBarVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInTriggerZoneRef = useRef(false);
  const isMountedRef = useRef(true);

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
        if (isMountedRef.current && !isInTriggerZoneRef.current) {
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

  const isHiddenByHover = hoveredBookKey === bookKey;
  const isVisible = isBarVisible && !isHiddenByHover;
  const progress =
    totalParagraphs > 0 ? Math.round(((currentIndex + 1) / totalParagraphs) * 100) : 0;

  return (
    <>
      <style jsx global>{`
        @keyframes subtle-slide-up {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <div
        className={clsx(
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
          isInTriggerZoneRef.current = true;
          showBar(false);
        }}
        onMouseLeave={() => {
          isInTriggerZoneRef.current = false;
          startHideTimer();
        }}
      >
        <div
          className={clsx(
            'flex items-center gap-1 rounded-full px-3 py-1.5',
            'bg-base-300 text-base-content',
            'border-base-content/10 border',
            'shadow-sm backdrop-blur-md',
            'transition-all duration-200 ease-out',
          )}
        >
          <button
            onClick={onPrev}
            disabled={isLoading}
            className={clsx(
              'flex items-center justify-center rounded-full p-1.5',
              'transition-all duration-200 ease-out',
              'hover:bg-base-content/10 active:scale-90',
              isLoading && 'pointer-events-none opacity-50',
            )}
            title={_('Previous Paragraph')}
            aria-label={_('Previous Paragraph')}
          >
            <MdChevronLeft size={iconSize} />
          </button>

          <div className='bg-base-content/10 mx-1 h-4 w-px' />

          <div className='flex items-center gap-2 px-1'>
            {isLoading ? (
              <div className='flex min-w-[3rem] items-center justify-center gap-2'>
                <span className='loading loading-dots loading-sm text-base-content/50' />
                <span className='text-base-content/50 text-sm'>{_('Loading')}</span>
              </div>
            ) : (
              <>
                <div className='flex min-w-[3rem] items-center justify-center gap-1'>
                  <AnimatedNumber value={currentIndex + 1} />
                  <span className='text-base-content/30 text-sm'>/</span>
                  <span className='text-sm font-medium tabular-nums'>{totalParagraphs}</span>
                </div>

                <span className='text-base-content/40 text-sm'>•</span>

                <div className='flex min-w-[2.5rem] items-center justify-center gap-0.5'>
                  <AnimatedNumber value={progress} />
                  <span className='text-sm font-medium'>%</span>
                </div>
              </>
            )}
          </div>

          <div className='bg-base-content/10 mx-1 h-4 w-px' />

          <button
            onClick={onNext}
            disabled={isLoading}
            className={clsx(
              'flex items-center justify-center rounded-full p-1.5',
              'transition-all duration-200 ease-out',
              'hover:bg-base-content/10 active:scale-90',
              isLoading && 'pointer-events-none opacity-50',
            )}
            title={_('Next Paragraph')}
            aria-label={_('Next Paragraph')}
          >
            <MdChevronRight size={iconSize} />
          </button>

          <button
            onClick={onClose}
            disabled={isLoading}
            className={clsx(
              'flex items-center justify-center rounded-full p-1.5',
              'transition-all duration-200 ease-out',
              'hover:bg-base-content/10 active:scale-90',
              isLoading && 'pointer-events-none opacity-50',
            )}
            title={_('Exit Paragraph Mode')}
            aria-label={_('Exit Paragraph Mode')}
          >
            <MdClose size={iconSize} />
          </button>
        </div>
      </div>
    </>
  );
};

export default ParagraphBar;
