'use client';

import React from 'react';
import clsx from 'clsx';
import { IoVolumeHigh, IoSync } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';

// The five derived states both reader modes expose (slice 5, #3235). idle and
// unsupported render nothing — we never nag, especially not on fixed-layout.
export type TtsSyncStatus = 'idle' | 'following' | 'syncing' | 'decoupled' | 'unsupported';

interface TTSFollowIndicatorProps {
  status: TtsSyncStatus;
  /**
   * RSVP non-Edge sentence-level following is paced by an estimator, not exact
   * word marks, so the label is qualified with " · estimated".
   */
  estimated?: boolean;
  /** Re-engage following. Only wired through on the decoupled (action) state. */
  onResume?: () => void;
  /**
   * Surface idiom. 'base' (default) uses daisyui base tokens — for the paragraph
   * overlay, where the global [data-eink] rules apply. 'plain' uses the neutral
   * gray-500 overlay + currentColor text to match the RSVP overlay's own
   * theme-painted surface (the same idiom as its chapter/WPM pills and "Look up"
   * pill), where daisyui base tokens would clash with the book theme.
   */
  variant?: 'base' | 'plain';
  className?: string;
}

// Shared pill chassis. eink-bordered is applied unconditionally: in eink mode it
// swaps to bg-base-100 + a 1px base-content border, and the RSVP overlay paints
// its own theme surface where the global [data-eink] rules don't auto-apply
// (mirrors the RSVP "Look up" pill). Glyph + text together so the meaning never
// rests on color alone — required to read in e-ink monochrome.
const PILL_BASE =
  'eink-bordered inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium leading-none whitespace-nowrap';

// Per-variant fills. 'plain' inherits text color (currentColor) so it reads on
// any book theme the RSVP overlay paints.
const STATUS_FILL: Record<NonNullable<TTSFollowIndicatorProps['variant']>, string> = {
  base: 'bg-base-content/10 text-base-content',
  plain: 'bg-gray-500/15',
};
const ACTION_FILL: Record<NonNullable<TTSFollowIndicatorProps['variant']>, string> = {
  base: 'bg-base-200 text-base-content transition-colors hover:bg-base-300',
  plain: 'bg-gray-500/20 transition-colors hover:bg-gray-500/30',
};

const TTSFollowIndicator: React.FC<TTSFollowIndicatorProps> = ({
  status,
  estimated = false,
  onResume,
  variant = 'base',
  className,
}) => {
  const _ = useTranslation();

  // Never nag: idle has nothing to follow, unsupported (fixed-layout) can never
  // engage. Both render null rather than a placeholder.
  if (status === 'idle' || status === 'unsupported') return null;

  if (status === 'decoupled') {
    // The only actionable state — the whole pill is the button. touch-target
    // extends the hit area to 44px on mobile without growing the rendered pill.
    return (
      <button
        type='button'
        aria-label={_('Resume audio')}
        onClick={onResume}
        className={clsx(
          PILL_BASE,
          'touch-target',
          ACTION_FILL[variant],
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
          className,
        )}
      >
        <IoSync className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
        <span>{_('Resume audio')}</span>
      </button>
    );
  }

  // following / syncing: a filled, non-interactive status pill. syncing adds the
  // loading-dots affordance while a cross-section re-extract is in flight.
  return (
    <div
      role='status'
      aria-live='polite'
      className={clsx(PILL_BASE, STATUS_FILL[variant], className)}
    >
      {status === 'syncing' ? (
        <span
          className='loading loading-dots loading-xs shrink-0'
          aria-hidden='true'
          data-testid='tts-follow-syncing'
        />
      ) : (
        <IoVolumeHigh className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
      )}
      <span>{_('Following audio')}</span>
      {estimated && <span className='not-eink:opacity-70'>{_(' · estimated')}</span>}
    </div>
  );
};

export default TTSFollowIndicator;
