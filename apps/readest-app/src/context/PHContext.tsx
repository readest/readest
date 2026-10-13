'use client';

import posthog from 'posthog-js';
import { ReactNode } from 'react';
import { PostHogProvider } from 'posthog-js/react';
import { applyPostHogConsent, getTelemetryDecision } from '@/utils/telemetry';
import { getAppVersion } from '@/utils/version';

const posthogUrl =
  process.env['NEXT_PUBLIC_POSTHOG_HOST'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_POSTHOG_URL_BASE64']!);
const posthogKey =
  process.env['NEXT_PUBLIC_POSTHOG_KEY'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_POSTHOG_KEY_BASE64']!);

let initialized = false;

/**
 * Start PostHog after the boot code has resolved the consent decision, so the
 * SDK cannot capture an event of its own (an initial pageview, for example)
 * before it knows the saved setting. Providers calls this once the settings
 * file is loaded and `reconcileTelemetryConsent` has run (issue #6422).
 */
export const initPostHog = () => {
  if (
    initialized ||
    typeof window === 'undefined' ||
    process.env['NODE_ENV'] !== 'production' ||
    !posthogKey
  ) {
    return;
  }

  initialized = true;
  posthog.init(posthogKey, {
    api_host: posthogUrl,
    person_profiles: 'always',
    autocapture: false,
    // Opted out unless the user said yes. The decision is final at this point.
    opt_out_capturing_by_default: getTelemetryDecision() !== 'opt-in',
    // Readest uses no feature flags, surveys, or session recordings. Their
    // loaders fetch remote assets even while capture is opted out, so turn
    // them off: an opted-out user then sends no request at all (issue #6422).
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    disable_session_recording: true,
    disable_surveys: true,
  });
  // Apply the decision now that init has set the project token. PostHog keeps
  // consent under a token-specific key, so an older grant stored there would
  // otherwise win. The SDK's initial pageview reads consent one tick from
  // now, so this synchronous call stops it (issue #6422).
  applyPostHogConsent();
  posthog.register_for_session({ $app_version: getAppVersion() });
  // AuthContext identifies a restored session at boot, usually before this
  // runs, and PostHog drops calls made before init. Identify it again here.
  const storedUser = localStorage.getItem('user');
  if (storedUser) posthog.identify((JSON.parse(storedUser) as { id: string }).id);
};

export const CSPostHogProvider = ({ children }: { children: ReactNode }) => {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};
