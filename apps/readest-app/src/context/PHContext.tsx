'use client';

import posthog from 'posthog-js';
import { ReactNode } from 'react';
import { PostHogProvider } from 'posthog-js/react';
import { TELEMETRY_OPT_OUT_KEY } from '@/utils/telemetry';

const shouldDisablePostHog = () => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === 'true';
};

const posthogUrl =
  process.env['NEXT_PUBLIC_POSTHOG_HOST'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_POSTHOG_URL_BASE64']!);
const posthogKey =
  process.env['NEXT_PUBLIC_POSTHOG_KEY'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_POSTHOG_KEY_BASE64']!);

if (typeof window !== 'undefined' && process.env['NODE_ENV'] === 'production' && posthogKey) {
  posthog.init(posthogKey, {
    api_host: posthogUrl,
    person_profiles: 'always',
  });
  if (shouldDisablePostHog()) {
    posthog.opt_out_capturing();
  }
}
export const CSPostHogProvider = ({ children }: { children: ReactNode }) => {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};
