import { useEffect, useRef } from 'react';
import { FoliateView } from '@/types/view';
import { NativeTouchEventType } from '@/types/system';
import { eventDispatcher } from '@/utils/event';

interface RendererInputListenersOptions {
  /** Fired on every renderer `scroll` event (the long-lived paginator). */
  onRendererScroll: () => void;
  /** Fired on each Android `native-touch` event; ignored when not on Android. */
  onNativeTouch?: (ev: NativeTouchEventType) => void;
  /** Whether to wire the Android native-touch bridge for this view. */
  enableNativeTouch: boolean;
  /** Starts the native touch-event bridge (safe to call once per view). */
  listenToNativeTouchEvents: () => void;
}

/**
 * Registers the input listeners that must live as long as the book view does —
 * the renderer `scroll` listener and (on Android) the global `native-touch`
 * dispatcher listener — exactly ONCE per view, with cleanup.
 *
 * These used to be attached inside the foliate `load` handler (the annotator's
 * `onLoad`), which runs on every section load — including foliate's *preloaded*
 * neighbour sections. Both the renderer and the global eventDispatcher outlive
 * individual sections, so those listeners accumulated without bound: every
 * chapter transition added more, and each renderer `scroll` (fired on every
 * paragraph-mode `goTo`) then ran all of them. Reading a long book — especially
 * in paragraph mode on Android, where the scroll/native-touch handlers do real
 * work — degraded steadily until the app was restarted.
 *
 * The handlers are read through refs, so a re-render never re-subscribes; the
 * effect re-runs only when the view (or the Android gate) changes.
 */
export const useRendererInputListeners = (
  view: FoliateView | null,
  {
    onRendererScroll,
    onNativeTouch,
    enableNativeTouch,
    listenToNativeTouchEvents,
  }: RendererInputListenersOptions,
) => {
  const onRendererScrollRef = useRef(onRendererScroll);
  onRendererScrollRef.current = onRendererScroll;
  const onNativeTouchRef = useRef(onNativeTouch);
  onNativeTouchRef.current = onNativeTouch;

  useEffect(() => {
    const renderer = view?.renderer;
    if (!renderer) return;

    const handleScroll = () => onRendererScrollRef.current();
    renderer.addEventListener('scroll', handleScroll);

    let offNativeTouch: (() => void) | undefined;
    if (enableNativeTouch) {
      listenToNativeTouchEvents();
      const handleNativeTouch = (event: CustomEvent) =>
        onNativeTouchRef.current?.(event.detail as NativeTouchEventType);
      eventDispatcher.on('native-touch', handleNativeTouch);
      offNativeTouch = () => eventDispatcher.off('native-touch', handleNativeTouch);
    }

    return () => {
      renderer.removeEventListener('scroll', handleScroll);
      offNativeTouch?.();
    };
    // `listenToNativeTouchEvents` is a stable store action and the handlers are
    // routed through refs, so the effect only depends on the view + the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, enableNativeTouch]);
};
