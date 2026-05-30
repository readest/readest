import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTrafficLightStore } from '@/store/trafficLightStore';

/**
 * Initializes the traffic-light store for the current window and (when
 * a header ref is provided) keeps Rust's centering calculation in sync
 * with the page's actual header height. Without a ref, the store's
 * h-11 (44px) fallback is used — fine for chrome that matches; pages
 * whose chrome is taller (library's h-[44px] / h-[52px], OPDS's
 * h-[48px], etc.) must pass their own ref so the inset is computed
 * from the rendered height instead of the default.
 *
 * Callers that conditionally render the header element (LibraryHeader
 * delays mounting until `insets` resolves) need this hook to react
 * when the ref's `.current` flips from null to the live node. We can't
 * depend on the ref object itself — `useRef` returns the same handle
 * every render — so we mirror `ref.current` into local state and use
 * that as the effect dependency.
 */
export const useTrafficLight = (headerRef?: React.RefObject<HTMLElement | null>) => {
  const { appService } = useEnv();
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(() => headerRef?.current ?? null);

  const {
    isTrafficLightVisible,
    initializeTrafficLightStore,
    initializeTrafficLightListeners,
    setTrafficLightVisibility,
    cleanupTrafficLightListeners,
  } = useTrafficLightStore();

  // Sync ref.current → state on every render. The guard inside
  // `setHeaderEl` is a no-op when the value hasn't changed, so this
  // doesn't trigger a re-render storm.
  useEffect(() => {
    const current = headerRef?.current ?? null;
    setHeaderEl((prev) => (prev === current ? prev : current));
  });

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;

    initializeTrafficLightStore(appService);
    initializeTrafficLightListeners();
    // The ResizeObserver below fires once immediately on `observe()`
    // with the current border-box size, so if `headerEl` is already
    // mounted we leave the initial height to that callback; otherwise
    // we fall back to the store's standard `h-11` (44px) until the
    // element appears and the observer kicks in.
    setTrafficLightVisibility(true, headerEl?.getBoundingClientRect().height);
    return () => {
      cleanupTrafficLightListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasTrafficLight]);

  // Track header size so chrome that resizes (responsive breakpoint,
  // font scale, safe-area inset shift) recenters the buttons without a
  // per-component push. Read the border-box height — `entry.contentRect`
  // returns content-box, which excludes padding. Library's `h-[48px]`
  // with `py-2` measures 32 via contentRect (off by 16), pushing y too
  // small and dropping the buttons toward the top of the chrome.
  useEffect(() => {
    if (!appService?.hasTrafficLight || !headerEl) return;
    let lastHeight = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const height =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
      if (height <= 0 || height === lastHeight) return;
      lastHeight = height;
      const { shouldShowTrafficLight } = useTrafficLightStore.getState();
      setTrafficLightVisibility(shouldShowTrafficLight, height);
    });
    observer.observe(headerEl);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasTrafficLight, headerEl]);

  return { isTrafficLightVisible };
};
