import clsx from 'clsx';
import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { formatPlaybackTime } from '@/utils/time';
import { eventDispatcher } from '@/utils/event';
import { throttle } from '@/utils/throttle';
import { TTSPlaybackInfo, usePlaybackInfo } from './usePlaybackInfo';

type TTSScrubberProps = {
  bookKey: string;
  isEink: boolean;
  onSeek: (seconds: number) => Promise<void>;
  onSeekPreview?: (seconds: number) => void;
  onGetPlaybackInfo: () => TTSPlaybackInfo | null;
};

// Interactive chapter scrubber: elapsed / track / -remaining. The track is an
// inline three-stop gradient — played (solid), buffered/prefetched (mid), rest
// (faint) — YouTube-style; `.tts-scrubber` in globals.css blanks the native
// track so the gradient IS the track.
const TTSScrubber = ({
  bookKey,
  isEink,
  onSeek,
  onSeekPreview,
  onGetPlaybackInfo,
}: TTSScrubberProps) => {
  const _ = useTranslation();
  const playback = usePlaybackInfo({ bookKey, isEink, onGetPlaybackInfo });
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const keyboardCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live location preview while the thumb moves, throttled so a fast drag
  // doesn't relocate the reader on every pixel. The trailing emit can land
  // after release; the committed seek owns navigation from that point, so
  // it must not redraw a preview nothing would clear.
  const throttledPreview = useMemo(
    () =>
      onSeekPreview
        ? throttle((seconds: number) => {
            if (dragValueRef.current === null) return;
            onSeekPreview(seconds);
          }, 100)
        : null,
    [onSeekPreview],
  );

  const commitSeek = (seconds: number) => {
    dragValueRef.current = null;
    setDragValue(null);
    playback.setRefreshPaused(false);
    const rollback = playback.applySeek(seconds);
    onSeek(seconds).catch(() => {
      // A silent snap-back is the exact violation the optimistic thumb
      // prevents — restore visibly and say why.
      rollback();
      eventDispatcher.dispatch('toast', { message: _('Failed to seek'), type: 'error' });
    });
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // React fires range onChange continuously during a drag; track the value
    // and commit only on pointer/key release.
    const value = parseFloat(e.target.value);
    dragValueRef.current = value;
    setDragValue(value);
    playback.setRefreshPaused(true);
    throttledPreview?.(value);
  };

  const handlePointerCommit = () => {
    if (dragValueRef.current !== null) commitSeek(dragValueRef.current);
  };

  const handleKeyUp = () => {
    // Holding an arrow key must not fire a network seek per press.
    if (keyboardCommitRef.current) clearTimeout(keyboardCommitRef.current);
    keyboardCommitRef.current = setTimeout(() => {
      if (dragValueRef.current !== null) commitSeek(dragValueRef.current);
    }, 500);
  };

  const { ready, stale, total, measuredFraction } = playback;
  const position = Math.min(dragValue ?? playback.position, total);
  const forceHours = total >= 3600;
  const elapsedLabel = ready ? formatPlaybackTime(position, forceHours) : '--:--';
  const remainingLabel = ready
    ? `-${formatPlaybackTime(Math.max(total - position, 0), forceHours)}`
    : '--:--';
  const playedPct = ready && total > 0 ? Math.min((position / total) * 100, 100) : 0;
  const bufferedPct = ready ? Math.max(playedPct, Math.min(measuredFraction, 1) * 100) : 0;

  return (
    <div dir='ltr' className={clsx('flex w-full items-center gap-2 py-1', stale && 'opacity-60')}>
      <span className='min-w-9 text-center text-xs tabular-nums'>{elapsedLabel}</span>
      <input
        className='tts-scrubber text-base-content min-w-0 grow'
        type='range'
        min={0}
        max={total || 1}
        step={1}
        value={position}
        disabled={!ready || stale}
        onChange={handleChange}
        onPointerUp={handlePointerCommit}
        onTouchEnd={handlePointerCommit}
        onKeyUp={handleKeyUp}
        style={{
          background: `linear-gradient(to right, currentColor 0% ${playedPct}%, color-mix(in srgb, currentColor 40%, transparent) ${playedPct}% ${bufferedPct}%, color-mix(in srgb, currentColor 15%, transparent) ${bufferedPct}% 100%)`,
        }}
        aria-label={_('Chapter progress')}
        aria-valuetext={_('{{elapsed}} of {{total}}', {
          elapsed: elapsedLabel,
          total: ready ? formatPlaybackTime(total, forceHours) : '--:--',
        })}
      />
      <span className='min-w-10 text-center text-xs tabular-nums'>{remainingLabel}</span>
    </div>
  );
};

export default TTSScrubber;
