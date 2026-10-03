import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdPlayArrow } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { PageInfo } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { lyricIndexAtCenter, lyricScrollTopFor } from '@/utils/ttsLyrics';

// How long the sheet stays parked where the reader left it before sliding back
// to the sentence being spoken. Every scroll event re-arms it, so a flick with
// momentum stays one gesture rather than a dozen. Long enough to read the line
// under the row and decide before it slides away.
const SEEK_IDLE_MS = 4000;
// A committed line whose audio never arrives must not spin forever.
const COMMIT_WATCHDOG_MS = 15000;
// A page lookup resolves a CFI against a freshly parsed copy of the section,
// so it waits for the drag to settle instead of firing per line crossed.
const PAGE_LOOKUP_DEBOUNCE_MS = 150;

type TTSLyricsViewProps = {
  lines: string[];
  activeIndex: number;
  buffering: boolean;
  isEink: boolean;
  onGetLyricPage: (index: number) => Promise<PageInfo | null>;
  onPlayFrom: (index: number) => Promise<void>;
};

// Lyric-style transcript of the chapter being read aloud (#5755): the spoken
// sentence sits centred and lit, the rest dim around it. Dragging the sheet
// parks it and raises a seek row over the centre line — page number on one
// side, play button on the other — so a line can be picked the way a music
// player picks a lyric, with playback moving only once the button is pressed.
const TTSLyricsView = ({
  lines,
  activeIndex,
  buffering,
  isEink,
  onGetLyricPage,
  onPlayFrom,
}: TTSLyricsViewProps) => {
  const _ = useTranslation();
  const iconSize16 = useResponsiveSize(16);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Content-space centre and height of every rendered line. Measured per
  // layout, so a scroll event costs a binary search instead of N forced
  // reflows.
  const centersRef = useRef<number[]>([]);
  const heightsRef = useRef<number[]>([]);
  const seekingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seekIndex, setSeekIndex] = useState<number | null>(null);
  // A line the reader committed to, held until its audio is heard so the button
  // can spin in place rather than the row vanishing into silence.
  const [pending, setPending] = useState<number | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [halfHeight, setHalfHeight] = useState(0);
  // Bumped whenever the measured line centres actually move. The follow scroll
  // depends on it, so a re-wrap re-parks the spoken line instead of leaving it
  // off screen until the next sentence.
  const [geometry, setGeometry] = useState(0);

  const rowIndex = seekIndex ?? pending;

  // Read the line geometry the scroll math runs on, and the half-viewport
  // spacer that lets the first and last lines reach the centre (percentage
  // padding resolves against width, so that height has to be measured).
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const centers: number[] = [];
    const heights: number[] = [];
    el.querySelectorAll<HTMLElement>('[data-lyric-line]').forEach((node) => {
      centers.push(node.offsetTop + node.offsetHeight / 2);
      heights.push(node.offsetHeight);
    });
    const moved =
      centers.length !== centersRef.current.length ||
      centers.some((center, i) => center !== centersRef.current[i]);
    centersRef.current = centers;
    heightsRef.current = heights;
    if (moved) setGeometry((version) => version + 1);
    setHalfHeight(el.clientHeight / 2);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [lines, halfHeight, measure]);

  // Watch the content box, not just the viewport: a narrower window re-wraps
  // every sentence and moves every centre, while the scroller's own height —
  // the only thing the spacer depends on — never changes. Measuring off that
  // alone left the geometry stale and the follow scroll a line or two out.
  useEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [measure]);

  // Follow the voice, unless the reader has taken the sheet over.
  useEffect(() => {
    if (seekIndex !== null || pending !== null) return;
    const el = scrollerRef.current;
    if (!el || activeIndex < 0) return;
    // Nothing to aim at until the lines have been measured: scrolling on the
    // pre-measure pass would just land at zero.
    if (centersRef.current.length !== lines.length) return;
    const top = lyricScrollTopFor(
      centersRef.current,
      heightsRef.current,
      activeIndex,
      el.clientHeight,
    );
    // Glide between neighbouring sentences the way a music player does, but
    // land a long move outright: opening onto the middle of a chapter, or
    // jumping chapters, is thousands of pixels, and animating that is a blur
    // past text nobody is reading. E-ink cannot animate at all — a smooth
    // scroll there is a stutter of full refreshes.
    const distance = Math.abs(top - el.scrollTop);
    // Already parked there — re-issuing the scroll would only re-arm an
    // animation over nothing.
    if (distance < 1) return;
    el.scrollTo?.({ top, behavior: distance > el.clientHeight * 2 || isEink ? 'auto' : 'smooth' });
  }, [activeIndex, seekIndex, pending, isEink, geometry, halfHeight, lines]);

  const clearIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      seekingRef.current = false;
      setSeekIndex(null);
    }, SEEK_IDLE_MS);
  }, []);

  useEffect(() => clearIdleTimer, []);

  // A new chapter is a new set of ordinals. Anything the reader had picked in
  // the old one must go with it: pressing play on a carried-over index would
  // seek to whatever sentence happens to sit there now, and a carried-over
  // commit would spin until its watchdog.
  useEffect(() => {
    seekingRef.current = false;
    clearIdleTimer();
    setSeekIndex(null);
    setPending(null);
    setPage(null);
  }, [lines]);

  // Only a real gesture opens the seek row: the follow effect above scrolls
  // this same element, and that must never read as the reader scrubbing.
  // Movement, not contact — a tap that arms this would turn the next follow
  // scroll into a phantom drag, and the row would raise itself unasked.
  const handleGestureStart = useCallback(() => {
    seekingRef.current = true;
    armIdleTimer();
  }, [armIdleTimer]);

  const handleScroll = useCallback(() => {
    if (!seekingRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const index = lyricIndexAtCenter(centersRef.current, el.scrollTop + el.clientHeight / 2);
    setSeekIndex(index >= 0 ? index : null);
    armIdleTimer();
  }, [armIdleTimer]);

  const handlePlayFrom = () => {
    if (seekIndex === null) return;
    clearIdleTimer();
    seekingRef.current = false;
    const target = seekIndex;
    setPending(target);
    setSeekIndex(null);
    onPlayFrom(target).catch(() => {
      // A dead button under a stuck spinner is the worst outcome here: drop the
      // commit and say why, exactly as the scrubber does.
      setPending(null);
      eventDispatcher.dispatch('toast', { message: _('Failed to seek'), type: 'error' });
    });
  };

  // The commit resolves once that line is both current and audible.
  useEffect(() => {
    if (pending !== null && !buffering && activeIndex === pending) setPending(null);
  }, [pending, buffering, activeIndex]);

  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => setPending(null), COMMIT_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (rowIndex === null) {
      setPage(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void onGetLyricPage(rowIndex).then((next) => {
        if (!cancelled) setPage(next);
      });
    }, PAGE_LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rowIndex, onGetLyricPage]);

  const fadeMask = 'linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)';

  return (
    <div className='relative min-h-24 w-full flex-1 sm:h-56 sm:flex-none'>
      <div
        ref={scrollerRef}
        className='no-scrollbar relative h-full overflow-y-auto overscroll-contain'
        style={isEink ? undefined : { maskImage: fadeMask, WebkitMaskImage: fadeMask }}
        onScroll={handleScroll}
        onTouchMove={handleGestureStart}
        onWheel={handleGestureStart}
      >
        <div ref={contentRef} style={{ paddingTop: halfHeight, paddingBottom: halfHeight }}>
          {lines.map((line, index) => (
            <div
              // Positional within the section; there is no stabler id.
              key={index}
              data-lyric-line
              aria-current={index === activeIndex ? 'true' : undefined}
              className={clsx(
                // The gutters are permanent so the seek row's page label and
                // play button never land on the text, and so raising the row
                // reflows nothing (which would invalidate the measured centres).
                // The transparent border keeps every line the same height on
                // e-ink, where only the current one draws a visible one.
                'mx-auto rounded-xl border border-transparent px-14 py-2 text-center text-sm leading-snug',
                // The line under the seek row is marked by weight alone — the
                // page number and play button already flank it, and a box drawn
                // round a five-row sentence reads as clutter.
                index === activeIndex
                  ? 'text-base-content not-eink:bg-base-200 eink-bordered font-semibold'
                  : index === rowIndex
                    ? 'text-base-content/70'
                    : 'text-base-content/40',
              )}
            >
              {line || ' '}
            </div>
          ))}
        </div>
      </div>
      {rowIndex !== null && (
        // Pinned to the two gutters the lines reserve. No rule joins them: the
        // target line can be four rows tall, and a hairline drawn across the
        // panel would strike through the words it is pointing at — the outline
        // on that line says which one it is instead.
        <div className='pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between'>
          <span className='text-base-content/60 w-14 shrink-0 truncate text-[10px] tabular-nums'>
            {page ? _('Page {{number}}', { number: page.current + 1 }) : ''}
          </span>
          <button
            type='button'
            aria-label={_('Play')}
            onClick={handlePlayFrom}
            disabled={pending !== null}
            className='not-eink:bg-base-300 eink-bordered pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full'
          >
            {pending !== null ? (
              <span className='loading loading-spinner loading-xs' />
            ) : (
              <MdPlayArrow size={iconSize16} />
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default TTSLyricsView;
