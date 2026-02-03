'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { RsvpState, RsvpWord, RSVPController } from '@/services/rsvp';
import { useThemeStore } from '@/store/themeStore';
import { TOCItem } from '@/libs/document';
import {
  IoClose,
  IoPlay,
  IoPause,
  IoPlaySkipBack,
  IoPlaySkipForward,
  IoRemove,
  IoAdd,
} from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';

interface FlatChapter {
  label: string;
  href: string;
  level: number;
}

interface RSVPOverlayProps {
  controller: RSVPController;
  chapters: TOCItem[];
  currentChapterHref: string | null;
  onClose: () => void;
  onChapterSelect: (href: string) => void;
  onRequestNextPage: () => void;
}

const RSVPOverlay: React.FC<RSVPOverlayProps> = ({
  controller,
  chapters,
  currentChapterHref,
  onClose,
  onChapterSelect,
  onRequestNextPage,
}) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode: _isDarkMode } = useThemeStore();
  const [state, setState] = useState<RsvpState>(controller.currentState);
  const [currentWord, setCurrentWord] = useState<RsvpWord | null>(controller.currentWord);
  const [countdown, setCountdown] = useState<number | null>(controller.currentCountdown);
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
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
      setCurrentWord(controller.currentWord);
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

      switch (event.key) {
        case ' ':
          event.preventDefault();
          event.stopPropagation();
          controller.togglePlayPause();
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
      }
    };

    // Use capture phase to handle events before they reach dropdown/select elements
    document.addEventListener('keydown', handleKeyboard, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyboard, { capture: true });
  }, [state.active, controller, onClose]);

  // Word display helpers
  const wordBefore = currentWord ? currentWord.text.substring(0, currentWord.orpIndex) : '';
  const orpChar = currentWord ? currentWord.text.charAt(currentWord.orpIndex) : '';
  const wordAfter = currentWord ? currentWord.text.substring(currentWord.orpIndex + 1) : '';

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

  // Context text helpers - show 100 words before and after
  const getContextBefore = useCallback((): string => {
    if (!state || state.words.length === 0) return '';
    const startIndex = Math.max(0, state.currentIndex - 100);
    return state.words
      .slice(startIndex, state.currentIndex)
      .map((w) => w.text)
      .join(' ');
  }, [state]);

  const getContextAfter = useCallback((): string => {
    if (!state || state.words.length === 0) return '';
    const endIndex = Math.min(state.words.length, state.currentIndex + 101);
    return state.words
      .slice(state.currentIndex + 1, endIndex)
      .map((w) => w.text)
      .join(' ');
  }, [state]);

  // Chapter helpers
  const getCurrentChapterLabel = useCallback((): string => {
    if (!currentChapterHref) return 'Select Chapter';
    const normalizedCurrent = currentChapterHref.split('#')[0]?.replace(/^\//, '') || '';
    const chapter = flatChapters.find((c) => {
      const normalizedHref = c.href.split('#')[0]?.replace(/^\//, '') || '';
      return normalizedHref === normalizedCurrent;
    });
    return chapter?.label || 'Select Chapter';
  }, [currentChapterHref, flatChapters]);

  const isChapterActive = useCallback(
    (href: string): boolean => {
      if (!currentChapterHref) return false;
      const normalizedCurrent = currentChapterHref.split('#')[0]?.replace(/^\//, '') || '';
      const normalizedHref = href.split('#')[0]?.replace(/^\//, '') || '';
      return normalizedHref === normalizedCurrent;
    },
    [currentChapterHref],
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
      const target = event.target as HTMLElement;
      if (target.closest('.rsvp-controls') || target.closest('.rsvp-header')) {
        return;
      }

      const screenWidth = window.innerWidth;
      const tapX = touch.clientX;

      if (tapX < screenWidth * 0.25) {
        controller.skipBackward(15);
      } else if (tapX > screenWidth * 0.75) {
        controller.skipForward(15);
      } else {
        controller.togglePlayPause();
      }
    }
  };

  // Progress bar click handler
  const handleProgressBarClick = (event: React.MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = (clickX / rect.width) * 100;

    const wasPlaying = state.playing;
    if (wasPlaying) {
      controller.pause();
    }

    controller.seekToPosition(percentage);

    if (wasPlaying) {
      setTimeout(() => controller.resume(), 50);
    }
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

  return (
    <div
      data-testid='rsvp-overlay'
      aria-label='RSVP Speed Reading Overlay'
      className='fixed inset-0 z-[10000] flex select-none flex-col'
      style={{
        backgroundColor: bgColor,
        color: fgColor,
        // Ensure solid background - no transparency
        backdropFilter: 'none',
        // @ts-expect-error CSS custom properties
        '--rsvp-accent': accentColor,
        '--rsvp-fg': fgColor,
        '--rsvp-bg': bgColor,
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className='rsvp-header flex shrink-0 items-center justify-between gap-2 p-3 md:gap-4 md:p-4'>
        <button
          aria-label={_('Close RSVP')}
          className='flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 md:h-11 md:w-11'
          onClick={onClose}
          title={_('Close')}
        >
          <IoClose className='h-5 w-5 md:h-6 md:w-6' />
        </button>

        {/* Chapter selector */}
        <div className='relative mx-2 min-w-0 max-w-[200px] flex-1 md:mx-4 md:max-w-[400px]'>
          <button
            className='flex w-full cursor-pointer items-center justify-between gap-1 rounded-lg border border-gray-500/30 bg-gray-500/15 px-2 py-1.5 text-xs transition-colors hover:bg-gray-500/25 md:gap-2 md:px-3 md:py-2 md:text-sm'
            onClick={() => setShowChapterDropdown(!showChapterDropdown)}
            title={_('Select Chapter')}
          >
            <span className='overflow-hidden text-ellipsis whitespace-nowrap'>
              {getCurrentChapterLabel()}
            </span>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              className='shrink-0 md:h-4 md:w-4'
            >
              <path d='M6 9l6 6 6-6' />
            </svg>
          </button>
          {showChapterDropdown && (
            <div
              className='absolute left-0 right-0 top-full z-[100] mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-gray-500/30 shadow-lg'
              style={{ backgroundColor: bgColor }}
            >
              {flatChapters.map((chapter, idx) => (
                <button
                  key={`${chapter.href}-${idx}`}
                  className={clsx(
                    'block w-full cursor-pointer border-none bg-transparent px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-500/20',
                    isChapterActive(chapter.href) &&
                      'bg-[color-mix(in_srgb,var(--rsvp-accent)_20%,transparent)] font-semibold',
                  )}
                  style={{ paddingLeft: `${0.75 + chapter.level * 1}rem` }}
                  onClick={() => handleChapterSelect(chapter.href)}
                >
                  {chapter.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className='shrink-0 text-sm font-medium opacity-70 md:text-base'>
          {_('{{number}} WPM', { number: state.wpm })}
        </div>
      </div>

      {/* Context panel (shown when paused) */}
      {!state.playing && countdown === null && (
        <div className='mx-3 max-h-[25vh] overflow-y-auto rounded-lg border border-gray-500/20 bg-gray-500/10 p-3 md:mx-4 md:max-h-[30vh] md:rounded-xl md:p-4'>
          <div className='mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-60 md:mb-3'>
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
            <span>{_('Context')}</span>
          </div>
          <div className='text-left text-base leading-relaxed md:text-lg'>
            <span className='opacity-70'>{getContextBefore()} </span>
            <span className='font-semibold' style={{ color: accentColor }}>
              {currentWord?.text || ''}
            </span>
            <span className='opacity-70'> {getContextAfter()}</span>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className='flex flex-1 flex-col items-center justify-center p-4 md:p-8'>
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
              <div className='relative flex min-h-16 w-full items-center justify-center whitespace-nowrap px-2 py-4 font-mono text-2xl font-medium tracking-wide sm:min-h-20 sm:px-4 sm:py-6 sm:text-3xl md:text-4xl lg:text-5xl'>
                {currentWord ? (
                  <>
                    <span className='absolute right-[calc(50%+0.3em)] text-right opacity-60'>
                      {wordBefore}
                    </span>
                    <span className='relative z-10 font-bold' style={{ color: accentColor }}>
                      {orpChar}
                    </span>
                    <span className='absolute left-[calc(50%+0.3em)] text-left opacity-60'>
                      {wordAfter}
                    </span>
                  </>
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
            onClick={handleProgressBarClick}
            onKeyDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowLeft') controller.skipBackward();
              else if (e.key === 'ArrowRight') controller.skipForward();
            }}
            title={_('Click to seek')}
          >
            <div
              className='absolute left-0 top-0 h-full rounded transition-[width] duration-100'
              style={{ width: `${state.progress}%`, backgroundColor: accentColor }}
            />
            <div
              className='absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-[left] duration-100'
              style={{ left: `${state.progress}%`, backgroundColor: accentColor }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4'>
          {/* Playback controls - centered on mobile, middle on desktop */}
          <div className='flex items-center justify-center gap-2 md:order-2 md:gap-4'>
            <button
              aria-label={_('Skip back 15 words')}
              className='flex cursor-pointer items-center gap-1 rounded-full border-none bg-transparent px-2 py-1.5 transition-colors hover:bg-gray-500/20 active:scale-95 md:px-3 md:py-2'
              onClick={() => controller.skipBackward(15)}
              title={_('Back 15 words (Shift+Left)')}
            >
              <span className='text-xs font-semibold opacity-80'>15</span>
              <IoPlaySkipBack className='h-5 w-5 md:h-6 md:w-6' />
            </button>

            <button
              aria-label={state.playing ? _('Pause') : _('Play')}
              className={clsx(
                'flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-none bg-gray-500/15 transition-colors hover:bg-gray-500/25 active:scale-95 md:h-16 md:w-16',
                state.playing ? '' : 'ps-1',
              )}
              onClick={() => controller.togglePlayPause()}
              title={state.playing ? _('Pause (Space)') : _('Play (Space)')}
            >
              {state.playing ? (
                <IoPause className='h-7 w-7 md:h-8 md:w-8' />
              ) : (
                <IoPlay className='h-7 w-7 md:h-8 md:w-8' />
              )}
            </button>

            <button
              aria-label={_('Skip forward 15 words')}
              className='flex cursor-pointer items-center gap-1 rounded-full border-none bg-transparent px-2 py-1.5 transition-colors hover:bg-gray-500/20 active:scale-95 md:px-3 md:py-2'
              onClick={() => controller.skipForward(15)}
              title={_('Forward 15 words (Shift+Right)')}
            >
              <IoPlaySkipForward className='h-5 w-5 md:h-6 md:w-6' />
              <span className='text-xs font-semibold opacity-80'>15</span>
            </button>
          </div>

          {/* Secondary controls row on mobile, split on desktop */}
          <div className='flex items-center justify-between gap-4 md:contents'>
            {/* Punctuation pause - left on desktop */}
            <div className='flex items-center md:order-1 md:min-w-[140px] md:flex-1'>
              <label className='flex cursor-pointer items-center gap-1.5 text-xs font-medium opacity-80 md:gap-2'>
                <span className='hidden sm:inline'>{_('Pause:')}</span>
                <span className='sm:hidden'>{_('Pause:')}</span>
                <select
                  className='cursor-pointer rounded border border-gray-500/30 bg-gray-500/20 px-1.5 py-1 text-xs font-medium transition-colors hover:border-gray-500/40 hover:bg-gray-500/30 md:px-2'
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
            </div>

            {/* Speed controls - right on desktop */}
            <div className='flex items-center justify-end gap-1.5 md:order-3 md:min-w-[140px] md:flex-1 md:gap-2'>
              <button
                aria-label={_('Decrease speed')}
                className='flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-10 md:w-10'
                onClick={() => controller.decreaseSpeed()}
                title={_('Slower (Left/Down)')}
              >
                <IoRemove className='h-4 w-4 md:h-5 md:w-5' />
              </button>
              <span
                aria-label={_('Current speed')}
                className='min-w-10 text-center text-sm font-medium md:min-w-12'
              >
                {state.wpm}
              </span>
              <button
                aria-label={_('Increase speed')}
                className='flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95 md:h-10 md:w-10'
                onClick={() => controller.increaseSpeed()}
                title={_('Faster (Right/Up)')}
              >
                <IoAdd className='h-4 w-4 md:h-5 md:w-5' />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RSVPOverlay;
