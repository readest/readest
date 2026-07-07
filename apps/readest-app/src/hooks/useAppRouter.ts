import { useEnv } from '@/context/EnvContext';
import { useRouter } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';

export const useAppRouter = () => {
  const { appService } = useEnv();
  const transitionRouter = useTransitionRouter();
  const plainRouter = useRouter();

  // A route transition is a plain full-page crossfade, so it only needs the
  // base View Transitions API - not the nested view-transition groups the
  // paginator turns require. Route through the transition router wherever the
  // API is usable (appService folds in the Linux WebKitGTK carve-out); engines
  // without it navigate plainly, sidestepping the DOM-update-budget TimeoutError
  // seen on unsupported webviews (Sentry READEST-9).
  return appService?.supportsViewTransitionsAPI ? transitionRouter : plainRouter;
};
