import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';
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
import { getPageArea, PageWiper, type PageWiperHost, revealPageWipe } from '../utils/pageWipe';
import { applyPageTurnAttributes } from './useCapturedTurn';

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
  /** A layer over the viewer for the copy of the page being read. */
  wipeCopyRef: React.RefObject<HTMLDivElement | null>;
  /**
   * The live view is on the page a wipe is bringing in, not the page being
   * read: its relocation isn't the reading position yet.
   */
  isWipeAhead: () => boolean;
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
// In paginated mode the page stays still and a line wipes the next page in at
// the same speed, down horizontal lines and across vertical ones (#7575, see
// PageWiper).
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
  const wipeCopyRef = useRef<HTMLDivElement | null>(null);
  const wiperRef = useRef<PageWiper | null>(null);
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
        // The session is over (the store says so): page turns animate as set
        // again. Also after a scrolled session, which held them off when the
        // View menu switched to paginated mode before it stopped.
        const view = viewRef.current;
        const settings = getViewSettings(bookKey);
        if (view && settings) {
          view.renderer.toggleAttribute('animated', !!settings.animated && !settings.isEink);
          applyPageTurnAttributes(view, settings, !!view.isFixedLayout);
        }
      },
    });
  }

  const wipeHostRef = useRef<PageWiperHost | null>(null);
  if (!wipeHostRef.current) {
    wipeHostRef.current = {
      getLayout: () => {
        const host = wipeCopyRef.current;
        const renderer = viewRef.current?.renderer;
        const area = renderer && getPageArea(renderer);
        if (!host || !area) return null;
        const origin = host.getBoundingClientRect();
        const rect = area.getBoundingClientRect();
        const settings = getViewSettings(bookKey);
        return {
          x: rect.left - origin.left,
          y: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
          columns: renderer.columnCount ?? 1,
          rtl: !!settings?.rtl,
          vertical: !!settings?.vertical,
        };
      },
      turn: async (forward) => {
        const renderer = viewRef.current?.renderer;
        if (!renderer?.isConnected || renderer.scrolled) return;
        // The paginator animates only with `animated` set; without it the turn
        // is an instant jump under the copy.
        const animated = renderer.hasAttribute('animated');
        renderer.removeAttribute('animated');
        ownTurnsRef.current++;
        try {
          await (forward ? renderer.next() : renderer.prev());
        } finally {
          ownTurnsRef.current--;
          // Unless a wipe started meanwhile, which turns pages unanimated.
          const wiping = scrollerRef.current?.active && wipeRef.current;
          if (animated && !wiping) renderer.setAttribute('animated', '');
        }
      },
      atEnd: () => !!viewRef.current?.renderer.atEnd,
      reveal: async (turn) => {
        const host = wipeCopyRef.current;
        const renderer = viewRef.current?.renderer;
        return host && renderer ? revealPageWipe(host, renderer, turn) : null;
      },
      drawEdge: (edge) => {
        const line = wipeLineRef.current;
        if (!line) return;
        line.style.display = edge ? '' : 'none';
        if (!edge) return;
        line.dataset['axis'] = edge.vertical ? (edge.rtl ? 'rtl' : 'ltr') : 'h';
        line.style.width = edge.vertical ? '' : `${edge.length}px`;
        line.style.height = edge.vertical ? `${edge.length}px` : '';
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

  const togglePause = () => {
    const scroller = scrollerRef.current!;
    if (!scroller.active) return;
    // A wipe pauses where it is: the next page above the line, the page being
    // read below it.
    if (scroller.paused) scroller.resume();
    else scroller.pause();
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
    // Fixed-layout books keep Auto Scroll scrolled-only.
    const wipeMode = !renderer.scrolled;
    if (wipeMode && view.isFixedLayout) return;
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
    // While the copy of the page being read is up, taps on it land on it, not
    // on the book. A tap pauses or plays, as it does on the book, at its
    // click: a swipe, such as the right-edge speed swipe
    // (useAutoScrollSpeedGesture), makes none.
    const onClick = (event: MouseEvent) => {
      if (!wipeCopyRef.current?.contains(event.target as Node)) return;
      event.stopPropagation();
      togglePause();
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
    view.addEventListener('relocate', onRelocate);
    window.addEventListener('click', onClick, true);
    // No page turn animates during the session, so none plays over the wipe:
    // not the paginator's slide, nor a curl, flip or slide of useCapturedTurn,
    // which leaves an Auto Scroll session's turns alone.
    view.renderer.removeAttribute('animated');
    const settings = getViewSettings(bookKey);
    if (settings) applyPageTurnAttributes(view, settings, false);
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
      window.removeEventListener('click', onClick, true);
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
  const scrolled = !!viewSettings?.scrolled;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller?.active && wipeRef.current === scrolled) scroller.stop();
  }, [scrolled]);

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
    wipeCopyRef,
    isWipeAhead,
    togglePause,
    adjustSpeed,
    setSpeed,
    stop: () => scrollerRef.current?.stop(),
  };
};
