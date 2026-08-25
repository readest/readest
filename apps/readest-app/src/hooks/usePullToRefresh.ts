import { useEffect } from 'react';
import { getOSPlatform } from '@/utils/misc';

const TRIGGER_THRESHOLD_STAGE1 = 120;
const TRIGGER_THRESHOLD_STAGE2 = 400;
const MAX_LOADING_POSITION = 80;
const PARALLAX_EFFECT = 0.3;
// Rubber-band resistance: the content follows the finger at k of its speed at
// first and saturates at MAX px, so a pull feels like a stiff overscroll
// rather than dragging the shelf (34px at the 120px trigger, 74px at 400px).
const DAMPING_MAX = 96;
const DAMPING_K = 0.35;
const SNAP_BACK_TRANSITION = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

function createApprFunction(MAX: number, k: number) {
  return (x: number) => MAX * (1 - Math.exp((-k * x) / MAX));
}

function getWrappers(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('.transform-wrapper'));
}

export const usePullToRefresh = (
  ref: React.RefObject<HTMLDivElement | null>,
  onTriggerStage1: () => Promise<void> | void,
  onTriggerStage2?: () => Promise<void> | void,
) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const appr = createApprFunction(DAMPING_MAX, DAMPING_K);
    let isLoading = false;

    // The scroller keeps its native overscroll (#5148). iOS WKWebView bounces
    // a nested scroller natively, so there the rubber-band carries the content
    // and the hook only drives the spinner and the trigger. Chromium never
    // draws an overscroll effect for a nested scroller (and the Android
    // WebView draws none for a document that does not scroll), so elsewhere
    // the hook translates the content itself, at both edges.
    const nativeBounce = getOSPlatform() === 'ios';

    el.addEventListener('touchstart', handleTouchStart, { passive: true });

    function handleTouchStart(startEvent: TouchEvent) {
      const el = ref.current;
      if (!el) return;

      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
      if (!atTop && !atBottom) return;
      const canBottomBounce = atBottom && !nativeBounce;
      let bottomPull = false;

      const initialX = startEvent.touches[0]!.clientX;
      const initialY = startEvent.touches[0]!.clientY;

      el.addEventListener('touchmove', handleTouchMove, { passive: true });
      el.addEventListener('touchend', handleTouchEnd);
      el.addEventListener('touchcancel', handleTouchCancel);

      function detachGesture() {
        el!.removeEventListener('touchmove', handleTouchMove);
        el!.removeEventListener('touchend', handleTouchEnd);
        el!.removeEventListener('touchcancel', handleTouchCancel);
      }

      // The browser can cancel a touch (a system gesture, a native scroll
      // takeover), and touchend never fires then: snap back and let go of
      // the gesture without refreshing.
      function handleTouchCancel() {
        detachGesture();
        hideLoadingSpinner(el!.parentNode as HTMLDivElement);
        for (const wrapper of nativeBounce ? [] : getWrappers(el!)) {
          wrapper.style.transition = SNAP_BACK_TRANSITION;
          wrapper.style.transform = 'translateY(0)';
        }
      }

      function handleTouchMove(moveEvent: TouchEvent) {
        const el = ref.current;
        if (!el) return;
        if (isLoading) return;

        const currentX = moveEvent.touches[0]!.clientX;
        const currentY = moveEvent.touches[0]!.clientY;
        const dx = currentX - initialX;
        const dy = currentY - initialY;
        if (Math.abs(dx) * 2 > Math.abs(dy)) return;

        // Re-check the edge on every move: a virtualized list can grow under
        // the finger (a programmatic jump lands before the rows below are
        // measured), and once it can scroll again the drag must scroll it.
        const stillAtBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
        if (dy < 0 && canBottomBounce && stillAtBottom) {
          bottomPull = true;
          for (const wrapper of getWrappers(el)) {
            wrapper.style.transform = `translate3d(0, ${-appr(-dy)}px, 0)`;
          }
          return;
        }
        if (bottomPull) {
          // Dragged back past the starting point, or the scroller can scroll
          // again: hand the gesture back to native scrolling.
          bottomPull = false;
          for (const wrapper of getWrappers(el)) {
            wrapper.style.transform = '';
          }
        }
        if (dy < 0) return;
        if (!atTop) return;

        const transformValue = appr(dy);

        const parentEl = el.parentNode as HTMLDivElement;
        if (dy > 10) {
          const opacity = Math.min(1, 0.3 + (dy / TRIGGER_THRESHOLD_STAGE2) * 0.7);
          showLoadingSpinner(parentEl, transformValue, opacity);
        } else {
          hideLoadingSpinner(parentEl);
        }

        // Update loading spinner position and opacity with parallax if it exists
        updateLoadingSpinnerPosition(parentEl, transformValue, dy);

        // The scroller can hold several transform targets (e.g. the recently
        // read shelf in the Virtuoso Header plus the book list) — drag them
        // all in lockstep so the whole shelf follows the pull.
        if (!nativeBounce) {
          for (const wrapper of getWrappers(el)) {
            wrapper.style.transform = `translate3d(0, ${transformValue}px, 0)`;
          }
        }
      }

      function showLoadingSpinner(el: HTMLDivElement, transform: number, opacity: number = 1) {
        const existing = el.querySelector('.pull-refresh-loading');
        if (existing) return;

        const headerbar = document.querySelector('.titlebar');
        const loadingSpinner = document.createElement('div');
        const headerBottom = headerbar?.getBoundingClientRect().bottom || 0;
        const parallaxOffset = transform * PARALLAX_EFFECT;
        loadingSpinner.style.top = `${headerBottom + parallaxOffset}px`;
        loadingSpinner.style.transition = 'opacity 0.15s ease-out';
        loadingSpinner.style.opacity = opacity.toString();
        loadingSpinner.className = 'pull-refresh-loading';
        loadingSpinner.innerHTML = `<span class="loading loading-infinity loading-lg"></span>`;
        el.appendChild(loadingSpinner);
      }

      function updateLoadingSpinnerPosition(el: HTMLDivElement, transform: number, dy: number) {
        const loadingSpinner = el.querySelector('.pull-refresh-loading') as HTMLElement;
        if (!loadingSpinner) return;

        const headerbar = document.querySelector('.titlebar');
        const headerBottom = headerbar?.getBoundingClientRect().bottom || 0;
        const parallaxOffset = transform * PARALLAX_EFFECT;
        const opacity = Math.min(1, 0.2 + (dy / TRIGGER_THRESHOLD_STAGE2) * 0.8);
        loadingSpinner.style.top = `${headerBottom + parallaxOffset}px`;
        loadingSpinner.style.opacity = opacity.toString();
      }

      function hideLoadingSpinner(el: HTMLDivElement) {
        const loadingSpinner = el.querySelector('.pull-refresh-loading');
        if (loadingSpinner) {
          loadingSpinner.remove();
        }
      }

      async function handleTouchEnd(endEvent: TouchEvent) {
        const el = ref.current;
        if (!el) return;

        const wrappers = nativeBounce ? [] : getWrappers(el);
        const parentEl = el.parentNode as HTMLDivElement;

        const y = endEvent.changedTouches[0]!.clientY;
        const dy = y - initialY;

        detachGesture();
        if (!atTop && !bottomPull) return;

        const isStage2 = onTriggerStage2 && dy > TRIGGER_THRESHOLD_STAGE2;
        const isStage1 = dy > TRIGGER_THRESHOLD_STAGE1;

        if (isStage2 || isStage1) {
          isLoading = true;

          // Calculate current transform value with damping
          const transformValue = appr(dy);
          const targetPosition = Math.min(transformValue, MAX_LOADING_POSITION);

          for (const wrapper of wrappers) {
            wrapper.style.transition = 'transform 0.2s ease-out';
            wrapper.style.transform = `translateY(${targetPosition}px)`;
          }

          const loadingSpinner = parentEl.querySelector('.pull-refresh-loading') as HTMLElement;
          if (loadingSpinner) {
            const headerbar = document.querySelector('.titlebar');
            const headerBottom = headerbar?.getBoundingClientRect().bottom || 0;
            const parallaxOffset = targetPosition * PARALLAX_EFFECT;
            loadingSpinner.style.transition = 'top 0.2s ease-out';
            loadingSpinner.style.top = `${headerBottom + parallaxOffset}px`;
            loadingSpinner.style.opacity = '1';

            // Remove transition after snap animation completes for smooth touch tracking
            setTimeout(() => {
              if (loadingSpinner) {
                loadingSpinner.style.transition = 'opacity 0.15s ease-out';
              }
            }, 200);
          }

          // Add touch listeners during loading to detect pull up and update parallax
          let loadingTouchStartY = 0;
          const handleLoadingTouchStart = (e: TouchEvent) => {
            loadingTouchStartY = e.touches[0]!.clientY;
          };
          const handleLoadingTouchMove = (e: TouchEvent) => {
            const currentY = e.touches[0]!.clientY;
            const pullDelta = currentY - loadingTouchStartY;

            // Update both wrapper and spinner position to maintain parallax consistency
            const newTransform = targetPosition + pullDelta;
            if (newTransform > 0) {
              for (const wrapper of wrappers) {
                wrapper.style.transform = `translateY(${newTransform}px)`;
              }

              // Update spinner position with same parallax calculation
              const loadingSpinner = parentEl.querySelector('.pull-refresh-loading') as HTMLElement;
              if (loadingSpinner) {
                const headerbar = document.querySelector('.titlebar');
                const headerBottom = headerbar?.getBoundingClientRect().bottom || 0;
                const parallaxOffset = newTransform * PARALLAX_EFFECT;
                loadingSpinner.style.top = `${headerBottom + parallaxOffset}px`;
                loadingSpinner.style.opacity = '1';
              }
            }

            // User pulled up significantly, reset
            if (pullDelta < -30) {
              for (const wrapper of wrappers) {
                wrapper.style.transition = 'transform 0.3s ease-out';
                wrapper.style.transform = 'translateY(0)';
              }
              hideLoadingSpinner(parentEl);
              el.removeEventListener('touchstart', handleLoadingTouchStart);
              el.removeEventListener('touchmove', handleLoadingTouchMove);
            }
          };

          el.addEventListener('touchstart', handleLoadingTouchStart, { passive: true });
          el.addEventListener('touchmove', handleLoadingTouchMove, { passive: true });

          try {
            const triggerFn = isStage2 ? onTriggerStage2 : onTriggerStage1;
            await Promise.resolve(triggerFn());
          } catch (error) {
            console.error('Pull to refresh error:', error);
          } finally {
            isLoading = false;
            hideLoadingSpinner(parentEl);
            for (const wrapper of wrappers) {
              wrapper.style.transition = 'transform 0.3s ease-out';
              wrapper.style.transform = 'translateY(0)';
            }
            setTimeout(() => {
              for (const wrapper of wrappers) {
                wrapper.style.transition = '';
              }
            }, 300);
            el.removeEventListener('touchstart', handleLoadingTouchStart);
            el.removeEventListener('touchmove', handleLoadingTouchMove);
          }
        } else {
          hideLoadingSpinner(parentEl);
          for (const wrapper of wrappers) {
            wrapper.style.transition = SNAP_BACK_TRANSITION;
            wrapper.style.transform = 'translateY(0)';
          }

          el.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function onTransitionEnd() {
        const el = ref.current;
        if (!el) return;

        el.style.transition = '';
        el.removeEventListener('transitionend', onTransitionEnd);
      }
    }

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current]);
};
