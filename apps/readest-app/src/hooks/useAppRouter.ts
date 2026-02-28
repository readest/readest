import { useEnv } from '@/context/EnvContext';
import { useRouter } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';

export const useAppRouter = () => {
  const { appService } = useEnv();
  const transitionRouter = useTransitionRouter();
  const plainRouter = useRouter();

  // View Transitions API crashes WebKitGTK 4.1 on Linux
  return appService?.isLinuxApp ? plainRouter : transitionRouter;
};
