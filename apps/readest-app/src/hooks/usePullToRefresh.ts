import { useEffect } from 'react';

const TRIGGER_THRESHOLD = 120;
const SHOW_INDICATOR_THRESHOLD = 60;

const MAX = 128;
const k = 0.4;
function appr(x: number) {
  return MAX * (1 - Math.exp((-k * x) / MAX));
}

export const usePullToRefresh = (ref: React.RefObject<HTMLDivElement>, onTrigger: () => void) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

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

        const currentX = moveEvent.touches[0]!.clientX;
        const currentY = moveEvent.touches[0]!.clientY;
        const dx = currentX - initialX;
        const dy = currentY - initialY;
        if (dy < 0 || Math.abs(dx) * 2 > Math.abs(dy)) return;

        const parentEl = el.parentNode as HTMLDivElement;
        if (dy > TRIGGER_THRESHOLD) {
          flipArrow(parentEl);
        } else if (dy > SHOW_INDICATOR_THRESHOLD) {
          addPullIndicator(parentEl);
        } else {
          removePullIndicator(parentEl);
        }

        const wrapper = el.querySelector('.transform-wrapper') as HTMLElement;
        if (wrapper) {
          wrapper.style.transform = `translate3d(0, ${appr(dy)}px, 0)`;
        }
      }

      function addPullIndicator(el: HTMLDivElement) {
        const indicator = el.querySelector('.pull-indicator');
        if (indicator) {
          if (indicator.classList.contains('flip')) {
            indicator.classList.remove('flip');
          }
          return;
        }

        const pullIndicator = document.createElement('div');
        pullIndicator.className = 'pull-indicator text-gray-500';
        pullIndicator.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 19c-.3 0-.6-.1-.8-.3l-6-6c-.4-.4-.4-1 0-1.4s1-.4 1.4 0L11 16.2V5c0-.6.4-1 1-1s1 .4 1 1v11.2l4.4-4.4c.4-.4 1-.4 1.4 0s.4 1 0 1.4l-6 6c-.2.2-.5.3-.8.3z"/>
          </svg>
        `;
        el.appendChild(pullIndicator);
      }

      function removePullIndicator(el: HTMLDivElement) {
        const pullIndicator = el.querySelector('.pull-indicator');
        if (pullIndicator) {
          pullIndicator.remove();
        }
      }

      function flipArrow(el: HTMLDivElement) {
        const pullIndicator = el.querySelector('.pull-indicator');
        if (pullIndicator && !pullIndicator.classList.contains('flip')) {
          pullIndicator.classList.add('flip');
        }
      }

      function handleTouchEnd(endEvent: TouchEvent) {
        const el = ref.current;
        if (!el) return;

        const wrapper = el.querySelector('.transform-wrapper') as HTMLElement;
        if (wrapper) {
          wrapper.style.transform = 'translateY(0)';
        }
        removePullIndicator(el.parentNode as HTMLDivElement);

        el.style.transition = 'transform 0.2s';

        const y = endEvent.changedTouches[0]!.clientY;
        const dy = y - initialY;
        if (dy > TRIGGER_THRESHOLD) {
          onTrigger();
        }

        el.addEventListener('transitionend', onTransitionEnd);

        el.removeEventListener('touchmove', handleTouchMove);
        el.removeEventListener('touchend', handleTouchEnd);
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
