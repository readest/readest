import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { eventDispatcher } from '@/utils/event';
import { resolvePageTurn, normalizeDomKeyEvent, KeyCandidate } from '@/utils/keybinding';
import { refreshEinkScreen } from '@/utils/bridge';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriGetWindowLogicalPosition } from '@/utils/window';
import { getReadingRulerMoveDirection } from '../utils/readingRuler';
import { useTouchInterceptor } from './useTouchInterceptor';

export type ScrollSource = 'touch' | 'mouse';

type PaginationSide = 'left' | 'right' | 'up' | 'down';
type PaginationMode = 'pan' | 'page' | 'section';

const swapLeftRight = (side: PaginationSide) => {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
};

const isPanningView = (view: FoliateView | null, viewSettings: ViewSettings | null | undefined) => {
  if (!view || !viewSettings) return false;
  return (
    view.book.rendition?.layout === 'pre-paginated' &&
    (viewSettings.zoomLevel > 100 || viewSettings.zoomMode !== 'fit-page')
  );
};

const hasHorizontalPanning = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null | undefined,
) => {
  if (!view || !viewSettings) return false;
  return isPanningView(view, viewSettings) && view.isOverflowX();
};

export const hasVerticalPanning = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null | undefined,
) => {
  if (!view || !viewSettings) return false;
  return isPanningView(view, viewSettings) && view.isOverflowY();
};

// In scrolled mode, snap the page-scroll distance to whole lines so the new view
// tiles cleanly: forward, the new view's top aligns to the first line that wasn't
// fully visible (so no already-shown line repeats and lines aren't cut at the top);
// backward, the new view's bottom aligns to the last such line. `distance` is a
// positive scroll amount. Falls back to `distance` if the geometry is unavailable.
const snapScrolledDistanceToLines = (
  view: FoliateView,
  distance: number,
  forward: boolean,
): number => {
  try {
    const visible = view.renderer.getContents().find((c) => {
      const f = c.doc?.defaultView?.frameElement?.getBoundingClientRect();
      return !!f && f.bottom > 1 && f.top < window.innerHeight;
    });
    const frameEl = visible?.doc?.defaultView?.frameElement as HTMLElement | undefined;
    if (!visible || !frameEl) return distance;
    let container: Element | null = frameEl;
    while (container && container.id !== 'container') container = container.parentElement;
    if (!(container instanceof HTMLElement)) return distance;

    const cRect = container.getBoundingClientRect();
    const frameRect = frameEl.getBoundingClientRect();
    const size = cRect.height;
    const scrollTop = container.scrollTop;

    const range = visible.doc.createRange();
    range.selectNodeContents(visible.doc.body);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 2 && r.height > 2);
    if (rects.length < 2) return distance;
    const heights = rects.map((r) => r.height).sort((a, b) => a - b);
    const maxLineHeight = (heights[Math.floor(heights.length / 2)] ?? 0) * 1.8;

    // Line boxes in content (scroll) coordinates, sorted top-to-bottom (skip
    // block/container boxes that are much taller than a line).
    const toContent = (localY: number) => localY + frameRect.top - cRect.top + scrollTop;
    const lines = rects
      .filter((r) => r.height <= maxLineHeight)
      .map((r) => ({ top: toContent(r.top), bottom: toContent(r.bottom) }))
      .sort((a, b) => a.top - b.top);

    let snapped: number;
    if (forward) {
      // First line not fully visible at the bottom -> it becomes the new view's top.
      const bottomEdge = scrollTop + size;
      const next = lines.find((l) => l.bottom > bottomEdge + 1);
      if (!next) return distance;
      snapped = next.top - scrollTop;
    } else {
      // Last line not fully visible at the top -> it becomes the new view's bottom.
      const topEdge = scrollTop;
      let prev: { top: number; bottom: number } | undefined;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.top < topEdge - 1) {
          prev = lines[i]!;
          break;
        }
      }
      if (!prev) return distance;
      snapped = scrollTop + size - prev.bottom;
    }
    // Guard against degenerate snaps; keep within roughly one page.
    return snapped > size * 0.4 && snapped < size * 1.6 ? snapped : distance;
  } catch {
    return distance;
  }
};

export const viewPagination = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null | undefined,
  side: PaginationSide,
  mode: PaginationMode = 'page',
  panDistance: number = 50,
) => {
  if (!view || !viewSettings) return;
  const renderer = view.renderer;
  if (viewSettings.rtl) {
    side = swapLeftRight(side);
  }
  if (renderer.scrolled) {
    // `renderer.size` is already the visible content height: in scrolled mode the
    // scroll container is inset by the header/footer (parent padding), so `size`
    // shrinks when they're shown. Subtracting their heights again here would
    // double-count and make consecutive views overlap.
    const { size } = renderer;
    const scrollingOverlap = viewSettings.scrollingOverlap;
    const distance = size - scrollingOverlap;
    switch (mode) {
      case 'section':
        if (side === 'left' || side === 'up') {
          return view.renderer.prevSection?.();
        } else {
          return view.renderer.nextSection?.();
        }
      case 'pan':
      case 'page':
      default: {
        const forward = !(side === 'left' || side === 'up');
        // Snap so the view's bottom edge lands between lines (not for vertical flow).
        const snapped = viewSettings.vertical
          ? distance
          : snapScrolledDistanceToLines(view, distance, forward);
        return forward ? view.next(snapped) : view.prev(snapped);
      }
    }
  } else if (mode === 'pan' && isPanningView(view, viewSettings)) {
    if (hasHorizontalPanning(view, viewSettings) && (side === 'left' || side === 'right')) {
      return view.pan(side === 'left' ? -panDistance : panDistance, 0);
    } else if (hasVerticalPanning(view, viewSettings) && (side === 'up' || side === 'down')) {
      return view.pan(0, side === 'up' ? -panDistance : panDistance);
    } else {
      return side === 'left' || side === 'up' ? view.prev() : view.next();
    }
  } else {
    switch (mode) {
      case 'section':
        if (side === 'left' || side === 'up') {
          return view.renderer.prevSection?.();
        } else {
          return view.renderer.nextSection?.();
        }
      case 'pan':
      case 'page':
      default:
        return side === 'left' || side === 'up' ? view.prev() : view.next();
    }
  }
};

export const usePagination = (
  bookKey: string,
  viewRef: React.RefObject<FoliateView | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, getViewState } = useReaderStore();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const {
    acquireVolumeKeyInterception,
    releaseVolumeKeyInterception,
    acquirePageTurnerKeyInterception,
    releasePageTurnerKeyInterception,
  } = useDeviceControlStore();
  // Reactive subscription: drives the effect dependency array below. The
  // handlers themselves re-read via getState() to avoid stale closures.
  const hardwarePageTurner = useSettingsStore((s) => s.settings.hardwarePageTurner);
  // While this book's TTS is actively playing, the volume keys must control the
  // system volume instead of flipping pages (#4691). A paused or stopped session
  // hands them back to the page-flip interception. Safe on iOS because the
  // native interception never reconfigures the audio session while native TTS
  // owns it (a .mixWithOthers flip there would vacate the Now Playing slot).
  const [ttsPlaying, setTtsPlaying] = useState(false);
  // handlePageFlip is registered once (see the effect below), so it can't read
  // the ttsPlaying state directly without going stale. This ref mirrors it for
  // the volume-key page-flip guard.
  const ttsPlayingRef = useRef(false);

  const handlePageFlip = async (
    msg: MessageEvent | CustomEvent | React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    const viewState = getViewState(bookKey);
    const bookData = getBookData(bookKey);
    if (!viewState?.inited || !bookData) return;

    const dispatchReadingRulerMove = (side: PaginationSide) => {
      return eventDispatcher.dispatchSync('reading-ruler-move', {
        bookKey,
        direction: getReadingRulerMoveDirection(side, viewRef.current?.book.dir),
      });
    };

    if (msg instanceof MessageEvent) {
      if (msg.data && msg.data.bookKey === bookKey) {
        const viewSettings = getViewSettings(bookKey)!;
        if (msg.data.type === 'iframe-single-click') {
          const viewElement = containerRef.current;
          if (viewElement) {
            const { screenX } = msg.data;
            const viewRect = viewElement.getBoundingClientRect();
            let windowStartX;
            // Currently for tauri APP the window.screenX is always 0
            if (isTauriAppPlatform()) {
              if (appService?.isMobile) {
                windowStartX = 0;
              } else {
                const windowPosition = (await tauriGetWindowLogicalPosition()) as {
                  x: number;
                  y: number;
                };
                windowStartX = windowPosition.x;
              }
            } else {
              windowStartX = window.screenX;
            }
            const viewStartX = windowStartX + viewRect.left;
            const viewCenterX = viewStartX + viewRect.width / 2;
            const consumed = eventDispatcher.dispatchSync('iframe-single-click');
            if (!consumed) {
              const centerStartX = viewStartX + viewRect.width * 0.375;
              const centerEndX = viewStartX + viewRect.width * 0.625;
              if (
                viewSettings.disableClick! ||
                (screenX >= centerStartX && screenX <= centerEndX)
              ) {
                // toggle visibility of the header bar and the footer bar
                setHoveredBookKey(hoveredBookKey ? null : bookKey);
                return;
              }

              if (hoveredBookKey) {
                setHoveredBookKey(null);
                return;
              }

              const side: PaginationSide =
                screenX >= viewCenterX
                  ? viewSettings.fullscreenClickArea
                    ? 'down'
                    : viewSettings.swapClickArea
                      ? 'left'
                      : 'right'
                  : viewSettings.fullscreenClickArea
                    ? 'down'
                    : viewSettings.swapClickArea
                      ? 'right'
                      : 'left';

              if (viewSettings.readingRulerEnabled && dispatchReadingRulerMove(side)) {
                return;
              }

              viewPagination(viewRef.current, viewSettings, side);
            }
          }
        } else if (
          msg.data.type === 'iframe-wheel' &&
          !viewSettings.scrolled &&
          !isPanningView(viewRef.current, viewSettings)
        ) {
          // The wheel event is handled by the iframe itself in scrolled mode.
          const { deltaY, deltaX } = msg.data;
          if (deltaY > 0) {
            viewPagination(viewRef.current, viewSettings, 'down');
          } else if (deltaY < 0) {
            viewPagination(viewRef.current, viewSettings, 'up');
          } else if (deltaX < 0) {
            viewPagination(viewRef.current, viewSettings, 'left');
          } else if (deltaX > 0) {
            viewPagination(viewRef.current, viewSettings, 'right');
          }
        } else if (msg.data.type === 'iframe-mouseup') {
          if (msg.data.button === 3) {
            viewRef.current?.history.back();
          } else if (msg.data.button === 4) {
            viewRef.current?.history.forward();
          }
        }
      }
    } else if (msg instanceof CustomEvent) {
      const viewSettings = getViewSettings(bookKey);
      // While TTS is playing, volume keys control the volume, not pagination.
      // The native layer still forwards the key here (iOS via a lingering KVO,
      // Android calls onNativeKeyDown unconditionally), so guard it here too.
      if (
        msg.type === 'native-key-down' &&
        viewSettings?.volumeKeysToFlip &&
        !ttsPlayingRef.current
      ) {
        const { keyName } = msg.detail;
        setHoveredBookKey('');
        if (keyName === 'VolumeUp') {
          if (viewSettings.readingRulerEnabled && dispatchReadingRulerMove('up')) {
            return;
          }
          viewPagination(viewRef.current, viewSettings, 'up');
        } else if (keyName === 'VolumeDown') {
          if (viewSettings.readingRulerEnabled && dispatchReadingRulerMove('down')) {
            return;
          }
          viewPagination(viewRef.current, viewSettings, 'down');
        }
      }
    } else {
      if (msg.type === 'click') {
        const { clientX } = msg;
        const width = window.innerWidth;
        const leftThreshold = width * 0.5;
        const rightThreshold = width * 0.5;
        const viewSettings = getViewSettings(bookKey);
        if (!viewSettings?.disableClick) {
          if (clientX < leftThreshold) {
            viewPagination(viewRef.current, viewSettings, 'left');
          } else if (clientX > rightThreshold) {
            viewPagination(viewRef.current, viewSettings, 'right');
          }
        }
      }
    }
  };

  // Hardware page turner: media keys arrive via the `native-key-down`
  // event; D-pad / keyboard keys arrive either as a top-window `keydown`
  // or — when focus is inside a book iframe — as an `iframe-keydown`
  // postMessage (mirroring useShortcuts' unified window + iframe handling).
  // All resolve through the shared binding registry. Suppressed while the
  // toolbar is visible so D-pad keys keep driving toolbar spatial navigation.
  const handleHardwarePageTurn = (candidate: KeyCandidate): boolean => {
    const settings = useSettingsStore.getState().settings.hardwarePageTurner;
    if (!settings?.enabled) return false;
    if (useReaderStore.getState().hoveredBookKey) return false;

    // Only the active book (the one driving the sidebar) responds, so a
    // single key press doesn't flip every book open in a parallel view.
    if (useSidebarStore.getState().sideBarBookKey !== bookKey) return false;

    const viewState = getViewState(bookKey);
    if (!viewState?.inited) return false;

    const action = resolvePageTurn(settings, candidate);
    if (!action) return false;

    // E-ink full screen refresh (Android only) — clears ghosting without
    // turning the page. The native bridge no-ops on non-e-ink hardware.
    if (action === 'refresh') {
      if (appService?.isAndroidApp) {
        refreshEinkScreen().catch(() => {});
      }
      return true;
    }

    const viewSettings = getViewSettings(bookKey);
    const side = action === 'pagePrev' || action === 'sectionPrev' ? 'up' : 'down';
    const mode = action === 'sectionPrev' || action === 'sectionNext' ? 'section' : 'page';
    setHoveredBookKey('');
    if (
      mode === 'page' &&
      viewSettings?.readingRulerEnabled &&
      eventDispatcher.dispatchSync('reading-ruler-move', {
        bookKey,
        direction: getReadingRulerMoveDirection(side, viewRef.current?.book.dir),
      })
    ) {
      return true;
    }
    viewPagination(viewRef.current, viewSettings, side, mode);
    return true;
  };

  const handleHardwareNativeKey = (msg: CustomEvent) => {
    const keyName = msg.detail?.keyName;
    if (typeof keyName !== 'string') return;
    handleHardwarePageTurn({ source: 'native', id: keyName });
  };

  const handleHardwareDomKey = (event: KeyboardEvent | MessageEvent) => {
    let candidate: KeyCandidate;
    if (event instanceof KeyboardEvent) {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
        return;
      }
      candidate = normalizeDomKeyEvent(event);
    } else if (event.data?.type === 'iframe-keydown' && event.data.bookKey === bookKey) {
      const id = event.data.code || event.data.key;
      if (typeof id !== 'string' || !id) return;
      candidate = { source: 'dom', id };
    } else {
      return;
    }

    if (handleHardwarePageTurn(candidate)) {
      // Stop `useShortcuts` from also paging on this key — capture-phase
      // for the window keydown, registration order for the iframe message.
      if (event instanceof KeyboardEvent) event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  useEffect(() => {
    if (!appService?.isMobileApp) return;

    eventDispatcher.on('native-key-down', handlePageFlip);
    return () => {
      eventDispatcher.off('native-key-down', handlePageFlip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track this book's TTS playback so volume-key interception can step aside
  // while audio is playing (#4691).
  useEffect(() => {
    const handlePlaybackState = (event: Event) => {
      const detail = (event as CustomEvent).detail as { bookKey?: string; state?: string };
      if (detail?.bookKey !== bookKey) return;
      const playing = detail.state === 'playing';
      ttsPlayingRef.current = playing;
      setTtsPlaying(playing);
    };
    eventDispatcher.on('tts-playback-state', handlePlaybackState);
    return () => {
      eventDispatcher.off('tts-playback-state', handlePlaybackState);
    };
  }, [bookKey]);

  // Volume-key page-flip interception (mobile only). Acquired only while the
  // setting is on and TTS isn't playing; the matching release on re-run/unmount
  // keeps the reference count balanced.
  useEffect(() => {
    if (!appService?.isMobileApp) return;

    const viewSettings = getViewSettings(bookKey);
    if (!viewSettings?.volumeKeysToFlip || ttsPlaying) return;

    acquireVolumeKeyInterception();
    return () => {
      releaseVolumeKeyInterception();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsPlaying]);

  // Hardware page turner: native-key + DOM-key listeners and native
  // media-key interception, re-evaluated whenever the setting changes.
  useEffect(() => {
    const hasNativeBinding =
      hardwarePageTurner?.bindings.pagePrev?.source === 'native' ||
      hardwarePageTurner?.bindings.pageNext?.source === 'native' ||
      hardwarePageTurner?.bindings.sectionPrev?.source === 'native' ||
      hardwarePageTurner?.bindings.sectionNext?.source === 'native' ||
      hardwarePageTurner?.bindings.refresh?.source === 'native';
    const needsNativeInterception =
      !!appService?.isMobileApp && !!hardwarePageTurner?.enabled && hasNativeBinding;

    if (needsNativeInterception) {
      acquirePageTurnerKeyInterception();
    }
    if (hasNativeBinding) {
      eventDispatcher.on('native-key-down', handleHardwareNativeKey);
    }
    window.addEventListener('keydown', handleHardwareDomKey, true);
    window.addEventListener('message', handleHardwareDomKey);

    return () => {
      if (needsNativeInterception) {
        releasePageTurnerKeyInterception();
      }
      if (hasNativeBinding) {
        eventDispatcher.off('native-key-down', handleHardwareNativeKey);
      }
      window.removeEventListener('keydown', handleHardwareDomKey, true);
      window.removeEventListener('message', handleHardwareDomKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hardwarePageTurner?.enabled,
    hardwarePageTurner?.bindings.pagePrev?.source,
    hardwarePageTurner?.bindings.pageNext?.source,
    hardwarePageTurner?.bindings.sectionPrev?.source,
    hardwarePageTurner?.bindings.sectionNext?.source,
    hardwarePageTurner?.bindings.refresh?.source,
  ]);

  // Touch swipe page flip for fixed-layout books — registered as a touch interceptor
  // so it participates in the priority-based consumption chain.
  useTouchInterceptor(
    `swipe-flip-${bookKey}`,
    (bk, detail) => {
      if (bk !== bookKey || detail.phase !== 'end') return false;
      const bookData = getBookData(bookKey);
      const viewSettings = getViewSettings(bookKey);
      if (!bookData?.isFixedLayout || viewSettings?.scrolled) return false;
      if (viewSettings?.disableSwipe) return false;
      if (isPanningView(viewRef.current, viewSettings)) return false;

      const { deltaX, deltaY, deltaT } = detail;
      const vx = Math.abs(deltaX / (deltaT || 1));
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 30 && vx > 0.2) {
        viewPagination(viewRef.current, viewSettings, deltaX > 0 ? 'left' : 'right');
        return true;
      }
      return false;
    },
    0,
  );

  return {
    handlePageFlip,
  };
};
