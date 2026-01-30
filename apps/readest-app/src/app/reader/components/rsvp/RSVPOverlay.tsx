'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { RsvpState, RsvpWord, RSVPController } from '@/services/rsvp';
import { useThemeStore } from '@/store/themeStore';
import { TOCItem } from '@/libs/document';
import { IoClose, IoPlay, IoPause, IoPlaySkipBack, IoPlaySkipForward, IoRemove, IoAdd } from 'react-icons/io5';

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
  const { themeCode, isDarkMode } = useThemeStore();
  const [state, setState] = useState<RsvpState>(controller.currentState);
  const [currentWord, setCurrentWord] = useState<RsvpWord | null>(controller.currentWord);
  const [countdown, setCountdown] = useState<number | null>(controller.currentCountdown);
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const [flatChapters, setFlatChapters] = useState<FlatChapter[]>([]);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const SWIPE_THRESHOLD = 50;
  const TAP_THRESHOLD = 10;

  // Flatten chapters for dropdown
  useEffect(() => {
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
    setFlatChapters(flatten(chapters));
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!state.active) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          controller.togglePlayPause();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (event.shiftKey) {
            controller.skipBackward(15);
          } else {
            controller.decreaseSpeed();
          }
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (event.shiftKey) {
            controller.skipForward(15);
          } else {
            controller.increaseSpeed();
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          controller.increaseSpeed();
          break;
        case 'ArrowDown':
          event.preventDefault();
          controller.decreaseSpeed();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
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

  // Context text helpers
  const getContextBefore = useCallback((): string => {
    if (!state || state.words.length === 0) return '';
    const startIndex = Math.max(0, state.currentIndex - 50);
    return state.words
      .slice(startIndex, state.currentIndex)
      .map((w) => w.text)
      .join(' ');
  }, [state]);

  const getContextAfter = useCallback((): string => {
    if (!state || state.words.length === 0) return '';
    const endIndex = Math.min(state.words.length, state.currentIndex + 51);
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

  // Use theme colors with fallbacks for solid backgrounds
  const bgColor = themeCode.palette.base100 || (isDarkMode ? '#1a1a2e' : '#ffffff');
  const fgColor = themeCode.palette.baseContent || (isDarkMode ? '#e0e0e0' : '#1a1a1a');
  const accentColor = themeCode.palette.primary || '#3b82f6';

  return (
    <div
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
      <div className='rsvp-header flex shrink-0 items-center justify-between p-4'>
        <button
          className='flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20'
          onClick={onClose}
          title='Close (Esc)'
        >
          <IoClose size={24} />
        </button>

        {/* Chapter selector */}
        <div className='relative mx-4 max-w-[300px] flex-1'>
          <button
            className='flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-gray-500/30 bg-gray-500/15 px-3 py-2 text-sm transition-colors hover:bg-gray-500/25'
            onClick={() => setShowChapterDropdown(!showChapterDropdown)}
            title='Select Chapter'
          >
            <span className='overflow-hidden text-ellipsis whitespace-nowrap'>
              {getCurrentChapterLabel()}
            </span>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
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
                    isChapterActive(chapter.href) && 'bg-[color-mix(in_srgb,var(--rsvp-accent)_20%,transparent)] font-semibold',
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

        <div className='text-base font-medium opacity-70'>{state.wpm} WPM</div>
      </div>

      {/* Context panel (shown when paused) */}
      {!state.playing && countdown === null && (
        <div className='mx-4 max-h-[30vh] overflow-y-auto rounded-xl border border-gray-500/20 bg-gray-500/10 p-4'>
          <div className='mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-60'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
            >
              <path d='M4 6h16M4 12h16M4 18h10' />
            </svg>
            <span>Context</span>
          </div>
          <div className='text-left text-lg leading-relaxed'>
            <span className='opacity-70'>{getContextBefore()} </span>
            <span className='font-semibold' style={{ color: accentColor }}>
              {currentWord?.text || ''}
            </span>
            <span className='opacity-70'> {getContextAfter()}</span>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className='flex flex-1 flex-col items-center justify-center p-8'>
        <div className='flex h-full w-full flex-col items-center justify-center'>
          <div className='flex h-full w-full flex-col items-center'>
            {/* Top guide line */}
            <div className='flex-1 w-px bg-current opacity-30' />

            {/* Word section */}
            <div className='flex flex-col items-center justify-center'>
              {/* Countdown */}
              {countdown !== null && (
                <div className='mb-2 flex items-center justify-center'>
                  <span
                    className='animate-pulse text-6xl font-bold sm:text-7xl'
                    style={{ color: accentColor }}
                  >
                    {countdown}
                  </span>
                </div>
              )}

              {/* Word display */}
              <div className='relative flex min-h-20 w-full items-center justify-center whitespace-nowrap px-4 py-6 font-mono text-3xl font-medium tracking-wide sm:text-4xl md:text-5xl'>
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
                  <span className='italic opacity-30'>Ready</span>
                )}
              </div>
            </div>

            {/* Bottom guide line */}
            <div className='flex-1 w-px bg-current opacity-30' />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className='rsvp-controls shrink-0 px-4 pb-8 pt-4'>
        {/* Progress section */}
        <div className='mb-4 flex flex-col gap-2'>
          <div className='flex items-center justify-between text-xs'>
            <span className='font-semibold uppercase tracking-wide opacity-70'>
              Chapter Progress
            </span>
            <span className='tabular-nums opacity-60'>
              {(state.currentIndex + 1).toLocaleString()} / {state.words.length.toLocaleString()}{' '}
              words
              {getTimeRemaining() && (
                <span className='opacity-80'> · {getTimeRemaining()} left</span>
              )}
            </span>
          </div>
          <div
            className='relative h-2 cursor-pointer overflow-visible rounded bg-gray-500/30'
            onClick={handleProgressBarClick}
            title='Click to seek'
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
        <div className='flex items-center justify-between'>
          {/* Punctuation pause */}
          <div className='flex min-w-[120px] flex-1 items-center'>
            <label className='flex cursor-pointer items-center gap-2 text-xs font-medium opacity-80'>
              Pause:
              <select
                className='cursor-pointer rounded border border-gray-500/30 bg-gray-500/20 px-2 py-1 text-xs font-medium transition-colors hover:border-gray-500/40 hover:bg-gray-500/30'
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

          {/* Playback controls */}
          <div className='flex items-center justify-center gap-4'>
            <button
              className='flex cursor-pointer items-center gap-1 rounded-full border-none bg-transparent px-3 py-2 transition-colors hover:bg-gray-500/20 active:scale-95'
              onClick={() => controller.skipBackward(15)}
              title='Back 15 words (Shift+Left)'
            >
              <span className='text-xs font-semibold opacity-80'>15</span>
              <IoPlaySkipBack size={24} />
            </button>

            <button
              className='flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border-none bg-gray-500/15 transition-colors hover:bg-gray-500/25 active:scale-95'
              onClick={() => controller.togglePlayPause()}
              title={state.playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {state.playing ? <IoPause size={32} /> : <IoPlay size={32} />}
            </button>

            <button
              className='flex cursor-pointer items-center gap-1 rounded-full border-none bg-transparent px-3 py-2 transition-colors hover:bg-gray-500/20 active:scale-95'
              onClick={() => controller.skipForward(15)}
              title='Forward 15 words (Shift+Right)'
            >
              <IoPlaySkipForward size={24} />
              <span className='text-xs font-semibold opacity-80'>15</span>
            </button>
          </div>

          {/* Speed controls */}
          <div className='flex min-w-[120px] flex-1 items-center justify-end gap-2'>
            <button
              className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95'
              onClick={() => controller.decreaseSpeed()}
              title='Slower (Left/Down)'
            >
              <IoRemove size={20} />
            </button>
            <span className='min-w-12 text-center text-sm font-medium'>{state.wpm}</span>
            <button
              className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-gray-500/20 active:scale-95'
              onClick={() => controller.increaseSpeed()}
              title='Faster (Right/Up)'
            >
              <IoAdd size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RSVPOverlay;
