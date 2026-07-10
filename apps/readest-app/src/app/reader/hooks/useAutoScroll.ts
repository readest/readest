import { useEffect, useRef, useState } from 'react';
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

// A stalled forward tick must persist this long before the session reacts
// (section hop, or stop at the end of the book) — brief stalls can happen
// while an adjacent section is still loading.
const AUTO_SCROLL_STALL_MS = 800;

export interface AutoScrollState {
  active: boolean;
  paused: boolean;
  speed: number;
  togglePause: () => void;
  adjustSpeed: (dir: 1 | -1) => void;
  stop: () => void;
}

// Auto Scroll reading mode (#4998): teleprompter-style continuous scrolling in
// scrolled mode, toggled via the 'autoscroll-toggle' event (View menu, Shift+A).
// A tap on the page pauses/resumes instead of turning the page or toggling the
// bars; manual wheel/drag input simply composes with the paced scrolling since
// every frame is a relative containerPosition step. Escape or leaving scrolled
// mode stops the session; the session state is never persisted.
export const useAutoScroll = (
  bookKey: string,
  viewRef: React.RefObject<FoliateView | null>,
): AutoScrollState => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setAutoScrollEnabled } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(viewSettings?.autoScrollSpeed ?? 100);

  // Undoes the per-session window listeners; set on start.
  const sessionCleanupRef = useRef<(() => void) | null>(null);
  const stallStartRef = useRef<number | null>(null);

  const scrollerRef = useRef<PacedScroller | null>(null);
  if (!scrollerRef.current) {
    scrollerRef.current = new PacedScroller({
      scrollBy: (delta) => {
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
      onStop: () => {
        setActive(false);
        setPaused(false);
        setAutoScrollEnabled(bookKey, false);
        sessionCleanupRef.current?.();
        sessionCleanupRef.current = null;
      },
    });
  }

  const togglePause = () => {
    const scroller = scrollerRef.current!;
    if (!scroller.active) return;
    if (scroller.paused) scroller.resume();
    else scroller.pause();
    setPaused(scroller.paused);
  };

  const adjustSpeed = (dir: 1 | -1) => {
    const current = getViewSettings(bookKey)?.autoScrollSpeed ?? speed;
    const next = Math.min(
      MAX_AUTO_SCROLL_SPEED,
      Math.max(MIN_AUTO_SCROLL_SPEED, current + dir * AUTO_SCROLL_SPEED_STEP),
    );
    setSpeed(next);
    scrollerRef.current!.setVelocity((AUTO_SCROLL_BASE_PX_PER_SEC * next) / 100);
    saveViewSettings(envConfig, bookKey, 'autoScrollSpeed', next, false, false);
  };

  const startSession = () => {
    const scroller = scrollerRef.current!;
    const renderer = viewRef.current?.renderer;
    if (!renderer?.scrolled) return;
    const speedNow = getViewSettings(bookKey)?.autoScrollSpeed ?? 100;
    setSpeed(speedNow);
    stallStartRef.current = null;
    scroller.start((AUTO_SCROLL_BASE_PX_PER_SEC * speedNow) / 100);
    setActive(true);
    setPaused(false);
    setAutoScrollEnabled(bookKey, true);

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') scroller.stop();
    };
    window.addEventListener('keydown', onKeydown, true);
    sessionCleanupRef.current = () => {
      window.removeEventListener('keydown', onKeydown, true);
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

  // Auto Scroll only exists in scrolled mode; leaving it ends the session.
  const scrolled = !!viewSettings?.scrolled;
  useEffect(() => {
    if (!scrolled) scrollerRef.current?.stop();
  }, [scrolled]);

  useEffect(() => {
    return () => scrollerRef.current?.stop();
  }, []);

  return {
    active,
    paused,
    speed,
    togglePause,
    adjustSpeed,
    stop: () => scrollerRef.current?.stop(),
  };
};
