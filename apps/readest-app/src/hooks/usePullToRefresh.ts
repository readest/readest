import { useEffect } from 'react';
import { getOSPlatform } from '@/utils/misc';

const TRIGGER_THRESHOLD_STAGE1 = 120;
const TRIGGER_THRESHOLD_STAGE2 = 400;
const MAX_LOADING_POSITION = 80;
const PARALLAX_EFFECT = 0.3;

// Platform-specific damping parameters for pull resistance
const getPlatformDamping = () => {
  const platform = getOSPlatform();

  if (platform === 'ios') {
    // iOS - tighter resistance (lower k = more damping)
    return { MAX: 120, k: 0.35 };
  } else if (platform === 'android') {
    // Android - looser resistance (higher k = less damping)
    return { MAX: 140, k: 0.5 };
  }
  return { MAX: 128, k: 0.4 };
};

function createApprFunction(MAX: number, k: number) {
  return (x: number) => MAX * (1 - Math.exp((-k * x) / MAX));
}

export const usePullToRefresh = (
  ref: React.RefObject<HTMLDivElement | null>,
  onTriggerStage1: () => Promise<void> | void,
  onTriggerStage2?: () => Promise<void> | void,
) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const damping = getPlatformDamping();
    const appr = createApprFunction(damping.MAX, damping.k);
    let isLoading = false;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });

    function handleTouchStart(startEvent: TouchEvent) {
      const el = ref.current;
      if (!el) return;

      if (el.scrollTop > 0) return;

      const initialX = startEvent.touches[0]!.clientX;
      const initialY = startEvent.touches[0]!.clientY;

      el.addEventListener('touchmove', handleTouchMove, { passive: true });
      el.addEventListener('touchend', handleTouchEnd);

      function handleTouchMove(moveEvent: TouchEvent) {
        const el = ref.current;
        if (!el) return;
        if (isLoading) return;

        const currentX = moveEvent.touches[0]!.clientX;
        const currentY = moveEvent.touches[0]!.clientY;
        const dx = currentX - initialX;
        const dy = currentY - initialY;
        if (dy < 0 || Math.abs(dx) * 2 > Math.abs(dy)) return;

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

        const wrapper = el.querySelector('.transform-wrapper') as HTMLElement;
        if (wrapper) {
          wrapper.style.transform = `translate3d(0, ${transformValue}px, 0)`;
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

        const wrapper = el.querySelector('.transform-wrapper') as HTMLElement;
        const parentEl = el.parentNode as HTMLDivElement;

        const y = endEvent.changedTouches[0]!.clientY;
        const dy = y - initialY;

        el.removeEventListener('touchmove', handleTouchMove);
        el.removeEventListener('touchend', handleTouchEnd);

        const isStage2 = onTriggerStage2 && dy > TRIGGER_THRESHOLD_STAGE2;
        const isStage1 = dy > TRIGGER_THRESHOLD_STAGE1;

        if (isStage2 || isStage1) {
          isLoading = true;

          // Calculate current transform value with damping
          const transformValue = appr(dy);
          const targetPosition = Math.min(transformValue, MAX_LOADING_POSITION);

          if (wrapper) {
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
              if (wrapper) {
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
              if (wrapper) {
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
            if (wrapper) {
              wrapper.style.transition = 'transform 0.3s ease-out';
              wrapper.style.transform = 'translateY(0)';
              setTimeout(() => {
                if (wrapper) wrapper.style.transition = '';
              }, 300);
            }
            el.removeEventListener('touchstart', handleLoadingTouchStart);
            el.removeEventListener('touchmove', handleLoadingTouchMove);
          }
        } else {
          hideLoadingSpinner(parentEl);
          if (wrapper) {
            wrapper.style.transition = 'transform 0.2s';
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
