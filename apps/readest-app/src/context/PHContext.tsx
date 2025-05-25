'use client';
import posthog from 'posthog-js';
import { ReactNode } from 'react';
import { PostHogProvider } from 'posthog-js/react';
import { TELEMETRY_OPT_OUT_KEY } from '@/utils/telemetry';

const shouldDisablePostHog = () => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === 'true';
};

if (
  typeof window !== 'undefined' &&
  process.env['NODE_ENV'] === 'production' &&
  process.env['NEXT_PUBLIC_POSTHOG_KEY']
) {
  posthog.init(process.env['NEXT_PUBLIC_POSTHOG_KEY'], {
    api_host: process.env['NEXT_PUBLIC_POSTHOG_HOST'],
    person_profiles: 'always',
  });
  if (shouldDisablePostHog()) {
    posthog.opt_out_capturing();
  }
}
export const CSPostHogProvider = ({ children }: { children: ReactNode }) => {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};
