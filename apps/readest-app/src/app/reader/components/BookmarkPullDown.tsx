import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RiArrowDownLine } from 'react-icons/ri';

import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { setLayeredTurnTouchClaimed } from '@/app/reader/utils/iframeEventHandlers';
import {
  BOOKMARK_PULL_ACTIVATION_PX,
  canPullBookmark,
  computePullOffset,
  isPastPullThreshold,
  previewRibbonFilled,
  pullHintShift,
  pullRibbonHeight,
  setBookmarkPullHandlers,
  shouldActivatePull,
  type BookmarkPullHandlers,
} from '@/app/reader/utils/bookmarkPullGesture';
import Ribbon from './Ribbon';

const SPRING_MS = 250;
const RIBBON_BODY_HEIGHT = 44; // matches Ribbon.tsx: safe-area top + header bar height
const HINT_PIN_INSET = 12;
const HINT_BOTTOM_GAP = 6;

interface BookmarkPullDownProps {
  bookKey: string;
  /** Mirror of the resting ribbon's `hoveredBookKey` suppression in BookCell. */
  ribbonHidden: boolean;
  /** The page-content wrapper this gesture slides down. */
  slideRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Pull-down-to-bookmark (#1359), after the WeRead interaction. Owns all
 * bookmark-ribbon rendering for a book cell: the resting `Ribbon` while idle,
 * and during a pull the slate band, the hint row and the preview ribbon whose
 * fill always shows the state a release would produce.
 *
 * Gesture events arrive through the `bookmarkPullGesture` bridge (capture
 * phase on each section document, registered by `FoliateViewer`). Ownership
 * mirrors `useBrightnessGesture`: one-way arbitration against the paginator,
 * `stopImmediatePropagation` once active, layered-turn claim cleanup on
 * release. The continuous offset is written imperatively (rAF-batched) to the
 * slide wrapper / band / hint / preview so only discrete transitions
 * (activation, threshold) re-render.
 */
const BookmarkPullDown: React.FC<BookmarkPullDownProps> = ({ bookKey, ribbonHidden, slideRef }) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const ribbonVisible = useReaderStore((s) => !!s.viewStates[bookKey]?.ribbonVisible);

  const [pulling, setPulling] = useState(false);
  const [pastThreshold, setPastThreshold] = useState(false);
  // Bookmark state captured at activation. Hint wording and preview fill are
  // derived from it so they stay frozen through the release spring even
  // though the actual toggle (and `ribbonVisible`) flips at touchend.
  const [removeMode, setRemoveMode] = useState(false);

  const bandRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const ribbonBoxRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const polygonRef = useRef<SVGPolygonElement | null>(null);

  // Per-gesture state.
  const armedRef = useRef(false);
  const activeRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const baseOffsetRef = useRef(0);
  const offsetRef = useRef(0);
  const pastRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<number | null>(null);
  const springRafIdRef = useRef<number | null>(null);

  const restHeightRef = useRef(RIBBON_BODY_HEIGHT);
  restHeightRef.current = (safeAreaInsets?.top || 0) + RIBBON_BODY_HEIGHT;
  const pinTopRef = useRef(HINT_PIN_INSET);
  pinTopRef.current = (safeAreaInsets?.top || 0) + HINT_PIN_INSET;

  const applyOffset = useCallback(
    (offset: number) => {
      offsetRef.current = offset;
      const slide = slideRef.current;
      if (slide) slide.style.transform = offset > 0 ? `translate3d(0, ${offset}px, 0)` : '';
      const band = bandRef.current;
      if (band) band.style.height = `${offset}px`;
      const hint = hintRef.current;
      if (hint) {
        const shift = pullHintShift(
          offset - HINT_BOTTOM_GAP,
          hint.offsetHeight || 20,
          pinTopRef.current,
        );
        hint.style.transform = shift ? `translateY(${shift}px)` : '';
      }
      const svg = svgRef.current;
      const polygon = polygonRef.current;
      if (svg && polygon) {
        const rest = restHeightRef.current;
        const width = ribbonBoxRef.current?.clientWidth || 32;
        // The resting ribbon notches at 22% of its height; freeze that depth
        // in px so the notch doesn't stretch into a spike as the tail grows.
        const notch = Math.round(rest * 0.22);
        const height = pullRibbonHeight(offset, rest);
        svg.setAttribute('height', `${height}`);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        polygon.setAttribute(
          'points',
          `${width},${height} ${width / 2},${height - notch} 0,${height} 0,0 ${width},0`,
        );
      }
    },
    [slideRef],
  );

  const cancelMoveRaf = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingOffsetRef.current = null;
  }, []);

  const scheduleOffset = useCallback(
    (offset: number) => {
      pendingOffsetRef.current = offset;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (pendingOffsetRef.current !== null) {
            applyOffset(pendingOffsetRef.current);
            pendingOffsetRef.current = null;
          }
        });
      }
    },
    [applyOffset],
  );

  const resetGesture = useCallback(() => {
    armedRef.current = false;
    activeRef.current = false;
    baseOffsetRef.current = 0;
  }, []);

  const finishPull = useCallback(() => {
    applyOffset(0);
    resetGesture();
    pastRef.current = false;
    setPastThreshold(false);
    setPulling(false);
  }, [applyOffset, resetGesture]);

  const cancelSpring = useCallback(() => {
    if (springRafIdRef.current !== null) {
      cancelAnimationFrame(springRafIdRef.current);
      springRafIdRef.current = null;
    }
  }, []);

  const springBack = useCallback(() => {
    cancelMoveRaf();
    cancelSpring();
    const from = offsetRef.current;
    if (from <= 0) {
      finishPull();
      return;
    }
    let startTs: number | null = null;
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const progress = Math.min(1, (ts - startTs) / SPRING_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      applyOffset(from * (1 - eased));
      if (progress < 1) {
        springRafIdRef.current = requestAnimationFrame(step);
      } else {
        springRafIdRef.current = null;
        finishPull();
      }
    };
    springRafIdRef.current = requestAnimationFrame(step);
  }, [applyOffset, cancelMoveRaf, cancelSpring, finishPull]);

  // The bridge invokes whatever handlers are installed for this bookKey, so
  // the callbacks read all runtime-variable state through refs.
  useEffect(() => {
    const handlers: BookmarkPullHandlers = {
      onTouchStart: (doc, e) => {
        if (e.touches.length !== 1) {
          resetGesture();
          return;
        }
        const t = e.touches[0];
        if (!t) return;
        if (springRafIdRef.current !== null) {
          // Re-grab mid-spring: keep the pull engaged from the current offset.
          cancelSpring();
          startXRef.current = t.screenX;
          startYRef.current = t.screenY;
          baseOffsetRef.current = offsetRef.current;
          armedRef.current = true;
          activeRef.current = true;
          setRemoveMode(!!useReaderStore.getState().viewStates[bookKey]?.ribbonVisible);
          return;
        }
        resetGesture();
        const selection = doc.getSelection?.();
        if (selection && !selection.isCollapsed) return; // don't hijack selection
        const viewSettings = useReaderStore.getState().getViewSettings(bookKey);
        const bookData = useBookDataStore.getState().getBookData(bookKey);
        if (!viewSettings) return;
        if (
          !canPullBookmark({
            scrolled: !!viewSettings.scrolled,
            vertical: !!viewSettings.vertical,
            isEink: !!viewSettings.isEink,
            isFixedLayout: !!bookData?.isFixedLayout,
          })
        ) {
          return;
        }
        // screenX/screenY, not clientX/clientY: in paginated mode the iframe
        // document is many screens wide, so client coordinates are document
        // coordinates; screen coordinates match the app viewport.
        startXRef.current = t.screenX;
        startYRef.current = t.screenY;
        armedRef.current = true;
      },
      onTouchMove: (_doc, e) => {
        if (!armedRef.current) return;
        if (e.touches.length !== 1) {
          if (activeRef.current) springBack();
          resetGesture();
          return;
        }
        const t = e.touches[0];
        if (!t) return;
        const dx = t.screenX - startXRef.current;
        const dy = t.screenY - startYRef.current + baseOffsetRef.current;
        if (!activeRef.current) {
          if (!shouldActivatePull(dx, dy)) {
            // One-way ownership: once the sequence is clearly horizontal (a
            // page turn) or upward, this gesture may not claim it later.
            if (
              (Math.abs(dx) >= BOOKMARK_PULL_ACTIVATION_PX && Math.abs(dx) > Math.abs(dy)) ||
              dy <= -BOOKMARK_PULL_ACTIVATION_PX
            ) {
              resetGesture();
            }
            return;
          }
          const store = useReaderStore.getState();
          if (store.hoveredBookKey) {
            // The toolbars are up: this pull dismisses them; bookmarking
            // stays a reading-surface gesture.
            store.setHoveredBookKey('');
            resetGesture();
            return;
          }
          activeRef.current = true;
          pastRef.current = false;
          setPastThreshold(false);
          setRemoveMode(!!store.viewStates[bookKey]?.ribbonVisible);
          setPulling(true);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        const offset = computePullOffset(dy);
        scheduleOffset(offset);
        const past = isPastPullThreshold(offset);
        if (past !== pastRef.current) {
          pastRef.current = past;
          setPastThreshold(past);
        }
      },
      onTouchEnd: (_doc, e) => {
        if (!activeRef.current) {
          resetGesture();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        // This capture-phase owner prevents the normal iframe touchend
        // forwarder from seeing the release, so clear its per-touch state.
        setLayeredTurnTouchClaimed(bookKey, false);
        if (e.touches.length === 0 && pastRef.current) {
          eventDispatcher.dispatch('toggle-bookmark', { bookKey });
        }
        springBack();
        resetGesture();
      },
      onTouchCancel: () => {
        if (!activeRef.current) {
          resetGesture();
          return;
        }
        setLayeredTurnTouchClaimed(bookKey, false);
        springBack();
        resetGesture();
      },
    };
    setBookmarkPullHandlers(bookKey, handlers);
    return () => setBookmarkPullHandlers(bookKey, null);
  }, [bookKey, cancelSpring, resetGesture, scheduleOffset, springBack]);

  useEffect(() => {
    return () => {
      cancelMoveRaf();
      cancelSpring();
    };
  }, [cancelMoveRaf, cancelSpring]);

  const filled = previewRibbonFilled(removeMode, pastThreshold);
  const hintText = removeMode
    ? pastThreshold
      ? _('Release to remove bookmark')
      : _('Pull down to remove bookmark')
    : pastThreshold
      ? _('Release to add bookmark')
      : _('Pull down to add bookmark');

  return (
    <>
      {!pulling && ribbonVisible && !ribbonHidden && <Ribbon />}
      {pulling && (
        <div className='pointer-events-none absolute inset-0 z-20'>
          <div
            ref={bandRef}
            className='bookmark-pull-band absolute left-0 right-0 top-0 overflow-hidden bg-[#6C717A]'
            style={{ height: 0 }}
          >
            <div
              ref={hintRef}
              className='absolute bottom-1.5 right-12 flex items-center gap-1.5 text-sm text-white/90'
            >
              <RiArrowDownLine
                aria-hidden
                className={clsx('transition-transform duration-200', pastThreshold && 'rotate-180')}
              />
              <span>{hintText}</span>
            </div>
          </div>
          <div
            ref={ribbonBoxRef}
            className='bookmark-pull-ribbon absolute right-0 top-0 flex w-8 justify-center sm:w-6'
          >
            <svg
              ref={svgRef}
              width='100%'
              height='0'
              xmlns='http://www.w3.org/2000/svg'
              style={{ overflow: 'visible' }}
              shapeRendering='geometricPrecision'
            >
              <polygon
                ref={polygonRef}
                fill={filled ? '#F44336' : 'none'}
                stroke={filled ? 'none' : 'rgba(255,255,255,0.9)'}
                strokeWidth={filled ? 0 : 2}
                strokeLinejoin='round'
              />
            </svg>
          </div>
        </div>
      )}
    </>
  );
};

export default BookmarkPullDown;
