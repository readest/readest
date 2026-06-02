'use client';

import type { ReactNode } from 'react';
import { LOCAL_ONLY_MODE } from '@/services/featureFlags';
import LocalOnlyRedirect from './LocalOnlyRedirect';

const LocalOnlyRouteGuard = ({ children }: { children: ReactNode }) => {
  if (LOCAL_ONLY_MODE) return <LocalOnlyRedirect />;
  return <>{children}</>;
};

export default LocalOnlyRouteGuard;
