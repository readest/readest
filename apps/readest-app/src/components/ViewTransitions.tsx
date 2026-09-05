'use client';

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

const NavigationTransition = createContext((navigate: () => void) => navigate());

export function ViewTransitions({ children }: { children: ReactNode }) {
  const [finish, setFinish] = useState<(() => void) | null>(null);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    finish?.();
  }, [finish]);
  useEffect(() => () => pending.current?.(), []);

  const navigate = useCallback((update: () => void) => {
    if (!document.startViewTransition) return update();
    pending.current?.();
    const transition = document.startViewTransition(
      () =>
        new Promise<void>((resolve, reject) => {
          pending.current?.();
          pending.current = resolve;
          startTransition(() => {
            try {
              update();
              setFinish(() => resolve);
            } catch (error) {
              reject(error);
            }
          });
        }),
    );
    // Skipped/overlapping animations must not turn successful navigation into
    // an unhandled rejection. Actual route-update failures remain observable.
    void transition.ready.catch(() => {});
    void transition.finished.catch(() => {});
    void transition.updateCallbackDone.catch((error) => {
      console.error('Failed to update route during view transition:', error);
    });
  }, []);

  // Only explicit push/replace calls animate. Native history navigation can
  // change just the query string (OPDS), with no new route mount to await.
  return <NavigationTransition.Provider value={navigate}>{children}</NavigationTransition.Provider>;
}

export function useTransitionRouter() {
  const router = useRouter();
  const navigate = useContext(NavigationTransition);
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => navigate(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        navigate(() => router.replace(...args)),
    }),
    [router, navigate],
  );
}
