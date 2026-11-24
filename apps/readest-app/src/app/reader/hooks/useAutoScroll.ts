import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { saveViewSettings } from '@/helpers/settings';
import {
  AUTO_SCROLL_BASE_PX_PER_SEC,
  AUTO_SCROLL_SPEED_STEP,
  MAX_AUTO_SCROLL_SPEED,
  MIN_AUTO_SCROLL_SPEED,
} from '@/services/constants';
import { PacedScroller } from '../utils/autoscroller';
import {
  AUTO_SCROLL_GESTURE_EDGE_RATIO,
  isInRightEdge,
  shouldActivate,
} from '../utils/autoScrollSpeedGesture';
import { hasReaderOverlay, subscribeReaderOverlays } from '../utils/readerOverlay';
import {
  isPageWipeRevealBusy,
  PageWiper,
  type PageWiperHost,
  revealPageWipe,
  supportsPageWipeReveal,
} from '../utils/pageWipe';

// A stalled forward tick must persist this long before the session reacts
// (section hop, or stop at the end of the book) — brief stalls can happen
// while an adjacent section is still loading.
const AUTO_SCROLL_STALL_MS = 800;

export interface AutoScrollState {
  active: boolean;
  paused: boolean;
  speed: number;
  /** The session wipes pages in (paginated mode) instead of scrolling. */
  wipe: boolean;
  /** The line a page wipe draws. */
  wipeLineRef: React.RefObject<HTMLDivElement | null>;
  /**
   * The live view is on the page a wipe is bringing in, not the page being
   * read: its relocation isn't the reading position yet.
   */
  isWipeAhead: () => boolean;
  /** This book's wipe holds the document's snapshot (see revealPageWipe). */
  isWipeCovering: () => boolean;
  togglePause: () => void;
  adjustSpeed: (dir: 1 | -1) => void;
  setSpeed: (value: number, persist?: boolean) => void;
  stop: () => void;
}

// Auto Scroll reading mode (#4998): teleprompter-style continuous scrolling in
// scrolled mode, toggled via the 'autoscroll-toggle' event (View menu, Shift+A).
// A tap on the page pauses/resumes instead of turning the page or toggling the
// bars; manual wheel/drag input simply composes with the paced scrolling since
// every frame is a relative containerPosition step. Escape or switching
// between scrolled and paginated mode stops the session.
//
// In paginated mode the page stays still and a line wipes the next page in
// from the top at the same speed (#7575, see PageWiper).
//
// Whether a session is engaged is remembered per book (#5631): a book closed
// mid-session reopens scrolling, so readers who use the mode all the time don't
// re-toggle it after every app suspend. Only an explicit stop clears it.
//
// `commitRelocateRef` commits the relocation held back while a wipe was ahead
// (see isWipeAhead), once the page is wiped in.
export const useAutoScroll = (
  bookKey: string,
  viewRef: React.RefObject<FoliateView | null>,
  commitRelocateRef?: React.RefObject<(() => void) | null>,
): AutoScrollState => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, getViewState, setAutoScrollEnabled } = useReaderStore();
  const inited = useReaderStore((state) => state.viewStates[bookKey]?.inited);
  const viewSettings = getViewSettings(bookKey);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeedState] = useState(viewSettings?.autoScrollSpeed ?? 100);
  const [wipe, setWipe] = useState(false);
  // The session's mode, for the scroller callbacks created once below.
  const wipeRef = useRef(false);
  const wipeLineRef = useRef<HTMLDivElement | null>(null);
  const wiperRef = useRef<PageWiper | null>(null);
  const overlayOpenRef = useRef(false);
  // Page turns of the wipe itself, so its relocations aren't taken for the
  // reader navigating away.
  const ownTurnsRef = useRef(0);
  const lastCfiRef = useRef<string | undefined>(undefined);
  // The view's own page turns, before a session routes them through its wipe.
  const viewTurnsRef = useRef<Pick<FoliateView, 'next' | 'prev'> & { view: FoliateView }>(null);

  // Undoes the per-session window listeners; set on start.
  const sessionCleanupRef = useRef<(() => void) | null>(null);
  const stallStartRef = useRef<number | null>(null);
  // Closing the book tears the session down through the same stop() path an
  // explicit stop takes — but it must leave the resume flag alone, since a
  // session that was still running at close is exactly what reopening resumes.
  const closingRef = useRef(false);

  const scrollerRef = useRef<PacedScroller | null>(null);
  if (!scrollerRef.current) {
    scrollerRef.current = new PacedScroller({
      scrollBy: (delta) => {
        if (wipeRef.current) {
          wiperRef.current?.advance(delta);
          return;
        }
        const view = viewRef.current;
        const renderer = view?.renderer;
        if (!renderer) return;
        // Vertical-writing books scroll along the horizontal axis in scrolled
        // mode, where reading forward means going more negative (foliate
        // paginator negates scrolled-mode offsets for vertical writing).
        const sign = renderer.scrollProp === 'scrollLeft' ? -1 : 1;
        const before = renderer.containerPosition;
        renderer.containerPosition = before + sign * delta;
        if (renderer.containerPosition === before) {
          // Clamped by the scroll bounds: at the end of the rendered content.
          const now = Date.now();
          if (stallStartRef.current === null) {
            stallStartRef.current = now;
          } else if (now - stallStartRef.current >= AUTO_SCROLL_STALL_MS) {
            stallStartRef.current = now;
            if (renderer.atEnd) {
              scrollerRef.current?.stop();
              eventDispatcher.dispatch('toast', { message: _('End of book'), type: 'info' });
            } else {
              // Single-section scroll mode parks at the section end; hop to
              // the next section and keep going.
              view?.next();
            }
          }
        } else {
          stallStartRef.current = null;
        }
      },
      // Whole pixels are all a scroll offset can express, so the remainder is
      // rendered as a sub-pixel transform on the scrollport. Without it a slow
      // session visibly steps: at the minimum speed of 5px/s the page jumps a
      // whole pixel every 200ms instead of gliding.
      onSubpixel: (offset) => {
        if (wipeRef.current) {
          wiperRef.current?.render(offset);
          return;
        }
        const renderer = viewRef.current?.renderer;
        if (!renderer) return;
        const sign = renderer.scrollProp === 'scrollLeft' ? -1 : 1;
        renderer.subpixelOffset = sign * offset;
      },
      onStop: () => {
        // The wiper is kept: until its turn back lands, isWipeAhead holds the
        // page it brought in back from the reading position, also on close.
        void wiperRef.current?.stop();
        setActive(false);
        setPaused(false);
        setAutoScrollEnabled(bookKey, false);
        if (!closingRef.current) {
          saveViewSettings(envConfig, bookKey, 'autoScrollRunning', false, true, false);
        }
        sessionCleanupRef.current?.();
        sessionCleanupRef.current = null;
      },
    });
  }

  const wipeHostRef = useRef<PageWiperHost | null>(null);
  if (!wipeHostRef.current) {
    const getCell = () => document.getElementById(`gridcell-${bookKey}`);
    wipeHostRef.current = {
      getLayout: () => {
        const cell = getCell();
        const renderer = viewRef.current?.renderer;
        if (!cell || !renderer) return null;
        return {
          width: cell.clientWidth,
          height: cell.clientHeight,
          columns: renderer.columnCount ?? 1,
          rtl: !!getViewSettings(bookKey)?.rtl,
        };
      },
      turn: async (forward) => {
        const renderer = viewRef.current?.renderer;
        if (!renderer?.isConnected || renderer.scrolled) return;
        // The paginator animates only with `animated` set; without it the turn
        // is an instant jump under the snapshot.
        const animated = renderer.hasAttribute('animated');
        renderer.removeAttribute('animated');
        ownTurnsRef.current++;
        try {
          await (forward ? renderer.next() : renderer.prev());
        } finally {
          ownTurnsRef.current--;
          if (animated) renderer.setAttribute('animated', '');
        }
      },
      atEnd: () => !!viewRef.current?.renderer.atEnd,
      // The snapshot is painted above the whole document, so a menu, dialog,
      // overlaid sidebar or the header and footer bars would vanish under it.
      // And while it is up every click lands on <html>, so the session's own
      // controls hold it off while they are on screen.
      canReveal: () => {
        const sidebar = useSidebarStore.getState();
        const notebook = useNotebookStore.getState();
        const cell = getCell();
        return (
          supportsPageWipeReveal() &&
          !!cell &&
          !isPageWipeRevealBusy(cell) &&
          !cell.querySelector('[data-page-wipe-above][data-visible]') &&
          !overlayOpenRef.current &&
          !useSettingsStore.getState().isSettingsDialogOpen &&
          useReaderStore.getState().hoveredBookKey !== bookKey &&
          !(sidebar.isSideBarVisible && !sidebar.isSideBarPinned) &&
          !(notebook.isNotebookVisible && !notebook.isNotebookPinned)
        );
      },
      reveal: async (turn) => {
        const cell = getCell();
        if (!cell) return null;
        const doc = viewRef.current?.renderer.getContents()[0]?.doc;
        const background = doc?.documentElement
          ? doc.defaultView
              ?.getComputedStyle(doc.documentElement)
              .getPropertyValue('--theme-bg-color')
              .trim()
          : '';
        return revealPageWipe(cell, turn, background || 'Canvas');
      },
      drawEdge: (edge) => {
        const line = wipeLineRef.current;
        if (!line) return;
        line.style.display = edge ? '' : 'none';
        if (!edge) return;
        line.style.width = `${edge.width}px`;
        line.style.transform = `translate(${edge.x}px, ${edge.y}px)`;
      },
      onEnd: () => {
        scrollerRef.current?.stop();
        eventDispatcher.dispatch('toast', { message: _('End of book'), type: 'info' });
      },
      onCommit: () => commitRelocateRef?.current?.(),
    };
  }

  const isWipeAhead = useCallback(() => !!wiperRef.current?.ahead, []);
  const isWipeCovering = useCallback(() => !!wiperRef.current?.covering, []);

  const togglePause = () => {
    const scroller = scrollerRef.current!;
    if (!scroller.active) return;
    if (scroller.paused) {
      scroller.resume();
    } else {
      scroller.pause();
      void wiperRef.current?.suspend();
    }
    setPaused(scroller.paused);
  };

  // Commit a speed (percent). `persist` off skips the settings write, for the
  // per-frame updates of a continuous drag; the release persists once.
  const setSpeed = (value: number, persist = true) => {
    const next = Math.min(
      MAX_AUTO_SCROLL_SPEED,
      Math.max(MIN_AUTO_SCROLL_SPEED, Math.round(value)),
    );
    setSpeedState(next);
    scrollerRef.current!.setVelocity((AUTO_SCROLL_BASE_PX_PER_SEC * next) / 100);
    if (persist) saveViewSettings(envConfig, bookKey, 'autoScrollSpeed', next, false, false);
  };

  const adjustSpeed = (dir: 1 | -1) => {
    const current = getViewSettings(bookKey)?.autoScrollSpeed ?? speed;
    setSpeed(current + dir * AUTO_SCROLL_SPEED_STEP);
  };

  const startSession = () => {
    const scroller = scrollerRef.current!;
    const view = viewRef.current;
    const renderer = view?.renderer;
    if (!view || !renderer) return;
    // The wipe runs down horizontal lines, so vertical and fixed-layout books
    // keep Auto Scroll scrolled-only.
    const wipeMode = !renderer.scrolled;
    if (wipeMode && (view.isFixedLayout || getViewSettings(bookKey)?.vertical)) return;
    wipeRef.current = wipeMode;
    setWipe(wipeMode);
    const speedNow = getViewSettings(bookKey)?.autoScrollSpeed ?? 100;
    setSpeedState(speedNow);
    stallStartRef.current = null;
    scroller.start((AUTO_SCROLL_BASE_PX_PER_SEC * speedNow) / 100);
    setActive(true);
    setPaused(false);
    setAutoScrollEnabled(bookKey, true);
    saveViewSettings(envConfig, bookKey, 'autoScrollRunning', true, true, false);

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') scroller.stop();
    };
    window.addEventListener('keydown', onKeydown, true);
    const cleanups = [() => window.removeEventListener('keydown', onKeydown, true)];
    if (wipeMode) cleanups.push(startWipe(view));
    sessionCleanupRef.current = () => cleanups.forEach((cleanup) => cleanup());
  };

  const startWipe = (view: FoliateView) => {
    // A stopped session may still be turning back: the new one waits for it.
    const wiper = new PageWiper(wipeHostRef.current!, wiperRef.current ?? undefined);
    wiperRef.current = wiper;
    lastCfiRef.current = view.lastLocation?.cfi;
    // Navigating elsewhere (a key, a swipe, the TOC, a re-layout) starts the
    // next wipe at the top of the page it lands on.
    const onRelocate = (event: Event) => {
      const cfi = (event as CustomEvent<{ cfi?: string }>).detail?.cfi;
      const moved = ownTurnsRef.current === 0 && cfi !== lastCfiRef.current;
      lastCfiRef.current = cfi;
      if (moved) wiper.reset();
    };
    // A hidden document drops the snapshot; put the page being read back.
    const onVisibilityChange = () => {
      if (document.hidden) void wiper.suspend();
    };
    // While the snapshot is up the transition sends every press to <html>,
    // not the page or a control. A press pauses, as a tap does otherwise.
    // That includes the moment the snapshot is being put away: on desktop the
    // move before a click shows the controls, which starts it.
    // A touch on the right edge may be the speed swipe (useAutoScrollSpeedGesture
    // also listens for it on the document), so only a tap there pauses.
    let edgeTouch: { id: number; x: number; y: number; moved: boolean } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      const scroller = scrollerRef.current!;
      if (event.target !== document.documentElement || !wiper.covering || scroller.paused) return;
      const { pointerId: id, clientX: x, clientY: y } = event;
      // The swipe's zone ends before iPhone Duo's status strip (#6307).
      const { isIPhoneDuo, safeAreaInsets } = useThemeStore.getState();
      const inset = isIPhoneDuo ? safeAreaInsets?.right || 0 : 0;
      if (
        event.pointerType === 'touch' &&
        isInRightEdge(x, window.innerWidth, AUTO_SCROLL_GESTURE_EDGE_RATIO, inset)
      ) {
        edgeTouch = { id, x, y, moved: false };
        return;
      }
      togglePause();
    };
    // Once the swipe has moved far enough to take over, it stays a swipe.
    const onPointerMove = (event: PointerEvent) => {
      const touch = edgeTouch;
      if (touch?.id !== event.pointerId) return;
      touch.moved ||= shouldActivate(event.clientX - touch.x, event.clientY - touch.y);
    };
    const onPointerUp = (event: PointerEvent) => {
      const touch = edgeTouch;
      if (touch?.id !== event.pointerId) return;
      onPointerMove(event);
      edgeTouch = null;
      if (!touch.moved && !scrollerRef.current!.paused) togglePause();
    };
    // Manual turns (keys, buttons, page-turner remotes) go through view.next
    // and view.prev; the wipe turns the renderer itself (see yieldTo).
    if (viewTurnsRef.current?.view !== view) {
      viewTurnsRef.current = { view, next: view.next, prev: view.prev };
    }
    const { next, prev } = viewTurnsRef.current;
    const wipeNext = (distance?: number) => wiper.yieldTo(() => next.call(view, distance));
    const wipePrev = (distance?: number) => wiper.yieldTo(() => prev.call(view, distance));
    Object.assign(view, { next: wipeNext, prev: wipePrev });
    overlayOpenRef.current = hasReaderOverlay();
    const unsubscribeOverlays = subscribeReaderOverlays(() => {
      overlayOpenRef.current = hasReaderOverlay();
    });
    view.addEventListener('relocate', onRelocate);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    return () => {
      // Page turns keep waiting behind the stop's turn back and any turn
      // queued after it, unless a new session has taken the view over.
      const restoreWhenIdle = () => {
        const tail = wiper.idle;
        void tail.then(() => {
          if (wiper.idle !== tail) return restoreWhenIdle();
          if (view.next === wipeNext) Object.assign(view, { next, prev });
        });
      };
      restoreWhenIdle();
      view.removeEventListener('relocate', onRelocate);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      unsubscribeOverlays();
    };
  };

  useEffect(() => {
    const scroller = scrollerRef.current!;
    const onToggle = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      if (scroller.active) scroller.stop();
      else startSession();
    };
    // Escape typed inside the book iframe arrives as a forwarded message.
    const onMessage = (msg: MessageEvent) => {
      if (msg.data?.type === 'iframe-keydown' && msg.data.key === 'Escape') scroller.stop();
    };
    // A tap on the page pauses/resumes the session; consuming the click keeps
    // it from also turning the page or toggling the header/footer bars.
    const onSingleClick = () => {
      if (!scroller.active) return false;
      togglePause();
      return true;
    };
    eventDispatcher.on('autoscroll-toggle', onToggle);
    eventDispatcher.onSync('iframe-single-click', onSingleClick);
    window.addEventListener('message', onMessage);
    return () => {
      eventDispatcher.off('autoscroll-toggle', onToggle);
      eventDispatcher.offSync('iframe-single-click', onSingleClick);
      window.removeEventListener('message', onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Scrolled and paginated mode run different sessions; switching ends it.
  // A wipe also ends on a vertical chapter, as it runs down horizontal lines.
  const scrolled = !!viewSettings?.scrolled;
  const vertical = !!viewSettings?.vertical;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller?.active) return;
    if (wipeRef.current === scrolled || (wipeRef.current && vertical)) scroller.stop();
  }, [scrolled, vertical]);

  // Resume the session the book was closed in (#5631). Waits for the view to
  // be inited: the renderer is in the store before init, but has no laid-out
  // content to scroll until then. A deep-link landing (?cfi=, library search
  // hit) is skipped — scrolling it unprompted would promote the preview into
  // the reading position the user never navigated to.
  useEffect(() => {
    if (!inited) return;
    if (getViewState(bookKey)?.previewMode) return;
    if (!getViewSettings(bookKey)?.autoScrollRunning) return;
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inited]);

  useEffect(() => {
    // Re-armed on every mount: StrictMode tears the effect down and sets this
    // up again, and a latched flag would suppress every later stop's write.
    closingRef.current = false;
    return () => {
      closingRef.current = true;
      scrollerRef.current?.stop();
    };
  }, []);

  return {
    active,
    paused,
    speed,
    wipe,
    wipeLineRef,
    isWipeAhead,
    isWipeCovering,
    togglePause,
    adjustSpeed,
    setSpeed,
    stop: () => scrollerRef.current?.stop(),
  };
};
